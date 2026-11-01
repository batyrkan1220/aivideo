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
  videos (often 2–10 MB). The server makes a 480p, silent, ≤10 s, 24 fps H.264 copy (~0.3–0.5 MB)
  with ffmpeg and cards play that; the template page keeps the full video with sound.
  Current files live in previews/lite4/; older copies are remade once and removed.
  Alongside it an animated WebP (320p, 12 fps, ≤10 s) for iPhones that refuse to autoplay video
  (Low Power Mode, low battery): images still animate there. Lives in previews/anim1/.
  One job at a time (the server is small); failures leave the card on the full video.
*/
const MAX_SOURCE_BYTES = 80 * 1024 * 1024;
const LITE_DIR = "previews/lite4/";
const ANIM_DIR = "previews/anim1/";
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
    .select("id,preview_video_path,preview_lite_path,preview_anim_path").not("preview_video_path", "is", null).is("deleted_at", null).limit(1000);
  // Missing, or still an old v1 copy (an original kept as-is because it was already small counts as done).
  const todo = (data ?? []).filter((r) => !r.preview_lite_path || (!r.preview_lite_path.startsWith(LITE_DIR) && r.preview_lite_path !== r.preview_video_path)
    || !r.preview_anim_path?.startsWith(ANIM_DIR));
  for (const r of todo) queueLitePreview(r.id);
  return todo.length;
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
  const { data: t } = await db.from("templates").select("preview_video_path,preview_lite_path,preview_anim_path").eq("id", templateId).maybeSingle();
  const oldLite = t?.preview_lite_path ?? null;
  const oldAnim = t?.preview_anim_path ?? null;
  const src = t?.preview_video_path;
  const url = mediaUrl(src ?? null);
  if (!src || !url) return false;

  const res = await fetch(url, { signal: AbortSignal.timeout(60_000), cache: "no-store" });
  if (!res.ok) return false;
  const input = Buffer.from(await res.arrayBuffer());
  if (input.length > MAX_SOURCE_BYTES) return false;

  const dir = await mkdtemp(join(tmpdir(), "lite-"));
  try {
    const inPath = join(dir, "in"), outPath = join(dir, "out.mp4"), animOut = join(dir, "out.webp");
    await writeFile(inPath, input);
    const fresh = !oldLite || oldLite === src || !oldLite.startsWith(LITE_DIR);
    let litePath = oldLite ?? src;
    const uploaded: string[] = [];
    if (fresh) {
      await runFfmpeg(inPath, outPath, mp4Args);
      const out = await readFile(outPath);
      // Already small (or the copy came out bigger): cards keep the original file.
      litePath = src;
      if (out.length > 0 && out.length < input.length * 0.85) {
        litePath = `${LITE_DIR}${randomUUID()}.mp4`;
        const { error } = await db.storage.from("template-media")
          .upload(litePath, out, { contentType: "video/mp4", cacheControl: "31536000", upsert: false });
        if (error) throw new Error(`upload ${error.message}`);
        uploaded.push(litePath);
      }
    }
    let animPath: string | null = oldAnim?.startsWith(ANIM_DIR) && !fresh ? oldAnim : null;
    if (!animPath) {
      try {
        await runFfmpeg(inPath, animOut, webpArgs);
        const anim = await readFile(animOut);
        if (anim.length > 0) {
          animPath = `${ANIM_DIR}${randomUUID()}.webp`;
          const { error } = await db.storage.from("template-media")
            .upload(animPath, anim, { contentType: "image/webp", cacheControl: "31536000", upsert: false });
          if (error) { animPath = null; console.error("[lite-preview] anim upload failed"); } else uploaded.push(animPath);
        }
      } catch (err) {
        console.error("[lite-preview] anim failed", err instanceof Error ? err.message.slice(0, 200) : "error");
      }
    }
    // Only if the template still has the same video (the admin may have replaced it meanwhile).
    const { data: updated } = await db.from("templates").update({ preview_lite_path: litePath, preview_anim_path: animPath })
      .eq("id", templateId).eq("preview_video_path", src).select("id");
    if (!updated?.length && uploaded.length) await db.storage.from("template-media").remove(uploaded);
    // Replaced light copies (never the original video) are no longer needed.
    if (updated?.length) {
      const stale = [
        oldLite && oldLite !== src && oldLite !== litePath && oldLite.startsWith("previews/lite") ? oldLite : null,
        oldAnim && oldAnim !== animPath && oldAnim.startsWith("previews/anim") ? oldAnim : null,
      ].filter((x): x is string => !!x);
      if (stale.length) await db.storage.from("template-media").remove(stale);
    }
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

// Short side 480 px (never upscaled), ≤24 fps, ≤10 s, no audio, fast start: sharp on 2–3× phone screens.
const mp4Args = (inPath: string, outPath: string) => [
  "-hide_banner", "-loglevel", "error", "-y", "-i", inPath, "-t", "10", "-an",
  "-vf", "scale=w='if(gt(iw,ih),-2,trunc(min(480,iw)/2)*2)':h='if(gt(iw,ih),trunc(min(480,ih)/2)*2,-2)'", "-fpsmax", "24",
  "-c:v", "libx264", "-preset", "medium", "-crf", "26", "-maxrate", "900k", "-bufsize", "1800k",
  "-profile:v", "main", "-pix_fmt", "yuv420p", "-movflags", "+faststart", outPath,
];
// Animated WebP fallback: short side 320 px, 12 fps, ≤10 s, endless loop.
const webpArgs = (inPath: string, outPath: string) => [
  "-hide_banner", "-loglevel", "error", "-y", "-i", inPath, "-t", "10", "-an",
  "-vf", "fps=12,scale=w='if(gt(iw,ih),-2,trunc(min(320,iw)/2)*2)':h='if(gt(iw,ih),trunc(min(320,ih)/2)*2,-2)'",
  "-c:v", "libwebp_anim", "-lossless", "0", "-q:v", "50", "-compression_level", "4", "-loop", "0", outPath,
];

async function runFfmpeg(inPath: string, outPath: string, build: (i: string, o: string) => string[]) {
  const bin = await ffmpegPath();
  const args = build(inPath, outPath);
  await new Promise<void>((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => { err = (err + d).slice(-400); });
    const timer = setTimeout(() => p.kill("SIGKILL"), 180_000);
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.on("close", (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`ffmpeg ${code}: ${err}`)); });
  });
}
