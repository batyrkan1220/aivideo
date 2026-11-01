import "server-only";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearMemo } from "@/lib/cache/memo";
import { supabaseAdmin } from "@/lib/supabase/server";
import { mediaUrl } from "@/lib/templates/queries";
import { SEEDANCE_MAX_SEC } from "@/lib/templates/seedance-config";
import { queueLitePreview } from "@/lib/templates/lite-preview";

/*
  Kling 4.0 takes template videos of at most 30 s. A longer upload is cut to its first 30 s here
  (re-encoded H.264 + AAC, sound kept), saved as a new file and set as the template video; the light
  previews are then remade from it. The original file is kept: orders already made still point to it.
*/
const MAX_SOURCE_BYTES = 200 * 1024 * 1024;

/** Returns the new (cut) video path, or null when nothing was changed. */
export async function trimTemplateIfTooLong(templateId: string, durationSec: number | null): Promise<string | null> {
  if (durationSec === null || durationSec <= SEEDANCE_MAX_SEC + 0.5) return null;
  const db = supabaseAdmin();
  const { data: t } = await db.from("templates").select("preview_video_path").eq("id", templateId).maybeSingle();
  const src = t?.preview_video_path ?? null;
  const url = mediaUrl(src);
  if (!src || !url) return null;
  const dir = await mkdtemp(join(tmpdir(), "trim-"));
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000), cache: "no-store" });
    if (!res.ok) return null;
    const input = Buffer.from(await res.arrayBuffer());
    if (input.length > MAX_SOURCE_BYTES) return null;
    const inPath = join(dir, "in"), outPath = join(dir, "out.mp4");
    await writeFile(inPath, input);
    await ffmpeg([
      "-hide_banner", "-loglevel", "error", "-y", "-i", inPath, "-t", String(SEEDANCE_MAX_SEC),
      "-map", "0:v:0", "-map", "0:a:0?",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", outPath,
    ]);
    const out = await readFile(outPath);
    if (!out.length) return null;
    const path = `previews/${randomUUID()}.mp4`;
    const { error } = await db.storage.from("template-media").upload(path, out, { contentType: "video/mp4", cacheControl: "31536000", upsert: false });
    if (error) { console.error("[trim] upload failed"); return null; }
    // Only if the admin has not swapped the video meanwhile.
    const { data: updated } = await db.from("templates")
      .update({ preview_video_path: path, video_duration_sec: SEEDANCE_MAX_SEC, video_aspect: null, preview_lite_path: null, preview_anim_path: null })
      .eq("id", templateId).eq("preview_video_path", src).select("id");
    if (!updated?.length) { await db.storage.from("template-media").remove([path]); return null; }
    clearMemo();
    queueLitePreview(templateId);
    console.log(`[trim] template video cut to ${SEEDANCE_MAX_SEC}s`);
    return path;
  } catch (err) {
    console.error("[trim] failed", err instanceof Error ? err.message.slice(0, 200) : "error");
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function ffmpeg(args: string[]) {
  const mod = (await import("ffmpeg-static")) as unknown as { default?: string | null } | string;
  const bin = typeof mod === "string" ? mod : mod.default;
  if (!bin) throw new Error("ffmpeg binary missing");
  await new Promise<void>((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => { err = (err + d).slice(-400); });
    const timer = setTimeout(() => p.kill("SIGKILL"), 240_000);
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.on("close", (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`ffmpeg ${code}: ${err}`)); });
  });
}
