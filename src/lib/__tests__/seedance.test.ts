import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: () => ({ KLING_API_KEY: "g".repeat(20) }) }));
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
    expect(p).toContain("Reference only the camera, movement, timing");
    expect(p).toContain("the person the biggest one in the frame with the person from @element_1");
    expect(p).toContain("@element_2");
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

  it("locks the face as an element, then generates the video", async () => {
    const calls: { url: string; init?: RequestInit; body?: unknown }[] = [];
    const replies = [
      { code: 0, data: { task_id: "el-1", task_status: "submitted" } },
      { code: 0, data: { task_status: "processing" } },
      { code: 0, data: { task_status: "succeed", task_result: { elements: [{ element_id: 308 }] } } },
      { code: 0, data: { id: "kt-1", status: "submitted" } },
      { code: 0, data: [{ id: "kt-1", status: "succeeded", outputs: [{ type: "video", url: "https://kling.cdn/out.mp4" }], billing: [{ charge_type: "unit", amount: "9.6" }] }] },
      { code: 0, data: [{ id: "kt-1", status: "failed", message: "risk control" }] },
    ];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(replies.shift()), { status: 200 });
    }));
    const r = await seedanceProvider.submit({ jobId: "j", ...base, faces, config: { durationSec: 8.1, wish: "night city", allowWish: true } });
    expect(calls[0].url).toBe("https://api-singapore.klingai.com/v1/general/advanced-custom-elements");
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${"g".repeat(20)}`);
    expect(r.providerJobId).toBe("el-1");
    expect(r.cost).toBeCloseTo(klingUnits(8.1, S) * 0.14, 4);
    expect(await seedanceProvider.getStatus("el-1", { startedAt: null, state: r.state ?? null })).toEqual({ state: "processing" });
    const advanced = await seedanceProvider.getStatus("el-1", { startedAt: null, state: r.state ?? null });
    expect(advanced).toMatchObject({ state: "processing", next: { providerJobId: "kt-1", state: { stage: "klingd" } } });
    const video = calls.find((c) => c.url.endsWith("/omni-video/kling-4.0"));
    const body = video?.body as { contents: { type: string; url?: string; id?: string; text?: string; element_id?: string }[]; settings: Record<string, unknown> };
    expect(body.contents.map((c) => c.type)).toEqual(["prompt", "feature_video", "element"]);
    expect(body.contents[2]).toMatchObject({ type: "element", element_id: "308", id: "element_1" });
    expect(body.contents.some((c) => c.type === "refer_image")).toBe(false);
    expect(body.contents[0].text).toContain("night city");
    expect(body.contents[0].text).toContain("@element_1");
    expect(body.settings).toMatchObject({ resolution: "720p", duration: 8, aspect_ratio: "9:16", audio: "original" });
    const videoState = advanced.state === "processing" ? advanced.next?.state ?? null : null;
    expect(await seedanceProvider.getStatus("kt-1", { startedAt: null, state: videoState })).toEqual({ state: "succeeded", outputUrl: "https://kling.cdn/out.mp4" });
    expect(await seedanceProvider.getStatus("kt-1", { startedAt: null, state: videoState })).toMatchObject({ state: "failed", errorCode: "provider_content_rejected" });
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

  it("locks two people and the car as elements, with clothing from their photos", async () => {
    const group = [
      { slotKey: "face_1", providerInput: "img_1", imageUrl: "https://s/1.jpg" },
      { slotKey: "face_2", providerInput: "img_2", imageUrl: "https://s/2.jpg" },
      { slotKey: "obj_1", providerInput: "img_3", imageUrl: "https://s/car.jpg" },
    ];
    const calls: { url: string; body?: { tag_list?: { tag_id?: string }[] } }[] = [];
    const replies = [
      { code: 0, data: { task_id: "el-1", task_status: "submitted" } },
      { code: 0, data: { task_status: "succeed", task_result: { elements: [{ element_id: 11 }] } } },
      { code: 0, data: { task_id: "el-2", task_status: "submitted" } },
      { code: 0, data: { task_status: "succeed", task_result: { elements: [{ element_id: 22 }] } } },
      { code: 0, data: { task_id: "el-3", task_status: "submitted" } },
      { code: 0, data: { task_status: "succeed", task_result: { elements: [{ element_id: 33 }] } } },
      { code: 0, data: { id: "kt-2", status: "submitted" } },
    ];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(replies.shift()), { status: 200 });
    }));
    const r = await seedanceProvider.submit({
      jobId: "j", ...base, faces: group,
      config: { durationSec: 10, people: 2, outfit: "photo", objects: [{ what: "car", label: "Фото машины" }] },
    });
    const second = await seedanceProvider.getStatus(r.providerJobId, { startedAt: null, state: r.state ?? null });
    expect(second).toMatchObject({ state: "processing", next: { providerJobId: "el-2" } });
    const secondState = second.state === "processing" ? second.next?.state ?? null : null;
    const third = await seedanceProvider.getStatus("el-2", { startedAt: null, state: secondState });
    expect(third).toMatchObject({ state: "processing", next: { providerJobId: "el-3" } });
    const thirdState = third.state === "processing" ? third.next?.state ?? null : null;
    const video = await seedanceProvider.getStatus("el-3", { startedAt: null, state: thirdState });
    expect(video).toMatchObject({ state: "processing", next: { providerJobId: "kt-2" } });
    const created = calls.filter((c) => c.url.endsWith("/advanced-custom-elements"));
    expect(created.map((c) => c.body?.tag_list?.[0]?.tag_id)).toEqual(["o_102", "o_102", "o_104"]);
    expect(created.map((c) => (c.body as { element_description?: string } | undefined)?.element_description)).toEqual([
      expect.stringContaining("Person 1 of 2."),
      expect.stringContaining("Person 2 of 2."),
      expect.not.stringContaining("Person"),
    ]);
    const body = calls.find((c) => c.url.endsWith("/omni-video/kling-4.0"))?.body as {
      contents: { type: string; id?: string; url?: string; element_id?: string; text?: string }[];
    };
    const elements = body.contents.filter((c) => c.type === "element");
    expect(elements).toEqual([
      expect.objectContaining({ element_id: "11", id: "element_1" }),
      expect.objectContaining({ element_id: "22", id: "element_2" }),
      expect.objectContaining({ element_id: "33", id: "element_3" }),
    ]);
    expect(body.contents.some((c) => c.type === "refer_image")).toBe(false);
    expect(body.contents.find((c) => c.type === "base_video" || c.type === "feature_video")?.type).toBe("feature_video");
    expect(body.contents.some((c) => c.type === "base_video")).toBe(false);
    expect(body.contents[0].text).toContain("Do not use the clothing from @video_1");
    expect(body.contents[0].text).toContain("@element_3 is the car, not a person");
    expect(body.contents[0].text).toContain("@element_1 is one separate person");
    expect(body.contents[0].text).toContain("Do not swap their faces");
    expect(body.contents[0].text).not.toContain("Clothing follows @video_1");
    vi.unstubAllGlobals();
  });
});
