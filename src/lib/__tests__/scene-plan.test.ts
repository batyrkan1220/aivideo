import { describe, expect, it } from "vitest";
import { planParts } from "../media/scene-plan";

describe("planParts", () => {
  it("one shot without cuts", () => {
    expect(planParts(13.16, [])).toEqual([{ start: 0, len: 13.16 }]);
  });
  it("every scene is its own shot, also short ones (TM-100039)", () => {
    const p = planParts(15, [1.83, 5.27, 7.93]);
    expect(p.map((x) => +x.start.toFixed(2))).toEqual([0, 1.83, 5.27, 7.93]);
    expect(p.reduce((a, b) => a + b.len, 0)).toBeCloseTo(15);
  });
  it("a flash under 0.8 s stays with its neighbour", () => {
    expect(planParts(10, [4, 4.3, 8]).map((x) => x.start)).toEqual([0, 4, 8]);
  });
  it("merges down to the maximum", () => {
    const p = planParts(30, [3, 6, 9, 12, 15, 18, 21, 24, 27], 0.8, 5);
    expect(p).toHaveLength(5);
    expect(p.reduce((a, b) => a + b.len, 0)).toBeCloseTo(30);
  });
  it("empty for unknown length", () => {
    expect(planParts(0, [2])).toEqual([]);
  });
});

import { toFrames } from "../media/scene-plan";
describe("toFrames", () => {
  it("every frame belongs to exactly one shot, cut on the scene's first frame", () => {
    const f = toFrames(planParts(15, [1.83, 5.27, 7.93]), 15, 30);
    expect(f.map((p) => [p.from, p.to])).toEqual([[0, 55], [55, 158], [158, 238], [238, null]]);
    expect(f.reduce((n, p) => n + p.frames, 0)).toBe(450);
    expect(f[0].len).toBeCloseTo(55 / 30);
  });
});

import { analysisTimes } from "../media/scene-plan";
describe("analysisTimes: a frame of every scene for the AI", () => {
  it("one frame from the middle of each scene, more evenly up to 6", () => {
    const t = analysisTimes(12, [3.1, 3.9, 8]);
    for (const mid of [1.55, 3.5, 5.95, 10]) expect(t).toContain(mid); // the short 0.8 s scene too
    expect(t.length).toBeGreaterThanOrEqual(6);
    expect([...t].sort((a, b) => a - b)).toEqual(t);
  });
  it("no cuts: 6 spread over the video", () => {
    expect(analysisTimes(10, [])).toHaveLength(6);
  });
  it("many scenes: at most 10, the longest", () => {
    expect(analysisTimes(30, Array.from({ length: 20 }, (_, i) => (i + 1) * 1.4))).toHaveLength(10);
  });
});
