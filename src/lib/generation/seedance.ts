import "server-only";
import { env } from "@/lib/env";
import { seedanceConfigSchema, seedanceOutputSec, SEEDANCE_MAX_PEOPLE, SEEDANCE_MAX_SEC, SEEDANCE_MIN_SEC, maxSecFor } from "@/lib/templates/seedance-config";
import { seedanceCostUsd, faceSwapCostUsd } from "@/lib/pricing-seedance";
import { seedancePricingSettings } from "@/lib/pricing-seedance/settings";
import { ProviderError, type GenerationProvider, type ProviderJobStatus } from "./types";
import { buildReplacePrompt, getPvr, submitPvr } from "./replicate";

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

/** muapi ai-video-face-swap accepts ≤ 600 frames: about 24 s at 25 fps. */
export const FACE_SWAP_MAX_SEC = 24;

/** Kling 4.0 reference-to-video: who (photo), where (template frame), how (template video). */
export function buildK4Prompt(withFrame: boolean, adminPrompt: string, wish: string, outfit: "photo" | "template" = "photo"): string {
  const parts = [
    "Recreate @video_1 shot by shot: exactly the same motion, actions, timing, camera movement, framing and cuts.",
    "The main person is the person from @image_1: keep exactly the same face, facial features, hairstyle, skin tone, age and body as in @image_1.",
    outfit === "template"
      ? "The person wears exactly the same outfit as the main person in @video_1 (same clothes, colors, shoes and accessories)."
      : "The person wears the same clothes as in @image_1.",
    withFrame ? "Use the same location, background, objects and lighting as in @video_1 and @image_2." : "Use the same location, background, objects and lighting as in @video_1.",
    "Photorealistic, natural, sharp face, no text, no watermark.",
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
    if (cfg.data.mode === "pvr" && input.faces.length > 3) problems.push("too_many_faces");
    if ((cfg.data.mode === "kling" || cfg.data.mode === "k4") && input.faces.length > 1) problems.push("too_many_faces"); // one photo
    if (!(d > 0)) problems.push("unknown_duration");
    else if (d < SEEDANCE_MIN_SEC - 0.5 || d > maxSecFor(cfg.data.mode) + 0.5) problems.push("bad_duration");
    return problems;
  },

  async submit(input) {
    const cfg = seedanceConfigSchema.parse(input.config ?? {});
    const extra = input.config as { durationSec?: number; wish?: unknown };
    const durationSec = Number(extra.durationSec);
    const pricing = await seedancePricingSettings();
    const faceUrls = input.faces.map((f) => f.imageUrl);
    if (cfg.mode === "k4") {
      // Kling 4.0 reference-to-video: template video = motion, camera and cuts (@video_1); customer
      // photo = the person (@image_1); template frame = location (@image_2). Then a face swap pass.
      const images = [faceUrls[0], ...(input.templateFrameUrl ? [input.templateFrameUrl] : [])];
      const body = {
        prompt: buildK4Prompt(!!input.templateFrameUrl, cfg.prompt, cfg.allowWish ? cleanWish(extra.wish) : "", cfg.outfit),
        // muapi field names for this model are not documented: send the known spellings (extra keys are ignored).
        images_list: images,
        image_urls: images,
        video_url: input.templateVideoUrl,
        videos_list: [input.templateVideoUrl],
        video_urls: [input.templateVideoUrl],
        duration: seedanceOutputSec(durationSec),
        resolution: "720p",
        aspect_ratio: cfg.aspectRatio === "adaptive" ? "auto" : cfg.aspectRatio,
        keep_original_sound: true,
      };
      const d = await call<{ request_id?: string; id?: string }>("/api/v1/kling-4.0-reference-to-video", { method: "POST", body: JSON.stringify(body) });
      const id = d.request_id ?? d.id;
      if (!id) throw new ProviderError("provider_bad_response", false, "kling4: missing request_id");
      // The face swap takes ≤ 600 frames (~24 s): longer videos are delivered as Kling made them.
      const swap = durationSec <= FACE_SWAP_MAX_SEC;
      const cost = seedanceCostUsd(durationSec, pricing, { mode: "k4", people: 1 });
      return { providerJobId: id, cost, state: { stage: "wan", i: 0, faces: swap ? faceUrls.slice(0, 1) : [], swap_cost: faceSwapCostUsd(durationSec, pricing) } };
    }
    if (cfg.mode === "pvr") {
      // Replicate p-video-replace: all people replaced in one run (photo i → person at positions[i]).
      const n = Math.min(3, faceUrls.length);
      const id = await submitPvr(input.templateVideoUrl, faceUrls.slice(0, n), buildReplacePrompt(cfg.positions, n));
      return { providerJobId: id, cost: seedanceCostUsd(durationSec, pricing, { mode: "pvr" }), state: { stage: "pvr", i: 0, faces: [] } };
    }
    if (cfg.mode === "wan") {
      // Wan 2.2 Animate "replace": template background/lighting stay, the person comes from the photo;
      // the face swap pass afterwards sharpens the likeness.
      const wanCost = seedanceCostUsd(durationSec, pricing, { mode: "wan", prepare: false });
      const wanState = { stage: "wan", i: 0, faces: faceUrls, swap_cost: faceSwapCostUsd(durationSec, pricing) };
      if (cfg.prepare) {
        // Step 0: Nano Banana Pro → a clean full-body image of the customer (face kept; outfit: own or template's).
        const frame = cfg.outfit === "template" ? input.templateFrameUrl ?? null : null;
        try {
          const id = await submitPrep(faceUrls[0], frame);
          return { providerJobId: id, cost: pricing.prepUsd, state: { stage: "prep", i: 0, faces: faceUrls, video: input.templateVideoUrl, prompt: cfg.prompt, next_cost: wanCost, swap_cost: wanState.swap_cost } };
        } catch (err) {
          console.error("[seedance] prep submit failed, Wan with the photo", err instanceof ProviderError ? `${err.code} ${err.message}` : err);
        }
      }
      const id = await submitWan(faceUrls[0], input.templateVideoUrl, cfg.prompt);
      return { providerJobId: id, cost: wanCost, state: wanState };
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
        // so a failed compose stops the job before the expensive Kling step (only the cheap image step is spent).
        const id = await submitCompose(input.templateFrameUrl, faceUrls[0]);
        return { providerJobId: id, cost: pricing.composeUsd, state: { stage: "compose", i: 0, faces: [faceUrls[0]], video: input.templateVideoUrl, prompt, next_cost: cost - pricing.composeUsd } };
      }
      const id = await submitKling(faceUrls[0], input.templateVideoUrl, prompt);
      return { providerJobId: id, cost, state: { stage: "kling", i: 0, faces: [] } };
    }
    if (cfg.mode === "swap") {
      // Face swap only: the customer's face goes straight onto the template video.
      const id = await submitFaceSwap(input.templateVideoUrl, faceUrls[0], 0);
      return { providerJobId: id, cost: seedanceCostUsd(durationSec, pricing, { mode: "swap", people: 1 }), state: { stage: "swap", i: 0, faces: faceUrls, swap_cost: faceSwapCostUsd(durationSec, pricing) } };
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
    const state = { stage: "seedance", faces: faceUrls, swap_cost: faceSwapCostUsd(durationSec, pricing) };
    return { providerJobId: id, cost: seedanceCostUsd(durationSec, pricing, { mode: "scene", people: 1 }), state };
  },

  async getStatus(providerJobId, ctx): Promise<ProviderJobStatus> {
    const st = parseState(ctx?.state);
    if (st?.stage === "pvr") return getPvr(providerJobId);
    let d: { status?: string; outputs?: unknown[]; video?: unknown; error?: unknown };
    try {
      d = await call<typeof d>(`/api/v1/predictions/${encodeURIComponent(providerJobId)}/result`);
    } catch (err) {
      // muapi answers a failed task with HTTP 400 + its error: that is a final failure, not "retry polling".
      if (err instanceof ProviderError && err.code === "provider_bad_params") {
        console.error("[seedance] task failed (400)", providerJobId, err.message.slice(0, 300));
        if (st?.stage === "swap" && st.base) return swapFallback(providerJobId, st.base, err.message);
        return { state: "failed", errorCode: "provider_failed", retryable: false };
      }
      throw err;
    }
    const status = String(d.status ?? "").toLowerCase();
    // Wan step 0 (full-body image) done or failed → Wan with that image (or the photo itself).
    if (st?.stage === "prep" && st.video && ["completed", "succeeded", "failed", "error", "cancelled"].includes(status)) {
      const img = status === "completed" || status === "succeeded" ? outputUrl(d) : undefined;
      if (!img) console.error("[seedance] prep failed, Wan with the photo", providerJobId, status, JSON.stringify(d.error ?? "").slice(0, 200));
      const id = await submitWan(img ?? st.faces[0], st.video, st.prompt ?? "");
      return { state: "processing", next: { providerJobId: id, state: { stage: "wan", i: 0, faces: st.faces, swap_cost: st.swap_cost }, cost: st.next_cost ?? 0 } };
    }
    // Kling step 1 (the customer put into the template frame) done or failed → step 2: Kling.
    if (st?.stage === "compose" && st.video && ["completed", "succeeded", "failed", "error", "cancelled"].includes(status)) {
      const img = status === "completed" || status === "succeeded" ? outputUrl(d) : undefined;
      if (!img) {
        console.error("[seedance] compose failed — Kling not started", providerJobId, status, JSON.stringify(d.error ?? d.outputs ?? "").slice(0, 300));
        return { state: "failed", errorCode: "provider_failed", retryable: false };
      }
      // Step 2: the exact face from the customer's photo onto the composed frame (image face swap).
      try {
        const fixId = await submitImageFaceSwap(img, st.faces[0]);
        return { state: "processing", next: { providerJobId: fixId, state: { ...st, stage: "facefix", base: img }, cost: 0 } };
      } catch (err) {
        console.error("[seedance] image face swap submit failed, Kling with the composed frame", err instanceof Error ? err.message : err);
      }
      const id = await submitKling(img, st.video, st.prompt ?? buildKlingPrompt("", ""));
      return { state: "processing", next: { providerJobId: id, state: { stage: "kling", i: 0, faces: [] }, cost: st.next_cost ?? 0 } };
    }
    // Step 3: Kling animates the frame (face fixed; if the fix failed, the composed frame as is).
    if (st?.stage === "facefix" && st.video && st.base && ["completed", "succeeded", "failed", "error", "cancelled"].includes(status)) {
      const fixed = status === "completed" || status === "succeeded" ? outputUrl(d) : undefined;
      if (!fixed) console.error("[seedance] image face swap failed, Kling with the composed frame", providerJobId, JSON.stringify(d.error ?? "").slice(0, 200));
      const id = await submitKling(fixed ?? st.base, st.video, st.prompt ?? buildKlingPrompt("", ""));
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
            return { state: "processing", next: { providerJobId: swapId, state: { stage: "swap", i, faces: st.faces, base: url, swap_cost: st.swap_cost }, cost: i === 0 ? 0 : st.swap_cost ?? 0 } };
          } catch (err) {
            console.error("[seedance] face swap submit failed", i, err instanceof ProviderError ? `${err.code} ${err.message}` : err instanceof Error ? err.message : err);
            // Busy / rate limit / server error: the worker polls again in 30 s and resubmits this pass.
            // Only "busy" (429) is worth waiting for; a 5xx on a finished video means the face swap
            // cannot take it (too long / too big) — deliver the video without it.
            const fresh = !ctx?.startedAt || Date.now() - ctx.startedAt.getTime() < 30 * 60_000;
            if (err instanceof ProviderError && err.code === "provider_http_429" && fresh) throw err;
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


type SeedanceState = { stage: "seedance" | "swap" | "kling" | "wan" | "compose" | "facefix" | "prep" | "pvr"; i: number; faces: string[]; base?: string; video?: string; prompt?: string; next_cost?: number; swap_cost?: number };
function parseState(s: unknown): SeedanceState | null {
  if (!s || typeof s !== "object") return null;
  const o = s as Record<string, unknown>;
  if ((o.stage !== "seedance" && o.stage !== "swap" && o.stage !== "kling" && o.stage !== "wan" && o.stage !== "compose" && o.stage !== "facefix" && o.stage !== "prep" && o.stage !== "pvr") || !Array.isArray(o.faces)) return null;
  return {
    stage: o.stage, i: Number(o.i) || 0,
    faces: o.faces.filter((x): x is string => typeof x === "string"),
    base: typeof o.base === "string" ? o.base : undefined,
    video: typeof o.video === "string" ? o.video : undefined,
    prompt: typeof o.prompt === "string" ? o.prompt : undefined,
    next_cost: typeof o.next_cost === "number" ? o.next_cost : undefined,
    swap_cost: typeof o.swap_cost === "number" ? o.swap_cost : undefined,
  };
}

function outputUrl(d: { outputs?: unknown[]; video?: unknown }): string | undefined {
  const isUrl = (x: unknown): x is string => typeof x === "string" && /^https?:\/\//.test(x);
  const fromVideo = typeof d.video === "object" && d.video ? (d.video as { url?: unknown }).url : d.video;
  return (d.outputs ?? []).find(isUrl) ?? (isUrl(fromVideo) ? fromVideo : undefined);
}

async function submitWan(imageUrl: string, videoUrl: string, prompt: string): Promise<string> {
  const d = await call<{ request_id?: string; id?: string }>("/api/v1/wan2.2-animate", {
    method: "POST",
    body: JSON.stringify({ image_url: imageUrl, video_url: videoUrl, mode: "replace", resolution: "720p", prompt: prompt || "" }),
  });
  const id = d.request_id ?? d.id;
  if (!id) throw new ProviderError("provider_bad_response", false, "wan: missing request_id");
  return id;
}

/** Nano Banana Pro: a clean full-body image of the customer for Wan (face kept; outfit own or the template's). */
async function submitPrep(photoUrl: string, templateFrameUrl: string | null): Promise<string> {
  const base = "Create one photorealistic full-body photo of the person from image 1, from head to feet, front view, natural standing pose, " +
    "plain light background, soft even light. Keep exactly the same face, facial features, eyes, nose, mouth, skin tone, hairstyle, age and body proportions as in image 1. Sharp face, no text.";
  const prompt = templateFrameUrl
    ? `${base} Dress the person exactly in the outfit of the main person in image 2: same clothes, colors, shoes and accessories. Do not copy the face or the background of image 2.`
    : `${base} Keep the same clothes as in image 1; if part of the outfit is not visible, complete it naturally in the same style.`;
  const d = await call<{ request_id?: string; id?: string }>("/api/v1/nano-banana-pro-edit", {
    method: "POST",
    body: JSON.stringify({ prompt, images_list: templateFrameUrl ? [photoUrl, templateFrameUrl] : [photoUrl], resolution: "2k", output_format: "jpg" }),
  });
  const id = d.request_id ?? d.id;
  if (!id) throw new ProviderError("provider_bad_response", false, "prep: missing request_id");
  return id;
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
  // Nano Banana Pro keeps a person's identity best among the editors; 2k for a sharp face.
  const d = await call<{ request_id?: string; id?: string }>("/api/v1/nano-banana-pro-edit", {
    method: "POST",
    body: JSON.stringify({ prompt, images_list: [frameUrl, photoUrl], resolution: "2k", output_format: "jpg" }),
  });
  const id = d.request_id ?? d.id;
  if (!id) throw new ProviderError("provider_bad_response", false, "compose: missing request_id");
  return id;
}

/** ai-image-face-swap: the face from the customer's photo onto the largest face of the image. */
async function submitImageFaceSwap(imageUrl: string, faceUrl: string): Promise<string> {
  const d = await call<{ request_id?: string; id?: string }>("/api/v1/ai-image-face-swap", {
    method: "POST",
    body: JSON.stringify({ image_url: imageUrl, swap_url: faceUrl, target_index: 0 }),
  });
  const id = d.request_id ?? d.id;
  if (!id) throw new ProviderError("provider_bad_response", false, "image face swap: missing request_id");
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
