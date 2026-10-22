import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { mp4DurationSec } from "@/lib/custom-video/mp4";

const MAX_BYTES = 60 * 1024 * 1024;

/** Downloads a (public) video and reads its duration from the MP4/MOV header. */
export async function fetchVideoDuration(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000), cache: "no-store" });
    if (!res.ok) return null;
    if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) return null;
    return mp4DurationSec(new Uint8Array(await res.arrayBuffer()));
  } catch {
    return null;
  }
}

/** Fills templates.video_duration_sec when missing (used for automatic Akool prices). */
export async function ensureTemplateDuration(templateId: string, videoUrl: string | null): Promise<number | null> {
  if (!videoUrl) return null;
  const d = await fetchVideoDuration(videoUrl);
  if (d && d > 0) await supabaseAdmin().from("templates").update({ video_duration_sec: d }).eq("id", templateId);
  return d;
}
