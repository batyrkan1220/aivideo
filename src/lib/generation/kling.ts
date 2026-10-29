import "server-only";
import { env } from "@/lib/env";
import { ProviderError, type ProviderJobStatus } from "./types";

/**
 * Kling AI official API (api-singapore.klingai.com), Kling 4.0 Omni video. Auth: `Bearer <API key>`.
 *   POST /omni-video/kling-4.0 { contents: [{type: prompt|refer_image|base_video|feature_video, url, id}], settings }
 *        → { code: 0, data: { id, status } }
 *   GET  /tasks?task_ids=<id> → { code: 0, data: [{ status: submitted|processing|succeeded|failed, message, outputs: [{type: video, url}] }] }
 * Docs: https://kling.ai/document-api/api/video/4-0/video-omni
 */
const BASE = "https://api-singapore.klingai.com";

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = env().KLING_API_KEY;
  if (!key) throw new ProviderError("provider_not_configured", false, "KLING_API_KEY is not set");
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
  } catch {
    throw new ProviderError("provider_unreachable", true);
  }
  const body = (await res.json().catch(() => ({}))) as T & { code?: number; message?: string };
  const msg = String(body?.message ?? "").slice(0, 300);
  if (res.status === 401 || res.status === 403) throw new ProviderError("provider_auth", false, msg);
  if (res.status === 429) throw new ProviderError("provider_http_429", true, msg);
  if (res.status >= 500) throw new ProviderError(`provider_http_${res.status}`, true, msg);
  if (!res.ok || (body.code !== undefined && body.code !== 0)) {
    if (/balance|insufficient|package|quota|arrear/i.test(msg)) throw new ProviderError("provider_no_balance", false, `${body.code} ${msg}`);
    throw new ProviderError("provider_bad_params", false, `${res.status} ${body.code} ${msg}`);
  }
  return body;
}

export type KlingMode = "edit" | "reference";

/** Edit = the template video itself is edited (scene 1:1); reference = a new video following its motion. */
export function buildKlingDirectPrompt(mode: KlingMode, outfit: "photo" | "template", adminPrompt: string, wish: string): string {
  const look = outfit === "template"
    ? "Keep the clothing of the original person in @video_1."
    : "Use the clothing of the person in @image_1.";
  const parts = mode === "edit"
    ? [
        "Edit @video_1: replace the main person with the person from @image_1.",
        "Preserve the person's facial features, face shape, eyes, nose, mouth, hairstyle, skin tone, age and body from @image_1 exactly.",
        look,
        "Keep everything else in @video_1 unchanged: background, location, other people, objects, lighting, camera movement, framing, cuts, motion, timing and sound.",
      ]
    : [
        "Follow the motion, actions, timing, camera movement, framing and cuts of @video_1, and recreate its location, background and lighting.",
        "The main person is the person from @image_1: preserve the facial features, face shape, hairstyle, skin tone, age and body from @image_1 exactly.",
        look,
      ];
  parts.push("Photorealistic, natural, sharp face, no text, no watermark.");
  if (adminPrompt) parts.push(`Scene and style: ${adminPrompt}`);
  if (wish) parts.push(`Customer's wish: ${wish}`);
  return parts.join(" ");
}

export async function submitKlingOmni(opts: { videoUrl: string; photoUrl: string; mode: KlingMode; prompt: string; durationSec: number; aspectRatio: string }): Promise<string> {
  const duration = Math.min(30, Math.max(3, Math.round(opts.durationSec)));
  const d = await call<{ data?: { id?: string } }>("/omni-video/kling-4.0", {
    method: "POST",
    body: JSON.stringify({
      contents: [
        { type: "prompt", text: opts.prompt },
        { type: opts.mode === "edit" ? "base_video" : "feature_video", url: opts.videoUrl, id: "video_1" },
        { type: "refer_image", url: opts.photoUrl, id: "image_1" },
      ],
      settings: { resolution: "720p", duration, aspect_ratio: ["16:9", "9:16", "1:1", "21:9"].includes(opts.aspectRatio) ? opts.aspectRatio : "adaptive" },
    }),
  });
  const id = d.data?.id;
  if (!id) throw new ProviderError("provider_bad_response", false, "kling: missing task id");
  return id;
}

export async function getKlingTask(id: string): Promise<ProviderJobStatus & { videoUrl?: string }> {
  const d = await call<{ data?: { status?: string; message?: string; outputs?: { type?: string; url?: string }[] }[] }>(`/tasks?task_ids=${encodeURIComponent(id)}`);
  const t = d.data?.[0];
  const status = String(t?.status ?? "");
  if (status === "succeeded") {
    const url = t?.outputs?.find((o) => o.type === "video" && typeof o.url === "string")?.url;
    if (!url) return { state: "failed", errorCode: "provider_no_output", retryable: false };
    return { state: "succeeded", outputUrl: url };
  }
  if (status === "failed") {
    const reason = String(t?.message ?? "").slice(0, 300);
    console.error("[kling] task failed", id, reason);
    const content = /risk|sensitive|policy|moderat|safety|inappropriate|violat/i.test(reason);
    return { state: "failed", errorCode: content ? "provider_content_rejected" : "provider_failed", retryable: false };
  }
  return { state: status === "submitted" ? "queued" : "processing" };
}
