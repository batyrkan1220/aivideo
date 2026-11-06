import { describe, expect, it } from "vitest";
import { analysisHint, applyAnalysis, cutoutRect, unclearPeople } from "@/lib/templates/analysis";
import { parseSeedanceConfig } from "@/lib/templates/seedance-config";

const a = {
  people: [
    { where: "on the left", look: "woman in red", ru: "слева — женщина", frame: 0, box: [100, 100, 900, 400] as [number, number, number, number] },
    { where: "on the right", look: "man in black", ru: "справа — мужчина", frame: 1, box: null },
  ],
  objects: [{ what: "car", look: "white sedan", ru: "белая машина", frame: 2, box: null }],
  scene: "Evening street, slow push-in.",
};

describe("AI analysis", () => {
  it("a fresh analysis takes the people, things, cut-outs and scene", () => {
    const next = applyAnalysis(parseSeedanceConfig({}), a, { people: ["targets/p1.jpg", ""], objects: ["targets/c.jpg"] }, false, new Date("2026-11-06T13:00:00Z"));
    expect(next.people).toBe(2);
    expect(next.positions).toEqual(["on the left, woman in red", "on the right, man in black"]);
    expect(next.targets).toEqual(["targets/p1.jpg", ""]);
    expect(next.objects).toEqual([{ what: "car", label: "Фото машины", look: "white sedan", target: "targets/c.jpg" }]);
    expect(next.prompt).toBe("Keep the video 1:1: Evening street, slow push-in.");
    expect(next.showTargets).toBe(true);
    expect(next.analyzedAt).toBe("2026-11-06T13:00:00.000Z");
  });
  it("keep: the admin's people count, things and prompt stay", () => {
    const cfg = parseSeedanceConfig({ people: 1, prompt: "national costume", objects: [{ what: "horse", label: "Фото лошади" }] });
    const next = applyAnalysis(cfg, a, { people: ["targets/p1.jpg"], objects: [""] }, true);
    expect(next.people).toBe(1);
    expect(next.objects).toEqual([{ what: "horse", label: "Фото лошади" }]);
    expect(next.prompt).toBe("national costume");
    expect(analysisHint(cfg, true)).toEqual({ people: 1, objects: ["horse"] });
  });
  it("cut-outs fit Kling: 1:2–2:1, at least 320 px", () => {
    const r = cutoutRect(360, 640, [100, 450, 900, 520])!; // a thin, tall person
    expect(r.sh / r.sw).toBeLessThanOrEqual(2.001);
    expect(Math.min(r.outW, r.outH)).toBeGreaterThanOrEqual(320);
    expect(r.sx).toBeGreaterThanOrEqual(0);
    expect(r.sy + r.sh).toBeLessThanOrEqual(640);
  });
  it("flags people Kling could mix up", () => {
    expect(unclearPeople({ people: 2, positions: ["on the right, bald man in a black suit", "on the right"] })).toEqual([1]);
    expect(unclearPeople({ people: 2, positions: ["in the center, woman in red", "in the center, woman in red"] })).toEqual([0, 1]);
    expect(unclearPeople({ people: 2, positions: ["on the left, woman in red dress", "on the right, man in a white shirt"] })).toEqual([]);
    expect(unclearPeople({ people: 1, positions: [""] })).toEqual([]);
  });
});
