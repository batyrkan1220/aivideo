"use server";
import { z } from "zod";
import { requirePermission, ForbiddenError, audit } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { mediaUrl } from "@/lib/templates/queries";
import { akoolStartAnalysis, akoolGetAnalysis } from "@/lib/generation/akool";
import { ProviderError } from "@/lib/generation/types";
import type { AkoolConfig } from "@/lib/templates/akool-config";

/**
 * Akool Character Swap V5 person analysis for a template video (admin only).
 * start → poll until done → the people (obj_id + preview image) are returned to the editor.
 * Preview images are copied into our public template-media bucket because Akool URLs expire.
 */

export type AnalysisError =
  | "forbidden" | "no_video" | "not_configured" | "no_balance" | "auth" | "feature_disabled"
  | "failed" | "no_people" | "generic";

async function staff() {
  try { return await requirePermission("templates.manage"); }
  catch (e) { if (e instanceof ForbiddenError) return null; throw e; }
}

const pathSchema = z.string().regex(/^previews\/[A-Za-z0-9._-]+$/).max(300);

function mapError(err: unknown): AnalysisError {
  if (!(err instanceof ProviderError)) return "generic";
  console.error("[akool.analysis]", err.code, err.message);
  if (err.code === "provider_not_configured") return "not_configured";
  if (err.code === "provider_no_balance") return "no_balance";
  if (err.code === "provider_auth") return "auth";
  if (err.code === "provider_feature_disabled") return "feature_disabled";
  return "generic";
}

export async function startPersonAnalysis(videoPath: string):
  Promise<{ ok: true; id: string; videoUrl: string } | { ok: false; error: AnalysisError }> {
  const u = await staff();
  if (!u) return { ok: false, error: "forbidden" };
  if (!pathSchema.safeParse(videoPath).success) return { ok: false, error: "no_video" };
  const videoUrl = mediaUrl(videoPath)!;
  try {
    const id = await akoolStartAnalysis(videoUrl);
    await audit(u.id, "template.akool_analysis", "template_media", null, { videoPath, analysisId: id });
    return { ok: true, id, videoUrl };
  } catch (err) {
    return { ok: false, error: mapError(err) };
  }
}

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export async function checkPersonAnalysis(id: string, videoPath: string, videoUrl: string):
  Promise<
    | { ok: true; done: false; progress: number | null }
    | { ok: true; done: true; analysis: NonNullable<AkoolConfig["analysis"]> }
    | { ok: false; error: AnalysisError; reason?: string }
  > {
  const u = await staff();
  if (!u) return { ok: false, error: "forbidden" };
  if (!/^[a-fA-F0-9]{24}$/.test(id) || !pathSchema.safeParse(videoPath).success || videoUrl !== mediaUrl(videoPath)) {
    return { ok: false, error: "generic" };
  }

  let res;
  try { res = await akoolGetAnalysis(id); }
  catch (err) { return { ok: false, error: mapError(err) }; }

  if (res.state === "processing") return { ok: true, done: false, progress: res.progress };
  if (res.state === "failed") return { ok: false, error: "failed", reason: res.reason.slice(0, 200) };
  if (!res.people.length) return { ok: false, error: "no_people" };

  const db = supabaseAdmin();
  const people: { objId: number; previewPath?: string }[] = [];
  for (const p of res.people.slice(0, 30)) {
    // Preview images are optional in the V5 API; copy them when present (Akool URLs expire).
    if (!p.imgUrl) { people.push({ objId: p.objId }); continue; }
    try {
      const r = await fetch(p.imgUrl, { signal: AbortSignal.timeout(20_000) });
      const type = (r.headers.get("content-type") ?? "").split(";")[0].trim();
      if (!r.ok || !EXT[type]) throw new Error(`preview ${r.status} ${type}`);
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf.byteLength > 5 * 1024 * 1024) throw new Error("preview too large");
      const path = `people/${id}/${p.objId}.${EXT[type]}`;
      const { error } = await db.storage.from("template-media").upload(path, buf, { contentType: type, upsert: true });
      if (error) throw new Error(error.message);
      people.push({ objId: p.objId, previewPath: path });
    } catch (err) {
      console.error("[akool.preview]", id, p.objId, err instanceof Error ? err.message : err);
      people.push({ objId: p.objId });
    }
  }
  return { ok: true, done: true, analysis: { id, videoPath, videoUrl, ...(res.trackManifestUrl ? { trackManifestUrl: res.trackManifestUrl } : {}), people } };
}
