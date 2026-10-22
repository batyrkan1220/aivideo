import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";
import { ProviderError, type GenerationProvider, type ProviderJobStatus } from "./types";

/**
 * WaveSpeed AI — model `wavespeed-ai/video-head-swap`
 * Docs: https://wavespeed.ai/models/wavespeed-ai/video-head-swap
 *
 * Replaces the whole head (face, hair, outline) of the person in the template video with the
 * person from the uploaded photo. The API has no way to choose WHICH person in the video is
 * replaced, so this provider supports single-person templates only.
 *
 * Template provider config: { "resolution": "720p" | "480p", "videoSeconds": 19 }
 * Pricing per docs: $0.04/s (480p), $0.08/s (720p), minimum 3 s, max 120 s.
 */

const configSchema = z.object({
  resolution: z.enum(["480p", "720p"]).default("720p"),
  videoSeconds: z.number().positive().max(600).optional(),
});

export function wavespeedCost(cfg: { videoSeconds?: number; resolution?: string }) {
  if (!cfg.videoSeconds) return null;
  const sec = Math.min(120, Math.max(3, Math.ceil(cfg.videoSeconds)));
  const rate = cfg.resolution === "480p" ? 0.04 : 0.08;
  return Math.round(sec * rate * 100) / 100;
}

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
    // WaveSpeed reports an empty balance as 400 "Insufficient credits…", not only 402.
    const noBalance = res.status === 402 || /insufficient (credit|balance)|top up/i.test(JSON.stringify(body));
    // 429/5xx: not accepted, safe to retry. Other 4xx (bad input, auth, no balance): don't retry.
    const retryable = !noBalance && (res.status === 429 || res.status >= 500);
    const code = noBalance ? "provider_no_balance"
      : res.status === 401 || res.status === 403 ? "provider_auth" : `provider_http_${res.status}`;
    throw new ProviderError(code, retryable, JSON.stringify(body).slice(0, 300));
  }
  return body as { data?: { id?: string; status?: string; outputs?: unknown[]; error?: string } };
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
      maxFaces: 1,
      qualities: ["standard"],
      supportsCancel: false,
      reportsProgress: false,
      reportsCost: true,            // when videoSeconds is configured
      producesRealVideo: true,
    };
  },

  validateInputs(input) {
    const problems: string[] = [];
    if (!/^https:\/\//.test(input.templateVideoUrl)) problems.push("template_video_not_public_https");
    if (!input.faces.length) problems.push("missing_faces");
    if (input.faces.length > 1) problems.push("head_swap_single_person_only");
    if (!configSchema.safeParse(input.config ?? {}).success) problems.push("invalid_provider_config");
    return problems;
  },

  async submit(input) {
    const cfg = configSchema.parse(input.config ?? {});
    const body = await call("/wavespeed-ai/video-head-swap", {
      method: "POST",
      body: JSON.stringify({ video: input.templateVideoUrl, face_image: input.faces[0].imageUrl, resolution: cfg.resolution }),
    });
    const id = body.data?.id;
    if (!id) throw new ProviderError("provider_bad_response", false, "missing data.id");
    return { providerJobId: id, cost: wavespeedCost(cfg) ?? undefined };
  },

  async getStatus(providerJobId): Promise<ProviderJobStatus> {
    const body = await call(`/predictions/${encodeURIComponent(providerJobId)}/result`);
    const status = body.data?.status ?? "processing";
    if (TERMINAL_FAIL.has(status)) {
      console.error("[wavespeed] failed", providerJobId, status, body.data?.error);
      return { state: "failed", errorCode: `provider_${status}`, retryable: false };
    }
    if (status !== "completed") return { state: "processing" };
    const out = firstOutputUrl(body.data?.outputs);
    if (!out) return { state: "failed", errorCode: "provider_no_output", retryable: false };
    return { state: "succeeded", outputUrl: out };
  },
};
