import "server-only";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { ffmpegLog, holdMedia } from "@/lib/templates/lite-preview";
import { klingShotSec, planParts, type Part } from "./scene-plan";

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
// Low-memory H.264 (no lookahead, no B-frames): the server has 512 MB, and the first version of this
// was killed while encoding a 720×1280 shot (TM-100035).
const x264 = ["-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency", "-x264-params", "ref=1", "-threads", "1"];

async function findShots(inPath: string) {
  // Scene changes from a small, cheap copy of the picture.
  const log = await ffmpegLog([...q, "-i", inPath, "-an", "-filter_threads", "1",
    "-vf", "scale=160:-2,select='gt(scene,0.35)',showinfo", "-f", "null", "-"]);
  const dur = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(log);
  const total = dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0;
  const cuts = [...log.matchAll(/pts_time:(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  return { total, cuts, parts: planParts(total, cuts) };
}

/**
 * Admin view of how an order of this template is cut: every scene change ffmpeg finds, the shots
 * Kling gets (3 s or more), and a small frame from the middle of each scene.
 */
export async function previewShots(videoUrl: string): Promise<{ total: number; cuts: number[]; parts: Part[]; scenes: { start: number; len: number; jpg: string }[] }> {
  const release = holdMedia();
  const dir = await mkdtemp(join(tmpdir(), "ps-"));
  try {
    const inPath = join(dir, "in");
    await download(videoUrl, inPath);
    const { total, cuts, parts } = await findShots(inPath);
    const edges = [0, ...cuts.filter((c) => c > 0.05 && c < total - 0.05), total];
    const scenes: { start: number; len: number; jpg: string }[] = [];
    for (let i = 0; i < edges.length - 1 && i < 24; i++) {
      const start = edges[i], len = edges[i + 1] - start, o = join(dir, `s${i}.jpg`);
      await ffmpegLog([...q, "-loglevel", "error", "-ss", (start + len / 2).toFixed(3), "-i", inPath, "-frames:v", "1",
        "-vf", "scale=240:-2", "-q:v", "5", o]);
      scenes.push({ start, len, jpg: `data:image/jpeg;base64,${(await readFile(o)).toString("base64")}` });
    }
    return { total, cuts, parts, scenes };
  } finally {
    release();
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Shots of the video (start/length in seconds), or null when it is one shot. */
export async function splitAtCuts(videoUrl: string): Promise<{ parts: (Part & { file: Buffer })[] } | null> {
  const release = holdMedia();
  const dir = await mkdtemp(join(tmpdir(), "sp-"));
  try {
    const inPath = join(dir, "in");
    await download(videoUrl, inPath);
    const { total, cuts, parts } = await findShots(inPath);
    console.log("[scenes]", `total=${total.toFixed(2)} cuts=${cuts.map((c) => c.toFixed(2)).join(",") || "-"} parts=${parts.length}`);
    if (parts.length < 2) return null;
    const out: (Part & { file: Buffer })[] = [];
    for (const [k, p] of parts.entries()) {
      const o = join(dir, `p${k}.mp4`);
      // Exact cut points: re-encoded (stream copy would snap to keyframes), sound kept.
      // Held on the last frame (and silence) up to whole seconds (at least 3): Kling returns whole
      // seconds only, so nothing of the shot is lost; the join cuts it back to its real length.
      const hold = klingShotSec(p.len) + 0.05 - p.len;
      await ffmpegLog([...q, "-loglevel", "error", "-ss", p.start.toFixed(3), "-t", p.len.toFixed(3), "-i", inPath,
        ...(hold ? ["-vf", `tpad=stop_mode=clone:stop_duration=${hold.toFixed(3)}`, "-af", `apad=pad_dur=${hold.toFixed(3)}`] : []),
        "-filter_threads", "1", ...x264, "-crf", "17", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", o]);
      out.push({ ...p, file: await readFile(o) });
    }
    return { parts: out };
  } finally {
    release();
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Joins Kling's shots in order. Each is fitted to its shot's exact length (Kling rounds the length to
 * whole seconds: a short one holds its last frame for the rest), all to the first one's size; the
 * template's sound goes over the whole video.
 */
export async function joinParts(partUrls: string[], lens: number[], soundUrl: string): Promise<Uint8Array> {
  const release = holdMedia();
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
    // What Kling returned, for the log: its length and the scene changes inside each part.
    for (const [k, f] of files.entries()) {
      const r = await findShots(f).catch(() => null);
      if (r) console.log("[scenes] kling part", k + 1, `len=${r.total.toFixed(2)} want=${lens[k].toFixed(2)} cuts=${r.cuts.map((c) => c.toFixed(2)).join(",") || "-"}`);
    }
    const fitted: string[] = [];
    for (const [k, f] of files.entries()) {
      const o = join(dir, `f${k}.mp4`);
      await ffmpegLog([...q, "-loglevel", "error", "-i", f, "-an", "-filter_threads", "1",
        "-vf", `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,tpad=stop_mode=clone:stop_duration=2,trim=duration=${lens[k].toFixed(3)},setpts=PTS-STARTPTS`,
        ...x264, "-crf", "18", "-pix_fmt", "yuv420p", o]);
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
    release();
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
