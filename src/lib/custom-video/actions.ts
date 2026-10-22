"use server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { track } from "@/lib/analytics";
import { customVideoSettings, MIN_VIDEO_SECONDS, VIDEO_TYPES } from "./settings";
import { mp4DurationSec, sniffVideoType } from "./mp4";
import { env } from "@/lib/env";
import { akoolStartAnalysis, akoolGetAnalysis } from "@/lib/generation/akool";

export type VideoError = "bad_type" | "too_large" | "too_long" | "too_short" | "unreadable" | "disabled" | "rate_limited" | "unauthorized" | "generic";
const BUCKET = "user-videos";
const VIDEOS_PER_HOUR = 20;

const requestSchema = z.object({
  contentType: z.string(),
  size: z.number().int().positive(),
  durationSec: z.number().positive().max(3600),
});

/** Signed upload URL for a customer video. The browser's duration is re-checked from the file later. */
export async function requestVideoUpload(raw: unknown): Promise<{ ok: true; videoId: string; path: string; token: string } | { ok: false; error: VideoError }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "unauthorized" };
  const p = requestSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: "generic" };
  const s = await customVideoSettings();
  if (!s.enabled) return { ok: false, error: "disabled" };
  if (!(VIDEO_TYPES as readonly string[]).includes(p.data.contentType)) return { ok: false, error: "bad_type" };
  if (p.data.size > s.maxMb * 1024 * 1024) return { ok: false, error: "too_large" };
  if (p.data.durationSec > s.maxSeconds + 0.5) return { ok: false, error: "too_long" };
  if (p.data.durationSec < MIN_VIDEO_SECONDS) return { ok: false, error: "too_short" };

  const db = supabaseAdmin();
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await db.from("order_videos").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", since);
  if ((count ?? 0) >= VIDEOS_PER_HOUR) return { ok: false, error: "rate_limited" };

  const ext = p.data.contentType === "video/quicktime" ? "mov" : "mp4";
  const path = `${user.id}/${randomUUID()}.${ext}`;
  const { data: signed, error: sErr } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
  if (sErr || !signed) { console.error("[video.sign]", sErr?.message); return { ok: false, error: "generic" }; }
  const { data: row, error } = await db.from("order_videos").insert({
    user_id: user.id, storage_path: path, mime_type: p.data.contentType, file_size: p.data.size,
  }).select("id").single();
  if (error || !row) { console.error("[video.row]", error?.code); return { ok: false, error: "generic" }; }
  await track("upload_started", { userId: user.id, props: { kind: "custom_video" } });
  return { ok: true, videoId: row.id, path: signed.path, token: signed.token };
}

/** Re-validates the stored bytes: real MP4/MOV container, size and duration. Invalid files are deleted. */
export async function confirmVideoUpload(videoId: string): Promise<{ ok: true; durationSec: number } | { ok: false; error: VideoError }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "unauthorized" };
  if (!z.string().uuid().safeParse(videoId).success) return { ok: false, error: "generic" };
  const db = supabaseAdmin();
  const { data: v } = await db.from("order_videos").select("id,storage_path")
    .eq("id", videoId).eq("user_id", user.id).is("order_id", null).maybeSingle();
  if (!v) return { ok: false, error: "generic" };
  const reject = async (error: VideoError) => {
    await db.storage.from(BUCKET).remove([v.storage_path]);
    await db.from("order_videos").delete().eq("id", v.id);
    return { ok: false as const, error };
  };
  const s = await customVideoSettings();
  const { data: blob, error } = await db.storage.from(BUCKET).download(v.storage_path);
  if (error || !blob) return reject("unreadable");
  if (blob.size > s.maxMb * 1024 * 1024) return reject("too_large");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const type = sniffVideoType(bytes);
  if (!type) return reject("bad_type");
  const dur = mp4DurationSec(bytes);
  if (dur === null) return reject("unreadable");
  if (dur > s.maxSeconds + 0.5) return reject("too_long");
  if (dur < MIN_VIDEO_SECONDS) return reject("too_short");
  await db.from("order_videos").update({ verified_at: new Date().toISOString(), mime_type: type, file_size: bytes.byteLength, duration_sec: dur }).eq("id", v.id);
  await startAnalysis(v.id, v.storage_path);
  return { ok: true, durationSec: dur };
}

/**
 * Akool rule: the video is analysed first; Akool returns every person it found (obj_id + preview).
 * The customer then gives one photo per person to replace, and the task must reuse the SAME url.
 * Without Akool (dev / not configured) the order falls back to replacing the main person.
 */
async function startAnalysis(videoId: string, storagePath: string) {
  const db = supabaseAdmin();
  if (env().AI_PROVIDER !== "akool" || !env().AKOOL_API_KEY) {
    await db.from("order_videos").update({ analysis_status: "unavailable" }).eq("id", videoId);
    return;
  }
  const { data: signed } = await db.storage.from(BUCKET).createSignedUrl(storagePath, URL_TTL_SEC);
  if (!signed) { await db.from("order_videos").update({ analysis_status: "unavailable" }).eq("id", videoId); return; }
  try {
    const id = await akoolStartAnalysis(signed.signedUrl);
    await db.from("order_videos").update({ analysis_status: "processing", akool_analysis_id: id, akool_video_url: signed.signedUrl }).eq("id", videoId);
  } catch (err) {
    console.error("[video.analysis.start]", err instanceof Error ? err.message : err);
    await db.from("order_videos").update({ analysis_status: "unavailable" }).eq("id", videoId);
  }
}

const URL_TTL_SEC = 30 * 24 * 3600; // = order_videos retention; Akool needs the same URL at task time
const IMG_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export type VideoPerson = { objId: number; previewUrl: string | null };
export type AnalysisResult =
  | { status: "processing" }
  | { status: "done"; people: VideoPerson[] }
  | { status: "unavailable" };

/** Polls the analysis; on completion stores the people (previews copied privately, Akool URLs expire). */
export async function checkVideoAnalysis(videoId: string): Promise<AnalysisResult> {
  const user = await getSessionUser();
  if (!user || !z.string().uuid().safeParse(videoId).success) return { status: "unavailable" };
  const db = supabaseAdmin();
  const { data: v } = await db.from("order_videos").select("id,analysis_status,akool_analysis_id,akool_people")
    .eq("id", videoId).eq("user_id", user.id).maybeSingle();
  if (!v || !v.analysis_status || v.analysis_status === "unavailable" || v.analysis_status === "failed") return { status: "unavailable" };
  if (v.analysis_status === "done") return { status: "done", people: await signPeople((v.akool_people ?? []) as StoredPerson[]) };

  let res;
  try { res = await akoolGetAnalysis(v.akool_analysis_id!); }
  catch (err) { console.error("[video.analysis.check]", err instanceof Error ? err.message : err); return { status: "processing" }; }
  if (res.state === "processing") return { status: "processing" };
  if (res.state === "failed" || !res.people.length) {
    await db.from("order_videos").update({ analysis_status: "failed" }).eq("id", v.id);
    return { status: "unavailable" };
  }
  const people: StoredPerson[] = [];
  for (const p of res.people.slice(0, 12)) {
    if (!p.imgUrl) { people.push({ objId: p.objId }); continue; }
    try {
      const r = await fetch(p.imgUrl, { signal: AbortSignal.timeout(20_000) });
      const type = (r.headers.get("content-type") ?? "").split(";")[0].trim();
      if (!r.ok || !IMG_EXT[type]) throw new Error(`preview ${r.status}`);
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf.byteLength > 5 * 1024 * 1024) throw new Error("preview too large");
      const path = `${user.id}/people/${v.akool_analysis_id}/${p.objId}.${IMG_EXT[type]}`;
      const { error } = await db.storage.from("user-uploads").upload(path, buf, { contentType: type, upsert: true });
      if (error) throw new Error(error.message);
      people.push({ objId: p.objId, previewPath: path });
    } catch (err) {
      console.error("[video.analysis.preview]", err instanceof Error ? err.message : err);
      people.push({ objId: p.objId });
    }
  }
  await db.from("order_videos").update({ analysis_status: "done", akool_people: people }).eq("id", v.id);
  return { status: "done", people: await signPeople(people) };
}

type StoredPerson = { objId: number; previewPath?: string };
async function signPeople(people: StoredPerson[]): Promise<VideoPerson[]> {
  const db = supabaseAdmin();
  return Promise.all(people.map(async (p) => {
    if (!p.previewPath) return { objId: p.objId, previewUrl: null };
    const { data } = await db.storage.from("user-uploads").createSignedUrl(p.previewPath, 3600);
    return { objId: p.objId, previewUrl: data?.signedUrl ?? null };
  }));
}

export async function removeVideoUpload(videoId: string): Promise<{ ok: boolean }> {
  const user = await getSessionUser();
  if (!user || !z.string().uuid().safeParse(videoId).success) return { ok: false };
  const db = supabaseAdmin();
  const { data: v } = await db.from("order_videos").select("id,storage_path")
    .eq("id", videoId).eq("user_id", user.id).is("order_id", null).maybeSingle();
  if (!v) return { ok: false };
  await db.storage.from(BUCKET).remove([v.storage_path]);
  await db.from("order_videos").delete().eq("id", v.id);
  return { ok: true };
}
