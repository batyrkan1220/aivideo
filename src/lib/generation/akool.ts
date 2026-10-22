import "server-only";
import { env } from "@/lib/env";
import { akoolConfigSchema } from "@/lib/templates/akool-config";
import { ProviderError, type GenerationProvider, type ProviderJobStatus } from "./types";

/**
 * Akool Open API — Character Swap V5 (model `akool-premium-multi-person`).
 * Replaces whole people (face, hair, body, outfit) in the template video, 1–5 people.
 * Docs: https://docs.akool.com/ai-tools-suite/swap-studio/character-swap-v5
 *
 *   POST /api/open/v5/characterSwap/analyze         { url, media_type: "video", type: "person" } → data._id
 *   GET  /api/open/v5/characterSwap/analyze/detail?_id=…  → analysis_result.{track_manifest_url, media[{obj_id,…}]}
 *   POST /api/open/v5/characterSwap/create          { media_type, target_url, model_name, analyze_id,
 *                                                     mappings[{obj_id,img_url}], resolution } → data.list[]._id
 *   GET  /api/open/v5/characterSwap/task/detail?_id=…     → status 1|2|3|4, url
 *
 * Auth: `x-api-key`. Responses use a body `code` (1000 = success) even when HTTP is 200.
 * Source video 3–20 s; the task must use the identical URL that was analysed.
 */

const MODEL = "akool-premium-multi-person";
const BASE = "/api/open/v5/characterSwap";
type Envelope<T> = { code?: number; msg?: string; data?: T };

function apiKey() {
  const k = env().AKOOL_API_KEY;
  if (!k) throw new ProviderError("provider_not_configured", false, "AKOOL_API_KEY is not set");
  return k;
}

/** Maps Akool business codes to our error codes. */
function codeError(code: number | undefined, msg: string | undefined): ProviderError {
  const detail = `akool code ${code}: ${msg ?? ""}`.slice(0, 300);
  if (code === 1104) return new ProviderError("provider_no_balance", false, detail);
  if (code === 1101 || code === 1102 || code === 1200) return new ProviderError("provider_auth", false, detail);
  if (code === 1009) return new ProviderError("provider_feature_disabled", false, detail);
  if (code === 1015) return new ProviderError("provider_busy", true, detail);   // "create error, retry later"
  if (code === 1003) return new ProviderError("provider_bad_params", false, detail);
  return new ProviderError(`provider_code_${code ?? "unknown"}`, false, detail);
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${env().AKOOL_API_BASE_URL}${path}`, {
      ...init,
      headers: { "x-api-key": apiKey(), "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new ProviderError("provider_unreachable", true); // not accepted → safe to retry
  }
  const body = (await res.json().catch(() => ({}))) as Envelope<T>;
  if (!res.ok && body.code === undefined) {
    const retryable = res.status === 429 || res.status >= 500;
    throw new ProviderError(res.status === 401 || res.status === 403 ? "provider_auth" : `provider_http_${res.status}`, retryable);
  }
  if (body.code !== 1000) throw codeError(body.code, body.msg);
  if (!body.data) throw new ProviderError("provider_bad_response", false, "missing data");
  return body.data;
}

// ── Person analysis (admin, once per template video) ───────────────────────────
export async function akoolStartAnalysis(videoUrl: string) {
  const d = await call<{ _id?: string }>(`${BASE}/analyze`, {
    method: "POST", body: JSON.stringify({ url: videoUrl, media_type: "video", type: "person" }),
  });
  if (!d._id) throw new ProviderError("provider_bad_response", false, "missing _id");
  return d._id;
}

export type AkoolAnalysis =
  | { state: "processing"; progress: number | null }
  | { state: "failed"; reason: string }
  | { state: "done"; trackManifestUrl: string | null; people: { objId: number; imgUrl: string | null }[] };

/** Preview image of a detected person, if Akool returns one (field name isn't documented). */
function previewOf(m: Record<string, unknown>): string | null {
  for (const k of ["img_url", "image_url", "preview_url", "url", "thumbnail", "cover_url"]) {
    const v = m[k];
    if (typeof v === "string" && /^https?:\/\//.test(v)) return v;
  }
  return null;
}

export async function akoolGetAnalysis(id: string): Promise<AkoolAnalysis> {
  const d = await call<{
    status?: number; progress?: number; error_reason?: string;
    analysis_result?: { track_manifest_url?: string; media?: Record<string, unknown>[] } | null;
  }>(`${BASE}/analyze/detail?_id=${encodeURIComponent(id)}`);
  if (d.status === 4) return { state: "failed", reason: d.error_reason ?? "" };
  if (d.status !== 3) return { state: "processing", progress: d.progress ?? null };
  const people = (d.analysis_result?.media ?? [])
    .filter((m) => Number.isInteger(m.obj_id))
    .map((m) => ({ objId: m.obj_id as number, imgUrl: previewOf(m) }));
  return { state: "done", trackManifestUrl: d.analysis_result?.track_manifest_url ?? null, people };
}

// ── Generation provider ───────────────────────────────────────────────────────
const objIdOf = (providerInput: string) => {
  const m = /^obj_(\d+)$/.exec(providerInput);
  return m ? Number(m[1]) : null;
};

export const akoolProvider: GenerationProvider = {
  key: "akool",

  capabilities() {
    return {
      videoFaceSwap: true,
      maxFaces: 5,
      qualities: ["standard"],
      supportsCancel: false,
      reportsProgress: true,
      reportsCost: false,          // Akool bills in credits; no per-request USD price
      producesRealVideo: true,
    };
  },

  validateInputs(input) {
    const problems: string[] = [];
    const cfg = akoolConfigSchema.safeParse(input.config ?? {});
    if (!cfg.success) return ["invalid_provider_config"];
    if (!input.faces.length) problems.push("missing_faces");
    if (input.faces.length > 5) problems.push("too_many_faces");
    const a = cfg.data.analysis;
    const auto = !a || a.videoUrl !== input.templateVideoUrl;
    if (auto) {
      // Auto mode (admin skipped "find people"): one person, analysed per order.
      if (input.faces.length !== 1) problems.push(a ? "akool_video_changed" : "akool_not_analyzed");
      return problems;
    }
    const ids = input.faces.map((f) => objIdOf(f.providerInput));
    if (ids.some((x) => x === null)) problems.push("akool_unmapped_slot");
    if (new Set(ids).size !== ids.length) problems.push("duplicate_target");
    if (ids.some((x) => x !== null && !a.people.some((p) => p.objId === x))) problems.push("akool_unknown_person");
    return problems;
  },

  async submit(input) {
    const cfg = akoolConfigSchema.parse(input.config ?? {});
    const a = cfg.analysis;
    if (!a || a.videoUrl !== input.templateVideoUrl) {
      // Auto mode: Akool requires a person analysis of the same video before replacing,
      // so step 1 analyses the template video; step 2 (in getStatus) creates the swap task.
      const analysisId = await akoolStartAnalysis(input.templateVideoUrl);
      const state: AutoState = {
        phase: "analysis", analysisId, videoUrl: input.templateVideoUrl,
        faceUrl: input.faces[0].imageUrl, resolution: cfg.resolution,
      };
      return { providerJobId: analysisId, state };
    }
    const id = await createTask(a.videoUrl, a.id,
      input.faces.map((f) => ({ obj_id: objIdOf(f.providerInput)!, img_url: f.imageUrl })), cfg.resolution);
    return { providerJobId: id };
  },

  async getStatus(providerJobId, { state }): Promise<ProviderJobStatus> {
    const s = state as AutoState | null;
    if (s?.phase === "analysis") {
      const r = await akoolGetAnalysis(s.analysisId);
      if (r.state === "processing") return { state: "processing", progress: 0 };
      if (r.state === "failed") {
        console.error("[akool] auto analysis failed", s.analysisId, r.reason);
        return { state: "failed", errorCode: "akool_analysis_failed", retryable: false };
      }
      if (!r.people.length) return { state: "failed", errorCode: "akool_no_people", retryable: false };
      // One-person template: replace the first (main) person Akool detected.
      const taskId = await createTask(s.videoUrl, s.analysisId, [{ obj_id: r.people[0].objId, img_url: s.faceUrl }], s.resolution);
      return { state: "processing", progress: 0, next: { providerJobId: taskId, state: { phase: "task" } } };
    }

    const d = await call<{ status?: number; progress?: number; url?: string | null; error_reason?: string }>(
      `${BASE}/task/detail?_id=${encodeURIComponent(providerJobId)}`,
    );
    if (d.status === 4) {
      console.error("[akool] task failed", providerJobId, d.error_reason);
      return { state: "failed", errorCode: "provider_failed", retryable: false };
    }
    if (d.status === 3) {
      if (!d.url) return { state: "failed", errorCode: "provider_no_output", retryable: false };
      return { state: "succeeded", outputUrl: d.url };
    }
    return { state: d.status === 1 ? "queued" : "processing", progress: d.progress ?? undefined };
  },
};

type AutoState = { phase: "analysis"; analysisId: string; videoUrl: string; faceUrl: string; resolution: "480p" | "720p" };

async function createTask(videoUrl: string, analyzeId: string, mappings: { obj_id: number; img_url: string }[], resolution: string) {
  const d = await call<{ list?: { _id?: string; deduction_credit?: number }[]; errors?: { index?: number; error?: string }[] }>(`${BASE}/create`, {
    method: "POST",
    body: JSON.stringify({
      media_type: "video",
      target_url: videoUrl,
      model_name: MODEL,
      analyze_id: analyzeId,
      mappings,
      resolution,
      keep_original_sound: true,
    }),
  });
  const task = d.list?.[0];
  if (!task?._id) {
    // Creation errors are not billed (docs), so it is safe to report and stop.
    throw new ProviderError("provider_rejected", false, JSON.stringify(d.errors ?? []).slice(0, 300));
  }
  return task._id;
}
