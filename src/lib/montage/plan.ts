/*
  Автомонтаж planning (pure, tested): which moments of which clips go into the video.
  Each clip gets a motion/brightness score per sample (from ffmpeg signalstats); the montage takes the
  liveliest, well-lit windows, a share per clip by its length, in the order the clips were added.
*/

export type MontageStyle = "dynamic" | "smooth" | "cinema";
export type MontageSound = "original" | "music" | "mute";
export type MontageOptions = { style: MontageStyle; length: 15 | 30 | 60; sound: MontageSound; title: string };

/** Length of one cut by style (s). */
export const SEG_SEC: Record<MontageStyle, number> = { dynamic: 1.2, smooth: 2.4, cinema: 3.2 };
export const MAX_CLIPS = 8;
export const MAX_CLIP_SEC = 180;

export type ClipStats = { duration: number; samples: { t: number; motion: number; light: number }[] };
export type Cut = { clip: number; start: number; len: number };

/** Score of the window [s, s+len): average motion, dark parts count less. */
function windowScore(c: ClipStats, s: number, len: number): number {
  const inWin = c.samples.filter((x) => x.t >= s && x.t < s + len);
  if (!inWin.length) return 0;
  const motion = inWin.reduce((a, x) => a + x.motion, 0) / inWin.length;
  const light = inWin.reduce((a, x) => a + x.light, 0) / inWin.length;
  // Very dark (< 30 of 255) or blown out (> 235) windows are pushed down; some motion beats none.
  const lightF = light < 30 ? 0.3 : light > 235 ? 0.6 : 1;
  return (0.5 + motion) * lightF;
}

export function planCuts(clips: ClipStats[], style: MontageStyle, lengthSec: number): Cut[] {
  const seg = SEG_SEC[style];
  const usable = clips.map((c) => Math.max(0, c.duration - 0.4));
  const total = usable.reduce((a, b) => a + b, 0);
  if (!clips.length || total < 1) return [];
  const target = Math.min(lengthSec, total * 0.85);
  const n = Math.max(1, Math.round(target / seg));
  // Cuts per clip by length, at least one each (while they last), never more than fit.
  const fit = usable.map((u) => Math.max(0, Math.floor(u / seg)));
  const per = usable.map((u, i) => Math.min(fit[i], Math.max(fit[i] > 0 ? 1 : 0, Math.round((u / total) * n))));
  // Adjust to n: add to / take from the longest clips.
  let sum = per.reduce((a, b) => a + b, 0);
  const order = usable.map((u, i) => ({ u, i })).sort((a, b) => b.u - a.u).map((x) => x.i);
  for (let guard = 0; sum < n && guard < 1000; guard++) {
    const i = order.find((k) => per[k] < fit[k]);
    if (i === undefined) break;
    per[i]++; sum++;
  }
  for (let guard = 0; sum > n && guard < 1000; guard++) {
    const i = order.find((k) => per[k] > 1);
    if (i === undefined) break;
    per[i]--; sum--;
  }
  const cuts: Cut[] = [];
  clips.forEach((c, ci) => {
    const len = Math.min(seg, c.duration - 0.2);
    if (per[ci] <= 0 || len < 0.6) return;
    const cand: { s: number; score: number }[] = [];
    for (let s = 0.2; s + len <= c.duration - 0.05; s += 0.25) cand.push({ s, score: windowScore(c, s, len) });
    if (!cand.length) cand.push({ s: 0, score: 0 });
    cand.sort((a, b) => b.score - a.score);
    const picked: number[] = [];
    for (const x of cand) {
      if (picked.length >= per[ci]) break;
      if (picked.every((p) => Math.abs(p - x.s) >= len + 0.3)) picked.push(x.s);
    }
    picked.sort((a, b) => a - b).forEach((s) => cuts.push({ clip: ci, start: Math.round(s * 100) / 100, len: Math.round(len * 100) / 100 }));
  });
  return cuts;
}

/** Parses `ffmpeg … signalstats,metadata=print` output into samples. */
export function parseStats(log: string): ClipStats["samples"] {
  const out: ClipStats["samples"] = [];
  let cur: { t: number; motion?: number; light?: number } | null = null;
  for (const line of log.split("\n")) {
    const t = /pts_time:([\d.]+)/.exec(line);
    if (t) { if (cur && cur.motion !== undefined) out.push({ t: cur.t, motion: cur.motion, light: cur.light ?? 128 }); cur = { t: Number(t[1]) }; continue; }
    const d = /lavfi\.signalstats\.YDIF=([\d.]+)/.exec(line);
    if (d && cur) cur.motion = Math.min(1, Number(d[1]) / 25);
    const a = /lavfi\.signalstats\.YAVG=([\d.]+)/.exec(line);
    if (a && cur) cur.light = Number(a[1]);
  }
  if (cur && cur.motion !== undefined) out.push({ t: cur.t, motion: cur.motion, light: cur.light ?? 128 });
  return out;
}
