import { describe, it, expect, vi, afterEach } from "vitest";
import { wavespeedProvider as ws } from "../generation/wavespeed";
import { ProviderError } from "../generation/types";

/** Mock WaveSpeed API (no network). Records every request. */
function mockApi(responses: Array<{ status?: number; body: unknown }>) {
  const calls: { url: string; method: string; body: Record<string, unknown> | null; auth: string | null }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({
      url, method: init.method ?? "GET",
      body: init.body ? JSON.parse(String(init.body)) : null,
      auth: new Headers(init.headers).get("authorization"),
    });
    const r = responses.shift() ?? { body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }));
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

const faces = (n: number) => Array.from({ length: n }, (_, i) => ({ slotKey: `face_${i + 1}`, providerInput: `face_${i + 1}`, imageUrl: `https://s/f${i + 1}.jpg` }));
const base = { templateVideoUrl: "https://cdn/template.mp4", quality: "standard" };

describe("WaveSpeed head-swap adapter (mocked API)", () => {
  it("submit → poll → succeeded", async () => {
    const calls = mockApi([
      { body: { data: { id: "p1", status: "created" } } },
      { body: { data: { id: "p1", status: "processing" } } },
      { body: { data: { id: "p1", status: "completed", outputs: ["https://out/1.mp4"] } } },
    ]);
    const sub = await ws.submit({ jobId: "j", ...base, faces: faces(1), config: { videoSeconds: 19 } });
    expect(sub.providerJobId).toBe("p1");
    expect(sub.cost).toBeCloseTo(1.52); // 19 s × $0.08 (720p default)
    expect(calls[0].url).toMatch(/\/wavespeed-ai\/video-head-swap$/);
    expect(calls[0].auth).toBe("Bearer test-wavespeed-key");
    expect(calls[0].body).toEqual({ video: "https://cdn/template.mp4", face_image: "https://s/f1.jpg", resolution: "720p" });

    expect((await ws.getStatus("p1", { startedAt: null, state: null })).state).toBe("processing");
    expect(await ws.getStatus("p1", { startedAt: null, state: null })).toEqual({ state: "succeeded", outputUrl: "https://out/1.mp4" });
  });

  it("480p pricing and old config keys are ignored", async () => {
    const calls = mockApi([{ body: { data: { id: "p" } } }]);
    const sub = await ws.submit({ jobId: "j", ...base, faces: faces(1), config: { resolution: "480p", videoSeconds: 2, targetIndexBySlot: [0] } });
    expect(sub.cost).toBeCloseTo(0.12); // min 3 s × $0.04
    expect(calls[0].body).toMatchObject({ resolution: "480p" });
  });

  it("provider failure is terminal and not auto-retried", async () => {
    mockApi([{ body: { data: { status: "failed", error: "no face" } } }]);
    expect(await ws.getStatus("x", { startedAt: null, state: null })).toMatchObject({ state: "failed", retryable: false });
  });

  it("429 is retryable; no balance (402 or 400 'Insufficient credits') is not", async () => {
    mockApi([{ status: 429, body: {} }]);
    await expect(ws.submit({ jobId: "j", ...base, faces: faces(1), config: {} })).rejects.toMatchObject({ retryable: true });
    for (const r of [{ status: 402, body: {} }, { status: 400, body: { code: 400, message: "Insufficient credits. Please top up your account to continue." } }]) {
      mockApi([r]);
      const err = await ws.submit({ jobId: "j", ...base, faces: faces(1), config: {} }).catch((e) => e);
      expect(err).toBeInstanceOf(ProviderError);
      expect(err).toMatchObject({ code: "provider_no_balance", retryable: false });
    }
  });

  it("single person only; https video required", () => {
    expect(ws.validateInputs({ ...base, faces: faces(2), config: {} })).toContain("head_swap_single_person_only");
    expect(ws.validateInputs({ ...base, templateVideoUrl: "http://insecure", faces: faces(1), config: {} })).toContain("template_video_not_public_https");
    expect(ws.validateInputs({ ...base, faces: faces(1), config: { resolution: "720p" } })).toEqual([]);
  });
});
