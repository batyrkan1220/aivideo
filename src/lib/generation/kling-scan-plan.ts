/** What to send Kling's face search. It treats a 0×0 audio track as the picture width and rejects the file. */

export type KlingScanPlan = "strip" | "scale";

export function parseMp4Tracks(data: Uint8Array): { w: number; h: number }[] {
  const tracks: { w: number; h: number }[] = [];
  const key = [0x74, 0x6b, 0x68, 0x64]; // tkhd
  for (let i = 0; i + 88 <= data.length; i++) {
    if (data[i] !== key[0] || data[i + 1] !== key[1] || data[i + 2] !== key[2] || data[i + 3] !== key[3]) continue;
    const ver = data[i + 4];
    const read = (at: number) => (data[at] << 24 | data[at + 1] << 16 | data[at + 2] << 8 | data[at + 3]) >>> 0;
    if (ver === 0) tracks.push({ w: Math.round(read(i + 80) / 65536), h: Math.round(read(i + 84) / 65536) });
    else if (ver === 1 && i + 100 <= data.length) tracks.push({ w: Math.round(read(i + 92) / 65536), h: Math.round(read(i + 96) / 65536) });
  }
  return tracks;
}

export function klingScanPlan(tracks: { w: number; h: number }[]): KlingScanPlan {
  const video = tracks.filter((t) => t.w >= 64 && t.h >= 64).sort((a, b) => b.w * b.h - a.w * a.h)[0];
  if (!video) return "strip";
  const fits = video.w >= 512 && video.h >= 512 && video.w <= 2160 && video.h <= 2160;
  return fits ? "strip" : "scale";
}

/** Picture size Kling face search accepts: both sides 512–2160, even. */
export function klingScanScale(w: number, h: number): { w: number; h: number } {
  let tw = w;
  let th = h;
  const minSide = Math.min(tw, th);
  if (minSide > 0 && minSide < 512) {
    const s = 512 / minSide;
    tw *= s;
    th *= s;
  }
  const maxSide = Math.max(tw, th);
  if (maxSide > 2160) {
    const s = 2160 / maxSide;
    tw *= s;
    th *= s;
  }
  const even = (n: number) => Math.max(512, Math.min(2160, Math.round(n / 2) * 2));
  return { w: even(tw), h: even(th) };
}
