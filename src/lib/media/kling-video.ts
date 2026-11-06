import "server-only";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { probeSize, runFfmpeg, upscaleArgs } from "@/lib/templates/lite-preview";

/**
 * Kling refuses videos under 700 px ("The video width should not be less than 700px"). Downloaded
 * TikTok/Instagram videos are often 576×1024. Returns an upscaled MP4 (short side 720) when the video
 * needs one, or null when Kling can take it as it is. Streams to a temp file; ffmpeg runs one at a time.
 */
export async function klingReadyCopy(url: string, maxBytes = 300 * 1024 * 1024): Promise<Buffer | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000), cache: "no-store" });
  if (!res.ok || !res.body) throw new Error(`download ${res.status}`);
  if (Number(res.headers.get("content-length") ?? 0) > maxBytes) { void res.body.cancel(); return null; }
  const dir = await mkdtemp(join(tmpdir(), "kv-"));
  try {
    const inPath = join(dir, "in"), out = join(dir, "out.mp4");
    await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), createWriteStream(inPath));
    const px = await probeSize(inPath);
    if (!px || Math.min(px.w, px.h) >= 720) return null;
    await runFfmpeg(inPath, out, upscaleArgs);
    console.log("[kling] upscaled customer video", `${px.w}x${px.h}`);
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
