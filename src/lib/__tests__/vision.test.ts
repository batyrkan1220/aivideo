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
      const json = { people: [{ where: "on the left", look: "woman in a red dress @image_9", ru: "слева — женщина в красном" }, { where: "on the right", look: "man in a black suit", ru: "справа — мужчина" }], objects: [{ what: "car", look: "the white sedan behind them", ru: "белая машина" }, { what: "boat", look: "x", ru: "лодка" }], scene: "Evening street, slow camera push-in; she turns @video_2 at 3 s." };
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] } }] }), { status: 200 });
    }));
    const r = await describeTemplateFrames(["AAAA", "BBBB"]);
    expect(sent!.url).toContain("/models/gemini-test:generateContent");
    expect(sent!.key).toBe("k".repeat(20));
    expect(sent!.body.contents[0].parts).toHaveLength(3);
    expect(r.people.map((p) => p.look)).toEqual(["woman in a red dress image_9", "man in a black suit"]);
    expect(r.objects).toEqual([{ what: "car", look: "the white sedan behind them", ru: "белая машина" }]);
    expect(r.scene).toBe("Evening street, slow camera push-in; she turns video_2 at 3 s.");
    vi.unstubAllGlobals();
  });
});

describe("prompt uses the descriptions", () => {
  it("one person and an object with a description", () => {
    const p = buildKlingDirectPrompt("edit", "template", "", "", 1, ["woman in a red dress"], [{ what: "car", look: "the white sedan" }]);
    expect(p).toContain("Replace the main person (woman in a red dress) in @video_1 with the person from @image_1.");
    expect(p).toContain("Replace the car (the white sedan) in @video_1 with the car from @image_2");
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
