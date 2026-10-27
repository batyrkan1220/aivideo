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
