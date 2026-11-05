import "server-only";
import { clearMemo } from "@/lib/cache/memo";
import { supabaseAdmin } from "@/lib/supabase/server";
import { moovLocation, mp4DurationSec } from "@/lib/custom-video/mp4";

const HEAD_BYTES = 256 * 1024;
const MAX_MOOV_BYTES = 4 * 1024 * 1024;

/**
 * Reads duration from the MP4/MOV `moov` box via Range requests.
 * The video file stays in Supabase; this never downloads the picture data.
 */
export async function fetchVideoDuration(url: string): Promise<number | null> {
  try {
    const head = await fetchRange(url, 0, HEAD_BYTES - 1);
    if (!head) return null;
    const loc = moovLocation(head.bytes);
    if (!loc) return null;
    if (loc.size > 0 && loc.start + loc.size <= head.bytes.length) return mp4DurationSec(head.bytes);
    const total = head.total;
    const size = loc.size > 0 ? loc.size : (total != null && total > loc.start ? Math.min(MAX_MOOV_BYTES, total - loc.start) : 0);
    if (size <= 0 || size > MAX_MOOV_BYTES) return null;
    if (loc.start === 0 && size <= head.bytes.length) return mp4DurationSec(head.bytes);
    const moov = await fetchRange(url, loc.start, loc.start + size - 1);
    return moov ? mp4DurationSec(moov.bytes) : null;
  } catch {
    return null;
  }
}

/** A small byte range. Returns null when the server would send the whole file. */
async function fetchRange(url: string, start: number, end: number): Promise<{ bytes: Uint8Array; total: number | null } | null> {
  const res = await fetch(url, {
    headers: { Range: `bytes=${start}-${end}` },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (res.status !== 206 && res.status !== 200) return null;
  const asked = end - start + 1;
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (res.status === 200 && (declared === 0 || declared > asked)) return null;
  if (declared > asked) return null;
  const total = contentRangeTotal(res.headers.get("content-range"));
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > asked) return null;
  return { bytes, total };
}

function contentRangeTotal(header: string | null): number | null {
  const m = /\/(\d+)\s*$/.exec(header ?? "");
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Fills templates.video_duration_sec when missing (used for automatic prices). */
export async function ensureTemplateDuration(templateId: string, videoUrl: string | null): Promise<number | null> {
  if (!videoUrl) return null;
  const d = await fetchVideoDuration(videoUrl);
  if (d && d > 0) { await supabaseAdmin().from("templates").update({ video_duration_sec: d }).eq("id", templateId); clearMemo("cat:"); }
  return d;
}
