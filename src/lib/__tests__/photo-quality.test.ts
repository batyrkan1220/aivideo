import { describe, expect, it } from "vitest";
import { assessGray } from "@/lib/uploads/photo-quality";

const W = 64, H = 64;
const img = (f: (x: number, y: number) => number) => { const a = new Uint8ClampedArray(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = f(x, y); return a; };

describe("assessGray", () => {
  it("passes a lit, sharp image", () => {
    expect(assessGray(img((x, y) => ((x >> 2) + (y >> 2)) % 2 ? 200 : 60), W, H)).toEqual([]);
  });
  it("flags a dark image", () => {
    expect(assessGray(img((x, y) => ((x + y) % 2 ? 50 : 10)), W, H)).toContain("dark");
  });
  it("flags an overexposed image", () => {
    expect(assessGray(img((x, y) => ((x + y) % 2 ? 255 : 200)), W, H)).toContain("bright");
  });
  it("flags a flat (foggy / empty) image", () => {
    expect(assessGray(img(() => 128), W, H)).toContain("flat");
  });
  it("flags a blurry image (smooth gradient, no edges)", () => {
    expect(assessGray(img((x) => 40 + x * 2.5), W, H)).toContain("blurry");
  });
});

import { faceIssues } from "@/lib/uploads/photo-quality";
describe("faceIssues", () => {
  it("no detector → no verdict", () => expect(faceIssues(null, "half")).toEqual([]));
  it("no face", () => expect(faceIssues([], "half")).toEqual(["no_face"]));
  it("group photo is refused", () => expect(faceIssues([0.12, 0.11, 0.1, 0.13, 0.09], "half")).toEqual(["many_faces"]));
  it("a tiny face in the background does not count", () => expect(faceIssues([0.3, 0.05], "half")).toEqual([]));
  it("face too small for a close-up template", () => expect(faceIssues([0.1], "face")).toEqual(["face_small"]));
  it("full-body photo may have a small face", () => expect(faceIssues([0.06], "full")).toEqual([]));
});

import { mergeBoxes } from "@/lib/uploads/photo-quality";
describe("mergeBoxes", () => {
  it("keeps one box for the same face found twice (whole image + tile)", () => {
    expect(mergeBoxes([{ x: 100, y: 100, w: 40, h: 40 }], [{ x: 104, y: 98, w: 38, h: 42 }])).toHaveLength(1);
  });
  it("adds a different face", () => {
    expect(mergeBoxes([{ x: 100, y: 100, w: 40, h: 40 }], [{ x: 300, y: 100, w: 40, h: 40 }])).toHaveLength(2);
  });
});
