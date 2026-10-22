import { describe, it, expect } from "vitest";
import { emptyTemplate } from "../templates/admin-schema";
import { autoFaceSlots } from "../templates/schema";
import { validateTemplateForm, firstErrorKey, M } from "../templates/editor-validation";

const ok = () => ({ ...emptyTemplate(), providerKey: "dev", titleKk: "Той биі", previewVideoPath: "p.mp4" });

describe("template editor validation", () => {
  it("a complete template has no errors, even for publish", () => {
    expect(validateTemplateForm(ok(), "{}", true)).toEqual({});
  });

  it("title is required; video only required to publish; no cover needed", () => {
    const t = { ...emptyTemplate(), providerKey: "dev" };
    const draft = validateTemplateForm(t, "{}", false);
    expect(draft.titleKk).toBe(M.required);
    expect(draft.preview).toBeUndefined();
    const pub = validateTemplateForm(t, "{}", true);
    expect(pub.cover).toBeUndefined();
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

  it("Akool: analysis of the current video and at least one person to publish", () => {
    const t = { ...ok(), providerKey: "akool" };
    expect(validateTemplateForm(t, "{}", false)).toEqual({});           // draft: fine
    expect(validateTemplateForm(t, "{}", true)).toEqual({});             // publish without analysis: auto, 1 person
    const analysis = { id: "6700000000000000000000a1", videoPath: "p.mp4", videoUrl: "https://x/p.mp4", people: [{ objId: 0, previewPath: "people/a1/0.jpg" }, { objId: 1, previewPath: "people/a1/1.jpg" }] };
    expect(validateTemplateForm(t, JSON.stringify({ analysis, selected: [] }), true)["akool.people"]).toBe(M.akoolNoPeople);
    expect(validateTemplateForm(t, JSON.stringify({ analysis, selected: [1, 0] }), true)).toEqual({});
    const changed = { ...t, previewVideoPath: "other.mp4" };
    expect(validateTemplateForm(changed, JSON.stringify({ analysis, selected: [0] }), false)["akool.analysis"]).toBe(M.akoolVideoChanged);
  });
});
