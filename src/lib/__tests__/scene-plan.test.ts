import { describe, expect, it } from "vitest";
import { planParts } from "../media/scene-plan";

describe("planParts", () => {
  it("one shot without cuts", () => {
    expect(planParts(13.16, [])).toEqual([{ start: 0, len: 13.16 }]);
  });
  it("splits at cuts with 3 s or more on both sides", () => {
    const p = planParts(13.16, [4.04, 8.5]);
    expect(p.map((x) => +x.start.toFixed(2))).toEqual([0, 4.04, 8.5]);
    expect(p.reduce((a, b) => a + b.len, 0)).toBeCloseTo(13.16);
  });
  it("keeps short shots with their neighbour", () => {
    expect(planParts(10, [1, 4, 5, 8.5]).map((x) => x.start)).toEqual([0, 4]);
  });
  it("merges down to the maximum", () => {
    const p = planParts(30, [3, 6, 9, 12, 15, 18, 21, 24, 27], 3, 5);
    expect(p).toHaveLength(5);
    expect(p.reduce((a, b) => a + b.len, 0)).toBeCloseTo(30);
    expect(p.every((x) => x.len >= 3)).toBe(true);
  });
  it("empty for unknown length", () => {
    expect(planParts(0, [2])).toEqual([]);
  });
});
