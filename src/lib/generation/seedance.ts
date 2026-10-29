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

/** Kling Motion Control: the person (face, hair, outfit) comes from the photo, the motion from the video. */
export function buildKlingPrompt(adminPrompt: string, wish: string): string {
  const parts = [
    "The person from the image performs exactly the same movements, dance, gestures and timing as in the reference video.",
    "Keep the person's face, facial features, hairstyle, skin tone and body exactly as in the image. Photorealistic, natural lighting, sharp face, no text, no watermark.",
  ];
  if (adminPrompt) parts.push(`Scene and style: ${adminPrompt}`);
  if (wish) parts.push(`Customer's wish: ${wish}`);
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
    if (cfg.data.mode === "swap") return problems; // face swap only: no Seedance length limits
    if ((cfg.data.mode === "kling" || cfg.data.mode === "wan") && input.faces.length > 1) problems.push("too_many_faces"); // one photo
    if (!(d > 0)) problems.push("unknown_duration");
    else if (d < SEEDANCE_MIN_SEC - 0.5 || d > SEEDANCE_MAX_SEC + 0.5) problems.push("bad_duration");
    return problems;
  },

  async submit(input) {
    const cfg = seedanceConfigSchema.parse(input.config ?? {});
    const extra = input.config as { durationSec?: number; wish?: unknown };
    const durationSec = Number(extra.durationSec);
    const pricing = await seedancePricingSettings();
    const faceUrls = input.faces.map((f) => f.imageUrl);
    if (cfg.mode === "wan") {
      // Wan 2.2 Animate "replace": template background/lighting stay, the person comes from the photo;
      // the face swap pass afterwards sharpens the likeness.
      const body = { image_url: faceUrls[0], video_url: input.templateVideoUrl, mode: "replace", resolution: "720p", prompt: cfg.prompt || "" };
      const d = await call<{ request_id?: string; id?: string }>("/api/v1/wan2.2-animate", { method: "POST", body: JSON.stringify(body) });
      const id = d.request_id ?? d.id;
      if (!id) throw new ProviderError("provider_bad_response", false, "wan: missing request_id");
      return { providerJobId: id, cost: seedanceCostUsd(durationSec, pricing, { mode: "wan" }), state: { stage: "wan", i: 0, faces: faceUrls } };
    }
    if (cfg.mode === "kling") {
      // Kling 3.0 Pro Motion Control builds the whole scene from its image. So first the customer is
      // put into the template's own frame (nano-banana-2-edit: frame + photo), then Kling animates
      // THAT image with the template's motion → template background, car, light; customer's look.
      const wish = cfg.allowWish ? cleanWish(extra.wish) : "";
      const prompt = buildKlingPrompt(cfg.prompt, wish);
      const cost = seedanceCostUsd(durationSec, pricing, { mode: "kling" });
      if (input.templateFrameUrl) {
        // No silent fallback: Kling with the customer's own photo gives their room as the scene,
        // so a failed compose stops the job before the expensive Kling step (only ~$0.06 spent).
        const id = await submitCompose(input.templateFrameUrl, faceUrls[0]);
        return { providerJobId: id, cost: pricing.composeUsd, state: { stage: "compose", i: 0, faces: [faceUrls[0]], video: input.templateVideoUrl, prompt, next_cost: cost - pricing.composeUsd } };
      }
      const id = await submitKling(faceUrls[0], input.templateVideoUrl, prompt);
      return { providerJobId: id, cost, state: { stage: "kling", i: 0, faces: [] } };
    }
    if (cfg.mode === "swap") {
      // Face swap only: the customer's face goes straight onto the template video.
      const id = await submitFaceSwap(input.templateVideoUrl, faceUrls[0], 0);
      return { providerJobId: id, cost: seedanceCostUsd(durationSec, pricing, { mode: "swap", people: 1 }), state: { stage: "swap", i: 0, faces: faceUrls } };
    }
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
    // Seedance does not keep a real person's face (ByteDance policy) → a face swap pass follows.
    const state = { stage: "seedance", faces: faceUrls };
    return { providerJobId: id, cost: seedanceCostUsd(durationSec, pricing, { mode: "scene", people: 1 }), state };
  },

  async getStatus(providerJobId, ctx): Promise<ProviderJobStatus> {
    const st = parseState(ctx?.state);
    const d = await call<{ status?: string; outputs?: unknown[]; video?: unknown; error?: unknown }>(`/api/v1/predictions/${encodeURIComponent(providerJobId)}/result`);
    const status = String(d.status ?? "").toLowerCase();
    // Kling step 1 (the customer put into the template frame) done or failed → step 2: Kling.
    if (st?.stage === "compose" && st.video && ["completed", "succeeded", "failed", "error", "cancelled"].includes(status)) {
      const img = status === "completed" || status === "succeeded" ? outputUrl(d) : undefined;
      if (!img) {
        console.error("[seedance] compose failed — Kling not started", providerJobId, status, JSON.stringify(d.error ?? d.outputs ?? "").slice(0, 300));
        return { state: "failed", errorCode: "provider_failed", retryable: false };
      }
      const id = await submitKling(img, st.video, st.prompt ?? buildKlingPrompt("", ""));
      return { state: "processing", next: { providerJobId: id, state: { stage: "kling", i: 0, faces: [] }, cost: st.next_cost ?? 0 } };
    }
    if (status === "completed" || status === "succeeded") {
      const url = outputUrl(d);
      if (!url) {
        if (st?.stage === "swap" && st.base) return swapFallback(providerJobId, st.base, "no_output");
        return { state: "failed", errorCode: "provider_no_output", retryable: false };
      }
      // Next face swap pass (one per person), then the finished video.
      if (st && st.faces.length) {
        const i = st.stage === "seedance" || st.stage === "wan" ? 0 : st.i + 1;
        if (i < st.faces.length) {
          try {
            const swapId = await submitFaceSwap(url, st.faces[i], i);
            return { state: "processing", next: { providerJobId: swapId, state: { stage: "swap", i, faces: st.faces, base: url }, cost: i === 0 ? 0 : (await seedancePricingSettings()).faceSwapUsd } };
          } catch (err) {
            console.error("[seedance] face swap submit failed", i, err instanceof Error ? err.message : err);
            return { state: "succeeded", outputUrl: url };
          }
        }
      }
      return { state: "succeeded", outputUrl: url };
    }
    if (status === "failed" || status === "error" || status === "cancelled") {
      const reason = JSON.stringify(d.error ?? "").slice(0, 300);
      if (st?.stage === "swap" && st.base) return swapFallback(providerJobId, st.base, reason);
      console.error("[seedance] task failed", providerJobId, reason);
      const content = st?.stage === "swap"
        ? /sensitive|policy|moderat|safety|nsfw|inappropriate/i.test(reason)
        : /sensitive|policy|moderat|safety|nsfw|real person|face|celebrit|inappropriate/i.test(reason);
      return { state: "failed", errorCode: content ? "provider_content_rejected" : "provider_failed", retryable: false };
    }
    return { state: status === "queued" || status === "pending" || status === "created" ? "queued" : "processing" };
  },
};


type SeedanceState = { stage: "seedance" | "swap" | "kling" | "wan" | "compose"; i: number; faces: string[]; base?: string; video?: string; prompt?: string; next_cost?: number };
function parseState(s: unknown): SeedanceState | null {
  if (!s || typeof s !== "object") return null;
  const o = s as Record<string, unknown>;
  if ((o.stage !== "seedance" && o.stage !== "swap" && o.stage !== "kling" && o.stage !== "wan" && o.stage !== "compose") || !Array.isArray(o.faces)) return null;
  return {
    stage: o.stage, i: Number(o.i) || 0,
    faces: o.faces.filter((x): x is string => typeof x === "string"),
    base: typeof o.base === "string" ? o.base : undefined,
    video: typeof o.video === "string" ? o.video : undefined,
    prompt: typeof o.prompt === "string" ? o.prompt : undefined,
    next_cost: typeof o.next_cost === "number" ? o.next_cost : undefined,
  };
}

function outputUrl(d: { outputs?: unknown[]; video?: unknown }): string | undefined {
  const isUrl = (x: unknown): x is string => typeof x === "string" && /^https?:\/\//.test(x);
  const fromVideo = typeof d.video === "object" && d.video ? (d.video as { url?: unknown }).url : d.video;
  return (d.outputs ?? []).find(isUrl) ?? (isUrl(fromVideo) ? fromVideo : undefined);
}

async function submitKling(imageUrl: string, videoUrl: string, prompt: string): Promise<string> {
  const d = await call<{ request_id?: string; id?: string }>("/api/v1/kling-v3.0-pro-motion-control", {
    method: "POST",
    body: JSON.stringify({ prompt, image_url: imageUrl, video_url: videoUrl, character_orientation: "video", keep_original_sound: true }),
  });
  const id = d.request_id ?? d.id;
  if (!id) throw new ProviderError("provider_bad_response", false, "kling: missing request_id");
  return id;
}

/** nano-banana-2-edit: the person from the customer's photo put into the template frame (same pose, scene, light). */
async function submitCompose(frameUrl: string, photoUrl: string): Promise<string> {
  const prompt = "Image 1 is a frame from a video, image 2 is a photo of a person. Replace the main person in image 1 with the person from image 2: " +
    "same face, facial features, hairstyle, skin tone and body as in image 2. Keep everything else from image 1 exactly: the pose, " +
    "position, size in the frame, clothing style of the scene, background, cars and objects, lighting, colors and camera angle. Photorealistic, sharp face.";
  const d = await call<{ request_id?: string; id?: string }>("/api/v1/nano-banana-2-edit", {
    method: "POST",
    body: JSON.stringify({ prompt, images_list: [frameUrl, photoUrl], resolution: "1k", output_format: "jpg" }),
  });
  const id = d.request_id ?? d.id;
  if (!id) throw new ProviderError("provider_bad_response", false, "compose: missing request_id");
  return id;
}

async function submitFaceSwap(videoUrl: string, faceUrl: string, targetIndex: number): Promise<string> {
  const d = await call<{ request_id?: string; id?: string }>("/api/v1/ai-video-face-swap", {
    method: "POST",
    body: JSON.stringify({ video_url: videoUrl, image_url: faceUrl, target_index: targetIndex, target_gender: "All" }),
  });
  const id = d.request_id ?? d.id;
  if (!id) throw new ProviderError("provider_bad_response", false, "face swap: missing request_id");
  return id;
}

/** A failed face swap must not lose the paid Seedance video: deliver it as is (logged for the admin). */
function swapFallback(id: string, base: string, reason: string): ProviderJobStatus {
  console.error("[seedance] face swap failed, delivering the Seedance video", id, reason.slice(0, 200));
  return { state: "succeeded", outputUrl: base };
}

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
