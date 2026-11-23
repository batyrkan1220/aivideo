import "server-only";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { ffmpegLog } from "@/lib/templates/lite-preview";

/**
 * A big video uploaded in byte parts (Supabase takes 50 MB per file): the parts are joined back into one
 * file on disk and re-encoded into a Kling-friendly MP4 — short side 720–1080 px, H.264, AAC, under 48 MB.
 * ffmpeg runs one at a time, one thread (512 MB server).
 */
export async function assembleVideo(partUrls: string[]): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "asm-"));
  try {
    const inPath = join(dir, "in"), out = join(dir, "out.mp4");
    const sink = createWriteStream(inPath);
    for (const url of partUrls) {
      const res = await fetch(url, { signal: AbortSignal.timeout(180_000), cache: "no-store" });
      if (!res.ok || !res.body) throw new Error(`part ${res.status}`);
      await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), sink, { end: false });
    }
    await new Promise<void>((resolve, reject) => sink.end((e?: Error | null) => (e ? reject(e) : resolve())));
    // Short side: 1080 when the video is bigger, 720 when it is smaller (Kling refuses under 700 px).
    const scale = "scale=w='if(gt(iw,ih),-2,if(gt(iw,1080),1080,720))':h='if(gt(iw,ih),if(gt(ih,1080),1080,720),-2)':flags=lanczos,setsar=1";
    for (const [crf, maxrate] of [["20", "12M"], ["26", "6M"]] as const) {
      await ffmpegLog([
        "-hide_banner", "-loglevel", "error", "-y", "-threads", "1", "-i", inPath, "-threads", "1", "-filter_threads", "1",
        "-vf", scale, "-c:v", "libx264", "-preset", "veryfast", "-crf", crf, "-maxrate", maxrate, "-bufsize", "16M", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", out,
      ], 600_000);
      if ((await stat(out)).size <= 48 * 1024 * 1024) return await readFile(out);
    }
    throw new Error("assembled video over 48 MB");
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
