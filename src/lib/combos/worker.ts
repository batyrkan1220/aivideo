import "server-only";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { faceSlotSchema, qualitySchema } from "@/lib/templates/schema";
import { isPhotoProvider, PHOTO_QUALITY } from "@/lib/templates/photo-config";
import { notifyOrderOwner } from "@/lib/telegram/bot";
import { notifyAdmins } from "@/lib/telegram/admin";
import { track } from "@/lib/analytics";

/*
  Photo combo: the customer pays once for a set of photo templates and uploads one selfie.
  After payment the combo's generation job opens one child order per photo template
  (paid by the parent, 0 ₸, its own copy of the selfie and its own Kling job), then waits
  until every child has finished. Children reuse the normal photo pipeline end to end.
*/

export const COMBO_PROVIDER = "combo";
export const comboConfigSchema = z.object({
  templateIds: z.array(z.string().uuid()).min(2).max(20),
  discountPercent: z.number().min(0).max(90).default(0),
  pricePerPhoto: z.number().int().min(0).optional(),
});
export type ComboConfig = z.infer<typeof comboConfigSchema>;

type Job = { id: string; order_id: string; attempt_count: number; provider_state: Record<string, unknown> | null };
type Result = { action: "processing" | "delay" | "completed" | "failed"; code?: string; children?: string[] };

const POLL_MS = 10_000;

/** Opens the child orders (idempotent: a retry reuses the ones already created). */
export async function startCombo(job: Job): Promise<Result> {
  const db = supabaseAdmin();
  const { data: order } = await db.from("orders")
    .select("id,user_id,payment_status,template_snapshot_json").eq("id", job.order_id).single();
  if (!order?.user_id) return { action: "failed", code: "order_missing" };
  if (order.payment_status !== "succeeded") return { action: "failed", code: "unpaid" };
  const snap = order.template_snapshot_json as Record<string, unknown>;
  const cfg = comboConfigSchema.safeParse(snap.provider_config_json);
  if (!cfg.success) return { action: "failed", code: "invalid_template" };

  // The selfie the customer uploaded for the combo.
  const { data: selfie } = await db.from("order_assets")
    .select("private_storage_path,mime_type,file_size,width,height,expires_at,verified_at")
    .eq("order_id", order.id).not("verified_at", "is", null).limit(1).maybeSingle();
  if (!selfie) return { action: "failed", code: "missing_inputs" };

  const { data: existing } = await db.from("orders").select("id,template_id").eq("parent_order_id", order.id);
  const have = new Map((existing ?? []).map((c) => [c.template_id as string, c.id as string]));
  const children: string[] = [];

  for (const templateId of cfg.data.templateIds) {
    if (have.has(templateId)) { children.push(have.get(templateId)!); continue; }
    const { data: t } = await db.from("templates").select("id,status,kind,current_version_id").eq("id", templateId).maybeSingle();
    if (!t || t.status !== "published" || !["catalog", "combo_item"].includes(t.kind as string) || !t.current_version_id) continue;
    const { data: v } = await db.from("template_versions").select("id,configuration_snapshot").eq("id", t.current_version_id).single();
    const cs = (v?.configuration_snapshot ?? {}) as Record<string, unknown>;
    if (!v || !isPhotoProvider(cs.provider_key as string)) continue;
    const slots = z.array(faceSlotSchema).safeParse(cs.face_slots_json);
    if (!slots.success || slots.data.length !== 1) continue; // combos use one-person photo templates
    const quality = z.array(qualitySchema).safeParse(cs.supported_qualities_json);
    const q = (quality.success && quality.data[0]) || PHOTO_QUALITY;

    const { data: child, error } = await db.from("orders").insert({
      user_id: order.user_id, template_id: t.id, template_version_id: v.id,
      template_snapshot_json: { ...cs, quality: q, combo_parent: order.id },
      quality: q.key, face_count: 1,
      pricing_breakdown_json: { totalKzt: 0, combo: true }, amount_kzt: 0, currency: "KZT",
      consent_accepted_at: new Date().toISOString(),
      payment_status: "succeeded", generation_status: "queued", parent_order_id: order.id,
    }).select("id").single();
    if (error || !child) { console.error("[combo.child]", error?.code, error?.message); continue; }

    // Its own copy of the selfie (asset paths are unique; retention deletes each copy on its own).
    const ext = selfie.private_storage_path.split(".").pop() ?? "jpg";
    const path = `${order.user_id}/combo/${child.id}.${ext}`;
    const { error: cpErr } = await db.storage.from("user-uploads").copy(selfie.private_storage_path, path);
    if (cpErr) { await db.from("orders").delete().eq("id", child.id); return { action: "delay", code: "combo_copy_failed" }; }
    await db.from("order_assets").insert({
      user_id: order.user_id, order_id: child.id, template_id: t.id, face_slot_key: slots.data[0].key,
      private_storage_path: path, mime_type: selfie.mime_type, file_size: selfie.file_size,
      width: selfie.width, height: selfie.height, expires_at: selfie.expires_at, verified_at: selfie.verified_at,
    });
    await db.from("generation_jobs").insert({ order_id: child.id, provider: cs.provider_key as string, status: "queued" });
    children.push(child.id);
  }

  if (!children.length) return { action: "failed", code: "invalid_template" };
  return { action: "processing", children };
}

/** Parent progress: done when every child has finished; succeeds if at least one photo came out. */
export async function pollCombo(job: Job): Promise<Result & { progress?: number }> {
  const db = supabaseAdmin();
  const { data: kids } = await db.from("orders").select("generation_status").eq("parent_order_id", job.order_id);
  const all = kids ?? [];
  if (!all.length) return { action: "failed", code: "invalid_template" };
  const done = all.filter((k) => ["completed", "failed", "cancelled"].includes(k.generation_status as string));
  const ok = all.filter((k) => k.generation_status === "completed").length;
  if (done.length < all.length) return { action: "delay", progress: Math.round((done.length / all.length) * 100) };
  return ok > 0 ? { action: "completed" } : { action: "failed", code: "generic" };
}

/** Worker hook for the combo job (returns after updating the job and order). */
export async function stepCombo(job: Job & { status: string }) {
  const db = supabaseAdmin();
  const now = () => new Date().toISOString();
  const later = (ms: number) => new Date(Date.now() + ms).toISOString();

  if (job.status === "queued") {
    const r = await startCombo(job);
    if (r.action === "failed") return finish(job, false, r.code);
    if (r.action === "delay") {
      await db.from("generation_jobs").update({ next_attempt_at: later(30_000), attempt_count: job.attempt_count + 1, error_code: r.code ?? null }).eq("id", job.id);
      return;
    }
    await db.from("generation_jobs").update({
      status: "processing", provider_job_id: `combo_${job.order_id}`, provider_state: { children: r.children },
      started_at: now(), attempt_count: job.attempt_count + 1, progress: 0, next_attempt_at: later(POLL_MS),
    }).eq("id", job.id);
    await db.from("orders").update({ generation_status: "processing" }).eq("id", job.order_id);
    return;
  }

  const r = await pollCombo(job);
  if (r.action === "delay") {
    await db.from("generation_jobs").update({ next_attempt_at: later(POLL_MS), progress: r.progress ?? null, last_polled_at: now() }).eq("id", job.id);
    return;
  }
  return finish(job, r.action === "completed", r.code);
}

async function finish(job: Job, ok: boolean, code?: string) {
  const db = supabaseAdmin();
  const at = new Date().toISOString();
  // Provider cost of the combo = sum of its children (for admin stats).
  const { data: kids } = await db.from("orders").select("id").eq("parent_order_id", job.order_id);
  const ids = (kids ?? []).map((k) => k.id);
  const { data: costs } = ids.length
    ? await db.from("generation_jobs").select("provider_cost").in("order_id", ids)
    : { data: [] as { provider_cost: number | null }[] };
  const cost = (costs ?? []).reduce((s, c) => s + (Number(c.provider_cost) || 0), 0);
  await db.from("generation_jobs").update({
    status: ok ? "completed" : "failed", completed_at: at, progress: 100, provider_cost: cost || null,
    error_code: ok ? null : code ?? "generic", retryable: false,
  }).eq("id", job.id);
  await db.from("orders").update({ generation_status: ok ? "completed" : "failed", ...(ok ? { completed_at: at } : {}) }).eq("id", job.order_id);
  await notifyOrderOwner(job.order_id, ok ? "ready" : "failed");
  await notifyAdmins(job.order_id, ok ? "ready" : "failed");
  await track(ok ? "generation_succeeded" : "generation_failed", { orderId: job.order_id, props: { combo: true, ...(code ? { code } : {}) } });
}
