import "server-only";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** One JPEG frame of a video (≤ 1280 px wide), read straight from its URL by ffmpeg. */
export async function videoFrameJpeg(videoUrl: string, atSec = 0.5): Promise<Uint8Array | null> {
  const ffmpeg = (await import("ffmpeg-static")).default as unknown as string | null;
  if (!ffmpeg) return null;
  const dir = await mkdtemp(join(tmpdir(), "frame-"));
  const out = join(dir, "f.jpg");
  try {
    await run(ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-ss", String(atSec), "-i", videoUrl,
      "-frames:v", "1", "-vf", "scale='min(1280,iw)':-2", "-q:v", "2", out,
    ], { timeout: 60_000 });
    const buf = await readFile(out);
    return buf.byteLength > 1000 ? new Uint8Array(buf) : null;
  } catch (err) {
    console.error("[frame] ffmpeg failed", err instanceof Error ? err.message.slice(0, 200) : err);
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
