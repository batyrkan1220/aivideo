import { describe, it, expect } from "vitest";
import { calculatePrice, startingPrice, formatKzt } from "../pricing";
import { validateFaceSlots, orderedSlots, pricingConfigSchema, type Quality, type FaceSlot } from "../templates/schema";

const std: Quality = { key: "standard", labelKk: "Стандарт", providerQuality: "std", surchargeKzt: 0, available: true };
const hd: Quality = { key: "high", labelKk: "Жоғары сапа", providerQuality: "hd", surchargeKzt: 1000, available: true };
const cfg = pricingConfigSchema.parse({
  basePriceKzt: 2000, chargeExtraFaces: true, extraFacePriceKzt: 500, includedFaces: 1,
});

describe("calculatePrice", () => {
  it("base + quality", () => {
    expect(calculatePrice(cfg, hd, 1).totalKzt).toBe(3000);
  });
  it("charges extra faces when enabled", () => {
    const p = calculatePrice(cfg, std, 3);
    expect(p.extraFaces).toBe(2);
    expect(p.totalKzt).toBe(3000);
  });
  it("ignores extra faces when disabled", () => {
    expect(calculatePrice({ ...cfg, chargeExtraFaces: false }, std, 3).totalKzt).toBe(2000);
  });
  it("applies active percent discount and skips expired", () => {
    const d = { ...cfg, discount: { type: "percent" as const, value: 10, endsAt: "2030-01-01T00:00:00Z" } };
    expect(calculatePrice(d, hd, 1, new Date("2026-10-01")).discountKzt).toBe(300);
    expect(calculatePrice(d, hd, 1, new Date("2031-01-01")).discountKzt).toBe(0);
  });
  it("never goes below min price nor negative", () => {
    const d = { ...cfg, minPriceKzt: 500, discount: { type: "fixed" as const, value: 99999 } };
    expect(calculatePrice(d, std, 1).totalKzt).toBe(500);
  });
  it("respects max price", () => {
    expect(calculatePrice({ ...cfg, maxPriceKzt: 2500 }, hd, 3).totalKzt).toBe(2500);
  });
  it("startingPrice skips unavailable qualities", () => {
    expect(startingPrice(cfg, [{ ...std, available: false }, hd], 1)).toBe(3000);
    expect(startingPrice(cfg, [], 1)).toBeNull();
  });
  it("formats tenge", () => {
    expect(formatKzt(12500)).toBe("12\u202F500\u00A0₸");
    expect(formatKzt(990)).toBe("990\u00A0₸");
    expect(formatKzt(1250000)).toBe("1\u202F250\u202F000\u00A0₸");
  });
});

describe("face slots", () => {
  const slots: FaceSlot[] = [
    { key: "right", labelKk: "3-бет — оң жақ", position: { x: 0.8, y: 0.4 }, providerInput: "face_3", order: 2 },
    { key: "left", labelKk: "1-бет — сол жақ", position: { x: 0.2, y: 0.4 }, providerInput: "face_1", order: 0 },
    { key: "center", labelKk: "2-бет — ортада", position: { x: 0.5, y: 0.4 }, providerInput: "face_2", order: 1 },
  ];
  it("valid 3-face config", () => expect(validateFaceSlots(slots, 3)).toEqual([]));
  it("detects count mismatch and duplicates", () => {
    expect(validateFaceSlots(slots, 2)).toContain("face_count_mismatch");
    expect(validateFaceSlots([slots[0], { ...slots[1], providerInput: "face_3" }], 2)).toContain("duplicate_provider_input");
  });
  it("orders deterministically by admin order", () => {
    expect(orderedSlots(slots).map((s) => s.key)).toEqual(["left", "center", "right"]);
  });
});
