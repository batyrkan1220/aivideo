import "server-only";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearMemo } from "@/lib/cache/memo";
import { supabaseAdmin } from "@/lib/supabase/server";
import { mediaUrl } from "@/lib/templates/queries";

/*
  Light card previews. Catalog cards are small, muted loops, yet the admin uploads full template
  videos (often 2–10 MB). The server makes a 480p, silent, ≤10 s H.264 copy (~0.3–0.6 MB) with
  ffmpeg and cards play that; the template page keeps the full video with sound.
  One job at a time (the server is small); failures leave the card on the full video.
*/
const MAX_SOURCE_BYTES = 80 * 1024 * 1024;
const queue: string[] = [];
let running = false;

/** Queue a template for a (re)made light preview. Safe to call many times. */
export function queueLitePreview(templateId: string) {
  if (!queue.includes(templateId)) queue.push(templateId);
  if (!running) void drain();
}

/** Server start: every template with a video but no light preview yet. */
export async function backfillLitePreviews() {
  const { data } = await supabaseAdmin().from("templates")
    .select("id").not("preview_video_path", "is", null).is("preview_lite_path", null).is("deleted_at", null).limit(500);
  for (const r of data ?? []) queueLitePreview(r.id);
  return data?.length ?? 0;
}

async function drain() {
  running = true;
  let ok = 0, failed = 0;
  try {
    while (queue.length) {
      const id = queue.shift()!;
      try { if (await makeOne(id)) ok++; else failed++; } catch (err) {
        failed++;
        console.error("[lite-preview] failed", err instanceof Error ? err.message.slice(0, 200) : "error");
      }
    }
  } finally {
    running = false;
    if (ok || failed) { clearMemo("cat:"); console.log(`[lite-preview] done ok=${ok} failed=${failed}`); }
  }
}

async function makeOne(templateId: string): Promise<boolean> {
  const db = supabaseAdmin();
  const { data: t } = await db.from("templates").select("preview_video_path").eq("id", templateId).maybeSingle();
  const src = t?.preview_video_path;
  const url = mediaUrl(src ?? null);
  if (!src || !url) return false;

  const res = await fetch(url, { signal: AbortSignal.timeout(60_000), cache: "no-store" });
  if (!res.ok) return false;
  const input = Buffer.from(await res.arrayBuffer());
  if (input.length > MAX_SOURCE_BYTES) return false;

  const dir = await mkdtemp(join(tmpdir(), "lite-"));
  try {
    const inPath = join(dir, "in"), outPath = join(dir, "out.mp4");
    await writeFile(inPath, input);
    await runFfmpeg(inPath, outPath);
    const out = await readFile(outPath);

    // Already small (or the copy came out bigger): cards keep the original file.
    let litePath = src;
    if (out.length > 0 && out.length < input.length * 0.85) {
      litePath = `previews/lite/${randomUUID()}.mp4`;
      const { error } = await db.storage.from("template-media")
        .upload(litePath, out, { contentType: "video/mp4", cacheControl: "31536000", upsert: false });
      if (error) throw new Error(`upload ${error.message}`);
    }
    // Only if the template still has the same video (the admin may have replaced it meanwhile).
    const { data: updated } = await db.from("templates").update({ preview_lite_path: litePath })
      .eq("id", templateId).eq("preview_video_path", src).select("id");
    if (!updated?.length && litePath !== src) await db.storage.from("template-media").remove([litePath]);
    return true;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function ffmpegPath(): Promise<string> {
  const mod = (await import("ffmpeg-static")) as unknown as { default?: string | null } | string;
  const p = typeof mod === "string" ? mod : mod.default;
  if (!p) throw new Error("ffmpeg binary missing");
  return p;
}

async function runFfmpeg(inPath: string, outPath: string) {
  const bin = await ffmpegPath();
  // Short side 480 px (never upscaled), ≤30 fps, ≤10 s, no audio, fast start for instant playback.
  const scale = "scale=w='if(gt(iw,ih),-2,trunc(min(480,iw)/2)*2)':h='if(gt(iw,ih),trunc(min(480,ih)/2)*2,-2)'";
  const args = [
    "-hide_banner", "-loglevel", "error", "-y", "-i", inPath, "-t", "10", "-an",
    "-vf", scale, "-fpsmax", "30",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-maxrate", "1000k", "-bufsize", "2000k",
    "-profile:v", "main", "-pix_fmt", "yuv420p", "-movflags", "+faststart", outPath,
  ];
  await new Promise<void>((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => { err = (err + d).slice(-400); });
    const timer = setTimeout(() => p.kill("SIGKILL"), 180_000);
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.on("close", (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`ffmpeg ${code}: ${err}`)); });
  });
}
