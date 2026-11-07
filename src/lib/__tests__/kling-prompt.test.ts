import { describe, expect, it } from "vitest";
import { buildKlingDirectPrompt } from "@/lib/generation/kling";
import { parseSeedanceConfig } from "@/lib/templates/seedance-config";

describe("Kling prompt priorities", () => {
  it("starts with the official edit instruction and keeps the wish lower priority", () => {
    const p = buildKlingDirectPrompt("edit", "template", "national costume", "red dress, smiling");
    expect(p.startsWith("Edit @video_1. Replace the main person in @video_1 with the person from @image_1.")).toBe(true);
    expect(p).toContain("keep exactly the clothing of the original person in @video_1");
    expect(p).toContain("Never take clothing from @image_1");
    expect(p).toContain("their clothing is the only thing that stays");
    expect(p).toContain("any person mentioned in it is still replaced as described above): national costume");
    expect(p.indexOf("Scene and motion to keep")).toBeLessThan(p.indexOf("Optional customer wish"));
    expect(p).toContain("The original person from @video_1 must not appear in any frame. Do not return @video_1 unchanged.");
    expect(p).toMatch(/ignore any part that asks to change the faces or the clothing/);
    expect(p).toContain("Never return to the original face from @video_1");
    expect(p).toContain("Replace the whole person, not only the face: head, hair, neck, arms, hands, legs and feet");
    expect(p).toContain("skin color and skin tone of @image_1 everywhere on the body");
    expect(p).not.toContain("@element");
    expect(p).not.toContain("Reference only");
  });

  it("adds no wish section when the customer wrote nothing", () => {
    const p = buildKlingDirectPrompt("edit", "photo", "", "");
    expect(p).not.toContain("customer wish");
    expect(p).toContain("in the clothing they wear in @image_1");
    expect(p).not.toContain("only thing that stays");
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
    expect(p).toContain("- The person on the left becomes the person from @image_1.");
    expect(p).toContain("- The person on the right becomes the person from @image_3.");
    expect(p).toContain("All 3 must be replaced");
    expect(p).not.toContain("other people");
    expect(p).toContain("@image_1, @image_2, @image_3 are 3 different people: each one goes only to their own place");
    expect(p).toContain("@image_4 is a photo of a horse");
    expect(p).toContain("Dress the people in the outfit from @image_5");
    expect(p).not.toContain("keep exactly the clothing of the original person");
  });
  it("slots: people first, then objects", async () => {
    const { seedanceSlots } = await import("@/lib/templates/seedance-config");
    const s = seedanceSlots(1, "face_", [], [{ what: "horse", label: "Фото лошади" }]);
    expect(s.map((x) => [x.key, x.providerInput, x.kind ?? "person"])).toEqual([["face_1", "img_1", "person"], ["obj_1", "img_2", "object"]]);
  });
});

describe("prompt for one shot of a cut template", () => {
  it("leaves out the whole-video scene note and keeps a shot without the person as it is", () => {
    const p = buildKlingDirectPrompt("edit", "photo", "Keep the video 1:1: two people kiss at the end.", "", 1, ["on the left"], [], [], true);
    expect(p).not.toContain("kiss");
    expect(p).toContain("one shot of a longer video");
    expect(p).toContain("If that person is not in this shot at all, add no one");
    expect(p).not.toContain("Do not return @video_1 unchanged");
  });
  it("the whole video still gets the scene note", () => {
    const p = buildKlingDirectPrompt("edit", "photo", "Keep the video 1:1: two people kiss at the end.", "", 1, ["on the left"]);
    expect(p).toContain("kiss");
    expect(p).toContain("Do not return @video_1 unchanged");
  });
});

import { findBy } from "@/lib/generation/kling";
describe("findBy: where and what they wear, not the original person's looks", () => {
  it.each([
    ["on the left, woman in black top and shorts with long dark hair", "on the left, woman in black top and shorts"],
    ["on the right, man with beard and short hair wearing white shirt", "on the right, man wearing white shirt"],
    ["on the right, bald, bearded man in black suit crying while driving", "on the right, man in black suit crying while driving"],
    ["in the center, young woman with long blonde hair wearing a bright red outfit", "in the center, woman wearing a bright red outfit"],
    ["in the center, woman in white tank top in bathroom doing hair and makeup", "in the center, woman in white tank top in bathroom doing"],
    ["on the left", "on the left"],
    ["", ""],
  ])("%s", (inp, out) => expect(findBy(inp)).toBe(out));
});

describe("hands and skin (TM-100047)", () => {
  it("hands and arms get the customer's skin and size, also in close-ups", () => {
    const p = buildKlingDirectPrompt("edit", "photo", "", "", 1, []);
    expect(p).toContain("Hands and arms count as the person too");
    expect(p).toContain("skin color and tone of @image_1 (from the face and neck when only the face is shown)");
  });
});

describe("things only (0 people)", () => {
  it("replaces the car, says nothing about faces, keeps the people", () => {
    const p = buildKlingDirectPrompt("edit", "photo", "", "", 0, [], [{ what: "car", look: "the white sedan on the right" }]);
    expect(p).toContain("@image_1 is a photo of a car. Replace the car (the white sedan on the right) in @video_1 with the car from @image_1");
    expect(p).toContain("every person with their own face and body");
    expect(p).not.toContain("100% identical");
    expect(p).not.toContain("Hands and arms");
  });
});

describe("a day photo of a car in a night video", () => {
  it("the car takes the video's light, not the photo's daylight", () => {
    const p = buildKlingDirectPrompt("edit", "photo", "", "", 0, [], [{ what: "car", n: 2 }]);
    expect(p).toContain("in daylight while the video is at night");
    expect(p).toContain("Never bring the photos' daylight, sky or background into the video.");
  });
});

describe("number plates", () => {
  it("a car's plate is copied from the photos, with its flag", () => {
    const p = buildKlingDirectPrompt("edit", "photo", "", "", 0, [], [{ what: "car", n: 3 }]);
    expect(p).toContain("Number plates: copy them exactly as on @image_1, @image_2 and @image_3");
    expect(p).toContain("the Kazakhstan flag with \"KZ\"");
  });
  it("nothing about plates for a horse", () => {
    expect(buildKlingDirectPrompt("edit", "photo", "", "", 0, [], [{ what: "horse" }])).not.toContain("Number plates");
  });
});
