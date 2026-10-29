import "server-only";
import { env } from "@/lib/env";
import { ProviderError, type ProviderJobStatus } from "./types";

/**
 * Replicate — prunaai/p-video-replace: replaces up to 3 people of a video with reference photos,
 * keeping the scene, motion, camera and sound. $0.03 per output second at 720p.
 *   POST /v1/models/prunaai/p-video-replace/predictions { input: { video, images[], instruction_prompt, resolution, save_audio } }
 *   GET  /v1/predictions/<id> → { status: starting|processing|succeeded|failed|canceled, output, error }
 */
const BASE = "https://api.replicate.com/v1";

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = env().REPLICATE_API_TOKEN;
  if (!token) throw new ProviderError("provider_not_configured", false, "REPLICATE_API_TOKEN is not set");
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
  } catch {
    throw new ProviderError("provider_unreachable", true);
  }
  const body = (await res.json().catch(() => ({}))) as T & { detail?: unknown; title?: unknown };
  if (!res.ok) {
    const detail = JSON.stringify(body?.detail ?? body?.title ?? "").slice(0, 300);
    if (res.status === 401 || res.status === 403) throw new ProviderError("provider_auth", false, detail);
    if (res.status === 402) throw new ProviderError("provider_no_balance", false, detail);
    if (res.status === 429 || res.status >= 500) throw new ProviderError(`provider_http_${res.status}`, true, detail);
    throw new ProviderError("provider_bad_params", false, `${res.status} ${detail}`);
  }
  return body;
}

/** Instruction: which reference photo replaces which person (by position in the frame). */
export function buildReplacePrompt(positions: string[], n: number): string {
  if (n === 1) return "Replace the main person in the video with the person from reference image 1. Keep the face, facial features, hairstyle and skin tone of reference image 1 exactly. Keep the motion, scene, camera and everything else unchanged.";
  const parts = Array.from({ length: n }, (_, i) => `the person ${positions[i]?.trim() || `number ${i + 1} from the left`} with the person from reference image ${i + 1}`);
  return `Replace ${parts.join(", and ")}. Each new person keeps exactly the face, facial features, hairstyle and skin tone of their reference image. Keep the motion, scene, camera and everything else unchanged.`;
}

export async function submitPvr(videoUrl: string, images: string[], prompt: string): Promise<string> {
  const d = await call<{ id?: string }>("/models/prunaai/p-video-replace/predictions", {
    method: "POST",
    body: JSON.stringify({ input: { video: videoUrl, images: images.slice(0, 3), instruction_prompt: prompt, resolution: "720p", save_audio: true } }),
  });
  if (!d.id) throw new ProviderError("provider_bad_response", false, "replicate: missing id");
  return d.id;
}

export async function getPvr(id: string): Promise<ProviderJobStatus> {
  const d = await call<{ status?: string; output?: unknown; error?: unknown }>(`/predictions/${encodeURIComponent(id)}`);
  const status = String(d.status ?? "");
  if (status === "succeeded" || status === "successful") {
    const out = Array.isArray(d.output) ? d.output.find((x) => typeof x === "string") : d.output;
    if (typeof out !== "string" || !/^https?:\/\//.test(out)) return { state: "failed", errorCode: "provider_no_output", retryable: false };
    return { state: "succeeded", outputUrl: out };
  }
  if (status === "failed" || status === "canceled") {
    const reason = JSON.stringify(d.error ?? "").slice(0, 300);
    console.error("[replicate] p-video-replace failed", id, reason);
    const content = /sensitive|policy|moderat|safety|nsfw|inappropriate/i.test(reason);
    return { state: "failed", errorCode: content ? "provider_content_rejected" : "provider_failed", retryable: false };
  }
  return { state: status === "starting" ? "queued" : "processing" };
}
