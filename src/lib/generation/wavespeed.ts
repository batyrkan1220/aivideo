import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";
import { ProviderError, type GenerationProvider, type ProviderJobStatus, type ProviderState } from "./types";

/**
 * WaveSpeed AI — model `wavespeed-ai/video-face-swap`
 * Docs: https://wavespeed.ai/models/wavespeed-ai/video-face-swap
 *
 * The model swaps ONE face per request; the face is chosen by `target_index`, which counts
 * faces by SIZE in the video (0 = largest), not left-to-right. So:
 *  - multi-face templates are processed as a chain: step k swaps face k into the output of step k-1;
 *  - each template maps its left-to-right slots to WaveSpeed indices in provider config:
 *      { "targetIndexBySlot": [1, 0, 2], "videoSeconds": 12, "targetGender": "all" }
 *    (default mapping: slot i → index i). Admins set this once per template after checking
 *    which person is largest in the video.
 * Pricing per docs: $0.01 per input second, minimum 3 s, per request (chain = one request per face).
 *
 * swapMode "head" uses `wavespeed-ai/video-head-swap` instead: replaces the whole head (face, hair,
 * outline) so identity really changes, e.g. a man's photo onto a female dancer. It has no target
 * index, so it is only allowed for single-person templates. Price: $0.04/s (480p), $0.08/s (720p).
 */

const configSchema = z.object({
  targetIndexBySlot: z.array(z.number().int().min(0).max(10)).optional(),
  targetGender: z.enum(["all", "male", "female"]).default("all"),
  videoSeconds: z.number().positive().max(600).optional(),
  swapMode: z.enum(["face", "head"]).default("face"),
  resolution: z.enum(["480p", "720p"]).default("720p"),
}).passthrough();

export function wavespeedCostPerStep(cfg: { videoSeconds?: number; swapMode?: string; resolution?: string }) {
  if (!cfg.videoSeconds) return null;
  const sec = Math.max(3, Math.ceil(cfg.videoSeconds));
  const rate = cfg.swapMode === "head" ? (cfg.resolution === "480p" ? 0.04 : 0.08) : 0.01;
  return Math.round(sec * rate * 100) / 100;
}

type ChainState = {
  steps: { faceUrl: string; targetIndex: number }[];
  step: number;               // index of the step currently running
  targetGender: "all" | "male" | "female";
  swapMode?: "face" | "head";
  resolution?: "480p" | "720p";
  costPerStep: number | null; // USD, when videoSeconds is known
};

const TERMINAL_FAIL = new Set(["failed", "cancelled", "timeout", "deleted"]);

function apiKey() {
  const k = env().WAVESPEED_API_KEY;
  if (!k) throw new ProviderError("provider_not_configured", false, "WAVESPEED_API_KEY is not set");
  return k;
}

async function call(path: string, init: RequestInit = {}) {
  let res: Response;
  try {
    res = await fetch(`${env().WAVESPEED_API_BASE_URL}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new ProviderError("provider_unreachable", true); // network: request not accepted → safe to retry
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 429/5xx: not accepted, safe to retry. Other 4xx (bad input, auth, no balance): don't retry.
    const retryable = res.status === 429 || res.status >= 500;
    const code = res.status === 401 || res.status === 403 ? "provider_auth"
      : res.status === 402 ? "provider_no_balance" : `provider_http_${res.status}`;
    throw new ProviderError(code, retryable, JSON.stringify(body).slice(0, 300));
  }
  return body as { data?: { id?: string; status?: string; outputs?: unknown[]; error?: string } };
}

async function submitStep(video: string, s: ChainState) {
  const step = s.steps[s.step];
  const body = s.swapMode === "head"
    ? await call("/wavespeed-ai/video-head-swap", {
        method: "POST",
        body: JSON.stringify({ video, face_image: step.faceUrl, resolution: s.resolution ?? "720p" }),
      })
    : await call("/wavespeed-ai/video-face-swap", {
        method: "POST",
        body: JSON.stringify({
          video,
          face_image: step.faceUrl,
          target_index: step.targetIndex,
          target_gender: s.targetGender,
        }),
      });
  const id = body.data?.id;
  if (!id) throw new ProviderError("provider_bad_response", false, "missing data.id");
  return id;
}

function firstOutputUrl(outputs: unknown[] | undefined): string | null {
  const o = outputs?.[0];
  if (typeof o === "string") return o;
  if (o && typeof o === "object" && typeof (o as { url?: unknown }).url === "string") return (o as { url: string }).url;
  return null;
}

export const wavespeedProvider: GenerationProvider = {
  key: "wavespeed",

  capabilities() {
    return {
      videoFaceSwap: true,
      maxFaces: 10,                 // via chaining, one request per face
      qualities: ["standard"],      // the model has no quality parameter; output follows the input video
      supportsCancel: false,
      reportsProgress: true,        // step-based for multi-face templates
      reportsCost: true,            // when videoSeconds is configured
      producesRealVideo: true,
    };
  },

  validateInputs(input) {
    const problems: string[] = [];
    if (!/^https:\/\//.test(input.templateVideoUrl)) problems.push("template_video_not_public_https");
    if (!input.faces.length) problems.push("missing_faces");
    if (input.faces.length > 10) problems.push("too_many_faces");
    const cfg = configSchema.safeParse(input.config);
    if (!cfg.success) problems.push("invalid_provider_config");
    const map = cfg.success ? cfg.data.targetIndexBySlot : undefined;
    if (map && map.length !== input.faces.length) problems.push("target_index_count_mismatch");
    if (map && new Set(map).size !== map.length) problems.push("duplicate_target_index");
    if (cfg.success && cfg.data.swapMode === "head" && input.faces.length > 1) problems.push("head_swap_single_person_only");
    return problems;
  },

  async submit(input) {
    const cfg = configSchema.parse(input.config);
    const map = cfg.targetIndexBySlot ?? input.faces.map((_, i) => i);
    const costPerStep = wavespeedCostPerStep(cfg);
    const state: ChainState = {
      steps: input.faces.map((f, i) => ({ faceUrl: f.imageUrl, targetIndex: map[i] })),
      step: 0,
      targetGender: cfg.targetGender,
      swapMode: cfg.swapMode,
      resolution: cfg.resolution,
      costPerStep,
    };
    const id = await submitStep(input.templateVideoUrl, state);
    return { providerJobId: id, cost: costPerStep ?? undefined, state: state as unknown as ProviderState };
  },

  async getStatus(providerJobId, { state }): Promise<ProviderJobStatus> {
    const s = state as unknown as ChainState | null;
    if (!s?.steps?.length) return { state: "failed", errorCode: "provider_state_missing", retryable: false };
    const n = s.steps.length;
    const stepProgress = (k: number) => (n > 1 ? Math.round((k / n) * 100) : undefined);

    const body = await call(`/predictions/${encodeURIComponent(providerJobId)}/result`);
    const status = body.data?.status ?? "processing";

    if (TERMINAL_FAIL.has(status)) {
      console.error("[wavespeed] step failed", providerJobId, status, body.data?.error);
      return { state: "failed", errorCode: `provider_${status}`, retryable: false };
    }
    if (status !== "completed") return { state: "processing", progress: stepProgress(s.step) };

    const out = firstOutputUrl(body.data?.outputs);
    if (!out) return { state: "failed", errorCode: "provider_no_output", retryable: false };

    if (s.step + 1 < n) {
      // Chain: feed this step's output video into the next face swap.
      const nextState: ChainState = { ...s, step: s.step + 1 };
      const nextId = await submitStep(out, nextState);
      return {
        state: "processing",
        progress: stepProgress(nextState.step),
        next: { providerJobId: nextId, state: nextState as unknown as ProviderState, cost: s.costPerStep ?? undefined },
      };
    }
    return { state: "succeeded", outputUrl: out };
  },
};
