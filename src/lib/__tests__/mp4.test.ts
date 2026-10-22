import { describe, expect, it } from "vitest";
import { mp4DurationSec, sniffVideoType } from "@/lib/custom-video/mp4";

function box(type: string, payload: Uint8Array) {
  const b = new Uint8Array(8 + payload.length);
  new DataView(b.buffer).setUint32(0, b.length);
  for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i);
  b.set(payload, 8);
  return b;
}
const cat = (...xs: Uint8Array[]) => { const out = new Uint8Array(xs.reduce((n, x) => n + x.length, 0)); let o = 0; for (const x of xs) { out.set(x, o); o += x.length; } return out; };
function mvhd(scale: number, dur: number) {
  const p = new Uint8Array(100); const dv = new DataView(p.buffer);
  dv.setUint32(12, scale); dv.setUint32(16, dur);
  return box("mvhd", p);
}
const ftyp = (brand: string) => box("ftyp", new Uint8Array([...brand].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0])));

describe("mp4", () => {
  it("sniffs mp4 and mov", () => {
    expect(sniffVideoType(ftyp("isom"))).toBe("video/mp4");
    expect(sniffVideoType(ftyp("qt  "))).toBe("video/quicktime");
    expect(sniffVideoType(new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });
  it("reads duration with moov at the end", () => {
    const file = cat(ftyp("isom"), box("mdat", new Uint8Array(500)), box("moov", mvhd(1000, 15500)));
    expect(mp4DurationSec(file)).toBe(15.5);
  });
  it("returns null without moov", () => {
    expect(mp4DurationSec(cat(ftyp("isom"), box("mdat", new Uint8Array(10))))).toBeNull();
  });
});
