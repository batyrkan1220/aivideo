import "server-only";
import { env } from "@/lib/env";
import { akoolConfigSchema } from "@/lib/templates/akool-config";
import { ProviderError, type GenerationProvider, type ProviderJobStatus } from "./types";

/**
 * Akool Open API — Head Swap (model `akool-premium`).
 * Docs: https://docs.akool.com/ai-tools-suite/head-swap/head-swap
 *
 *   POST /api/open/v4/headswap/analyze          { video_url, type: "head" }        → data._id
 *   GET  /api/open/v4/headswap/analyze/detail?_id=…                               → analysis_result.media[{obj_id,img_url}]
 *   POST /api/open/v4/headswap/task/create      { video_url, mappings[{obj_id,img_url}], model_name, resolution }
 *   GET  /api/open/v4/headswap/task/detail?_id=…                                  → status 1|2|3|4, video_url
 *
 * Auth: `x-api-key`. Responses use a body `code` (1000 = success) even when HTTP is 200.
 */

const MODEL = "akool-premium";
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
  if (code === 1003) return new ProviderError("provider_feature_disabled", false, detail);
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
  const d = await call<{ _id?: string }>("/api/open/v4/headswap/analyze", {
    method: "POST", body: JSON.stringify({ video_url: videoUrl, type: "head" }),
  });
  if (!d._id) throw new ProviderError("provider_bad_response", false, "missing _id");
  return d._id;
}

export type AkoolAnalysis =
  | { state: "processing"; progress: number | null }
  | { state: "failed"; reason: string }
  | { state: "done"; people: { objId: number; imgUrl: string }[] };

export async function akoolGetAnalysis(id: string): Promise<AkoolAnalysis> {
  const d = await call<{
    status?: number; progress?: number; error_reason?: string;
    analysis_result?: { media?: { obj_id?: number; img_url?: string }[] } | null;
  }>(`/api/open/v4/headswap/analyze/detail?_id=${encodeURIComponent(id)}`);
  if (d.status === 4) return { state: "failed", reason: d.error_reason ?? "" };
  if (d.status !== 3) return { state: "processing", progress: d.progress ?? null };
  const people = (d.analysis_result?.media ?? [])
    .filter((m) => Number.isInteger(m.obj_id) && typeof m.img_url === "string")
    .map((m) => ({ objId: m.obj_id as number, imgUrl: m.img_url as string }));
  return { state: "done", people };
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
    const a = cfg.data.analysis;
    if (!a) problems.push("akool_not_analyzed");
    // Akool requires the exact same video_url string that was analysed.
    else if (a.videoUrl !== input.templateVideoUrl) problems.push("akool_video_changed");
    if (!input.faces.length) problems.push("missing_faces");
    if (input.faces.length > 5) problems.push("too_many_faces");
    const ids = input.faces.map((f) => objIdOf(f.providerInput));
    if (ids.some((x) => x === null)) problems.push("akool_unmapped_slot");
    if (new Set(ids).size !== ids.length) problems.push("duplicate_target");
    if (a && ids.some((x) => x !== null && !a.people.some((p) => p.objId === x))) problems.push("akool_unknown_person");
    return problems;
  },

  async submit(input) {
    const cfg = akoolConfigSchema.parse(input.config ?? {});
    const d = await call<{ _id?: string }>("/api/open/v4/headswap/task/create", {
      method: "POST",
      body: JSON.stringify({
        video_url: cfg.analysis!.videoUrl,
        mappings: input.faces.map((f) => ({ obj_id: objIdOf(f.providerInput), img_url: f.imageUrl })),
        model_name: MODEL,
        resolution: cfg.resolution,
        keep_original_sound: true,
      }),
    });
    if (!d._id) throw new ProviderError("provider_bad_response", false, "missing _id");
    return { providerJobId: d._id };
  },

  async getStatus(providerJobId): Promise<ProviderJobStatus> {
    const d = await call<{ status?: number; progress?: number; video_url?: string | null; error_reason?: string; error_code?: number }>(
      `/api/open/v4/headswap/task/detail?_id=${encodeURIComponent(providerJobId)}`,
    );
    if (d.status === 4) {
      console.error("[akool] task failed", providerJobId, d.error_code, d.error_reason);
      return { state: "failed", errorCode: "provider_failed", retryable: false };
    }
    if (d.status === 3) {
      if (!d.video_url) return { state: "failed", errorCode: "provider_no_output", retryable: false };
      return { state: "succeeded", outputUrl: d.video_url };
    }
    return { state: d.status === 1 ? "queued" : "processing", progress: d.progress ?? undefined };
  },
};
