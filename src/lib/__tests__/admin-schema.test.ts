import { describe, it, expect } from "vitest";
import { emptyTemplate, publishProblems, inputToRow, templateInputSchema } from "../templates/admin-schema";

describe("template publishing rules", () => {
  it("a new template cannot be published without media", () => {
    const p = publishProblems(emptyTemplate());
    expect(p).toContain("missing_cover");
    expect(p).toContain("missing_preview");
  });

  it("a complete template passes", () => {
    const t = { ...emptyTemplate(), titleKk: "Той биі", coverAssetPath: "covers/a.jpg", previewVideoPath: "previews/a.mp4" };
    expect(publishProblems(t)).toEqual([]);
  });

  it("rejects duplicate provider inputs and no available quality", () => {
    const t = {
      ...emptyTemplate(), coverAssetPath: "c", previewVideoPath: "p",
      faceSlots: [
        { key: "a", labelKk: "1", position: { x: 0.2, y: 0.4 }, providerInput: "face", order: 0 },
        { key: "b", labelKk: "2", position: { x: 0.8, y: 0.4 }, providerInput: "face", order: 1 },
      ],
      qualities: [{ ...emptyTemplate().qualities[0], available: false }],
    };
    const p = publishProblems(t);
    expect(p).toContain("invalid_face_slots");
    expect(p).toContain("no_available_quality");
  });

  it("requires a provider", () => {
    expect(publishProblems({ ...emptyTemplate(), coverAssetPath: "c", previewVideoPath: "p", providerKey: null })).toContain("missing_provider");
  });
});

describe("inputToRow", () => {
  it("derives face count from slots and renumbers order", () => {
    const t = emptyTemplate();
    t.faceSlots = [
      { key: "l", labelKk: "1-бет — сол жақ", position: { x: 0.2, y: 0.4 }, providerInput: "f1", order: 5 },
      { key: "c", labelKk: "2-бет — ортада", position: { x: 0.5, y: 0.4 }, providerInput: "f2", order: 9 },
      { key: "r", labelKk: "3-бет — оң жақ", position: { x: 0.8, y: 0.4 }, providerInput: "f3", order: 1 },
    ];
    const row = inputToRow(t);
    expect(row.required_face_count).toBe(3);
    expect(row.face_slots_json.map((s) => [s.key, s.order])).toEqual([["l", 0], ["c", 1], ["r", 2]]);
  });

  it("schema rejects a too-short title and >10 MB user upload limit", () => {
    expect(templateInputSchema.safeParse({ ...emptyTemplate(), titleKk: "a" }).success).toBe(false);
    expect(templateInputSchema.safeParse({ ...emptyTemplate(), titleKk: "Той", maxUploadBytes: 50e6 }).success).toBe(false);
  });
});
