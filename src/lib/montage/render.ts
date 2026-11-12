import "server-only";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ffmpegLog } from "@/lib/templates/lite-preview";
import { parseStats, planCuts, type ClipStats, type MontageOptions } from "./plan";

/*
  Автомонтаж render (ffmpeg only, sized for the 512 MB / 0.5 CPU server):
   1. each clip is scanned small (2 frames a second, 96 px) for motion and light;
   2. the plan takes the best windows (plan.ts);
   3. every cut is encoded on its own to 720×1280, 30 fps, with the style's look and fades, and the title
      on the first one; one encoder at a time, one thread;
   4. the cuts are joined without re-encoding, then the sound is set (original / the customer's track / none).
*/

const W = 720, H = 1280, FPS = 30;
const q = ["-hide_banner", "-y", "-loglevel", "error", "-threads", "1"];
const x264 = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-x264-params", "ref=1", "-threads", "1", "-r", String(FPS), "-g", String(FPS)];
const FONT = () => join(process.cwd(), "assets/fonts/Onest-ExtraBold.ttf");

type Probe = { duration: number; audio: boolean };

async function probe(file: string): Promise<Probe> {
  const info = await ffmpegLog(["-hide_banner", "-i", file, "-f", "null", "-t", "0.01", "-"]).catch((e: Error) => e.message);
  const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(info);
  return { duration: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0, audio: /Stream #.*Audio:/.test(info) };
}

async function stats(file: string, duration: number): Promise<ClipStats> {
  const log = await ffmpegLog(["-hide_banner", "-loglevel", "info", "-threads", "1", "-i", file, "-an",
    "-vf", "fps=2,scale=96:-2,signalstats,metadata=mode=print:key=lavfi.signalstats.YDIF,metadata=mode=print:key=lavfi.signalstats.YAVG",
    "-f", "null", "-"], 240_000).catch(() => "");
  return { duration, samples: parseStats(log) };
}

const LOOK: Record<MontageOptions["style"], string> = {
  dynamic: "eq=contrast=1.05:saturation=1.08",
  smooth: "eq=contrast=1.02:saturation=1.04",
  cinema: "eq=contrast=1.08:saturation=0.92:gamma=0.97,vignette=PI/5",
};

export async function renderMontage(dir: string, clipFiles: string[], musicFile: string | null, opts: MontageOptions): Promise<{ file: string; durationSec: number }> {
  const probes = [];
  for (const f of clipFiles) probes.push(await probe(f));
  const st: ClipStats[] = [];
  for (const [i, f] of clipFiles.entries()) st.push(await stats(f, probes[i].duration));
  const cuts = planCuts(st, opts.style, opts.length);
  if (!cuts.length) throw new Error("no_cuts");

  const titleFile = join(dir, "title.txt");
  const title = opts.title.trim().slice(0, 40);
  if (title) await writeFile(titleFile, title);
  const parts: string[] = [];
  let total = 0;
  for (const [k, c] of cuts.entries()) {
    const first = k === 0, last = k === cuts.length - 1;
    const fadeIn = first ? 0.35 : opts.style === "dynamic" ? 0 : 0.2;
    const fadeOut = last ? 0.6 : opts.style === "dynamic" ? 0 : 0.2;
    const vf = [
      `scale=${W}:${H}:force_original_aspect_ratio=increase`, `crop=${W}:${H}`, "setsar=1", `fps=${FPS}`, LOOK[opts.style],
      ...(fadeIn ? [`fade=t=in:st=0:d=${fadeIn}`] : []),
      ...(fadeOut ? [`fade=t=out:st=${Math.max(0, c.len - fadeOut).toFixed(2)}:d=${fadeOut}`] : []),
      // The title: big, centred low, on the first cut only.
      ...(first && title ? [`drawtext=fontfile='${FONT()}':textfile='${titleFile}':fontcolor=white:fontsize=64:line_spacing=8:` +
        `x=(w-text_w)/2:y=h*0.72:shadowcolor=black@0.55:shadowx=0:shadowy=4:alpha='if(lt(t,0.3),t/0.3,1)'`] : []),
    ].join(",");
    const af = `aresample=44100,aformat=channel_layouts=stereo${fadeIn ? `,afade=t=in:st=0:d=${fadeIn}` : ""}${fadeOut ? `,afade=t=out:st=${Math.max(0, c.len - fadeOut).toFixed(2)}:d=${fadeOut}` : ""}`;
    const out = join(dir, `p${k}.mp4`);
    const src = ["-ss", c.start.toFixed(2), "-t", c.len.toFixed(2), "-i", clipFiles[c.clip]];
    const audio = probes[c.clip].audio
      ? ["-map", "0:v:0", "-map", "0:a:0", "-af", af]
      : ["-f", "lavfi", "-t", c.len.toFixed(2), "-i", "anullsrc=r=44100:cl=stereo", "-map", "0:v:0", "-map", "1:a:0"];
    const args = probes[c.clip].audio
      ? [...q, ...src, "-vf", vf, ...audio, ...x264, "-c:a", "aac", "-b:a", "128k", "-t", c.len.toFixed(2), out]
      : [...q, ...src, ...audio.slice(0, 6), "-vf", vf, ...audio.slice(6), ...x264, "-c:a", "aac", "-b:a", "128k", "-t", c.len.toFixed(2), out];
    await ffmpegLog(args, 180_000);
    parts.push(out);
    total += c.len;
  }

  const list = join(dir, "list.txt");
  await writeFile(list, parts.map((p) => `file '${p}'`).join("\n"));
  const joined = join(dir, "joined.mp4");
  await ffmpegLog([...q, "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", joined], 120_000);

  const final = join(dir, "montage.mp4");
  if (opts.sound === "music" && musicFile) {
    // The customer's track under the clips' own sound (kept quiet), faded out at the end.
    await ffmpegLog([...q, "-i", joined, "-stream_loop", "-1", "-i", musicFile,
      "-filter_complex", `[1:a]aresample=44100,aformat=channel_layouts=stereo,volume=0.9,afade=t=in:st=0:d=0.5,afade=t=out:st=${Math.max(0, total - 1.5).toFixed(2)}:d=1.5[m];[0:a]volume=0.25[o];[m][o]amix=inputs=2:duration=first,volume=2[a]`,
      "-map", "0:v:0", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-t", total.toFixed(2), "-movflags", "+faststart", final], 180_000);
  } else if (opts.sound === "mute") {
    await ffmpegLog([...q, "-i", joined, "-map", "0:v:0", "-c:v", "copy", "-an", "-movflags", "+faststart", final], 60_000);
  } else {
    await ffmpegLog([...q, "-i", joined, "-c", "copy", "-movflags", "+faststart", final], 60_000);
  }
  await readFile(final).then((b) => { if (!b.byteLength) throw new Error("empty"); });
  return { file: final, durationSec: Math.round(total * 100) / 100 };
}
