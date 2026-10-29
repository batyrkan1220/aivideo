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
export function buildKlingDirectPrompt(mode: KlingMode, outfit: "photo" | "template", adminPrompt: string, wish: string, people = 1, positions: string[] = []): string {
  const refs = Array.from({ length: people }, (_, i) => `@image_${i + 1}`);
  const look = outfit === "template"
    ? "Keep the clothing of the original people in @video_1."
    : `Use the clothing of the people in ${refs.join(", ")}.`;
  const who = people === 1
    ? "replace the main person with the person from @image_1."
    : `replace ${refs.map((r, i) => `the person ${positions[i]?.trim() || `number ${i + 1} from the left`} with the person from ${r}`).join(", and ")}.`;
  const same = `Each new person must look 100% identical to their reference image (${refs.join(", ")}) in every frame: preserve the facial features, face shape, eyes, eyebrows, nose, mouth, teeth, ears, moles, hairstyle, hair color, skin tone, age and body proportions exactly. Do not beautify, stylize or change the faces.`;
  const parts = mode === "edit"
    ? [
        `Edit @video_1: ${who}`,
        same,
        look,
        "Keep everything else in @video_1 unchanged: background, location, other people, objects, lighting, camera movement, framing, cuts, motion, timing and sound.",
      ]
    : [
        "Follow the motion, actions, timing, camera movement, framing and cuts of @video_1, and recreate its location, background and lighting.",
        `In the new video, ${who.replace(/\.$/, "")}.`,
        same,
        look,
      ];
  parts.push("Photorealistic, natural, sharp face, no text, no watermark.");
  if (adminPrompt) parts.push(`Scene and style: ${adminPrompt}`);
  if (wish) parts.push(`Customer's wish: ${wish}`);
  return parts.join(" ");
}

export async function submitKlingOmni(opts: { videoUrl: string; photoUrls: string[]; mode: KlingMode; prompt: string; durationSec: number; aspectRatio: string }): Promise<string> {
  const duration = Math.min(30, Math.max(3, Math.round(opts.durationSec)));
  const d = await call<{ data?: { id?: string } }>("/omni-video/kling-4.0", {
    method: "POST",
    body: JSON.stringify({
      contents: [
        { type: "prompt", text: opts.prompt },
        { type: opts.mode === "edit" ? "base_video" : "feature_video", url: opts.videoUrl, id: "video_1" },
        ...opts.photoUrls.slice(0, 5).map((url, i) => ({ type: "refer_image", url, id: `image_${i + 1}` })),
      ],
      // Vertical 720p for phones unless the template asks for another format.
      settings: { resolution: "720p", duration, aspect_ratio: ["16:9", "1:1", "21:9"].includes(opts.aspectRatio) ? opts.aspectRatio : "9:16" },
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

export type KlingStatus = { state: "none" | "ok" | "auth" | "error"; packs?: { name: string; remaining: number; total: number; for40: boolean }[] };

/** Admin check: key accepted + active resource packs (does one cover Kling 4.0?). Never returns the key. */
export async function klingStatus(): Promise<KlingStatus> {
  if (!env().KLING_API_KEY) return { state: "none" };
  try {
    const now = Date.now();
    const d = await call<{ data?: { resource_pack_subscribe_infos?: { resource_pack_name?: string; resource_pack_tier?: string; resource_pack_applicable_models?: string; total_quantity?: number; remaining_quantity?: number; status?: string }[] } }>(
      `/account/costs?start_time=${now - 365 * 86400_000}&end_time=${now}`);
    const packs = (d.data?.resource_pack_subscribe_infos ?? []).filter((p) => p.status === "online").map((p) => ({
      name: String(p.resource_pack_name ?? ""),
      remaining: Number(p.remaining_quantity) || 0,
      total: Number(p.total_quantity) || 0,
      for40: p.resource_pack_tier === "flagship" || /4\.0/.test(String(p.resource_pack_applicable_models ?? "")),
    }));
    return { state: "ok", packs };
  } catch (err) {
    return { state: err instanceof ProviderError && err.code === "provider_auth" ? "auth" : "error" };
  }
}
