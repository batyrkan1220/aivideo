import "server-only";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  const src = join(dir, "v.mp4");
  try {
    // Download in Node: the static ffmpeg build cannot resolve host names itself.
    const res = await fetch(videoUrl, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) { console.error("[frame] video download failed", res.status); return null; }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > 120 * 1024 * 1024) return null;
    await writeFile(src, bytes);
    await run(ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-ss", String(atSec), "-i", src,
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
