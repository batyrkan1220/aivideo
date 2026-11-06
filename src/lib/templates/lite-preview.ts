import "server-only";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
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
  Alongside it an animated WebP cut to the card's own shape (3:4, 360×480, 15 fps, ≤10 s, ~0.7–1 MB,
  re-encoded smaller if it passes 1.3 MB): cards and the hero show this image, which animates everywhere
  (iOS Low Power Mode, Telegram WebViews) with no autoplay rules. Lives in previews/anim5/.
  And a 360×480 WebP of the cover (~20–40 KB, cached for a year) that cards show first: covers/thumb1/.
  One job at a time (the server is small); failures leave the card on the full video.
  Memory: the 512 MB instance was killed when whole videos were held in RAM. The source is streamed
  to a temp file and ffmpeg runs single-threaded, so Node only ever holds the small outputs.
*/
const MAX_SOURCE_BYTES = 80 * 1024 * 1024;
const LITE_DIR = "previews/lite4/";
const KLING_DIR = "previews/kling1/";
const ANIM_DIR = "previews/anim5/";
const THUMB_DIR = "covers/thumb1/";
const queue: string[] = [];
let running = false;

/** True while preview copies are being made (other ffmpeg jobs wait: the server has 512 MB). */
export const liteBusy = () => running;

/** Queue a template for a (re)made light preview. Safe to call many times. */
export function queueLitePreview(templateId: string) {
  if (!queue.includes(templateId)) queue.push(templateId);
  if (!running) void drain();
}

/** Server start: every template with a video but no light preview yet. */
export async function backfillLitePreviews() {
  const { data } = await supabaseAdmin().from("templates")
    .select("id,cover_asset_path,cover_thumb_path,preview_video_path,preview_lite_path,preview_anim_path,video_aspect,video_px").not("preview_video_path", "is", null).is("deleted_at", null).limit(1000);
  // Missing, or still an old v1 copy (an original kept as-is because it was already small counts as done).
  const todo = (data ?? []).filter((r) => !r.preview_lite_path || (!r.preview_lite_path.startsWith(LITE_DIR) && r.preview_lite_path !== r.preview_video_path)
    || !r.preview_anim_path?.startsWith(ANIM_DIR) || (!!r.cover_asset_path && !r.cover_thumb_path?.startsWith(THUMB_DIR)) || !r.video_aspect || !r.video_px);
  for (const r of todo) queueLitePreview(r.id);
  if (!todo.length) void cleanupOrphans();
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
    if (ok || failed) { clearMemo("cat:"); console.log(`[lite-preview] done ok=${ok} failed=${failed}`); void cleanupOrphans(); }
  }
}

async function makeOne(templateId: string): Promise<boolean> {
  const db = supabaseAdmin();
  const { data: t } = await db.from("templates").select("cover_asset_path,cover_thumb_path,preview_video_path,preview_lite_path,preview_anim_path,kling_video_path").eq("id", templateId).maybeSingle();
  const oldLite = t?.preview_lite_path ?? null;
  const oldAnim = t?.preview_anim_path ?? null;
  const src = t?.preview_video_path;
  const url = mediaUrl(src ?? null);
  if (!src || !url) return false;

  const res = await fetch(url, { signal: AbortSignal.timeout(120_000), cache: "no-store" });
  if (!res.ok || !res.body) return false;
  if (Number(res.headers.get("content-length") ?? 0) > MAX_SOURCE_BYTES) { void res.body.cancel(); return false; }

  const dir = await mkdtemp(join(tmpdir(), "lite-"));
  try {
    const inPath = join(dir, "in"), outPath = join(dir, "out.mp4"), animOut = join(dir, "out.webp");
    await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), createWriteStream(inPath));
    const inputSize = (await stat(inPath)).size;
    if (inputSize > MAX_SOURCE_BYTES) return false;
    // Width ÷ height of the original (rotation applied), so the template page can reserve its box.
    const aspect = await probeAspect(inPath).catch(() => null);
    // Kling refuses a template video under 700 px ("The video width should not be less than 700px"):
    // such videos get an upscaled copy (short side 720) that only Kling uses.
    const px = await probeSize(inPath).catch(() => null);
    let klingPath: string | null = t?.kling_video_path ?? null;
    // Kling also takes only MP4/MOV: a WebM template gets the same copy.
    if (px && (Math.min(px.w, px.h) < 720 || /\.webm$/i.test(src)) && !klingPath) {
      const kOut = join(dir, "kling.mp4");
      try {
        await runFfmpeg(inPath, kOut, upscaleArgs);
        const p = `${KLING_DIR}${randomUUID()}.mp4`;
        const { error } = await db.storage.from("template-media").upload(p, await readFile(kOut), { contentType: "video/mp4", cacheControl: "31536000", upsert: false });
        if (!error) { klingPath = p; console.log("[lite-preview] kling copy", templateId, `${px.w}x${px.h}`); }
      } catch (err) {
        console.error("[lite-preview] kling copy failed", err instanceof Error ? err.message.slice(0, 200) : "error");
      }
    }
    const fresh = !oldLite || oldLite === src || !oldLite.startsWith(LITE_DIR);
    let litePath = oldLite ?? src;
    const uploaded: string[] = [];
    if (fresh) {
      await runFfmpeg(inPath, outPath, mp4Args);
      const out = await readFile(outPath);
      // Already small (or the copy came out bigger): cards keep the original file.
      litePath = src;
      if (out.length > 0 && out.length < inputSize * 0.85) {
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
        await runFfmpeg(inPath, animOut, webpArgs(65));
        let anim = await readFile(animOut);
        // Busy footage can come out heavy: one smaller pass keeps cards light.
        if (anim.length > 1300 * 1024) { await runFfmpeg(inPath, animOut, webpArgs(50)); anim = await readFile(animOut); }
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
    // Cover thumbnail for cards.
    const cover = t?.cover_asset_path ?? null;
    let thumbPath: string | null = t?.cover_thumb_path?.startsWith(THUMB_DIR) ? t.cover_thumb_path : null;
    const coverUrl = mediaUrl(cover);
    if (!thumbPath && cover && coverUrl) {
      try {
        const cr = await fetch(coverUrl, { signal: AbortSignal.timeout(30_000), cache: "no-store" });
        if (cr.ok) {
          const coverIn = join(dir, "cover"), thumbOut = join(dir, "thumb.webp");
          await writeFile(coverIn, Buffer.from(await cr.arrayBuffer()));
          await runFfmpeg(coverIn, thumbOut, thumbArgs);
          const thumb = await readFile(thumbOut);
          if (thumb.length > 0) {
            const p = `${THUMB_DIR}${randomUUID()}.webp`;
            const { error } = await db.storage.from("template-media")
              .upload(p, thumb, { contentType: "image/webp", cacheControl: "31536000", upsert: false });
            if (!error) { thumbPath = p; uploaded.push(p); }
          }
        }
      } catch (err) {
        console.error("[lite-preview] thumb failed", err instanceof Error ? err.message.slice(0, 200) : "error");
      }
    }
    // Only if the template still has the same video (the admin may have replaced it meanwhile).
    if (klingPath && klingPath !== t?.kling_video_path) uploaded.push(klingPath);
    const { data: updated } = await db.from("templates").update({ preview_lite_path: litePath, preview_anim_path: animPath, cover_thumb_path: thumbPath, ...(aspect ? { video_aspect: aspect } : {}), ...(px ? { video_px: `${px.w}x${px.h}` } : {}), kling_video_path: klingPath })
      .eq("id", templateId).eq("preview_video_path", src).select("id");
    if (!updated?.length && uploaded.length) await db.storage.from("template-media").remove(uploaded);
    // Replaced light copies (never the original video) are no longer needed.
    if (updated?.length) {
      const stale = [
        oldLite && oldLite !== src && oldLite !== litePath && oldLite.startsWith("previews/lite") ? oldLite : null,
        oldAnim && oldAnim !== animPath && oldAnim.startsWith("previews/anim") ? oldAnim : null,
        t?.cover_thumb_path && t.cover_thumb_path !== thumbPath && t.cover_thumb_path.startsWith("covers/thumb") ? t.cover_thumb_path : null,
      ].filter((x): x is string => !!x);
      if (stale.length) await db.storage.from("template-media").remove(stale);
    }
    return true;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function ffmpegPath(): Promise<string> {
  const mod = (await import("ffmpeg-static")) as unknown as { default?: string | null } | string;
  const p = typeof mod === "string" ? mod : mod.default;
  if (!p) throw new Error("ffmpeg binary missing");
  return p;
}

// Short side 480 px (never upscaled), ≤24 fps, ≤10 s, no audio, fast start: sharp on 2–3× phone screens.
const mp4Args = (inPath: string, outPath: string) => [
  "-hide_banner", "-loglevel", "error", "-y", "-threads", "1", "-i", inPath, "-t", "10", "-an", "-threads", "1", "-filter_threads", "1",
  "-vf", "scale=w='if(gt(iw,ih),-2,trunc(min(480,iw)/2)*2)':h='if(gt(iw,ih),trunc(min(480,ih)/2)*2,-2)'", "-fpsmax", "24",
  "-c:v", "libx264", "-preset", "medium", "-crf", "26", "-maxrate", "900k", "-bufsize", "1800k",
  "-profile:v", "main", "-pix_fmt", "yuv420p", "-movflags", "+faststart", outPath,
];
// Animated WebP card preview: centre-cropped to the card's 3:4 and sized for it (360×480, sharp
// at 2× on phones), 15 fps, ≤10 s, endless loop. No pixels are spent on parts the card cuts off.
const CARD_CROP = "crop='min(iw,ih*3/4)':'min(ih,iw*4/3)'";
const webpArgs = (q: number) => (inPath: string, outPath: string) => [
  "-hide_banner", "-loglevel", "error", "-y", "-threads", "1", "-i", inPath, "-t", "10", "-an", "-threads", "1", "-filter_threads", "1",
  "-vf", `fps=15,${CARD_CROP},scale=360:480:flags=lanczos,setsar=1`,
  "-c:v", "libwebp_anim", "-lossless", "0", "-q:v", String(q), "-compression_level", "5", "-loop", "0", outPath,
];
// Static cover for cards: same crop, 360×480 WebP.
const thumbArgs = (inPath: string, outPath: string) => [
  "-hide_banner", "-loglevel", "error", "-y", "-i", inPath, "-frames:v", "1",
  "-vf", `${CARD_CROP},scale=360:480:flags=lanczos,setsar=1`, "-c:v", "libwebp", "-q:v", "78", outPath,
];

// Short side to 720 px (Kling needs 700+), same frames and sound, high quality, single-threaded.
export const upscaleArgs = (inPath: string, outPath: string) => [
  "-hide_banner", "-loglevel", "error", "-y", "-threads", "1", "-i", inPath, "-threads", "1", "-filter_threads", "1",
  "-vf", "scale=w='if(gt(iw,ih),-2,720)':h='if(gt(iw,ih),720,-2)':flags=lanczos,setsar=1",
  "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", outPath,
];

/** Display size (rotation applied) of a video from ffmpeg's stream info. */
export async function probeSize(inPath: string): Promise<{ w: number; h: number } | null> {
  const bin = await ffmpegPath();
  const info = await new Promise<string>((resolve) => {
    const p = spawn(bin, ["-hide_banner", "-i", inPath], { stdio: ["ignore", "ignore", "pipe"] });
    let out = "";
    p.stderr.on("data", (d) => { out = (out + d).slice(-8000); });
    const timer = setTimeout(() => p.kill("SIGKILL"), 20_000);
    p.on("close", () => { clearTimeout(timer); resolve(out); });
    p.on("error", () => { clearTimeout(timer); resolve(""); });
  });
  const m = /Video:.*?(\d{2,5})x(\d{2,5})/.exec(info);
  if (!m) return null;
  let w = Number(m[1]), h = Number(m[2]);
  if (/rotat(e|ion of)\s*:?\s*-?(90|270)/i.test(info)) [w, h] = [h, w];
  return { w, h };
}

/** Reads the display aspect (w/h) of a video from ffmpeg's stream info, honouring 90° rotation. */
async function probeAspect(inPath: string): Promise<number | null> {
  const bin = await ffmpegPath();
  const info = await new Promise<string>((resolve) => {
    const p = spawn(bin, ["-hide_banner", "-i", inPath], { stdio: ["ignore", "ignore", "pipe"] });
    let out = "";
    p.stderr.on("data", (d) => { out = (out + d).slice(-8000); });
    const timer = setTimeout(() => p.kill("SIGKILL"), 20_000);
    p.on("close", () => { clearTimeout(timer); resolve(out); });
    p.on("error", () => { clearTimeout(timer); resolve(""); });
  });
  const m = /Video:.*?(\d{2,5})x(\d{2,5})/.exec(info);
  if (!m) return null;
  let w = Number(m[1]), h = Number(m[2]);
  const sar = /SAR (\d+):(\d+)/.exec(info.slice(m.index));
  if (sar && Number(sar[2]) > 0 && Number(sar[1]) > 0) w = (w * Number(sar[1])) / Number(sar[2]);
  if (/rotat(e|ion of)\s*:?\s*-?(90|270)/i.test(info)) [w, h] = [h, w];
  const a = w / h;
  return Number.isFinite(a) && a > 0.2 && a < 5 ? Math.round(a * 10000) / 10000 : null;
}

/** Deletes light copies / thumbnails in storage that no template points to any more. */
async function cleanupOrphans() {
  try {
    const db = supabaseAdmin();
    const { data: rows } = await db.from("templates").select("cover_thumb_path,preview_lite_path,preview_anim_path,kling_video_path");
    const keep = new Set((rows ?? []).flatMap((r) => [r.cover_thumb_path, r.preview_lite_path, r.preview_anim_path, r.kling_video_path]).filter(Boolean) as string[]);
    const dirs: string[] = [];
    for (const root of ["previews", "covers"]) {
      const { data } = await db.storage.from("template-media").list(root, { limit: 1000 });
      for (const e of data ?? []) if (!e.id && /^(lite\d*|anim\d+|thumb\d+|kling\d+)$/.test(e.name)) dirs.push(`${root}/${e.name}`);
    }
    let removed = 0;
    for (const d of dirs) {
      const { data } = await db.storage.from("template-media").list(d, { limit: 1000 });
      const stale = (data ?? []).filter((f) => f.id).map((f) => `${d}/${f.name}`).filter((p) => !keep.has(p));
      for (let i = 0; i < stale.length; i += 100) {
        const { error } = await db.storage.from("template-media").remove(stale.slice(i, i + 100));
        if (!error) removed += Math.min(100, stale.length - i);
      }
    }
    // Cut-outs of template people/things: kept while a template points to them; unsaved ones go after a day.
    const { data: cfgs } = await db.from("templates").select("provider_config_json");
    const targets = new Set((cfgs ?? []).flatMap((r) => {
      const c = r.provider_config_json as { targets?: unknown; objects?: { target?: unknown }[] } | null;
      const people = Array.isArray(c?.targets) ? c.targets : [];
      const things = Array.isArray(c?.objects) ? c.objects.map((o) => o?.target) : [];
      return [...people, ...things].filter((x): x is string => typeof x === "string");
    }));
    const { data: cut } = await db.storage.from("template-media").list("targets", { limit: 1000 });
    const dayAgo = Date.now() - 24 * 3600_000;
    const staleCut = (cut ?? []).filter((f) => f.id && !targets.has(`targets/${f.name}`) && Date.parse(f.created_at ?? "") < dayAgo).map((f) => `targets/${f.name}`);
    for (let i = 0; i < staleCut.length; i += 100) {
      const { error } = await db.storage.from("template-media").remove(staleCut.slice(i, i + 100));
      if (!error) removed += Math.min(100, staleCut.length - i);
    }
    if (removed) console.log(`[lite-preview] removed ${removed} unused files`);
  } catch (err) {
    console.error("[lite-preview] cleanup failed", err instanceof Error ? err.message.slice(0, 200) : "error");
  }
}

// One ffmpeg process on the server at a time (512 MB): every job waits for the previous one.
let ffmpegChain: Promise<unknown> = Promise.resolve();

export function runFfmpeg(inPath: string, outPath: string, build: (i: string, o: string) => string[]): Promise<void> {
  const run = ffmpegChain.then(() => runFfmpegNow(inPath, outPath, build));
  ffmpegChain = run.catch(() => {});
  return run;
}

async function runFfmpegNow(inPath: string, outPath: string, build: (i: string, o: string) => string[]) {
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
