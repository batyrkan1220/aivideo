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

async function call<T>(path: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<T> {
  const key = env().KLING_API_KEY;
  if (!key) throw new ProviderError("provider_not_configured", false, "KLING_API_KEY is not set");
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch {
    throw new ProviderError("provider_unreachable", true);
  }
  const body = (await res.json().catch(() => ({}))) as T & { code?: number; message?: string };
  const msg = String(body?.message ?? "").slice(0, 300);
  const serviceCode = Number(body.code);
  const detail = `${res.status} ${Number.isFinite(serviceCode) ? serviceCode : ""} ${msg}`.replace(/\s+/g, " ").trim();
  if (res.status === 401 || res.status === 403) throw new ProviderError("provider_auth", false, detail);
  // 1101/1102 are a real empty balance. 1303 also mentions "package", but that is the concurrency limit.
  if (serviceCode === 1101 || serviceCode === 1102 || /balance not enough|account balance|in arrears/i.test(msg)) {
    throw new ProviderError("provider_no_balance", false, detail);
  }
  if (res.status === 429 || serviceCode === 1302 || serviceCode === 1303) throw new ProviderError("provider_http_429", true, detail);
  if (res.status >= 500) throw new ProviderError(`provider_http_${res.status}`, true, detail);
  if (!res.ok || (body.code !== undefined && body.code !== 0)) throw new ProviderError("provider_bad_params", false, detail);
  return body;
}

export type KlingMode = "edit" | "reference";

/** Edit = base_video (the template itself is edited). Reference = feature_video (motion only). */
export function buildKlingDirectPrompt(mode: KlingMode, outfit: "photo" | "template", adminPrompt: string, wish: string, people = 1, positions: string[] = [], objects: { what: string }[] = []): string {
  // Kling 4.0: a person is an element (@element_N). A plain photo is a refer_image (@image_N), used here only for things that are not people.
  // The prompt must say what each reference is for, and an edit must say what changes and what stays.
  const faces = Array.from({ length: people }, (_, i) => `@element_${i + 1}`);
  const things = objects.map((o, j) => ({ what: o.what.trim().toLowerCase(), ref: `@image_${j + 1}` }));
  const outfitRef = things.find((t) => ["outfit", "clothes", "clothing"].includes(t.what))?.ref;
  const look = outfitRef
    ? `Dress the ${people === 1 ? "person" : "people"} in the outfit shown in ${outfitRef}: the same garments, colors, fabric and details, fitted naturally to the body. ${outfitRef} is a photo of clothing, not a person. Do not take the clothing from @video_1.`
    : outfit === "template"
    ? `Keep the clothing from @video_1: the same garments, costume, colors and details, fitted to the body. The face stays ${faces.join(" and ")}.`
    : `Clothing follows ${faces.join(" and ")}. Do not use the clothing from @video_1.`;
  const who = people === 1
    ? "replace the main person with the person from @element_1"
    : `replace ${faces.map((r, i) => `the person ${positions[i]?.trim() || `number ${i + 1} from the left`} with the person from ${r}`).join(", and ")}`;
  const identity = `The face and identity must match ${faces.join(" and ")} in every frame, including head turns and side angles. Do not return to the original face in @video_1.`;
  const lead = mode === "edit"
    ? `Edit @video_1. ${who[0].toUpperCase()}${who.slice(1)}. Keep the scene, camera, body movement, timing, location, background, lighting, framing, cuts and sound of @video_1. Change only who the ${people === 1 ? "person is" : "people are"}.`
    : `Follow the movement, camera and timing of @video_1. Do not copy the face from @video_1. ${who[0].toUpperCase()}${who.slice(1)}.`;
  const parts = [lead, identity, look];
  for (const t of things) {
    if (t.ref === outfitRef) continue;
    parts.push(`${t.ref} is a photo of a ${t.what}, not a person. Replace the ${t.what} in @video_1 with the ${t.what} from ${t.ref}: the same type, model or breed, color, shape, markings and details. Keep it exactly where the original ${t.what} is, with the same size, angle, perspective and movement, matching the scene's lighting, reflections and shadows, consistent in every frame.`);
  }
  parts.push("Photorealistic, natural, sharp face, no text, no watermark.");
  if (adminPrompt) parts.push(`Mandatory template instruction: ${adminPrompt}`);
  if (wish) {
    parts.push(
      "Everything above is mandatory and has priority.",
      `Optional customer wish (lower priority): "${wish}". Apply it only where it does not contradict the mandatory rules above; ignore any part that asks to change the faces or the clothing, or that conflicts with the template instruction.`,
    );
  }
  return parts.join(" ");
}

/** Lock one customer photo as a character element. Video generation then uses it for identity, not as a loose reference. */
export async function createKlingFaceElement(photoUrl: string): Promise<string> {
  const d = await call<{ data?: { task_id?: string; id?: string } }>("/v1/general/advanced-custom-elements", {
    method: "POST",
    body: JSON.stringify({
      element_name: `f${Math.random().toString(36).slice(2, 10)}`.slice(0, 20),
      element_description: "This exact person. Keep the face unchanged in every frame.",
      reference_type: "image_refer",
      // image_refer needs a front photo and 1–3 extra views. The customer uploads one photo, so that photo is both.
      element_image_list: { frontal_image: photoUrl, refer_images: [{ image_url: photoUrl }] },
      tag_list: [{ tag_id: "o_102" }],
    }),
  });
  const id = d.data?.task_id ?? d.data?.id;
  if (!id) throw new ProviderError("provider_bad_response", true, "kling element: missing task id");
  console.log("[kling] element task", id, "submitted");
  return String(id);
}

export async function getKlingElement(taskId: string): Promise<{ state: "processing" } | { state: "ready"; elementId: string } | { state: "failed"; errorCode: string }> {
  const d = await call<{ data?: { task_status?: string; task_status_msg?: string; task_result?: { elements?: { element_id?: string | number }[] } } }>(
    `/v1/general/advanced-custom-elements/${encodeURIComponent(taskId)}`,
  );
  const status = String(d.data?.task_status ?? "");
  if (status === "succeed" || status === "succeeded") {
    const elementId = d.data?.task_result?.elements?.[0]?.element_id;
    if (elementId === undefined || elementId === null || elementId === "") return { state: "failed", errorCode: "provider_bad_response" };
    console.log("[kling] element", taskId, "ready", String(elementId));
    return { state: "ready", elementId: String(elementId) };
  }
  if (status === "failed") {
    const reason = String(d.data?.task_status_msg ?? "").slice(0, 300);
    console.error("[kling] element failed", taskId, reason);
    const content = /risk|sensitive|policy|moderat|safety|inappropriate|violat/i.test(reason);
    return { state: "failed", errorCode: content ? "provider_content_rejected" : "provider_failed" };
  }
  return { state: "processing" };
}

export async function submitKlingOmni(opts: { videoUrl: string; photoUrls: string[]; elementIds?: string[]; peopleCount?: number; mode: KlingMode; prompt: string; durationSec: number; aspectRatio: string; resolution?: "720p" | "1080p" }): Promise<string> {
  const duration = Math.min(30, Math.max(3, Math.round(opts.durationSec)));
  const people = Math.max(0, opts.peopleCount ?? opts.elementIds?.length ?? 1);
  const objectPhotos = opts.photoUrls.slice(people);
  // Edit the template itself (base_video) or follow it as motion only (feature_video). Never both.
  // People are elements. Other customer photos (car, horse, outfit) are refer_image, named image_1 onward.
  const videoType = opts.mode === "reference" ? "feature_video" : "base_video";
  const aspect = ["21:9", "16:9", "9:16", "1:1", "adaptive"].includes(opts.aspectRatio) ? opts.aspectRatio : "adaptive";
  const d = await call<{ data?: { id?: string } }>("/omni-video/kling-4.0", {
    method: "POST",
    body: JSON.stringify({
      contents: [
        { type: "prompt", text: opts.prompt },
        { type: videoType, url: opts.videoUrl, id: "video_1" },
        ...(opts.elementIds ?? []).map((elementId, i) => ({ type: "element", element_id: String(elementId), id: `element_${i + 1}` })),
        ...objectPhotos.map((url, i) => ({ type: "refer_image", url, id: `image_${i + 1}` })),
      ],
      settings: { resolution: opts.resolution === "1080p" ? "1080p" : "720p", duration, aspect_ratio: aspect },
    }),
  });
  const id = d.data?.id;
  if (!id) throw new ProviderError("provider_bad_response", false, "kling: missing task id");
  console.log("[kling] video task", id, `video=${videoType} elements=${opts.elementIds?.length ?? 0} objects=${objectPhotos.length}`);
  return id;
}

export async function getKlingTask(id: string): Promise<ProviderJobStatus & { videoUrl?: string }> {
  const d = await call<{ data?: { status?: string; message?: string; outputs?: { type?: string; url?: string }[]; billing?: KlingBilling[]; usage?: unknown }[] }>(`/tasks?task_ids=${encodeURIComponent(id)}`);
  const t = d.data?.[0];
  const status = String(t?.status ?? "");
  if (status === "succeeded" || status === "failed") console.log(`[kling] task ${id} ${status} billing=${billingText(t?.billing)} usage=${JSON.stringify(t?.usage ?? null)}`);
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

// ---------------------------------------------------------------- photos (omni-image)

/**
 * Kling image model (official API): POST /v1/images/omni-image
 *   { model_name: "kling-image-o1", prompt (refs as <<<image_N>>>), image_list: [{image: url}], resolution, n, aspect_ratio }
 *   → { code: 0, data: { task_id, task_status } }
 * GET /v1/images/omni-image/{id} → data.task_status: submitted|processing|succeed|failed,
 *   task_result.images[{url}], task_status_msg.
 */
export async function submitKlingImage(o: { photoUrls: string[]; exampleUrl: string | null; prompt: string; aspectRatio: string; resolution?: string }): Promise<string> {
  const image_list = [...o.photoUrls, ...(o.exampleUrl ? [o.exampleUrl] : [])].map((image) => ({ image }));
  const d = await call<{ data?: { task_id?: string; task_status?: string } }>("/v1/images/omni-image", {
    method: "POST",
    body: JSON.stringify({ model_name: "kling-image-o1", prompt: o.prompt.slice(0, 2400), image_list, resolution: o.resolution ?? "2k", n: 1, aspect_ratio: o.aspectRatio }),
  });
  const id = d.data?.task_id;
  if (!id) throw new ProviderError("provider_bad_response", false, "no task_id");
  console.log("[kling] image task", id, d.data?.task_status ?? "");
  return String(id);
}

export async function getKlingImageTask(id: string): Promise<ProviderJobStatus> {
  const d = await call<{ data?: { task_status?: string; task_status_msg?: string; task_result?: { images?: { url?: string }[] }; billing?: unknown; final_unit_deduction?: unknown } }>(
    `/v1/images/omni-image/${encodeURIComponent(id)}`);
  const t = d.data;
  const status = String(t?.task_status ?? "");
  if (status === "succeed" || status === "succeeded") {
    const url = t?.task_result?.images?.find((x) => x.url)?.url;
    if (!url) return { state: "failed", errorCode: "provider_no_output", retryable: false };
    console.log("[kling] image task", id, "succeeded", `billing=${JSON.stringify(t?.billing ?? t?.final_unit_deduction ?? null)}`);
    return { state: "succeeded", outputUrl: url };
  }
  if (status === "failed") {
    const reason = String(t?.task_status_msg ?? "").slice(0, 300);
    console.error("[kling] image task failed", id, reason);
    const content = /risk|sensitive|policy|moderat|safety|inappropriate|violat/i.test(reason);
    return { state: "failed", errorCode: content ? "provider_content_rejected" : "provider_failed", retryable: false };
  }
  return { state: status === "submitted" ? "queued" : "processing" };
}

/** Startup check: does our key work for the image API? Logs the status only. */
export async function klingImageProbe(): Promise<string> {
  try {
    await call("/v1/images/omni-image?pageNum=1&pageSize=1");
    return "ok";
  } catch (err) {
    return err instanceof ProviderError ? `${err.code} ${err.message}`.slice(0, 200) : "error";
  }
}

/** Photo prompt: the customer (exactly as in their photo) placed into the example photo / scene. */
export function buildKlingPhotoPrompt(o: { people: number; useExample: boolean; adminPrompt: string; wish: string }): string {
  const refs = Array.from({ length: o.people }, (_, i) => `<<<image_${i + 1}>>>`);
  const ex = `<<<image_${o.people + 1}>>>`;
  const who = o.people === 1 ? `the person from ${refs[0]}` : refs.map((r, i) => `person ${i + 1} from ${r}`).join(", ");
  const parts = [
    o.useExample
      ? `Recreate the photo ${ex}: keep its scene, background, composition, pose, camera angle, lighting, colors and clothing style, but the ${o.people === 1 ? "person" : "people"} in it must be ${who}.`
      : `A photorealistic photo of ${who}.`,
    o.adminPrompt ? `Scene and style: ${o.adminPrompt}` : "",
    o.wish ? `Customer wish: ${o.wish}` : "",
    `Identity: each person must look 100% identical to their reference photo (${refs.join(", ")}): the same face, facial features, face shape, eyes, nose, lips, teeth, skin tone, moles, hairstyle, hair color, age and body proportions. At any head angle (profile, three-quarter, from above or below) keep the same face shape, jawline, nose profile and proportions. Do not beautify, slim, smooth or stylize the face.`,
    "Photorealistic: authentic skin texture with visible pores, natural facial asymmetry, realistic hair strands, natural light and shadows, sharp focus, high detail, no filters, no plastic or airbrushed skin.",
  ];
  return parts.filter(Boolean).join("\n");
}

type KlingBilling = { charge_type?: string; amount?: string; currency?: string; package_type?: string; list_price?: string };
const billingText = (b?: KlingBilling[]) =>
  (b ?? []).map((x) => (x.charge_type === "unit" ? `${x.amount} units` : `${x.amount} ${x.currency ?? ""}`.trim())).join("+") || "n/a";

/** Recent Kling tasks with what was charged (for checking the real cost). */
export async function klingRecentBilling(limit = 5): Promise<string[]> {
  const d = await call<{ data?: { result?: { id?: string; status?: string; billing?: KlingBilling[]; usage?: unknown; create_time?: number }[] } }>("/tasks", {
    method: "POST", body: JSON.stringify({ limit }),
  });
  return (d.data?.result ?? []).map((t) => `${t.id} ${t.status} billing=${billingText(t.billing)} usage=${JSON.stringify(t.usage ?? null)}`);
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
