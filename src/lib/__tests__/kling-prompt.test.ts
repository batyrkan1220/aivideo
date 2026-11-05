import { describe, expect, it } from "vitest";
import { buildKlingDirectPrompt } from "@/lib/generation/kling";
import { parseSeedanceConfig } from "@/lib/templates/seedance-config";

describe("Kling prompt priorities", () => {
  it("keeps the template rules mandatory and the customer's wish lower priority", () => {
    const p = buildKlingDirectPrompt("edit", "template", "national costume", "red dress, smiling");
    expect(p).toContain("Keep the clothing of the original people");
    expect(p).toContain("Mandatory template instruction: national costume");
    expect(p.indexOf("Mandatory template instruction")).toBeLessThan(p.indexOf("Optional customer wish"));
    expect(p).toMatch(/ignore any part that asks to change the faces or the clothing/);
    expect(p).toContain("including the final seconds");
    expect(p).toContain("Use @image_1 as the only character reference");
    expect(p).toContain("must not appear in any frame");
  });

  it("adds no wish section when the customer wrote nothing", () => {
    expect(buildKlingDirectPrompt("edit", "photo", "", "")).not.toContain("customer wish");
  });

  it("accepts the customer-choice outfit in template config", () => {
    expect(parseSeedanceConfig({ outfit: "choice" }).outfit).toBe("choice");
    expect(parseSeedanceConfig({ outfit: "weird" }).outfit).toBe("photo");
  });
});

import { kzNationalDigits, maskKzNational, normalizeKzPhone } from "@/lib/payments/phone";
describe("Kaspi phone mask", () => {
  it("accepts any way of typing or pasting", () => {
    for (const raw of ["+7 701 555 12 34", "87015551234", "77015551234", "7015551234", "+7 (701) 555-12-34"]) {
      expect(kzNationalDigits(raw)).toBe("7015551234");
    }
    expect(maskKzNational("70155512")).toBe("701 555 12");
    expect(normalizeKzPhone(`+7 ${maskKzNational("7015551234")}`)).toBe("+77015551234");
  });
});

import { applySeedancePricing, seedanceCostUsd, seedancePricingSchema } from "@/lib/pricing-seedance";
import { calculatePrice } from "@/lib/pricing";
import type { PricingConfig } from "@/lib/templates/schema";
describe("1080p option", () => {
  it("adds half of the price for Full HD; 720p stays the default", () => {
    const base = { basePriceKzt: 0, chargeExtraFaces: false, includedFaces: 1, extraFacePriceKzt: 0, platformFeeKzt: 0, minPriceKzt: 0 } as PricingConfig;
    const { pricing, qualities } = applySeedancePricing(base, 2280);
    expect(qualities.map((q) => q.key)).toEqual(["720p", "1080p"]);
    expect(calculatePrice(pricing, qualities[0], 1).totalKzt).toBe(2280);
    expect(calculatePrice(pricing, qualities[1], 1).totalKzt).toBe(3420);
  });
  it("counts Kling cost ×1.5 for 1080p", () => {
    const s = seedancePricingSchema.parse({});
    expect(seedanceCostUsd(10, s, {}, "1080p")).toBeCloseTo(seedanceCostUsd(10, s) * 1.5, 4);
  });
});

describe("Kling prompt with things to swap", () => {
  it("adds the car after the person and keeps identity rules for people only", async () => {
    const { buildKlingDirectPrompt } = await import("@/lib/generation/kling");
    const p = buildKlingDirectPrompt("edit", "photo", "", "", 1, [], [{ what: "car" }]);
    expect(p).toContain("@image_2 is a photo of a car, not a person");
    expect(p).toContain("Replace the car in @video_1 with the car from @image_2");
    expect(p).toContain("reference image (@image_1)");
  });
  it("an outfit photo dresses the person", async () => {
    const { buildKlingDirectPrompt } = await import("@/lib/generation/kling");
    const p = buildKlingDirectPrompt("edit", "template", "", "", 1, [], [{ what: "outfit" }]);
    expect(p).toContain("Dress the person in the outfit shown in @image_2");
    expect(p).not.toContain("Keep the clothing of the original people");
  });
  it("slots: people first, then objects", async () => {
    const { seedanceSlots } = await import("@/lib/templates/seedance-config");
    const s = seedanceSlots(1, "face_", [], [{ what: "horse", label: "Фото лошади" }]);
    expect(s.map((x) => [x.key, x.providerInput, x.kind ?? "person"])).toEqual([["face_1", "img_1", "person"], ["obj_1", "img_2", "object"]]);
  });
});
