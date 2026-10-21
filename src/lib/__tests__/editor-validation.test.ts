import { describe, it, expect } from "vitest";
import { emptyTemplate } from "../templates/admin-schema";
import { autoFaceSlots } from "../templates/schema";
import { validateTemplateForm, firstErrorKey, M } from "../templates/editor-validation";

const ok = () => ({ ...emptyTemplate(), titleKk: "Той биі", coverAssetPath: "c.jpg", previewVideoPath: "p.mp4" });

describe("template editor validation", () => {
  it("a complete template has no errors, even for publish", () => {
    expect(validateTemplateForm(ok(), "{}", true)).toEqual({});
  });

  it("title is required; media only required to publish", () => {
    const t = { ...emptyTemplate() };
    const draft = validateTemplateForm(t, "{}", false);
    expect(draft.titleKk).toBe(M.required);
    expect(draft.cover).toBeUndefined();
    const pub = validateTemplateForm(t, "{}", true);
    expect(pub.cover).toBe(M.coverMissing);
    expect(pub.preview).toBe(M.previewMissing);
    expect(firstErrorKey(pub)).toBe("titleKk");
  });

  it("flags quality fields, duplicate keys and no available quality", () => {
    const t = ok();
    t.qualities = [
      { key: "std", labelKk: "", providerQuality: "", surchargeKzt: 0, available: false },
      { key: "std", labelKk: "HD", providerQuality: "hd", surchargeKzt: -5, available: false },
    ];
    const e = validateTemplateForm(t, "{}", false);
    expect(e["quality.0.labelKk"]).toBe(M.required);
    expect(e["quality.0.providerQuality"]).toBe(M.required);
    expect(e["quality.1.key"]).toBe(M.keyDuplicate);
    expect(e["quality.1.surchargeKzt"]).toBe(M.nonNegative);
    expect(e.qualities).toBe(M.noAvailableQuality);
  });

  it("pricing rules", () => {
    const t = ok();
    t.pricing = { ...t.pricing, maxPriceKzt: 100, minPriceKzt: 500, discount: { type: "percent", value: 150, startsAt: "2026-10-10T00:00:00Z", endsAt: "2026-10-01T00:00:00Z" } };
    const e = validateTemplateForm(t, "{}", false);
    expect(e["pricing.maxPriceKzt"]).toBe(M.maxBelowMin);
    expect(e["pricing.discount.value"]).toBe(M.percentMax);
    expect(e["pricing.discount.endsAt"]).toBe(M.discountEnds);
  });

  it("invalid JSON is reported", () => {
    expect(validateTemplateForm(ok(), "{oops", false).providerConfig).toBe(M.jsonInvalid);
  });

  it("WaveSpeed: unique per-person index and video length to publish", () => {
    const t = { ...ok(), providerKey: "wavespeed", faceSlots: autoFaceSlots(3) };
    const bad = validateTemplateForm(t, JSON.stringify({ targetIndexBySlot: [0, 0, 1] }), true);
    expect(bad["ws.index"]).toBe(M.wsIndexDuplicate);
    expect(bad["ws.videoSeconds"]).toBe(M.wsSeconds);
    expect(validateTemplateForm(t, JSON.stringify({ targetIndexBySlot: [1, 0, 2], videoSeconds: 12 }), true)).toEqual({});
  });
});
