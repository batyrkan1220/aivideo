"use server";
import { clearMemo } from "@/lib/cache/memo";
import { queueLitePreview } from "@/lib/templates/lite-preview";
import { SEEDANCE_MAX_SEC, SEEDANCE_MIN_SEC } from "@/lib/templates/seedance-config";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit, requirePermission, ForbiddenError } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  templateInputSchema, publishProblems, rowToInput, inputToRow, type PublishProblem,
} from "@/lib/templates/admin-schema";

export type SaveResult =
  | { ok: true; id: string }
  | { ok: false; error: "invalid" | "forbidden" | "generic" | "too_long"; fields?: string[] };

/** Length the browser already measured. The server does not download the video to check it. */
function videoMeta(raw: unknown): { durationSec: number | null; aspect: number | null } {
  const p = z.object({
    durationSec: z.number().finite().positive().max(600).nullable().optional(),
    aspect: z.number().finite().positive().max(20).nullable().optional(),
  }).safeParse(raw ?? {});
  if (!p.success) return { durationSec: null, aspect: null };
  return { durationSec: p.data.durationSec ?? null, aspect: p.data.aspect ?? null };
}

function durationRejected(providerKey: string | null, path: string | null, sec: number | null) {
  if (!path || providerKey === "kling_photo") return false;
  return sec != null && (sec < SEEDANCE_MIN_SEC - 0.5 || sec > SEEDANCE_MAX_SEC + 0.5);
}

async function guard(perm: Parameters<typeof requirePermission>[0]) {
  try {
    return await requirePermission(perm);
  } catch (e) {
    if (e instanceof ForbiddenError) return null;
    throw e;
  }
}

export async function saveTemplate(raw: unknown, id: string | null, metaRaw?: unknown): Promise<SaveResult> {
  const user = await guard("templates.manage");
  if (!user) return { ok: false, error: "forbidden" };

  const parsed = templateInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "invalid", fields: parsed.error.issues.map((i) => i.path.join(".")) };
  }
  const row = inputToRow(parsed.data);
  const meta = videoMeta(metaRaw);
  if (durationRejected(row.provider_key, row.preview_video_path, meta.durationSec)) return { ok: false, error: "too_long" };
  const db = supabaseAdmin();

  if (!id) {
    const { data, error } = await db.from("templates")
      .insert({ ...row, status: "draft", created_by: user.id, ...storedVideo(row.preview_video_path, meta) }).select("id").single();
    if (error) { console.error("[admin.template.create]", error.code, error.message); return { ok: false, error: "generic" }; }
    // Light card copies (MP4, animated WebP, cover thumbnail) are made in the background.
    if (row.preview_video_path) queueLitePreview(data.id);
    await audit(user.id, "template.create", "template", data.id, { title: row.title_kk });
    clearMemo();
    revalidatePath("/admin/templates");
    return { ok: true, id: data.id };
  }

  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "generic" };
  const { data: before } = await db.from("templates")
    .select("pricing_config_json, supported_qualities_json, status, preview_video_path, preview_lite_path, preview_anim_path, cover_asset_path, cover_thumb_path, video_duration_sec").eq("id", id).single();
  if (!before) return { ok: false, error: "generic" };

  const { error } = await db.from("templates").update(row).eq("id", id);
  if (error) { console.error("[admin.template.update]", error.code, error.message); return { ok: false, error: "generic" }; }

  // New video already lives in Supabase. Point the card at that same file — do not download it back.
  if (row.preview_video_path !== before.preview_video_path) {
    const old = before.preview_lite_path;
    await db.from("templates").update({
      preview_anim_path: null,
      preview_lite_path: row.preview_video_path,
      video_duration_sec: meta.durationSec ? roundSec(meta.durationSec) : null,
      video_aspect: meta.aspect,
    }).eq("id", id);
    if (before.preview_anim_path?.startsWith("previews/anim")) await db.storage.from("template-media").remove([before.preview_anim_path]);
    if (old && old !== before.preview_video_path && old.startsWith("previews/lite")) await db.storage.from("template-media").remove([old]);
  } else if (row.preview_video_path && before.video_duration_sec == null && meta.durationSec) {
    await db.from("templates").update({
      video_duration_sec: roundSec(meta.durationSec),
      ...(meta.aspect ? { video_aspect: meta.aspect } : {}),
    }).eq("id", id);
  }
  // New cover is uploaded from the browser. Drop the old server-made thumbnail; don't rebuild it here.
  if (row.cover_asset_path !== before.cover_asset_path) {
    await db.from("templates").update({ cover_thumb_path: null }).eq("id", id);
    if (before.cover_thumb_path?.startsWith("covers/thumb")) await db.storage.from("template-media").remove([before.cover_thumb_path]);
  }
  if (row.preview_video_path && (row.preview_video_path !== before.preview_video_path || row.cover_asset_path !== before.cover_asset_path)) queueLitePreview(id);
  await audit(user.id, "template.update", "template", id, { title: row.title_kk });
  const pricingChanged =
    JSON.stringify(before.pricing_config_json) !== JSON.stringify(row.pricing_config_json) ||
    JSON.stringify(before.supported_qualities_json) !== JSON.stringify(row.supported_qualities_json);
  if (pricingChanged) {
    await audit(user.id, "template.pricing_changed", "template", id, {
      before: { pricing: before.pricing_config_json, qualities: before.supported_qualities_json },
      after: { pricing: row.pricing_config_json, qualities: row.supported_qualities_json },
    });
  }
  // A published template's live configuration changed → snapshot a new version for future orders.
  if (before.status === "published") await snapshotVersion(id);

  clearMemo();

  revalidatePath("/admin/templates");
  revalidatePath(`/templates/${id}`);
  return { ok: true, id };
}

/** Card preview is the Supabase object itself, so the web service never pulls the file into RAM. */
function storedVideo(path: string | null, meta: { durationSec: number | null; aspect: number | null }) {
  if (!path) return {};
  return {
    preview_lite_path: path,
    ...(meta.durationSec ? { video_duration_sec: roundSec(meta.durationSec) } : {}),
    ...(meta.aspect ? { video_aspect: meta.aspect } : {}),
  };
}

function roundSec(sec: number) {
  return Math.round(sec * 100) / 100;
}

/** Immutable configuration snapshot; orders reference the version that was current when created. */
async function snapshotVersion(templateId: string) {
  const db = supabaseAdmin();
  const { data: t } = await db.from("templates").select("*").eq("id", templateId).single();
  if (!t) return;
  const { data: last } = await db.from("template_versions").select("version_number")
    .eq("template_id", templateId).order("version_number", { ascending: false }).limit(1).maybeSingle();
  const snapshot = {
    title_kk: t.title_kk, required_face_count: t.required_face_count, face_slots_json: t.face_slots_json,
    supported_qualities_json: t.supported_qualities_json, pricing_config_json: t.pricing_config_json,
    provider_key: t.provider_key, provider_config_json: t.provider_config_json,
    preview_video_path: t.preview_video_path, cover_asset_path: t.cover_asset_path, max_upload_bytes: t.max_upload_bytes,
  };
  const { data: v, error } = await db.from("template_versions")
    .insert({ template_id: templateId, version_number: (last?.version_number ?? 0) + 1, configuration_snapshot: snapshot })
    .select("id").single();
  if (error) { console.error("[admin.template.version]", error.code); return; }
  await db.from("templates").update({ current_version_id: v.id }).eq("id", templateId);
}

export type StatusResult = { ok: true } | { ok: false; error: "forbidden" | "generic"; problems?: PublishProblem[] };

export async function changeStatus(
  id: string, action: "publish" | "unpublish" | "archive" | "restore",
): Promise<StatusResult> {
  const user = await guard("templates.publish");
  if (!user) return { ok: false, error: "forbidden" };
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "generic" };
  const db = supabaseAdmin();

  if (action === "publish") {
    const { data: r } = await db.from("templates").select("*").eq("id", id).single();
    if (!r) return { ok: false, error: "generic" };
    const input = templateInputSchema.safeParse(rowToInput(r));
    const problems = input.success ? publishProblems(input.data, r.video_duration_sec == null ? null : Number(r.video_duration_sec)) : (["invalid_face_slots"] as PublishProblem[]);
    if (problems.length) return { ok: false, error: "generic", problems };
    const { error } = await db.from("templates")
      .update({ status: "published", published_at: r.published_at ?? new Date().toISOString() }).eq("id", id);
    if (error) return { ok: false, error: "generic" };
    await snapshotVersion(id);
  } else {
    const status = action === "unpublish" ? "disabled" : action === "archive" ? "archived" : "draft";
    const { error } = await db.from("templates").update({ status }).eq("id", id);
    if (error) return { ok: false, error: "generic" };
  }

  await audit(user.id, `template.${action}`, "template", id);
  clearMemo();
  revalidatePath("/admin/templates");
  revalidatePath("/");
  return { ok: true };
}

export type DeleteResult = { ok: true; mode: "deleted" | "hidden" } | { ok: false; error: "forbidden" | "generic" };

/**
 * Deletes a template. Without any orders it is removed for good (versions cascade, media files
 * are removed from storage). With order history it is hidden instead: archived + deleted_at, so it
 * disappears from the catalog and the admin list while customers' orders stay intact.
 */
export async function deleteTemplate(id: string): Promise<DeleteResult> {
  const user = await guard("templates.publish");
  if (!user) return { ok: false, error: "forbidden" };
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "generic" };
  const db = supabaseAdmin();
  const { data: t } = await db.from("templates").select("id,kind,cover_asset_path,cover_thumb_path,preview_video_path,preview_lite_path,preview_anim_path").eq("id", id).maybeSingle();
  if (!t || t.kind !== "catalog") return { ok: false, error: "generic" };

  const [{ count: orders }, { count: assets }] = await Promise.all([
    db.from("orders").select("id", { count: "exact", head: true }).eq("template_id", id),
    db.from("order_assets").select("id", { count: "exact", head: true }).eq("template_id", id),
  ]);
  let mode: "deleted" | "hidden";
  if ((orders ?? 0) + (assets ?? 0) > 0) {
    const { error } = await db.from("templates")
      .update({ status: "archived", is_trending: false, deleted_at: new Date().toISOString() }).eq("id", id);
    if (error) return { ok: false, error: "generic" };
    mode = "hidden";
  } else {
    const { error: e1 } = await db.from("templates").update({ current_version_id: null }).eq("id", id);
    const { error: e2 } = e1 ? { error: e1 } : await db.from("templates").delete().eq("id", id);
    if (e2) return { ok: false, error: "generic" };
    const files = [...new Set([t.cover_asset_path, t.cover_thumb_path, t.preview_video_path, t.preview_lite_path, t.preview_anim_path])].filter((p): p is string => !!p && !/^https?:/.test(p));
    if (files.length) await db.storage.from("template-media").remove(files);
    mode = "deleted";
  }

  await audit(user.id, "template.delete", "template", id, { mode });
  clearMemo();
  revalidatePath("/admin/templates");
  revalidatePath("/");
  return { ok: true, mode };
}

const uploadSchema = z.object({
  kind: z.enum(["cover", "preview"]),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm"]),
  size: z.number().int().positive(),
});
const LIMITS = { cover: 5 * 1024 * 1024, preview: 50 * 1024 * 1024 } as const;
const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4", "video/webm": "webm",
};

/**
 * Issues a one-time signed upload URL so the browser uploads straight to storage
 * (large videos never pass through our server). Bucket policy enforces type/size again.
 */
export async function createUploadUrl(raw: unknown) {
  const user = await guard("templates.manage");
  if (!user) return { ok: false as const };
  const p = uploadSchema.safeParse(raw);
  if (!p.success) return { ok: false as const };
  const { kind, contentType, size } = p.data;
  const isImage = contentType.startsWith("image/");
  if ((kind === "cover") !== isImage || size > LIMITS[kind]) return { ok: false as const };

  const path = `${kind === "cover" ? "covers" : "previews"}/${randomUUID()}.${EXT[contentType]}`;
  const { data, error } = await supabaseAdmin().storage.from("template-media").createSignedUploadUrl(path);
  if (error) { console.error("[admin.upload]", error.message); return { ok: false as const }; }
  return { ok: true as const, path: data.path, token: data.token };
}
