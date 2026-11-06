import { describe, expect, it } from "vitest";
import { buildKlingDirectPrompt } from "@/lib/generation/kling";
import { parseSeedanceConfig } from "@/lib/templates/seedance-config";

describe("Kling prompt priorities", () => {
  it("keeps the template rules mandatory and the customer's wish lower priority", () => {
    const p = buildKlingDirectPrompt("edit", "template", "national costume", "red dress, smiling");
    expect(p).toContain("Keep only the clothing from @video_1");
    expect(p).toContain("Clothing only.");
    expect(p).toContain("Mandatory template instruction: national costume");
    expect(p.indexOf("Mandatory template instruction")).toBeLessThan(p.indexOf("Optional customer wish"));
    expect(p).toMatch(/ignore any part that asks to change the faces or the clothing/);
    expect(p).toContain("Reference only the camera, movement, timing");
    expect(p).toContain("the person from @element_1");
    expect(p).not.toContain("@image_1");
    expect(p).toContain("@element_1 is one person");
    expect(p).toContain("Do not keep the original face, head, hair, skin or body from @video_1");
    expect(p.indexOf("@element_1 is one person")).toBeLessThan(p.indexOf("Reference only the camera"));
  });

  it("adds no wish section when the customer wrote nothing", () => {
    const p = buildKlingDirectPrompt("edit", "photo", "", "");
    expect(p).not.toContain("customer wish");
    expect(p).toContain("Clothing follows @element_1");
    expect(p).toContain("Do not use the clothing from @video_1");
    expect(p).not.toContain("Clothing follows @video_1");
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
    expect(p).toContain("@element_2 is the car, not a person");
    expect(p).toContain("Replace the car in @video_1 with the car from @element_2");
    expect(p).toContain("@element_1 is one person");
    expect(p).toContain("from the left and from the right");
    expect(p).toContain("until the last frame");
    expect(p).not.toContain("@image_1");
  });
  it("keeps three people and a horse or outfit as their own elements", () => {
    const p = buildKlingDirectPrompt("edit", "template", "", "", 3, ["on the left", "in the center", "on the right"], [{ what: "horse" }, { what: "outfit" }]);
    expect(p).toContain("Reference only the camera, movement, timing");
    expect(p).toContain("the person on the left with the person from @element_1");
    expect(p).toContain("the person on the right with the person from @element_3");
    expect(p).toContain("@element_1 is one separate person, on the left");
    expect(p).toContain("@element_2 is one separate person, in the center");
    expect(p).toContain("Do not swap their faces");
    expect(p).toContain("@element_4 is the horse, not a person");
    expect(p).toContain("Dress the people in the outfit shown in @element_5");
    expect(p).not.toContain("Keep the clothing from @video_1");
  });
  it("an outfit photo dresses the person", async () => {
    const { buildKlingDirectPrompt } = await import("@/lib/generation/kling");
    const p = buildKlingDirectPrompt("edit", "template", "", "", 1, [], [{ what: "outfit" }]);
    expect(p).toContain("Dress the person in the outfit shown in @element_2");
    expect(p).toContain("Do not take the clothing from @video_1");
    expect(p).not.toContain("Clothing follows @video_1");
  });
  it("slots: people first, then objects", async () => {
    const { seedanceSlots } = await import("@/lib/templates/seedance-config");
    const s = seedanceSlots(1, "face_", [], [{ what: "horse", label: "Фото лошади" }]);
    expect(s.map((x) => [x.key, x.providerInput, x.kind ?? "person"])).toEqual([["face_1", "img_1", "person"], ["obj_1", "img_2", "object"]]);
  });
});
