import { describe, expect, it } from "vitest";
import { akoolCredits, akoolAutoPriceKzt, akoolTierPrices, applyAkoolPricing, DEFAULT_AKOOL_PRICING as S } from "@/lib/pricing-akool";
import { calculatePrice } from "@/lib/pricing";

const base = { basePriceKzt: 0, chargeExtraFaces: false, extraFacePriceKzt: 0, includedFaces: 1, platformFeeKzt: 0, minPriceKzt: 0 };

describe("akool pricing", () => {
  it("credits follow seconds × rate (Akool example: 10 s 720p = 20)", () => {
    expect(akoolCredits(10, "720p", S)).toBe(20);
    expect(akoolCredits(9.2, "480p", S)).toBe(10);  // 5-second blocks
    expect(akoolCredits(11, "720p", S)).toBe(30);   // 15 billed seconds × 2
  });
  it("auto price = credits × tenge × (1 + markup), rounded up, with a minimum", () => {
    expect(akoolAutoPriceKzt(10, "720p", S)).toBe(1000); // 20 × 25 × 2
    expect(akoolAutoPriceKzt(3, "480p", S)).toBe(990);   // minimum
    expect(akoolAutoPriceKzt(20, "720p", { ...S, tengePerCredit: 23.3 })).toBe(1870); // 40×23.3=932 → ×2=1864 → 1870
  });
  it("manual price is the 720p price; 480p is cheaper by the auto difference", () => {
    expect(akoolTierPrices(20, 2990, S)).toEqual({ "720p": 2990, "480p": 2990 - (2000 - 1000) });
    expect(akoolTierPrices(null, 1990, S)).toEqual({ "720p": 1990, "480p": 1990 });
    expect(akoolTierPrices(null, 0, S)).toBeNull();
  });
  it("maps onto the generic calculator exactly", () => {
    const tiers = akoolTierPrices(15, 0, S)!;
    const { pricing, qualities } = applyAkoolPricing(base, tiers);
    for (const q of qualities) expect(calculatePrice(pricing, q, 1).totalKzt).toBe(tiers[q.key as "480p" | "720p"]);
  });
});
