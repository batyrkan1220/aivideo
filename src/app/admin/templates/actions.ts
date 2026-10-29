"use server";
import { ensureTemplateDuration } from "@/lib/templates/duration";
import { mediaUrl } from "@/lib/templates/queries";
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
  | { ok: false; error: "invalid" | "forbidden" | "generic"; fields?: string[] };

async function guard(perm: Parameters<typeof requirePermission>[0]) {
  try {
    return await requirePermission(perm);
  } catch (e) {
    if (e instanceof ForbiddenError) return null;
    throw e;
  }
}

export async function saveTemplate(raw: unknown, id: string | null): Promise<SaveResult> {
  const user = await guard("templates.manage");
  if (!user) return { ok: false, error: "forbidden" };

  const parsed = templateInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "invalid", fields: parsed.error.issues.map((i) => i.path.join(".")) };
  }
  const row = inputToRow(parsed.data);
  const db = supabaseAdmin();

  if (!id) {
    const { data, error } = await db.from("templates")
      .insert({ ...row, status: "draft", created_by: user.id }).select("id").single();
    if (error) { console.error("[admin.template.create]", error.code, error.message); return { ok: false, error: "generic" }; }
    if (row.preview_video_path) await ensureTemplateDuration(data.id, mediaUrl(row.preview_video_path));
    await audit(user.id, "template.create", "template", data.id, { title: row.title_kk });
    revalidatePath("/admin/templates");
    return { ok: true, id: data.id };
  }

  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "generic" };
  const { data: before } = await db.from("templates")
    .select("pricing_config_json, supported_qualities_json, status, preview_video_path, video_duration_sec").eq("id", id).single();
  if (!before) return { ok: false, error: "generic" };

  const { error } = await db.from("templates").update(row).eq("id", id);
  if (error) { console.error("[admin.template.update]", error.code, error.message); return { ok: false, error: "generic" }; }

  // Video length drives automatic prices: re-read it whenever the video changes.
  if (row.preview_video_path && (row.preview_video_path !== before.preview_video_path || before.video_duration_sec == null)) {
    await ensureTemplateDuration(id, mediaUrl(row.preview_video_path));
  }
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

  revalidatePath("/admin/templates");
  revalidatePath(`/templates/${id}`);
  return { ok: true, id };
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
    preview_video_path: t.preview_video_path, max_upload_bytes: t.max_upload_bytes,
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
  const { data: t } = await db.from("templates").select("id,kind,cover_asset_path,preview_video_path").eq("id", id).maybeSingle();
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
    const files = [t.cover_asset_path, t.preview_video_path].filter((p): p is string => !!p && !/^https?:/.test(p));
    if (files.length) await db.storage.from("template-media").remove(files);
    mode = "deleted";
  }

  await audit(user.id, "template.delete", "template", id, { mode });
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
