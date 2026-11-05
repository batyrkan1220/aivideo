import "server-only";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegStatic from "ffmpeg-static";
import { klingScanPlan, klingScanScale, parseMp4Tracks } from "./kling-scan-plan";

const MAX_BYTES = 45 * 1024 * 1024;

function ffmpegBinary(): string | null {
  return typeof ffmpegStatic === "string" && ffmpegStatic ? ffmpegStatic : null;
}

function runFfmpeg(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 45_000);
    child.stderr.on("data", (chunk: Buffer) => { err = (err + chunk.toString()).slice(-400); });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(err.replace(/\s+/g, " ").trim().slice(-180) || `ffmpeg ${code}`));
    });
  });
}

/**
 * A video Kling can scan: the audio track is gone (its 0×0 size was read as the picture width),
 * and a picture narrower than 512px is scaled up. null = send the original file.
 */
export async function klingScanFile(sourceUrl: string): Promise<Buffer | null> {
  const bin = ffmpegBinary();
  if (!bin) return null;
  let res: Response;
  try {
    res = await fetch(sourceUrl, { signal: AbortSignal.timeout(25_000), cache: "no-store" });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const src = Buffer.from(await res.arrayBuffer());
  if (src.length < 1000 || src.length > MAX_BYTES) return null;
  const tracks = parseMp4Tracks(src);
  const video = tracks.filter((t) => t.w >= 64 && t.h >= 64).sort((a, b) => b.w * b.h - a.w * a.h)[0];
  const plan = klingScanPlan(tracks);
  const dir = await mkdtemp(join(tmpdir(), "kling-scan-"));
  const input = join(dir, "in.mp4");
  const output = join(dir, "out.mp4");
  try {
    await writeFile(input, src);
    const copy = ["-y", "-i", input, "-map", "0:v:0", "-c", "copy", "-an", "-movflags", "+faststart", output];
    if (plan === "strip") await runFfmpeg(bin, copy);
    else {
      const size = klingScanScale(video?.w ?? 720, video?.h ?? 1280);
      try {
        await runFfmpeg(bin, ["-y", "-i", input, "-an", "-vf", `scale=${size.w}:${size.h}:flags=fast_bilinear`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-threads", "1", "-pix_fmt", "yuv420p", "-movflags", "+faststart", output]);
      } catch {
        await runFfmpeg(bin, copy);
      }
    }
    const out = await readFile(output);
    if (out.length < 1000 || out.length > MAX_BYTES) return null;
    console.log("[admin.element] scan", plan, video ? `${video.w}x${video.h}` : "unknown");
    return out;
  } catch (e) {
    console.error("[admin.element] scan", e instanceof Error ? e.message.slice(0, 180) : "failed");
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
