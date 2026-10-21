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

describe("WaveSpeed adapter (mocked API)", () => {
  it("single face: submit → poll → succeeded", async () => {
    const calls = mockApi([
      { body: { data: { id: "p1", status: "created" } } },
      { body: { data: { id: "p1", status: "processing" } } },
      { body: { data: { id: "p1", status: "completed", outputs: ["https://out/1.mp4"] } } },
    ]);
    const sub = await ws.submit({ jobId: "j", ...base, faces: faces(1), config: { videoSeconds: 12 } });
    expect(sub.providerJobId).toBe("p1");
    expect(sub.cost).toBeCloseTo(0.12);
    expect(calls[0].url).toMatch(/\/wavespeed-ai\/video-face-swap$/);
    expect(calls[0].auth).toBe("Bearer test-wavespeed-key");
    expect(calls[0].body).toMatchObject({ video: "https://cdn/template.mp4", face_image: "https://s/f1.jpg", target_index: 0 });

    expect((await ws.getStatus("p1", { startedAt: null, state: sub.state! })).state).toBe("processing");
    const done = await ws.getStatus("p1", { startedAt: null, state: sub.state! });
    expect(done).toEqual({ state: "succeeded", outputUrl: "https://out/1.mp4" });
  });

  it("three faces: chains output → next face, honours the slot→index map", async () => {
    const calls = mockApi([
      { body: { data: { id: "a" } } },                                                  // submit face 1
      { body: { data: { status: "completed", outputs: ["https://out/a.mp4"] } } },      // poll a
      { body: { data: { id: "b" } } },                                                  // submit face 2
      { body: { data: { status: "completed", outputs: [{ url: "https://out/b.mp4" }] } } },
      { body: { data: { id: "c" } } },                                                  // submit face 3
      { body: { data: { status: "completed", outputs: ["https://out/c.mp4"] } } },
    ]);
    const sub = await ws.submit({ jobId: "j", ...base, faces: faces(3), config: { targetIndexBySlot: [1, 0, 2] } });
    expect(calls[0].body).toMatchObject({ face_image: "https://s/f1.jpg", target_index: 1 });

    const s1 = await ws.getStatus("a", { startedAt: null, state: sub.state! });
    expect(s1.state).toBe("processing");
    if (s1.state !== "processing" || !s1.next) throw new Error("expected next step");
    expect(s1.progress).toBe(33);
    expect(calls[2].body).toMatchObject({ video: "https://out/a.mp4", face_image: "https://s/f2.jpg", target_index: 0 });

    const s2 = await ws.getStatus(s1.next.providerJobId, { startedAt: null, state: s1.next.state });
    if (s2.state !== "processing" || !s2.next) throw new Error("expected next step");
    expect(calls[4].body).toMatchObject({ video: "https://out/b.mp4", face_image: "https://s/f3.jpg", target_index: 2 });

    const s3 = await ws.getStatus(s2.next.providerJobId, { startedAt: null, state: s2.next.state });
    expect(s3).toEqual({ state: "succeeded", outputUrl: "https://out/c.mp4" });
  });

  it("provider failure is terminal and not auto-retried", async () => {
    mockApi([{ body: { data: { id: "x" } } }, { body: { data: { status: "failed", error: "no face" } } }]);
    const sub = await ws.submit({ jobId: "j", ...base, faces: faces(1), config: {} });
    expect(await ws.getStatus("x", { startedAt: null, state: sub.state! })).toMatchObject({ state: "failed", retryable: false });
  });

  it("429 is retryable (not accepted); 402 no balance is not", async () => {
    mockApi([{ status: 429, body: {} }]);
    await expect(ws.submit({ jobId: "j", ...base, faces: faces(1), config: {} }))
      .rejects.toMatchObject({ retryable: true });
    mockApi([{ status: 402, body: {} }]);
    const err = await ws.submit({ jobId: "j", ...base, faces: faces(1), config: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ code: "provider_no_balance", retryable: false });
  });

  it("validates config against the template's faces", () => {
    expect(ws.validateInputs({ ...base, faces: faces(2), config: { targetIndexBySlot: [0] } })).toContain("target_index_count_mismatch");
    expect(ws.validateInputs({ ...base, faces: faces(2), config: { targetIndexBySlot: [1, 1] } })).toContain("duplicate_target_index");
    expect(ws.validateInputs({ ...base, templateVideoUrl: "http://insecure", faces: faces(1), config: {} })).toContain("template_video_not_public_https");
    expect(ws.validateInputs({ ...base, faces: faces(3), config: { targetIndexBySlot: [2, 0, 1] } })).toEqual([]);
  });
});
