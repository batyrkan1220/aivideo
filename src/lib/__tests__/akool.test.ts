import { describe, it, expect, vi, afterEach } from "vitest";
import { akoolProvider as ak, akoolGetAnalysis, akoolStartAnalysis } from "../generation/akool";
import { ProviderError } from "../generation/types";
import { akoolSlots, akoolProblems, parseAkoolConfig } from "../templates/akool-config";
import { inputToRow, emptyTemplate, publishProblems } from "../templates/admin-schema";

/** Mock Akool API (no network). Records every request. */
function mockApi(responses: Array<{ status?: number; body: unknown }>) {
  const calls: { url: string; method: string; body: Record<string, unknown> | null; key: string | null }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({
      url, method: init.method ?? "GET",
      body: init.body ? JSON.parse(String(init.body)) : null,
      key: new Headers(init.headers).get("x-api-key"),
    });
    const r = responses.shift() ?? { body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }));
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

const VIDEO = "https://cdn/template.mp4";
const analysis = {
  id: "6700000000000000000000a1", videoPath: "previews/v.mp4", videoUrl: VIDEO,
  people: [{ objId: 0, previewPath: "people/an1/0.jpg" }, { objId: 1, previewPath: "people/an1/1.jpg" }, { objId: 2, previewPath: "people/an1/2.jpg" }],
};
const cfg = { resolution: "720p", analysis, selected: [2, 0] };
const faces = [
  { slotKey: "face_1", providerInput: "obj_2", imageUrl: "https://s/f1.jpg" },
  { slotKey: "face_2", providerInput: "obj_0", imageUrl: "https://s/f2.jpg" },
];
const base = { templateVideoUrl: VIDEO, quality: "standard" };

describe("Akool config → slots", () => {
  it("one slot per selected person, in selection order, with preview", () => {
    const slots = akoolSlots(parseAkoolConfig(cfg));
    expect(slots.map((s) => s.providerInput)).toEqual(["obj_2", "obj_0"]);
    expect(slots[0]).toMatchObject({ key: "face_1", previewImagePath: "people/an1/2.jpg", labelKk: "1-адамның фотосы", order: 0 });
  });

  it("server derives slots from config (browser slots are ignored)", () => {
    const row = inputToRow({ ...emptyTemplate(), providerKey: "akool", previewVideoPath: "previews/v.mp4", providerConfig: cfg });
    expect(row.required_face_count).toBe(2);
    expect(row.face_slots_json.map((s) => s.providerInput)).toEqual(["obj_2", "obj_0"]);
  });

  it("publish requires analysis of the current video and a selection", () => {
    expect(akoolProblems(parseAkoolConfig({}), "previews/v.mp4")).toEqual(["akool_not_analyzed"]);
    expect(akoolProblems(parseAkoolConfig(cfg), "previews/other.mp4")).toEqual(["akool_video_changed"]);
    expect(akoolProblems(parseAkoolConfig({ ...cfg, selected: [] }), "previews/v.mp4")).toEqual(["akool_no_people"]);
    const t = { ...emptyTemplate(), titleKk: "Би", coverAssetPath: "c.jpg", previewVideoPath: "previews/v.mp4", providerKey: "akool", providerConfig: cfg };
    expect(publishProblems(t)).toEqual([]);
  });
});

describe("Akool Character Swap V5 adapter (mocked API)", () => {
  it("analysis: start → detail with people (preview optional)", async () => {
    const calls = mockApi([
      { body: { code: 1000, data: { _id: "an1", status: 1 } } },
      { body: { code: 1000, data: { status: 2, progress: 40 } } },
      { body: { code: 1000, data: { status: 3, analysis_result: { track_manifest_url: "https://a/m.json", media: [{ obj_id: 0, img_url: "https://a/0.jpg" }, { obj_id: 1 }] } } } },
    ]);
    expect(await akoolStartAnalysis(VIDEO)).toBe("an1");
    expect(calls[0].url).toBe("https://openapi.akool.com/api/open/v5/characterSwap/analyze");
    expect(calls[0].body).toEqual({ url: VIDEO, media_type: "video", type: "person" });
    expect(calls[0].key).toBe("test-akool-key-123");
    expect(await akoolGetAnalysis("an1")).toEqual({ state: "processing", progress: 40 });
    expect(await akoolGetAnalysis("an1")).toEqual({
      state: "done", trackManifestUrl: "https://a/m.json",
      people: [{ objId: 0, imgUrl: "https://a/0.jpg" }, { objId: 1, imgUrl: null }],
    });
    expect(calls[1].url).toMatch(/\/characterSwap\/analyze\/detail\?_id=an1$/);
  });

  it("task: create with mappings → detail → succeeded", async () => {
    const calls = mockApi([
      { body: { code: 1000, data: { list: [{ _id: "t1", status: 1, deduction_credit: 40 }], errors: [] } } },
      { body: { code: 1000, data: { status: 2, progress: 50 } } },
      { body: { code: 1000, data: { status: 3, url: "https://out/r.mp4" } } },
    ]);
    const sub = await ak.submit({ jobId: "j", ...base, faces, config: cfg });
    expect(sub.providerJobId).toBe("t1");
    expect(calls[0].url).toBe("https://openapi.akool.com/api/open/v5/characterSwap/create");
    expect(calls[0].body).toEqual({
      media_type: "video", target_url: VIDEO, model_name: "akool-premium-multi-person",
      analyze_id: "6700000000000000000000a1",
      mappings: [{ obj_id: 2, img_url: "https://s/f1.jpg" }, { obj_id: 0, img_url: "https://s/f2.jpg" }],
      resolution: "720p", keep_original_sound: true,
    });
    expect(await ak.getStatus("t1", { startedAt: null, state: null })).toEqual({ state: "processing", progress: 50 });
    expect(await ak.getStatus("t1", { startedAt: null, state: null })).toEqual({ state: "succeeded", outputUrl: "https://out/r.mp4" });
    expect(calls[1].url).toMatch(/\/characterSwap\/task\/detail\?_id=t1$/);
  });

  it("rejected input (data.errors) is reported, not billed", async () => {
    mockApi([{ body: { code: 1000, data: { list: [], errors: [{ index: 0, error: "bad image" }] } } }]);
    await expect(ak.submit({ jobId: "j", ...base, faces, config: cfg })).rejects.toMatchObject({ code: "provider_rejected", retryable: false });
  });

  it("business codes: 1104 no credits, 1009 no permission — not retryable; 1015 and 5xx retryable", async () => {
    mockApi([{ body: { code: 1015, msg: "retry later" } }]);
    await expect(ak.submit({ jobId: "j", ...base, faces, config: cfg })).rejects.toMatchObject({ retryable: true });
    for (const [code, expected] of [[1104, "provider_no_balance"], [1009, "provider_feature_disabled"], [1101, "provider_auth"]] as const) {
      mockApi([{ body: { code, msg: "x" } }]);
      const err = await ak.submit({ jobId: "j", ...base, faces, config: cfg }).catch((e) => e);
      expect(err).toBeInstanceOf(ProviderError);
      expect(err).toMatchObject({ code: expected, retryable: false });
    }
    mockApi([{ status: 503, body: {} }]);
    await expect(ak.submit({ jobId: "j", ...base, faces, config: cfg })).rejects.toMatchObject({ retryable: true });
  });

  it("failed task is terminal", async () => {
    mockApi([{ body: { code: 1000, data: { status: 4, error_reason: "no face" } } }]);
    expect(await ak.getStatus("t", { startedAt: null, state: null })).toMatchObject({ state: "failed", retryable: false });
  });

  it("validates video identity and mappings", () => {
    expect(ak.validateInputs({ ...base, faces, config: cfg })).toEqual([]);
    expect(ak.validateInputs({ ...base, templateVideoUrl: "https://cdn/other.mp4", faces, config: cfg })).toContain("akool_video_changed");
    expect(ak.validateInputs({ ...base, faces, config: {} })).toContain("akool_not_analyzed");
    expect(ak.validateInputs({ ...base, faces: [{ ...faces[0], providerInput: "face_1" }], config: cfg })).toContain("akool_unmapped_slot");
    expect(ak.validateInputs({ ...base, faces: [{ ...faces[0], providerInput: "obj_9" }], config: cfg })).toContain("akool_unknown_person");
  });
});
