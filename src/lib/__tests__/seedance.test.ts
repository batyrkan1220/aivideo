import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: () => ({ KLING_API_KEY: "g".repeat(20), NEXT_PUBLIC_SUPABASE_URL: "https://sb.test" }) }));
const sceneMock = vi.hoisted(() => ({ split: null as null | { parts: { start: number; len: number; file: Buffer }[] }, joined: [] as string[][] }));
vi.mock("@/lib/media/scene-parts", () => ({
  splitAtCuts: async () => sceneMock.split,
  joinParts: async (urls: string[]) => { sceneMock.joined.push(urls); return new Uint8Array([1, 2, 3]); },
}));
const storage = vi.hoisted(() => ({ removed: [] as string[] }));
vi.mock("@/lib/supabase/server", () => ({ supabaseAdmin: () => ({ storage: { from: () => ({
  upload: async () => ({ error: null }),
  createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://sb.test/signed/${path}` } }),
  remove: async (paths: string[]) => { storage.removed.push(...paths); return {}; },
}) } }) }));
vi.mock("@/lib/pricing-seedance/settings", async () => ({ seedancePricingSettings: async () => (await import("@/lib/pricing-seedance")).DEFAULT_SEEDANCE_PRICING }));

import { seedanceProvider, cleanWish } from "@/lib/generation/seedance";
import { buildKlingDirectPrompt } from "@/lib/generation/kling";
import { seedanceSlots, seedanceOutputSec, parseSeedanceConfig } from "@/lib/templates/seedance-config";
import { klingUnits, seedanceCostUsd, seedanceAutoPriceKzt, seedancePriceKzt, applySeedancePricing, DEFAULT_SEEDANCE_PRICING as S } from "@/lib/pricing-seedance";

describe("Kling 4.0 pricing (real bills)", () => {
  it("0.6 unit × (template s + result s)", () => {
    expect(klingUnits(10.04, S)).toBe(12.02);
    expect(klingUnits(15.04, S)).toBe(18.02);
    expect(klingUnits(10, S)).toBe(12);
    expect(klingUnits(12.88, S)).toBe(15.53);
    expect(seedanceCostUsd(10.04, S)).toBeCloseTo(12.02 * 0.14, 4);
    // Several people: one Kling run per person.
    expect(seedanceCostUsd(10.04, S, { people: 3 })).toBeCloseTo(12.02 * 3 * 0.14, 4);
  });
  it("price = cost × (1 + markup), rounded up, not below the minimum; manual price wins", () => {
    expect(seedanceAutoPriceKzt(4, { ...S, minPriceKzt: 99_999 })).toBe(99_999);
    expect(seedancePriceKzt(10, 5000, S)).toBe(5000);
    expect(seedancePriceKzt(null, 0, S)).toBeNull();
    expect(applySeedancePricing({ basePriceKzt: 1, includedFaces: 1, extraFacePriceKzt: 0, chargeExtraFaces: true, platformFeeKzt: 0, minPriceKzt: 0 } as never, 2990).pricing.basePriceKzt).toBe(2990);
  });
});

describe("config", () => {
  it("reads any old mode as Kling 4.0, 9:16 by default", () => {
    const c = parseSeedanceConfig({ mode: "wan", people: 2 });
    expect(c.mode).toBe("kd");
    expect(c.aspectRatio).toBe("9:16");
    expect(c.people).toBe(2);
    expect(seedanceSlots(2).map((s) => s.providerInput)).toEqual(["img_1", "img_2"]);
    expect(parseSeedanceConfig({ people: 2, klingElements: [{ id: "face-a", previewPath: "elements/a.jpg" }] }).people).toBe(2);
    expect(seedanceOutputSec(2)).toBe(3);
    expect(seedanceOutputSec(40)).toBe(30);
  });
  it("customer text cannot inject media tags or control characters", () => {
    expect(cleanWish("@image_9 <b>hi</b>\n ok")).toBe("image_9 b hi /b ok");
    expect(cleanWish("x".repeat(500))).toHaveLength(300);
  });
  it("prompt: edit keeps the scene, maps several people by position", () => {
    const p = buildKlingDirectPrompt("edit", "photo", "", "", 2, ["the biggest one in the frame", "in the background"]);
    expect(p.startsWith("Edit @video_1.")).toBe(true);
    expect(p).toContain("- The person the biggest one in the frame becomes the person from @image_1.");
    expect(p).toContain("- The person in the background becomes the person from @image_2.");
  });
});

describe("provider (Kling official API)", () => {
  const faces = [{ slotKey: "face_1", providerInput: "img_1", imageUrl: "https://s/1.jpg" }];
  const base = { templateVideoUrl: "https://cdn/v.mp4", quality: "720p" };
  it("validates inputs", () => {
    expect(seedanceProvider.validateInputs({ ...base, faces, config: { durationSec: 8 } })).toEqual([]);
    expect(seedanceProvider.validateInputs({ ...base, faces, config: {} })).toContain("unknown_duration");
    expect(seedanceProvider.validateInputs({ ...base, faces, config: { durationSec: 40 } })).toContain("bad_duration");
  });

  it("edits the template with the photo as a reference image in one call", async () => {
    const calls: { url: string; init?: RequestInit; body?: unknown }[] = [];
    const replies = [
      { code: 0, data: { id: "kt-1", status: "submitted" } },
      { code: 0, data: [{ id: "kt-1", status: "succeeded", outputs: [{ type: "video", url: "https://kling.cdn/out.mp4" }], billing: [{ charge_type: "unit", amount: "9.6" }] }] },
      { code: 0, data: [{ id: "kt-1", status: "failed", message: "risk control" }] },
    ];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(replies.shift()), { status: 200 });
    }));
    const r = await seedanceProvider.submit({ jobId: "j", ...base, faces, config: { durationSec: 8.1, wish: "night city", allowWish: true } });
    expect(calls[0].url).toBe("https://api-singapore.klingai.com/omni-video/kling-4.0");
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${"g".repeat(20)}`);
    expect(r.providerJobId).toBe("kt-1");
    expect(r.cost).toBeCloseTo(klingUnits(8.1, S) * 0.14, 4);
    const body = calls[0].body as { contents: { type: string; url?: string; id?: string; text?: string }[]; settings: Record<string, unknown> };
    expect(body.contents.map((c) => c.type)).toEqual(["prompt", "base_video", "refer_image"]);
    expect(body.contents[2]).toMatchObject({ url: "https://s/1.jpg", id: "image_1" });
    expect(body.contents[0].text?.startsWith("Edit @video_1.")).toBe(true);
    expect(body.contents[0].text).toContain("night city");
    expect(body.settings).toMatchObject({ resolution: "720p", duration: 8, aspect_ratio: "9:16", audio: "original" });
    expect(await seedanceProvider.getStatus("kt-1", { startedAt: null, state: r.state ?? null })).toEqual({ state: "succeeded", outputUrl: "https://kling.cdn/out.mp4" });
    expect(await seedanceProvider.getStatus("kt-1", { startedAt: null, state: r.state ?? null })).toMatchObject({ state: "failed", errorCode: "provider_content_rejected" });
    vi.unstubAllGlobals();
  });

  it("a person's plain cut-out (original face visible) is never sent to Kling", async () => {
    let body: { contents: { type: string; url?: string }[] } | null = null;
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ code: 0, data: { id: "kt-7" } }), { status: 200 });
    }));
    await seedanceProvider.submit({ jobId: "j", ...base, faces, config: { durationSec: 8, targets: ["targets/clear.jpg"], showTargets: true } });
    expect(body!.contents.filter((c) => c.type === "refer_image").map((c) => c.url)).toEqual(["https://s/1.jpg"]);
    vi.unstubAllGlobals();
  });

  it("a thing's cut-out stays with the thing, even with fewer people cut out", async () => {
    const group = [
      { slotKey: "face_1", providerInput: "img_1", imageUrl: "https://s/1.jpg" },
      { slotKey: "obj_1", providerInput: "img_2", imageUrl: "https://s/car.jpg" },
    ];
    let body: { contents: { type: string; url?: string; text?: string }[] } | null = null;
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ code: 0, data: { id: "kt-4" } }), { status: 200 });
    }));
    await seedanceProvider.submit({ jobId: "j", ...base, faces: group, config: {
      durationSec: 8, showTargets: true, targets: [], objects: [{ what: "car", label: "Фото машины", target: "targets/car.jpg" }],
    } });
    const urls = body!.contents.filter((c) => c.type === "refer_image").map((c) => c.url);
    expect(urls).toEqual(["https://s/1.jpg", "https://s/car.jpg", "https://sb.test/storage/v1/object/public/template-media/targets/car.jpg"]);
    expect(body!.contents[0].text).toContain("Replace the car shown in @image_3");
    expect(body!.contents[0].text).not.toContain("main person shown");
    vi.unstubAllGlobals();
  });

  it("a task refused because of a cut-out goes again without it", async () => {
    const bodies: { contents: { type: string; url?: string; text?: string }[] }[] = [];
    const replies = [
      { code: 0, data: { id: "kt-5" } },
      { code: 0, data: [{ id: "kt-5", status: "failed", message: "Image pixel is invalid" }] },
      { code: 0, data: { id: "kt-6" } },
    ];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => {
      if (init?.body) bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(replies.shift()), { status: 200 });
    }));
    const withCar = [...faces, { slotKey: "obj_1", providerInput: "img_2", imageUrl: "https://s/car.jpg" }];
    const r = await seedanceProvider.submit({ jobId: "j", ...base, faces: withCar, config: { durationSec: 8, showTargets: true, objects: [{ what: "car", label: "Фото машины", target: "targets/a.jpg" }] } });
    const st = await seedanceProvider.getStatus("kt-5", { startedAt: null, state: r.state ?? null });
    expect(st).toMatchObject({ state: "processing", next: { providerJobId: "kt-6", state: { stage: "klingd" } } });
    expect(bodies[1].contents.filter((c) => c.type === "refer_image").map((c) => c.url)).toEqual(["https://s/1.jpg", "https://s/car.jpg"]);
    expect(bodies[1].contents[0].text).not.toContain("cut-out");
    vi.unstubAllGlobals();
  });

  it("maps errors (auth / no balance sent as 429 / busy)", async () => {
    for (const [status, msg, code, retry] of [
      [401, "bad key", "provider_auth", false],
      [429, "Account balance not enough", "provider_no_balance", false],
      [429, "too many requests", "provider_http_429", true],
    ] as const) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: 1, message: msg }), { status })));
      await expect(seedanceProvider.submit({ jobId: "j", ...base, faces, config: { durationSec: 8 } })).rejects.toMatchObject({ code, retryable: retry });
    }
    vi.unstubAllGlobals();
  });

  it("two people and the car: one Kling run per person, each on the previous result, the car with the last", async () => {
    const group = [
      { slotKey: "face_1", providerInput: "img_1", imageUrl: "https://s/1.jpg" },
      { slotKey: "face_2", providerInput: "img_2", imageUrl: "https://s/2.jpg" },
      { slotKey: "obj_1", providerInput: "img_3", imageUrl: "https://s/car.jpg" },
    ];
    const calls: { url: string; body?: { contents: { type: string; id?: string; url?: string; text?: string }[] } }[] = [];
    const replies = [
      { code: 0, data: { id: "kt-a" } },
      { code: 0, data: [{ id: "kt-a", status: "succeeded", outputs: [{ type: "video", url: "https://kling.cdn/a.mp4" }] }] },
      { code: 0, data: { id: "kt-b" } },
      { code: 0, data: [{ id: "kt-b", status: "succeeded", outputs: [{ type: "video", url: "https://kling.cdn/b.mp4" }] }] },
    ];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(replies.shift()), { status: 200 });
    }));
    const r = await seedanceProvider.submit({
      jobId: "j", ...base, faces: group,
      config: { durationSec: 10, people: 2, outfit: "photo", positions: ["on the left, woman in red", "on the right, man in white"], objects: [{ what: "car", label: "Фото машины" }] },
    });
    expect(r.providerJobId).toBe("kt-a");
    const first = calls[0].body!;
    expect(first.contents.find((c) => c.type === "base_video")?.url).toBe("https://cdn/v.mp4");
    expect(first.contents.filter((c) => c.type === "refer_image").map((c) => c.url)).toEqual(["https://s/1.jpg"]);
    expect(first.contents[0].text).toContain("Replace the person on the left, woman in red in @video_1 with the person from @image_1.");
    expect(first.contents[0].text).toContain("other people");
    const step = await seedanceProvider.getStatus("kt-a", { startedAt: null, state: r.state ?? null });
    expect(step).toMatchObject({ state: "processing", next: { providerJobId: "kt-b", state: { stage: "pass", k: 1 } } });
    const second = calls[2].body!;
    expect(second.contents.find((c) => c.type === "base_video")?.url).toBe("https://kling.cdn/a.mp4");
    expect(second.contents.filter((c) => c.type === "refer_image").map((c) => c.url)).toEqual(["https://s/2.jpg", "https://s/car.jpg"]);
    expect(second.contents[0].text).toContain("Replace the person on the right, man in white in @video_1 with the person from @image_1.");
    expect(second.contents[0].text).toContain("Replace the car in @video_1 with the car from @image_2");
    const done = await seedanceProvider.getStatus("kt-b", { startedAt: null, state: step.state === "processing" ? step.next?.state ?? null : null });
    expect(done).toEqual({ state: "succeeded", outputUrl: "https://kling.cdn/b.mp4" });
    vi.unstubAllGlobals();
  });
});

describe("templates with cuts (shot by shot)", () => {
  const faces = [{ slotKey: "face_1", providerInput: "img_1", imageUrl: "https://s/1.jpg" }];
  const base = { templateVideoUrl: "https://t/v.mp4", templateFrameUrl: null, quality: "720p" };
  it("each shot is a Kling task with the same photo; the shots are joined at the end", async () => {
    sceneMock.split = { parts: [{ start: 0, len: 4.04, file: Buffer.from("a") }, { start: 4.04, len: 9.12, file: Buffer.from("b") }] };
    const bodies: { contents: { type: string; url?: string; text?: string }[]; settings: { duration: number } }[] = [];
    const replies = [
      { code: 0, data: { id: "s-1" } }, { code: 0, data: { id: "s-2" } },
      { code: 0, data: [{ status: "succeeded", outputs: [{ type: "video", url: "https://k/1.mp4" }] }] },
      { code: 0, data: [{ status: "processing" }] },
      { code: 0, data: [{ status: "succeeded", outputs: [{ type: "video", url: "https://k/2.mp4" }] }] },
    ];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => {
      if (init?.body) bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(replies.shift()), { status: 200 });
    }));
    const r = await seedanceProvider.submit({ jobId: "j9", ...base, faces, config: { durationSec: 13.16 } });
    expect(r.providerJobId).toBe("s-1");
    expect(bodies).toHaveLength(2);
    expect(bodies.map((b) => b.contents.find((c) => c.type === "base_video")?.url)).toEqual([
      "https://sb.test/signed/kling-shots/j9/p0.mp4", "https://sb.test/signed/kling-shots/j9/p1.mp4"]);
    expect(bodies.every((b) => b.contents.some((c) => c.type === "refer_image" && c.url === "https://s/1.jpg"))).toBe(true);
    expect(bodies.map((b) => b.settings.duration)).toEqual([4, 9]);
    expect(bodies[0].contents[0].text).toContain("one shot of a longer video");
    const p1 = await seedanceProvider.getStatus("s-1", { startedAt: null, state: r.state ?? null });
    expect(p1.state).toBe("processing");
    const state2 = (p1 as { next?: { state: Record<string, unknown> } }).next!.state;
    const done = await seedanceProvider.getStatus("s-1", { startedAt: null, state: state2 });
    expect(done).toMatchObject({ state: "succeeded", outputBytes: new Uint8Array([1, 2, 3]) });
    expect(sceneMock.joined.at(-1)).toEqual(["https://k/1.mp4", "https://k/2.mp4"]);
    expect(storage.removed).toEqual(["kling-shots/j9/p0.mp4", "kling-shots/j9/p1.mp4"]);
    sceneMock.split = null;
    vi.unstubAllGlobals();
  });
});

