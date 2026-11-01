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
