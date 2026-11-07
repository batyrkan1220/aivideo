"use server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { track } from "@/lib/analytics";
import { customVideoSettings, MIN_VIDEO_SECONDS, VIDEO_TYPES } from "./settings";
import { mp4DurationSec, mp4VideoAspect, sniffVideoType } from "./mp4";
import { aspectAllowed } from "./aspect";

/**
 * Scene cuts in the customer's video. Kling keeps the face only inside one continuous shot (after a
 * cut it drifts back to the original person), so the form warns about cuts. Best effort: a busy
 * server or an unreadable file gives null and the upload goes on.
 */
async function countCuts(bytes: Uint8Array): Promise<number | null> {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "cv-"));
  try {
    const p = join(dir, "in");
    await writeFile(p, bytes);
    const { findShots } = await import("@/lib/media/scene-parts");
    const r = await Promise.race([findShots(p), new Promise<null>((res) => setTimeout(() => res(null), 25_000))]);
    if (!r) return null;
    // Cuts that leave both sides at least 0.8 s (flashes and double detections do not count).
    return Math.max(0, r.parts.length - 1);
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export type VideoError = "bad_type" | "too_large" | "too_long" | "too_short" | "bad_aspect" | "unreadable" | "disabled" | "rate_limited" | "unauthorized" | "generic";
const BUCKET = "user-videos";
const VIDEOS_PER_HOUR = 20;

const requestSchema = z.object({
  contentType: z.string(),
  size: z.number().int().positive(),
  durationSec: z.number().positive().max(3600),
  /** Width ÷ height from the browser's decoder (re-checked from the file later). */
  aspect: z.number().positive().max(20).optional(),
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
  if (p.data.aspect && !aspectAllowed(p.data.aspect)) return { ok: false, error: "bad_aspect" };

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
export async function confirmVideoUpload(videoId: string): Promise<{ ok: true; durationSec: number; aspect: number | null; cuts: number | null } | { ok: false; error: VideoError }> {
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
  // Kling takes 2:5 … 5:2 only; unknown (unusual container) is let through.
  const aspect = mp4VideoAspect(bytes);
  if (aspect !== null && !aspectAllowed(aspect)) return reject("bad_aspect");
  await db.from("order_videos").update({ verified_at: new Date().toISOString(), mime_type: type, file_size: bytes.byteLength, duration_sec: dur, aspect }).eq("id", v.id);
  const cuts = await countCuts(bytes);
  return { ok: true, durationSec: dur, aspect, cuts };
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
