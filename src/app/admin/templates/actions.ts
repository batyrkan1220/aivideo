"use server";
import { catalogSettings } from "@/lib/catalog/settings";
import { clearMemo } from "@/lib/cache/memo";
import { snapshotVersion } from "@/lib/templates/versions";
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

  // A new video needs a new AI analysis: the old cut-outs and descriptions belong to the old one.
  if (row.provider_key === "seedance" && row.preview_video_path !== before.preview_video_path && row.provider_config_json && typeof row.provider_config_json === "object") {
    const { analyzedAt: _old, ...rest } = row.provider_config_json as Record<string, unknown>;
    row.provider_config_json = rest;
  }
  const { error } = await db.from("templates").update(row).eq("id", id);
  if (error) { console.error("[admin.template.update]", error.code, error.message); return { ok: false, error: "generic" }; }

  // New video already lives in Supabase. Point the card at that same file — do not download it back.
  if (row.preview_video_path !== before.preview_video_path) {
    const old = before.preview_lite_path;
    await db.from("templates").update({
      preview_anim_path: null,
      // The Kling copy and the measured size belong to the old video; the preview job remakes them.
      kling_video_path: null,
      video_px: null,
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
    const problems = input.success ? publishProblems(input.data, r.video_duration_sec == null ? null : Number(r.video_duration_sec), r.kind === "catalog", (await catalogSettings()).requireAnalysis) : (["invalid_face_slots"] as PublishProblem[]);
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
  kind: z.enum(["cover", "preview", "target"]),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm"]),
  size: z.number().int().positive(),
});
const LIMITS = { cover: 5 * 1024 * 1024, preview: 50 * 1024 * 1024, target: 1024 * 1024 } as const;
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
  if ((kind !== "preview") !== isImage || size > LIMITS[kind]) return { ok: false as const };

  const path = `${kind === "cover" ? "covers" : kind === "target" ? "targets" : "previews"}/${randomUUID()}.${EXT[contentType]}`;
  const { data, error } = await supabaseAdmin().storage.from("template-media").createSignedUploadUrl(path);
  if (error) { console.error("[admin.upload]", error.message); return { ok: false as const }; }
  return { ok: true as const, path: data.path, token: data.token };
}

export type DetectResult =
  | ({ ok: true } & import("@/lib/templates/vision").VisionResult)
  | { ok: false; error: "forbidden" | "not_configured" | "failed" | "invalid" };

/** Template editor: Gemini lists the people and things in a few frames the browser cut from the video. */
export async function detectTemplateElements(framesRaw: unknown): Promise<DetectResult> {
  const user = await guard("templates.manage");
  if (!user) return { ok: false, error: "forbidden" };
  const frames = z.array(z.string().regex(/^[A-Za-z0-9+/=]+$/).max(500_000)).min(1).max(8).safeParse(framesRaw);
  if (!frames.success) return { ok: false, error: "invalid" };
  const { describeTemplateFrames, VisionError } = await import("@/lib/templates/vision");
  try {
    return { ok: true, ...(await describeTemplateFrames(frames.data)) };
  } catch (err) {
    return { ok: false, error: err instanceof VisionError ? err.code : "failed" };
  }
}

/** Admin: run the AI analysis on the server again (people count and things stay as set). */
export async function reanalyzeTemplate(id: string): Promise<{ ok: boolean }> {
  const user = await guard("templates.manage");
  if (!user || !z.string().uuid().safeParse(id).success) return { ok: false };
  const { queueAnalysis } = await import("@/lib/templates/analyze-server");
  queueAnalysis(id);
  await audit(user.id, "template.reanalyze", "template", id, {});
  return { ok: true };
}

/** Admin: the scene changes ffmpeg finds in the template video and the shots Kling gets, with a frame of each. */
export async function templateShots(id: string) {
  const user = await guard("templates.manage");
  if (!user || !z.string().uuid().safeParse(id).success) return null;
  const { data: t } = await supabaseAdmin().from("templates").select("preview_video_path,kling_video_path").eq("id", id).maybeSingle();
  const { mediaUrl } = await import("@/lib/templates/queries");
  const url = mediaUrl(t?.kling_video_path ?? t?.preview_video_path ?? null);
  if (!url) return null;
  try {
    const { previewShots } = await import("@/lib/media/scene-parts");
    const r = await previewShots(url);
    console.log("[scenes] admin", id, `total=${r.total.toFixed(2)} cuts=${r.cuts.map((c) => c.toFixed(2)).join(",") || "-"} shots=${r.parts.map((p) => `${p.start.toFixed(2)}+${p.len.toFixed(2)}`).join(",")}`);
    return r;
  } catch (err) {
    console.error("[scenes] admin failed", err instanceof Error ? err.message.slice(0, 160) : "error");
    return null;
  }
}

/** Admin: show or hide templates with 2–3 people (one Kling run per person) to customers. */
/** Changes one catalog switch and keeps the others. */
async function setCatalogSwitch(key: "multiPeople" | "requireAnalysis", on: boolean, action: string): Promise<{ ok: boolean }> {
  const user = await guard("templates.manage");
  if (!user) return { ok: false };
  const { CATALOG_KEY } = await import("@/lib/catalog/settings");
  const db = supabaseAdmin();
  const { data: cur } = await db.from("site_settings").select("value").eq("key", CATALOG_KEY).maybeSingle();
  const value = { ...((cur?.value as Record<string, unknown> | null) ?? {}), [key]: !!on };
  const { error } = await db.from("site_settings").upsert({ key: CATALOG_KEY, value, updated_by: user.id, updated_at: new Date().toISOString() });
  if (error) return { ok: false };
  await audit(user.id, action, "site_settings", null, { on: !!on });
  clearMemo();
  revalidatePath("/admin/templates");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setMultiPeople(on: boolean) { return setCatalogSwitch("multiPeople", on, "catalog.multi_people"); }
/** Off while Gemini is not available: templates without the AI analysis are open to customers. */
export async function setRequireAnalysis(on: boolean) { return setCatalogSwitch("requireAnalysis", on, "catalog.require_analysis"); }
