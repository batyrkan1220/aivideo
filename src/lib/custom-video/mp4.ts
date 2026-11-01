/**
 * Minimal ISO-BMFF (MP4 / MOV) checks, no dependencies:
 *  - `sniffVideoType`: real container type from the first bytes ("ftyp" box);
 *  - `mp4DurationSec`: duration from moov → mvhd (works whether moov is at the start or the end);
 *  - `mp4VideoAspect`: display width ÷ height of the video track (tkhd size + 90°/270° rotation).
 */
export type VideoType = "video/mp4" | "video/quicktime";

export function sniffVideoType(b: Uint8Array): VideoType | null {
  if (b.length < 12) return null;
  const tag = String.fromCharCode(b[4], b[5], b[6], b[7]);
  if (tag !== "ftyp") return null;
  const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
  return brand === "qt  " ? "video/quicktime" : "video/mp4";
}

function u32(b: Uint8Array, o: number) { return ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]; }
function u64(b: Uint8Array, o: number) { return u32(b, o) * 2 ** 32 + u32(b, o + 4); }
function type4(b: Uint8Array, o: number) { return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]); }

/** Walks boxes in [start, end) and returns the payload range of the first box named `name`. */
function findBox(b: Uint8Array, start: number, end: number, name: string): [number, number] | null {
  let o = start;
  while (o + 8 <= end) {
    let size = u32(b, o);
    const t = type4(b, o + 4);
    let header = 8;
    if (size === 1) { if (o + 16 > end) return null; size = u64(b, o + 8); header = 16; }
    else if (size === 0) size = end - o;
    if (size < header || o + size > end) return null;
    if (t === name) return [o + header, o + size];
    o += size;
  }
  return null;
}

export function mp4DurationSec(b: Uint8Array): number | null {
  const moov = findBox(b, 0, b.length, "moov");
  if (!moov) return null;
  const mvhd = findBox(b, moov[0], moov[1], "mvhd");
  if (!mvhd) return null;
  const p = mvhd[0];
  const version = b[p];
  const scale = version === 1 ? u32(b, p + 20) : u32(b, p + 12);
  const dur = version === 1 ? u64(b, p + 24) : u32(b, p + 16);
  if (!scale) return null;
  return Math.round((dur / scale) * 100) / 100;
}

/** Width ÷ height as shown (video track's tkhd, rotation applied), or null when unknown. */
export function mp4VideoAspect(b: Uint8Array): number | null {
  const moov = findBox(b, 0, b.length, "moov");
  if (!moov) return null;
  let o = moov[0];
  while (o + 8 <= moov[1]) {
    const trak = findBox(b, o, moov[1], "trak");
    if (!trak) return null;
    const mdia = findBox(b, trak[0], trak[1], "mdia");
    const hdlr = mdia && findBox(b, mdia[0], mdia[1], "hdlr");
    if (hdlr && type4(b, hdlr[0] + 8) === "vide") {
      const tkhd = findBox(b, trak[0], trak[1], "tkhd");
      if (!tkhd) return null;
      const p = tkhd[0];
      const m = p + (b[p] === 1 ? 52 : 40); // transformation matrix
      if (m + 44 > tkhd[1]) return null;
      let w = u32(b, m + 36) / 65536, h = u32(b, m + 40) / 65536;
      const a = u32(b, m) | 0, c = u32(b, m + 4) | 0;
      if (a === 0 && c !== 0) [w, h] = [h, w]; // rotated 90° / 270°
      if (!(w > 0 && h > 0)) return null;
      return Math.round((w / h) * 10000) / 10000;
    }
    o = trak[1];
  }
  return null;
}
