import "server-only";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { ffmpegLog } from "@/lib/templates/lite-preview";
import { planParts, type Part } from "./scene-plan";

/*
  Kling keeps the customer's face only inside one continuous shot: after a cut in the template it
  falls back to the original person (TM-100034, from 4 s). So a template with cuts is edited shot by
  shot: one Kling task per shot, each with the same photo, then the shots are joined again and the
  template's own sound is put back. Shots under 3 s (Kling's minimum) stay with their neighbour.
*/

const MAX_BYTES = 200 * 1024 * 1024;

async function download(url: string, path: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000), cache: "no-store" });
  if (!res.ok || !res.body) throw new Error(`download ${res.status}`);
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) { void res.body.cancel(); throw new Error("too large"); }
  await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), createWriteStream(path));
}

const q = ["-hide_banner", "-y", "-threads", "1"];

/** Shots of the video (start/length in seconds), or null when it is one shot. */
export async function splitAtCuts(videoUrl: string): Promise<{ parts: (Part & { file: Buffer })[] } | null> {
  const dir = await mkdtemp(join(tmpdir(), "sp-"));
  try {
    const inPath = join(dir, "in");
    await download(videoUrl, inPath);
    // Scene changes from a small, cheap copy of the picture.
    const log = await ffmpegLog([...q, "-i", inPath, "-an", "-filter_threads", "1",
      "-vf", "scale=160:-2,select='gt(scene,0.35)',showinfo", "-f", "null", "-"]);
    const dur = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(log);
    const total = dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0;
    const cuts = [...log.matchAll(/pts_time:(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
    const parts = planParts(total, cuts);
    console.log("[scenes]", `total=${total.toFixed(2)} cuts=${cuts.map((c) => c.toFixed(2)).join(",") || "-"} parts=${parts.length}`);
    if (parts.length < 2) return null;
    const out: (Part & { file: Buffer })[] = [];
    for (const [k, p] of parts.entries()) {
      const o = join(dir, `p${k}.mp4`);
      // Exact cut points: re-encoded (stream copy would snap to keyframes), sound kept.
      await ffmpegLog([...q, "-loglevel", "error", "-ss", p.start.toFixed(3), "-i", inPath, "-t", p.len.toFixed(3),
        "-filter_threads", "1", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", o]);
      out.push({ ...p, file: await readFile(o) });
    }
    return { parts: out };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Joins Kling's shots in order. Each is fitted to its shot's exact length (Kling rounds the length to
 * whole seconds: a short one holds its last frame for the rest), all to the first one's size; the
 * template's sound goes over the whole video.
 */
export async function joinParts(partUrls: string[], lens: number[], soundUrl: string): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), "sj-"));
  try {
    const files: string[] = [];
    for (const [k, url] of partUrls.entries()) {
      const f = join(dir, `k${k}`);
      await download(url, f);
      files.push(f);
    }
    const first = await ffmpegLog([...q, "-i", files[0], "-f", "null", "-t", "0.01", "-"]).catch(() => "");
    const m = /Video:.*?(\d{2,5})x(\d{2,5})/.exec(first);
    const W = m ? Number(m[1]) : 720, H = m ? Number(m[2]) : 1280;
    const fitted: string[] = [];
    for (const [k, f] of files.entries()) {
      const o = join(dir, `f${k}.mp4`);
      await ffmpegLog([...q, "-loglevel", "error", "-i", f, "-an", "-filter_threads", "1",
        "-vf", `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,tpad=stop_mode=clone:stop_duration=2,trim=duration=${lens[k].toFixed(3)},setpts=PTS-STARTPTS`,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "17", "-pix_fmt", "yuv420p", o]);
      fitted.push(o);
    }
    const list = join(dir, "list.txt");
    await writeFile(list, fitted.map((f) => `file '${f}'`).join("\n"));
    const sound = join(dir, "sound");
    const haveSound = await download(soundUrl, sound).then(() => true, () => false);
    const out = join(dir, "out.mp4");
    const total = lens.reduce((a, b) => a + b, 0);
    await ffmpegLog([...q, "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list,
      ...(haveSound ? ["-i", sound, "-map", "0:v:0", "-map", "1:a:0?"] : []),
      "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-t", total.toFixed(3), "-movflags", "+faststart", out]);
    return new Uint8Array(await readFile(out));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
