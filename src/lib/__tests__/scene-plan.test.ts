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
