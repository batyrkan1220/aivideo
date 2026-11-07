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

/**
 * Kling 4.0 official pattern (user guide): an edit must start with "Edit @video_1" and say what changes,
 * with the new person given as a reference image (@image_N). "Reference @video_1" makes a new video instead.
 * Customer photos are plain refer_image inputs: people first (@image_1…), then the things to swap.
 */
/**
 * shot: @video_1 is one shot of a longer template (it was cut at its scene changes). The template's scene
 * note describes the whole video, so it is left out (Kling put scenes from it into the wrong shot,
 * TM-100039), and a person may be missing from a shot: then the shot stays as it is.
 */
/**
 * Where a person is and what they wear, from the analysis ("on the left, woman in black top and shorts
 * with long dark hair"), without the original person's own looks: hair, beard, face, age. Kling read
 * "long dark hair" as part of the person to keep, and the girl did not look like her photo even in the
 * first run (TM-100041); the clothing and the place are enough to find her.
 */
export function findBy(pos?: string): string {
  let t = ` ${(pos ?? "").trim()} `;
  if (!t.trim()) return "";
  const hairy = "(hair|beard|mustache|moustache|ponytail|braids?|bun|glasses|tattoos?|freckles|makeup|eyes|skin)";
  // "with long dark hair", "with beard and short hair" (up to the next comma or "wearing / in / holding …")
  t = t.replace(new RegExp(`\\bwith\\b(?:(?!,|\\bwearing\\b|\\bholding\\b|\\bin\\b).)*?\\b${hairy}\\b((?:\\s+and\\s+\\w+)*\\s+${hairy}\\b)?`, "gi"), " ");
  // "short dark hair", "a beard" left on their own
  t = t.replace(new RegExp(`\\b(?:and\\s+)?(?:(?:short|long|dark|light|blonde?|brown|black|red|grey|gray|wet|curly|wavy|straight|thick)\\s+)*${hairy}\\b`, "gi"), " ");
  // the person's own looks and age
  t = t.replace(/\b(bald|bearded|young|old|elderly|teenage|middle-aged|blonde?|brunette|redhead|[a-z]+-haired)\b/gi, " ");
  return t.split(",").map((p) => p.replace(/\s+/g, " ").replace(/^(and|with|a|an)\s+|\s+(and|with)$/gi, "").trim()).filter(Boolean).join(", ");
}

export function buildKlingDirectPrompt(mode: KlingMode, outfit: "photo" | "template", adminPrompt: string, wish: string, people = 1, positions: string[] = [], objects: { what: string; look?: string }[] = [], targetRefs: string[] = [], shot = false): string {
  // Optional cut-outs from the template (@image_k) that show which person or thing is meant: people first, then things.
  const shown = (i: number) => (targetRefs[i] ? ` shown in ${targetRefs[i]}` : "");
  const refs = Array.from({ length: people }, (_, i) => `@image_${i + 1}`);
  const things = objects.map((o, j) => ({ what: o.what.trim().toLowerCase(), look: o.look?.trim() ?? "", ref: `@image_${people + j + 1}`, shown: shown(people + j) }));
  const outfitRef = things.find((t) => ["outfit", "clothes", "clothing"].includes(t.what))?.ref;
  const spot = (i: number) => `${findBy(positions[i]) || `number ${i + 1} from the left`}${shown(i)}`;
  const who = people === 1
    ? `Replace ${findBy(positions[0]) ? `the person ${findBy(positions[0])}` : "the main person"}${shown(0)} in @video_1 with the person from @image_1. ` +
      "That description only tells which person in @video_1 to replace; their face, hair and body all become the person from @image_1."
    : [
        `There are ${people} people to replace in @video_1. Replace every one of them, in every frame:`,
        ...refs.map((r, i) => `- The person ${spot(i)} becomes the person from ${r}.`),
        `All ${people} must be replaced; none of them may keep the face or look of the original person.`,
        `${refs.join(", ")} are ${people} different people: each one goes only to their own place. Do not swap, blend or mix their faces.`,
      ].join("\n");
  const hasOutfitPhoto = things.some((t) => ["outfit", "clothes", "clothing"].includes(t.what));
  const same = [
    `The new ${people === 1 ? "person" : "people"} must look 100% identical to ${refs.join(", ")} in every frame, from the first frame to the very last: the same face shape, eyes, eyebrows, nose, lips, jaw, ears, moles, hairstyle, hair color, skin tone and age.`,
    `Replace the whole person, not only the face: head, hair, neck, arms, hands, legs and feet, with the skin color and skin tone of ${refs.join(", ")} everywhere on the body, and their body build and proportions. No part of the original person's body or skin may remain${outfit === "template" && !hasOutfitPhoto ? " (their clothing is the only thing that stays, see below)" : ""}.`,
    "Keep the identity the same from every angle: front, three-quarter, profile, looking up and looking down. Never return to the original face from @video_1, also not in the last seconds.",
    "Natural, realistic skin. Do not beautify, slim, smooth or stylize the faces.",
  ].join(" ");
  const look = outfitRef
    ? `Dress the ${people === 1 ? "person" : "people"} in the outfit from ${outfitRef}: the same garments, colors and fabric. ${outfitRef} is a photo of clothing, not a person.`
    : outfit === "template"
    // A short "Keep the clothing" lost to the whole-body rule above: Kling dressed the person as in the photo.
    ? `Clothing: keep exactly the clothing of the original person in @video_1 — the same garments, cut, colors, fabric, shoes and accessories, in every frame. Put these clothes on the new person. Never take clothing from ${refs.join(", ")}: use those photos only for the face, hair, skin and body.`
    : `Clothing: dress the new ${people === 1 ? "person" : "people"} in the clothing they wear in ${refs.join(", ")} — the same garments, colors and fabric — not in the clothes from @video_1.`;
  const parts = mode === "edit"
    ? [
        `Edit @video_1. ${who}`,
        same,
        look,
        people === 1
          ? "Keep everything else in @video_1 unchanged: background, location, other people (with their own faces, also anyone already replaced), objects, lighting, camera movement, framing, cuts, motion and timing."
          : `Apart from these ${people} people, keep everything in @video_1 unchanged: background, location, objects, lighting, camera movement, framing, cuts, motion and timing.`,
      ]
    : [
        "Follow the motion, actions, timing, camera movement, framing and cuts of @video_1, and recreate its location, background and lighting.",
        `In the new video, ${who[0].toLowerCase()}${who.slice(1)}`,
        same,
        look,
      ];
  for (const t of things) {
    if (t.ref === outfitRef) continue;
    parts.push(`${t.ref} is a photo of a ${t.what}, not a person. Replace the ${t.what}${t.look ? ` (${t.look})` : ""}${t.shown} in @video_1 with the ${t.what} from ${t.ref}: the same type, model or breed, color, shape, markings and details, in the same place, size, angle and movement, matching the scene's lighting and shadows in every frame.`);
  }
  const cutouts = targetRefs.filter(Boolean);
  if (cutouts.length) {
    parts.push(`${cutouts.join(", ")} ${cutouts.length === 1 ? "is a cut-out" : "are cut-outs"} from @video_1 that only show${cutouts.length === 1 ? "s" : ""} which one to replace; faces in them are hidden on purpose. The faces come only from the customer photos ${refs.join(", ")}. Never copy anything else from the cut-outs into the result.`);
  }
  parts.push("Photorealistic, natural, sharp face, no text, no watermark.");
  // The template note describes the ORIGINAL video (often "a young woman …"). Labelled plainly, Kling read it
  // as "keep this woman" and returned the template unchanged (TM-100020/21/31). It only fixes scene and motion.
  if (adminPrompt && !shot) {
    parts.push(`Scene and motion to keep from @video_1 (it describes the original video; any person mentioned in it is still replaced as described above): ${adminPrompt}`);
  }
  const photosRef = refs.join(", ");
  if (shot) {
    parts.push(
      "@video_1 is one shot of a longer video. Edit only what is in this shot: do not add scenes, people, moves or frames that are not in it, keep its frames in the same order and its start and end exactly as they are.",
      `Final check: if the person to replace is in this shot, they are the person from ${photosRef} in every frame, with their face, hair, skin and body, and the original person must not appear. ` +
      "If that person is not in this shot at all, add no one and change no one: keep the shot exactly as it is. Never give the new face to a different person.",
    );
  } else {
    parts.push(
      `Final check: every replaced person in the result is the person from ${photosRef}, with their face, hair, skin and body. ` +
      "The original person from @video_1 must not appear in any frame. Do not return @video_1 unchanged.",
    );
  }
  if (wish) {
    parts.push(
      "Everything above is mandatory and has priority.",
      `Optional customer wish (lower priority): "${wish}". Apply it only where it does not contradict the mandatory rules above; ignore any part that asks to change the faces or the clothing, or that conflicts with the template instruction.`,
    );
  }
  return parts.join(" ");
}

/** Kling 4.0 takes up to 10 images in one task. */
export const KLING_MAX_IMAGES = 10;

export async function submitKlingOmni(opts: { videoUrl: string; photoUrls: string[]; mode: KlingMode; prompt: string; durationSec: number; aspectRatio: string; resolution?: "720p" | "1080p" }): Promise<string> {
  const duration = Math.min(30, Math.max(3, Math.round(opts.durationSec)));
  // Edit: the template itself is edited (base_video), so place and motion stay 1:1. Reference: a new video following it.
  const videoType = opts.mode === "edit" ? "base_video" : "feature_video";
  const aspect = ["21:9", "16:9", "9:16", "1:1", "adaptive"].includes(opts.aspectRatio) ? opts.aspectRatio : "adaptive";
  const photos = opts.photoUrls.slice(0, KLING_MAX_IMAGES);
  const d = await call<{ data?: { id?: string } }>("/omni-video/kling-4.0", {
    method: "POST",
    body: JSON.stringify({
      contents: [
        { type: "prompt", text: opts.prompt },
        { type: videoType, url: opts.videoUrl, id: "video_1" },
        ...photos.map((url, i) => ({ type: "refer_image", url, id: `image_${i + 1}` })),
      ],
      // original keeps the template video's soundtrack.
      settings: { resolution: opts.resolution === "1080p" ? "1080p" : "720p", duration, aspect_ratio: aspect, audio: "original" },
    }),
  });
  const id = d.data?.id;
  if (!id) throw new ProviderError("provider_bad_response", false, "kling: missing task id");
  console.log("[kling] video task", id, `video=${videoType} mode=${opts.mode} images=${photos.length}`);
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
