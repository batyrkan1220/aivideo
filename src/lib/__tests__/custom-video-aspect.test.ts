import { describe, expect, it } from "vitest";
import { aspectAllowed, nearestOutputAspect } from "@/lib/custom-video/aspect";

describe("custom video aspect (Kling 4.0 rules)", () => {
  it("accepts 2:5 … 5:2 only", () => {
    expect(aspectAllowed(9 / 16)).toBe(true);
    expect(aspectAllowed(0.4)).toBe(true);
    expect(aspectAllowed(2.5)).toBe(true);
    expect(aspectAllowed(0.3)).toBe(false);
    expect(aspectAllowed(3)).toBe(false);
  });
  it("picks the closest output", () => {
    expect(nearestOutputAspect(9 / 16)).toBe("9:16");
    expect(nearestOutputAspect(3 / 4)).toBe("9:16");
    expect(nearestOutputAspect(1)).toBe("1:1");
    expect(nearestOutputAspect(4 / 3)).toBe("16:9");
    expect(nearestOutputAspect(16 / 9)).toBe("16:9");
    expect(nearestOutputAspect(null)).toBe("9:16");
  });
});
