import { describe, expect, it } from "vitest";
import { klingScanPlan, klingScanScale, parseMp4Tracks } from "@/lib/generation/kling-scan-plan";

function tkhd(w: number, h: number) {
  const buf = Buffer.alloc(88);
  buf.write("tkhd", 0);
  buf.writeUInt32BE(Math.round(w * 65536), 80);
  buf.writeUInt32BE(Math.round(h * 65536), 84);
  return buf;
}

describe("Kling face-search file", () => {
  it("drops the 0×0 audio track when the picture already fits", () => {
    const tracks = parseMp4Tracks(Buffer.concat([tkhd(704, 1280), tkhd(0, 0)]));
    expect(tracks).toEqual([{ w: 704, h: 1280 }, { w: 0, h: 0 }]);
    expect(klingScanPlan(tracks)).toBe("strip");
  });
  it("scales a picture narrower than 512", () => {
    expect(klingScanPlan([{ w: 464, h: 848 }, { w: 0, h: 0 }])).toBe("scale");
    expect(klingScanScale(464, 848)).toEqual({ w: 512, h: 936 });
  });
});
