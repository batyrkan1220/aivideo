import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: () => ({ KLING_API_KEY: "g".repeat(20), NEXT_PUBLIC_SUPABASE_URL: "https://sb.test" }) }));
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
    expect(p.startsWith("Edit @video_1.")).toBe(true);
    expect(p).toContain("the person the biggest one in the frame with the person from @image_1");
    expect(p).toContain("the person in the background with the person from @image_2");
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

  it("adds the template cut-out after the customer's photo only when the toggle is on", async () => {
    const bodies: { contents: { type: string; url?: string; text?: string }[] }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ code: 0, data: { id: "kt-3" } }), { status: 200 });
    }));
    await seedanceProvider.submit({ jobId: "j", ...base, faces, config: { durationSec: 8, targets: ["targets/a.jpg"], showTargets: true } });
    await seedanceProvider.submit({ jobId: "j", ...base, faces, config: { durationSec: 8, targets: ["targets/a.jpg"] } });
    const imgs = (b: (typeof bodies)[number]) => b.contents.filter((c) => c.type === "refer_image").map((c) => c.url);
    expect(imgs(bodies[0])).toEqual(["https://s/1.jpg", "https://sb.test/storage/v1/object/public/template-media/targets/a.jpg"]);
    expect(bodies[0].contents[0].text).toContain("shown in @image_2");
    expect(imgs(bodies[1])).toEqual(["https://s/1.jpg"]);
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

  it("two people and the car go as images in order, clothing from their photos", async () => {
    const group = [
      { slotKey: "face_1", providerInput: "img_1", imageUrl: "https://s/1.jpg" },
      { slotKey: "face_2", providerInput: "img_2", imageUrl: "https://s/2.jpg" },
      { slotKey: "obj_1", providerInput: "img_3", imageUrl: "https://s/car.jpg" },
    ];
    const calls: { url: string; body?: { contents: { type: string; id?: string; url?: string; text?: string }[] } }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify({ code: 0, data: { id: "kt-2" } }), { status: 200 });
    }));
    const r = await seedanceProvider.submit({
      jobId: "j", ...base, faces: group,
      config: { durationSec: 10, people: 2, outfit: "photo", objects: [{ what: "car", label: "Фото машины" }] },
    });
    expect(r.providerJobId).toBe("kt-2");
    expect(calls).toHaveLength(1);
    const body = calls[0].body!;
    expect(body.contents.filter((c) => c.type === "refer_image").map((c) => [c.id, c.url])).toEqual([
      ["image_1", "https://s/1.jpg"], ["image_2", "https://s/2.jpg"], ["image_3", "https://s/car.jpg"],
    ]);
    expect(body.contents.some((c) => c.type === "element")).toBe(false);
    const text = body.contents[0].text!;
    expect(text).toContain("Use the clothing of the people in @image_1, @image_2");
    expect(text).toContain("@image_3 is a photo of a car, not a person");
    expect(text).toContain("do not swap, blend or mix their faces");
    vi.unstubAllGlobals();
  });
});
