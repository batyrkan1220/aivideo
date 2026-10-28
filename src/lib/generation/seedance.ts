import "server-only";
import { env } from "@/lib/env";
import { seedanceConfigSchema, seedanceOutputSec, SEEDANCE_MAX_PEOPLE, SEEDANCE_MAX_SEC, SEEDANCE_MIN_SEC } from "@/lib/templates/seedance-config";
import { seedanceCostUsd } from "@/lib/pricing-seedance";
import { seedancePricingSettings } from "@/lib/pricing-seedance/settings";
import { ProviderError, type GenerationProvider, type ProviderJobStatus } from "./types";

/**
 * muapi.ai — Seedance 2.5 Omni Reference, international endpoint, 720p.
 * Docs: https://muapi.ai/playground/seedance-2.5-intl-omni-reference/api
 *
 *   POST /api/v1/<model>  { prompt, images_list[], videos_list[], resolution, duration, aspect_ratio, seed }
 *        → { request_id }
 *   GET  /api/v1/predictions/<request_id>/result → { status: …|"completed"|"failed", outputs[], error }
 *
 * Auth: `x-api-key`. Media are referenced in the prompt by position: @Image1…, @Video1.
 */

function key() {
  const k = env().MUAPI_API_KEY;
  if (!k) throw new ProviderError("provider_not_configured", false, "MUAPI_API_KEY is not set");
  return k;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${env().MUAPI_API_BASE_URL}${path}`, {
      ...init,
      headers: { "x-api-key": key(), "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
  } catch {
    throw new ProviderError("provider_unreachable", true); // not accepted → safe to retry
  }
  const body = (await res.json().catch(() => ({}))) as T & { detail?: unknown; error?: unknown; message?: unknown };
  if (!res.ok) {
    const detail = JSON.stringify(body?.detail ?? body?.error ?? body?.message ?? "").slice(0, 300);
    if (res.status === 401 || res.status === 403) throw new ProviderError("provider_auth", false, detail);
    if (res.status === 402) throw new ProviderError("provider_no_balance", false, detail);
    if (res.status === 429 || res.status >= 500) throw new ProviderError(`provider_http_${res.status}`, true, detail);
    throw new ProviderError("provider_bad_params", false, `${res.status} ${detail}`);
  }
  return body;
}

/** Text for Seedance: who replaces whom, what to keep, and the admin's / customer's wishes. */
export function buildPrompt(people: number, adminPrompt: string, wish: string): string {
  const refs = Array.from({ length: people }, (_, i) => `@Image${i + 1}`);
  const who = people === 1
    ? "Replace the person in @Video1 with the person from @Image1."
    : `Replace the people in @Video1 from left to right: ${refs.map((r, i) => `person ${i + 1} (counting from the left) with the person from ${r}`).join(", ")}.`;
  const parts = [
    who,
    "Keep exactly the motion, choreography, gestures, timing, camera movement and framing of @Video1.",
    `Each new person must look exactly like their photo (${refs.join(", ")}): same face and facial features, skin tone, hair, age and body type. Photorealistic, natural lighting, sharp details, no text, no watermark.`,
  ];
  if (adminPrompt) parts.push(`Scene, outfit and style: ${adminPrompt}`);
  else parts.push("Keep the background and atmosphere of @Video1.");
  if (wish) parts.push(`Customer's wish (follow it as long as the motion of @Video1 is kept): ${wish}`);
  return parts.join(" ");
}

/** Customer text is free input: no media tags, no control characters, limited length. */
export const cleanWish = (s: unknown) =>
  typeof s === "string" ? s.replace(/[@<>{}\[\]\\]/g, " ").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300) : "";

const imgIndex = (providerInput: string) => {
  const m = /^img_(\d+)$/.exec(providerInput);
  return m ? Number(m[1]) : null;
};

export const seedanceProvider: GenerationProvider = {
  key: "seedance",

  capabilities() {
    return {
      videoFaceSwap: true,
      maxFaces: SEEDANCE_MAX_PEOPLE,
      qualities: ["720p"],
      supportsCancel: false,
      reportsProgress: false,
      reportsCost: true,
      producesRealVideo: true,
    };
  },

  validateInputs(input) {
    const problems: string[] = [];
    const cfg = seedanceConfigSchema.safeParse(input.config ?? {});
    if (!cfg.success) return ["invalid_provider_config"];
    if (!input.templateVideoUrl) problems.push("missing_video");
    if (!input.faces.length) problems.push("missing_faces");
    if (input.faces.length > SEEDANCE_MAX_PEOPLE) problems.push("too_many_faces");
    const idx = input.faces.map((f) => imgIndex(f.providerInput));
    if (idx.some((x, i) => x !== i + 1)) problems.push("unmapped_slot");
    const d = Number((input.config as { durationSec?: unknown }).durationSec);
    if (!(d > 0)) problems.push("unknown_duration");
    else if (d < SEEDANCE_MIN_SEC - 0.5 || d > SEEDANCE_MAX_SEC + 0.5) problems.push("bad_duration");
    return problems;
  },

  async submit(input) {
    const cfg = seedanceConfigSchema.parse(input.config ?? {});
    const extra = input.config as { durationSec?: number; wish?: unknown };
    const durationSec = Number(extra.durationSec);
    const body = {
      prompt: buildPrompt(input.faces.length, cfg.prompt, cfg.allowWish ? cleanWish(extra.wish) : ""),
      images_list: input.faces.map((f) => f.imageUrl),
      videos_list: [input.templateVideoUrl],
      resolution: "720p",
      duration: seedanceOutputSec(durationSec),
      aspect_ratio: cfg.aspectRatio,
      seed: -1,
    };
    const d = await call<{ request_id?: string; id?: string }>(`/api/v1/${env().MUAPI_MODEL}`, { method: "POST", body: JSON.stringify(body) });
    const id = d.request_id ?? d.id;
    if (!id) throw new ProviderError("provider_bad_response", false, "missing request_id");
    return { providerJobId: id, cost: seedanceCostUsd(durationSec, await seedancePricingSettings()) };
  },

  async getStatus(providerJobId): Promise<ProviderJobStatus> {
    const d = await call<{ status?: string; outputs?: unknown[]; error?: unknown }>(`/api/v1/predictions/${encodeURIComponent(providerJobId)}/result`);
    const status = String(d.status ?? "").toLowerCase();
    if (status === "completed" || status === "succeeded") {
      const url = (d.outputs ?? []).find((x): x is string => typeof x === "string" && /^https?:\/\//.test(x));
      if (!url) return { state: "failed", errorCode: "provider_no_output", retryable: false };
      return { state: "succeeded", outputUrl: url };
    }
    if (status === "failed" || status === "error" || status === "cancelled") {
      const reason = JSON.stringify(d.error ?? "").slice(0, 300);
      console.error("[seedance] task failed", providerJobId, reason);
      const content = /sensitive|policy|moderat|safety|nsfw|real person|face|celebrit|inappropriate/i.test(reason);
      return { state: "failed", errorCode: content ? "provider_content_rejected" : "provider_failed", retryable: false };
    }
    return { state: status === "queued" || status === "pending" || status === "created" ? "queued" : "processing" };
  },
};

/** Admin check: is the muapi key accepted, and what is the account balance (USD)? Never returns the key. */
export async function muapiStatus(): Promise<{ state: "none" | "ok" | "auth" | "error"; balance?: number }> {
  const k = env().MUAPI_API_KEY;
  if (!k) return { state: "none" };
  try {
    const res = await fetch(`${env().MUAPI_API_BASE_URL}/api/v1/account/balance`, {
      headers: { "x-api-key": k }, signal: AbortSignal.timeout(8_000), cache: "no-store",
    });
    if (res.status === 401 || res.status === 403) return { state: "auth" };
    if (!res.ok) return { state: "error" };
    const b = Number(((await res.json().catch(() => ({}))) as { balance?: unknown }).balance);
    return { state: "ok", balance: Number.isFinite(b) ? b : undefined };
  } catch {
    return { state: "error" };
  }
}
