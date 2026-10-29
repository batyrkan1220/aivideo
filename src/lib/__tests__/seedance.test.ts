import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: () => ({ REPLICATE_API_TOKEN: "r".repeat(20), MUAPI_API_KEY: "k".repeat(20), MUAPI_API_BASE_URL: "https://api.muapi.test", MUAPI_MODEL: "seedance-2.5-intl-omni-reference" }) }));
vi.mock("@/lib/pricing-seedance/settings", async () => ({ seedancePricingSettings: async () => (await import("@/lib/pricing-seedance")).DEFAULT_SEEDANCE_PRICING }));

import { seedanceProvider, buildPrompt, cleanWish } from "@/lib/generation/seedance";
import { seedanceSlots, seedanceOutputSec, parseSeedanceConfig } from "@/lib/templates/seedance-config";
import { seedanceBilledSec, seedanceCostUsd, seedanceCostKzt, seedanceAutoPriceKzt, seedancePriceKzt, applySeedancePricing, DEFAULT_SEEDANCE_PRICING as S } from "@/lib/pricing-seedance";

describe("seedance pricing", () => {
  it("bills reference + output seconds at 65 % of the 720p rate", () => {
    expect(seedanceBilledSec(10)).toBe(20);
    expect(seedanceBilledSec(2)).toBe(2 + 4);            // output is at least 4 s
    expect(seedanceBilledSec(8.06)).toBe(9 + 8);         // reference rounded up (real muapi bill $4.133)
    expect(seedanceCostUsd(10, S)).toBeCloseTo(20 * 0.374 * 0.65 + 10 * 0.094, 4); // + one face swap pass (per second)
    expect(seedanceCostKzt(10, S)).toBe(Math.round((20 * 0.374 * 0.65 + 10 * 0.094) * S.tengePerUsd));
  });
  it("price = cost × (1 + markup), rounded up, not below the minimum", () => {
    const raw = seedanceCostKzt(15, S) * (1 + S.markupPercent / 100);
    expect(seedanceAutoPriceKzt(15, S)).toBe(Math.max(S.minPriceKzt, Math.ceil(raw / S.roundToKzt) * S.roundToKzt));
    expect(seedanceAutoPriceKzt(4, { ...S, minPriceKzt: 99_999 })).toBe(99_999);
  });
  it("manual price wins; unknown length → not priced", () => {
    expect(seedancePriceKzt(10, 5000, S)).toBe(5000);
    expect(seedancePriceKzt(null, 0, S)).toBeNull();
    const eff = applySeedancePricing({ basePriceKzt: 0, chargeExtraFaces: true, extraFacePriceKzt: 500, includedFaces: 1, platformFeeKzt: 0, minPriceKzt: 0 }, 7000);
    expect(eff.pricing.basePriceKzt).toBe(7000);
    expect(eff.pricing.chargeExtraFaces).toBe(false);
    expect(eff.qualities.map((q) => q.key)).toEqual(["720p"]);
  });
});

describe("seedance config", () => {
  it("slots left → right, img_<n>", () => {
    expect(seedanceSlots(2).map((s) => [s.key, s.providerInput, s.order])).toEqual([["face_1", "img_1", 0], ["face_2", "img_2", 1]]);
    expect(seedanceSlots(1, "p_")[0].key).toBe("p_1");
  });
  it("output length 4–30 s", () => {
    expect(seedanceOutputSec(2.2)).toBe(4);
    expect(seedanceOutputSec(9.6)).toBe(10);
    expect(seedanceOutputSec(40)).toBe(30);
  });
  it("defaults", () => expect(parseSeedanceConfig({})).toMatchObject({ people: 1, framing: "half", aspectRatio: "adaptive", allowWish: true }));
});

describe("seedance prompt", () => {
  it("one person; admin prompt and wish are added", () => {
    const p = buildPrompt(1, "night city", "white suit");
    expect(p).toContain("Replace the person in @Video1 with the person from @Image1.");
    expect(p).toContain("Scene, outfit and style: night city");
    expect(p).toContain("Customer's wish");
    expect(p).toContain("white suit");
  });
  it("several people are mapped left → right; no admin prompt keeps the background", () => {
    const p = buildPrompt(2, "", "");
    expect(p).toContain("person 1 (counting from the left) with the person from @Image1");
    expect(p).toContain("person 2 (counting from the left) with the person from @Image2");
    expect(p).toContain("Keep the background and atmosphere of @Video1.");
  });
  it("customer text cannot inject media tags or control characters", () => {
    expect(cleanWish("@Image9 <b>hi</b>\n\u0000 ok")).not.toMatch(/[@<>\n\u0000]/);
    expect(cleanWish("@Image9 <b>hi</b>\n ok")).toBe("Image9 b hi /b ok");
    expect(cleanWish("x".repeat(500))).toHaveLength(300);
    expect(cleanWish(5)).toBe("");
  });
});

describe("seedance provider", () => {
  const faces = [{ slotKey: "face_1", providerInput: "img_1", imageUrl: "https://s/1.jpg" }];
  const base = { templateVideoUrl: "https://cdn/v.mp4", quality: "720p" };
  it("validates inputs", () => {
    expect(seedanceProvider.validateInputs({ ...base, faces, config: { durationSec: 8 } })).toEqual([]);
    expect(seedanceProvider.validateInputs({ ...base, faces, config: { mode: "scene" } })).toContain("unknown_duration");
    expect(seedanceProvider.validateInputs({ ...base, faces, config: { mode: "scene", durationSec: 40 } })).toContain("bad_duration");
    expect(seedanceProvider.validateInputs({ ...base, faces: [{ ...faces[0], providerInput: "img_2" }], config: { durationSec: 8 } })).toContain("unmapped_slot");
  });

  it("submits the documented body and reads the result", async () => {
    const calls: { url: string; body?: unknown }[] = [];
    const replies = [
      { request_id: "req-1" },
      { status: "processing" },
      { status: "completed", outputs: ["https://cdn.muapi/out.mp4"] },
      { status: "failed", error: "content policy: sensitive face" },
    ];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(replies.shift()), { status: 200 });
    }));
    const r = await seedanceProvider.submit({ jobId: "j", ...base, faces, config: { mode: "scene", people: 1, durationSec: 8.2, wish: "beach", allowWish: true } });
    expect(r.providerJobId).toBe("req-1");
    expect(r.cost).toBeCloseTo(seedanceCostUsd(8.2, S, { mode: "scene" }), 4);
    expect(calls[0].url).toBe("https://api.muapi.test/api/v1/seedance-2.5-intl-omni-reference");
    expect(calls[0].body).toMatchObject({ images_list: ["https://s/1.jpg"], videos_list: ["https://cdn/v.mp4"], resolution: "720p", duration: 8, aspect_ratio: "adaptive" });
    expect(String((calls[0].body as { prompt: string }).prompt)).toContain("beach");
    expect(await seedanceProvider.getStatus("req-1", { startedAt: null, state: null })).toEqual({ state: "processing" });
    expect(await seedanceProvider.getStatus("req-1", { startedAt: null, state: null })).toEqual({ state: "succeeded", outputUrl: "https://cdn.muapi/out.mp4" });
    expect(await seedanceProvider.getStatus("req-1", { startedAt: null, state: null })).toMatchObject({ state: "failed", errorCode: "provider_content_rejected" });
    expect(calls[1].url).toBe("https://api.muapi.test/api/v1/predictions/req-1/result");
    vi.unstubAllGlobals();
  });

  it("after Seedance, swaps each face in turn; a failed swap delivers the last good video", async () => {
    const two = [faces[0], { slotKey: "face_2", providerInput: "img_2", imageUrl: "https://s/2.jpg" }];
    const calls: { url: string; body?: unknown }[] = [];
    const replies = [
      { request_id: "seed-1" },
      { status: "completed", outputs: ["https://cdn/seed.mp4"] },
      { request_id: "swap-1" },
      { status: "completed", outputs: ["https://cdn/swap1.mp4"] },
      { request_id: "swap-2" },
      { status: "failed", error: "no face" },
    ];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(replies.shift()), { status: 200 });
    }));
    const r = await seedanceProvider.submit({ jobId: "j", ...base, faces: two, config: { mode: "scene", people: 2, durationSec: 8 } });
    expect(r.state).toEqual({ stage: "seedance", faces: ["https://s/1.jpg", "https://s/2.jpg"], swap_cost: 8 * 0.094 });
    const s1 = await seedanceProvider.getStatus("seed-1", { startedAt: null, state: r.state ?? null });
    expect(s1).toMatchObject({ state: "processing", next: { providerJobId: "swap-1", state: { stage: "swap", i: 0, base: "https://cdn/seed.mp4" } } });
    expect(calls[2].url).toBe("https://api.muapi.test/api/v1/ai-video-face-swap");
    expect(calls[2].body).toMatchObject({ video_url: "https://cdn/seed.mp4", image_url: "https://s/1.jpg", target_index: 0 });
    const n1 = (s1 as { next: { state: Record<string, unknown> } }).next.state;
    const s2 = await seedanceProvider.getStatus("swap-1", { startedAt: null, state: n1 });
    expect(s2).toMatchObject({ state: "processing", next: { providerJobId: "swap-2", state: { i: 1, base: "https://cdn/swap1.mp4" } } });
    expect(calls[4].body).toMatchObject({ video_url: "https://cdn/swap1.mp4", image_url: "https://s/2.jpg", target_index: 1 });
    const n2 = (s2 as { next: { state: Record<string, unknown> } }).next.state;
    expect(await seedanceProvider.getStatus("swap-2", { startedAt: null, state: n2 })).toEqual({ state: "succeeded", outputUrl: "https://cdn/swap1.mp4" });
    vi.unstubAllGlobals();
  });

  it("swap mode: face swap straight on the template video, no Seedance", async () => {
    const calls: { url: string; body?: unknown }[] = [];
    const replies = [{ request_id: "swap-0" }, { status: "completed", outputs: ["https://cdn/swapped.mp4"] }];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(replies.shift()), { status: 200 });
    }));
    expect(seedanceProvider.validateInputs({ ...base, faces, config: { mode: "swap", durationSec: 47 } })).toEqual([]);
    const r = await seedanceProvider.submit({ jobId: "j", ...base, faces, config: { mode: "swap", durationSec: 8 } });
    expect(calls[0].url).toBe("https://api.muapi.test/api/v1/ai-video-face-swap");
    expect(calls[0].body).toMatchObject({ video_url: "https://cdn/v.mp4", image_url: "https://s/1.jpg", target_index: 0 });
    expect(r.cost).toBeCloseTo(8 * 0.094, 4);
    expect(await seedanceProvider.getStatus("swap-0", { startedAt: null, state: r.state ?? null })).toEqual({ state: "succeeded", outputUrl: "https://cdn/swapped.mp4" });
    expect(seedanceCostUsd(8, S, { mode: "swap", people: 2 })).toBeCloseTo(2 * 8 * 0.094, 4);
    vi.unstubAllGlobals();
  });

  it("kling mode (default): photo + template video → Kling Motion Control, one person", async () => {
    const calls: { url: string; body?: unknown }[] = [];
    const replies = [{ request_id: "k-1" }, { status: "completed", outputs: ["https://cdn/kling.mp4"] }];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(replies.shift()), { status: 200 });
    }));
    const two = [faces[0], { slotKey: "face_2", providerInput: "img_2", imageUrl: "https://s/2.jpg" }];
    expect(seedanceProvider.validateInputs({ ...base, faces: two, config: { mode: "kling", durationSec: 8 } })).toContain("too_many_faces");
    const r = await seedanceProvider.submit({ jobId: "j", ...base, faces, config: { mode: "kling", durationSec: 8.06, wish: "night city", allowWish: true } });
    expect(calls[0].url).toBe("https://api.muapi.test/api/v1/kling-v3.0-pro-motion-control");
    expect(calls[0].body).toMatchObject({ image_url: "https://s/1.jpg", video_url: "https://cdn/v.mp4", character_orientation: "video", keep_original_sound: true });
    expect(String((calls[0].body as { prompt: string }).prompt)).toContain("night city");
    expect(r.cost).toBeCloseTo(9 * 0.194 + 0.14, 4);
    expect(await seedanceProvider.getStatus("k-1", { startedAt: null, state: r.state ?? null })).toEqual({ state: "succeeded", outputUrl: "https://cdn/kling.mp4" });
    vi.unstubAllGlobals();
  });

  it("kling with a template frame: customer put into the frame first, then Kling animates it", async () => {
    const calls: { url: string; body?: unknown }[] = [];
    const replies = [{ request_id: "c-1" }, { status: "completed", outputs: ["https://cdn/composed.jpg"] }, { request_id: "fx-1" }, { status: "completed", outputs: ["https://cdn/fixed.jpg"] }, { request_id: "k-2" }, { status: "completed", outputs: ["https://cdn/k.mp4"] }];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(replies.shift()), { status: 200 });
    }));
    const r = await seedanceProvider.submit({ jobId: "j", ...base, templateFrameUrl: "https://cdn/cover.jpg", faces, config: { mode: "kling", durationSec: 8 } });
    expect(calls[0].url).toBe("https://api.muapi.test/api/v1/nano-banana-pro-edit");
    expect(calls[0].body).toMatchObject({ images_list: ["https://cdn/cover.jpg", "https://s/1.jpg"] });
    expect(r.cost).toBeCloseTo(0.14, 4);
    const s0 = await seedanceProvider.getStatus("c-1", { startedAt: null, state: r.state ?? null });
    expect(s0).toMatchObject({ state: "processing", next: { providerJobId: "fx-1", state: { stage: "facefix", base: "https://cdn/composed.jpg" } } });
    expect(calls[2].url).toBe("https://api.muapi.test/api/v1/ai-image-face-swap");
    expect(calls[2].body).toMatchObject({ image_url: "https://cdn/composed.jpg", swap_url: "https://s/1.jpg", target_index: 0 });
    const s1 = await seedanceProvider.getStatus("fx-1", { startedAt: null, state: (s0 as { next: { state: Record<string, unknown> } }).next.state });
    expect(s1).toMatchObject({ state: "processing", next: { providerJobId: "k-2", state: { stage: "kling" } } });
    expect((s1 as { next: { cost: number } }).next.cost).toBeCloseTo(8 * 0.194, 4);
    expect(calls[4].url).toBe("https://api.muapi.test/api/v1/kling-v3.0-pro-motion-control");
    expect(calls[4].body).toMatchObject({ image_url: "https://cdn/fixed.jpg", video_url: "https://cdn/v.mp4" });
    const n = (s1 as { next: { state: Record<string, unknown> } }).next.state;
    expect(await seedanceProvider.getStatus("k-2", { startedAt: null, state: n })).toEqual({ state: "succeeded", outputUrl: "https://cdn/k.mp4" });
    vi.unstubAllGlobals();
  });

  it("kling: a failed compose stops before Kling (no expensive run with the customer's room)", async () => {
    const replies = [{ status: "failed", error: "bad image" }];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(replies.shift()), { status: 200 })));
    const st = { stage: "compose", i: 0, faces: ["https://s/1.jpg"], video: "https://cdn/v.mp4", prompt: "p", next_cost: 1.28 };
    expect(await seedanceProvider.getStatus("c-9", { startedAt: null, state: st })).toMatchObject({ state: "failed", errorCode: "provider_failed" });
    vi.unstubAllGlobals();
  });

  it("wan mode (default): Wan 2.2 Animate replace, then a face swap pass", async () => {
    const calls: { url: string; body?: unknown }[] = [];
    const replies = [{ request_id: "w-1" }, { status: "completed", outputs: ["https://cdn/wan.mp4"] }, { request_id: "fs-1" }, { status: "completed", outputs: ["https://cdn/final.mp4"] }];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(replies.shift()), { status: 200 });
    }));
    const r = await seedanceProvider.submit({ jobId: "j", ...base, faces, config: { durationSec: 8, prepare: false } });
    expect(calls[0].url).toBe("https://api.muapi.test/api/v1/wan2.2-animate");
    expect(calls[0].body).toMatchObject({ image_url: "https://s/1.jpg", video_url: "https://cdn/v.mp4", mode: "replace", resolution: "720p" });
    expect(r.cost).toBeCloseTo(8 * 0.14 + 8 * 0.094, 4); // muapi: Wan 8 s = $1.12, face swap $0.75
    const s1 = await seedanceProvider.getStatus("w-1", { startedAt: null, state: r.state ?? null });
    expect(s1).toMatchObject({ state: "processing", next: { providerJobId: "fs-1" } });
    expect(calls[2].body).toMatchObject({ video_url: "https://cdn/wan.mp4", image_url: "https://s/1.jpg", target_index: 0 });
    const n = (s1 as { next: { state: Record<string, unknown> } }).next.state;
    expect(await seedanceProvider.getStatus("fs-1", { startedAt: null, state: n })).toEqual({ state: "succeeded", outputUrl: "https://cdn/final.mp4" });
    vi.unstubAllGlobals();
  });

  it("wan with prepare (default): Nano Banana Pro full-body image (template outfit) → Wan with it → face swap with the photo", async () => {
    const calls: { url: string; body?: unknown }[] = [];
    const replies = [{ request_id: "p-1" }, { status: "completed", outputs: ["https://cdn/full.jpg"] }, { request_id: "w-2" }, { status: "completed", outputs: ["https://cdn/wan.mp4"] }, { request_id: "fs-2" }];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(replies.shift()), { status: 200 });
    }));
    const r = await seedanceProvider.submit({ jobId: "j", ...base, templateFrameUrl: "https://cdn/frame.jpg", faces, config: { durationSec: 8, outfit: "template" } });
    expect(calls[0].url).toBe("https://api.muapi.test/api/v1/nano-banana-pro-edit");
    expect(calls[0].body).toMatchObject({ images_list: ["https://s/1.jpg", "https://cdn/frame.jpg"], resolution: "2k" });
    expect(r.cost).toBeCloseTo(0.12, 4);
    const s1 = await seedanceProvider.getStatus("p-1", { startedAt: null, state: r.state ?? null });
    expect(s1).toMatchObject({ state: "processing", next: { providerJobId: "w-2", state: { stage: "wan" } } });
    expect((s1 as { next: { cost: number } }).next.cost).toBeCloseTo(8 * 0.14 + 8 * 0.094, 4);
    expect(calls[2].body).toMatchObject({ image_url: "https://cdn/full.jpg", mode: "replace" });
    const s2 = await seedanceProvider.getStatus("w-2", { startedAt: null, state: (s1 as { next: { state: Record<string, unknown> } }).next.state });
    expect(s2).toMatchObject({ state: "processing", next: { providerJobId: "fs-2" } });
    expect(calls[4].body).toMatchObject({ video_url: "https://cdn/wan.mp4", image_url: "https://s/1.jpg" }); // exact face from the photo
    vi.unstubAllGlobals();
  });

  it("pvr mode: Replicate p-video-replace, all people in one run with position mapping", async () => {
    const calls: { url: string; body?: unknown }[] = [];
    const replies = [{ id: "rp-1", status: "starting" }, { status: "processing" }, { status: "succeeded", output: "https://replicate.delivery/out.mp4" }];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(replies.shift()), { status: 200 });
    }));
    const two = [faces[0], { slotKey: "face_2", providerInput: "img_2", imageUrl: "https://s/2.jpg" }];
    const r = await seedanceProvider.submit({ jobId: "j", ...base, faces: two, config: { mode: "pvr", people: 2, positions: ["the biggest one in the frame", "in the background"], durationSec: 19.9 } });
    expect(calls[0].url).toBe("https://api.replicate.com/v1/models/prunaai/p-video-replace/predictions");
    const input = (calls[0].body as { input: { images: string[]; instruction_prompt: string; resolution: string } }).input;
    expect(input).toMatchObject({ images: ["https://s/1.jpg", "https://s/2.jpg"], resolution: "720p" });
    expect(input.instruction_prompt).toContain("the person the biggest one in the frame with the person from reference image 1");
    expect(r.cost).toBeCloseTo(20 * 0.03, 4);
    expect(await seedanceProvider.getStatus("rp-1", { startedAt: null, state: r.state ?? null })).toEqual({ state: "processing" });
    expect(await seedanceProvider.getStatus("rp-1", { startedAt: null, state: r.state ?? null })).toEqual({ state: "succeeded", outputUrl: "https://replicate.delivery/out.mp4" });
    vi.unstubAllGlobals();
  });

  it("maps HTTP errors (auth / balance / retryable)", async () => {
    for (const [status, code, retry] of [[401, "provider_auth", false], [402, "provider_no_balance", false], [503, "provider_http_503", true]] as const) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status })));
      await expect(seedanceProvider.submit({ jobId: "j", ...base, faces, config: { durationSec: 8 } })).rejects.toMatchObject({ code, retryable: retry });
    }
    vi.unstubAllGlobals();
  });
});
