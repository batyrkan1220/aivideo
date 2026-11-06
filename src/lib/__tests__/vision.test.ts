import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: () => ({ GEMINI_API_KEY: "k".repeat(20), GEMINI_MODEL: "gemini-test" }) }));

import { describeTemplateFrames } from "@/lib/templates/vision";
import { buildKlingDirectPrompt } from "@/lib/generation/kling";

describe("Gemini template vision", () => {
  it("sends the frames and keeps only clean, allowed results", async () => {
    let sent: { url: string; body: { contents: { parts: unknown[] }[] }; key?: string } | null = null;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      sent = { url, body: JSON.parse(String(init.body)), key: (init.headers as Record<string, string>)["x-goog-api-key"] };
      const json = { people: [{ where: "on the left", look: "woman in a red dress @image_9", ru: "слева — женщина в красном", frame: 9, box: [100, 50, 900, 1200] }, { where: "on the right", look: "man in a black suit", ru: "справа — мужчина" }], objects: [{ what: "car", look: "the white sedan behind them", ru: "белая машина", frame: 1, box: [5, 5, 10, 10] }, { what: "boat", look: "x", ru: "лодка" }], scene: "Evening street, slow camera push-in; she turns @video_2 at 3 s." };
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] } }] }), { status: 200 });
    }));
    const r = await describeTemplateFrames(["AAAA", "BBBB"]);
    expect(sent!.url).toContain("/models/gemini-test:generateContent");
    expect(sent!.key).toBe("k".repeat(20));
    expect(sent!.body.contents[0].parts).toHaveLength(3);
    expect(r.people.map((p) => p.look)).toEqual(["woman in a red dress image_9", "man in a black suit"]);
    expect(r.objects).toEqual([{ what: "car", look: "the white sedan behind them", ru: "белая машина", frame: 1, box: null }]);
    expect(r.people[0]).toMatchObject({ frame: 1, box: [100, 50, 900, 1000] });
    expect(r.scene).toBe("Evening street, slow camera push-in; she turns video_2 at 3 s.");
    vi.unstubAllGlobals();
  });
});

describe("prompt uses the descriptions", () => {
  it("one person and an object with a description", () => {
    const p = buildKlingDirectPrompt("edit", "template", "", "", 1, ["woman in a red dress"], [{ what: "car", look: "the white sedan" }]);
    expect(p).toContain("Replace the person woman in a red dress in @video_1 with the person from @image_1.");
    expect(p).toContain("Replace the car (the white sedan) in @video_1 with the car from @image_2");
  });
});

describe("cut-outs in the prompt", () => {
  it("points at the template cut-out and warns not to copy it", () => {
    const p = buildKlingDirectPrompt("edit", "template", "", "", 2, ["on the left", "on the right"], [{ what: "car" }], ["@image_4", "", "@image_5"]);
    expect(p).toContain("- The person on the left shown in @image_4 becomes the person from @image_1.");
    expect(p).toContain("- The person on the right becomes the person from @image_2.");
    expect(p).toContain("Replace the car shown in @image_5 in @video_1 with the car from @image_3");
    expect(p).toContain("@image_4, @image_5 are cut-outs from @video_1 that only show which one to replace");
  });
});

describe("Gemini busy", () => {
  it("retries a 503 and then moves to the next model", async () => {
    const urls: string[] = [];
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 500 });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(url);
      if (urls.length <= 2) return new Response(JSON.stringify({ error: { status: "UNAVAILABLE" } }), { status: 503 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ people: [], objects: [], scene: "" }) }] } }] }), { status: 200 });
    }));
    const r = await describeTemplateFrames(["AAAA"]);
    expect(r.people).toEqual([]);
    expect(urls[0]).toContain("gemini-test");
    expect(urls[1]).toContain("gemini-test");
    expect(urls[2]).toContain("gemini-3.8-flash");
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
});

describe("no doubles", () => {
  it("drops a worn outfit listed as a thing and a person listed twice", async () => {
    let prompt = "";
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      prompt = JSON.parse(String(init.body)).contents[0].parts.at(-1).text;
      const json = {
        people: [
          { where: "in the center", look: "man", ru: "мужчина", frame: 0, box: [100, 100, 900, 450] },
          { where: "in the center", look: "woman in red", ru: "женщина", frame: 1, box: [100, 500, 950, 900] },
          { where: "in the center", look: "woman in red again", ru: "женщина", frame: 1, box: [110, 510, 940, 890] },
        ],
        objects: [
          { what: "outfit", look: "red outfit", ru: "наряд", frame: 1, box: [300, 520, 900, 880] },
          { what: "car", look: "car behind her", ru: "машина", frame: 1, box: [400, 520, 800, 880] },
          { what: "car", look: "white car", ru: "машина", frame: 2, box: [500, 0, 900, 400] },
        ],
        scene: "",
      };
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] } }] }), { status: 200 });
    }));
    const r = await describeTemplateFrames(["A", "B", "C"]);
    expect(r.people.map((p) => p.look)).toEqual(["man", "woman in red"]);
    expect(r.objects.map((o) => o.look)).toEqual(["white car"]);
    expect(prompt).not.toContain("outfit");
    vi.unstubAllGlobals();
  });
});
