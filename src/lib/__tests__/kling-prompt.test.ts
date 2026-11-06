import { describe, expect, it } from "vitest";
import { buildKlingDirectPrompt } from "@/lib/generation/kling";
import { parseSeedanceConfig } from "@/lib/templates/seedance-config";

describe("Kling prompt priorities", () => {
  it("starts with the official edit instruction and keeps the wish lower priority", () => {
    const p = buildKlingDirectPrompt("edit", "template", "national costume", "red dress, smiling");
    expect(p.startsWith("Edit @video_1. Replace the main person in @video_1 with the person from @image_1.")).toBe(true);
    expect(p).toContain("Keep the clothing from @video_1");
    expect(p).toContain("Mandatory template instruction: national costume");
    expect(p.indexOf("Mandatory template instruction")).toBeLessThan(p.indexOf("Optional customer wish"));
    expect(p).toMatch(/ignore any part that asks to change the faces or the clothing/);
    expect(p).toContain("Never return to the original face from @video_1");
    expect(p).not.toContain("@element");
    expect(p).not.toContain("Reference only");
  });

  it("adds no wish section when the customer wrote nothing", () => {
    const p = buildKlingDirectPrompt("edit", "photo", "", "");
    expect(p).not.toContain("customer wish");
    expect(p).toContain("Use the clothing of the people in @image_1");
  });

  it("reference mode makes a new video that follows the template", () => {
    const p = buildKlingDirectPrompt("reference", "photo", "", "");
    expect(p.startsWith("Follow the motion")).toBe(true);
    expect(p).toContain("replace the main person in @video_1 with the person from @image_1");
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
  it("adds the car after the person", async () => {
    const { buildKlingDirectPrompt } = await import("@/lib/generation/kling");
    const p = buildKlingDirectPrompt("edit", "photo", "", "", 1, [], [{ what: "car" }]);
    expect(p).toContain("@image_2 is a photo of a car, not a person");
    expect(p).toContain("Replace the car in @video_1 with the car from @image_2");
    expect(p).toContain("the very last");
  });
  it("three people by position, then a horse and an outfit", () => {
    const p = buildKlingDirectPrompt("edit", "template", "", "", 3, ["on the left", "in the center", "on the right"], [{ what: "horse" }, { what: "outfit" }]);
    expect(p).toContain("the person on the left with the person from @image_1");
    expect(p).toContain("the person on the right with the person from @image_3");
    expect(p).toContain("do not swap, blend or mix their faces");
    expect(p).toContain("@image_4 is a photo of a horse");
    expect(p).toContain("Dress the people in the outfit from @image_5");
    expect(p).not.toContain("Keep the clothing from @video_1");
  });
  it("slots: people first, then objects", async () => {
    const { seedanceSlots } = await import("@/lib/templates/seedance-config");
    const s = seedanceSlots(1, "face_", [], [{ what: "horse", label: "Фото лошади" }]);
    expect(s.map((x) => [x.key, x.providerInput, x.kind ?? "person"])).toEqual([["face_1", "img_1", "person"], ["obj_1", "img_2", "object"]]);
  });
});
