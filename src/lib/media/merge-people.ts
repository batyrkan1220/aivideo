import "server-only";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { ffmpegLog, holdMedia } from "@/lib/templates/lite-preview";
import { mergeGraph } from "./merge-graph";

/*
  Two people, edited in parallel (TM-100058/62): a second Kling run on Kling's own result came out smeared
  or left the person as they were. So each person is replaced in their own run on the clean template, and
  the two results are put together frame by frame: every part of the picture comes from the run that
  changed it most against the template (that is where its person was replaced). The mask is worked out
  small, softened and steadied over a few frames, so there is no hard seam and no flicker.
*/

const MAX_BYTES = 200 * 1024 * 1024;
const q = ["-hide_banner", "-y", "-threads", "1"];
// Low-memory H.264 (the server has 512 MB), as in scene-parts.
const x264 = ["-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency", "-x264-params", "ref=1", "-threads", "1"];

async function download(url: string, path: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000), cache: "no-store" });
  if (!res.ok || !res.body) throw new Error(`download ${res.status}`);
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) { void res.body.cancel(); throw new Error("too large"); }
  await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), createWriteStream(path));
}

/** base = run of person 1 (its sound is kept), other = run of person 2, template = the clean template. */
export async function mergeEdits(baseUrl: string, otherUrl: string, templateUrl: string): Promise<Uint8Array> {
  const release = holdMedia();
  const dir = await mkdtemp(join(tmpdir(), "mp-"));
  try {
    const [a, b, t] = ["a", "b", "t"].map((n) => join(dir, n));
    await download(baseUrl, a);
    await download(otherUrl, b);
    await download(templateUrl, t);
    return await mergeFiles(a, b, t, join(dir, "out.mp4"));
  } finally {
    release();
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function mergeFiles(a: string, b: string, t: string, out: string): Promise<Uint8Array> {
  const info = await ffmpegLog([...q, "-i", a, "-f", "null", "-t", "0.01", "-"]).catch(() => "");
  const m = /Video:.*?(\d{2,5})x(\d{2,5})/.exec(info);
  const W = m ? Number(m[1]) : 720, H = m ? Number(m[2]) : 1280;
  const fpsM = /(\d+(?:\.\d+)?) fps/.exec(info);
  const fps = Math.min(60, Math.max(12, fpsM ? Number(fpsM[1]) : 24));
  const dur = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(info);
  const sec = dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0;
  // "-threads 1" before EACH input: a global one only covers the first decoder, and the others took a
  // thread (and frame buffers) per host core — the 512 MB server was killed 4 s into the first merge.
  const one = ["-threads", "1"];
  await ffmpegLog([...q, "-loglevel", "error", ...one, "-i", a, ...one, "-i", b, ...one, "-i", t, "-filter_threads", "1", "-filter_complex_threads", "1",
    "-filter_complex", mergeGraph(W, H, fps), "-map", "[v]", "-map", "0:a:0?",
    ...x264, "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k",
    ...(sec > 0 ? ["-t", sec.toFixed(3)] : []), "-movflags", "+faststart", out], 300_000);
  return new Uint8Array(await readFile(out));
}
