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

/**
 * The @image refs of each thing, after `start` photos: a thing may have several photos (a car from
 * the front, side and back: n = 3), which go one after another.
 */
function thingRefs(objects: { n?: number }[], start: number): string[][] {
  let at = start;
  return objects.map((o) => Array.from({ length: Math.max(1, o.n ?? 1) }, () => `@image_${++at}`));
}
/**
 * Customers shoot their car in daylight, the template may be at night (or the other way): the thing keeps
 * its own look but takes the video's light: night, street lamps, its own headlights, rain, sunset.
 */
const RELIGHT = (what: string) => `The photos of the ${what} may be taken in other light (for example in daylight while the video is at night): show it lit exactly like the scene in @video_1 — the same time of day, darkness, street lights, glare, wet reflections and colors of light, with its own lights (headlights, tail lights) on if the original has them on. Never bring the photos' daylight, sky or background into the video.`;
/**
 * TM-100051: "same size" made Kling squeeze the customer's car into the original's outline, and it came
 * out another model. The new thing keeps its own shape and proportions; only its place, path, angle and
 * movement come from the video.
 */
const KEEP_OWN = (what: string, ref: string) =>
  `It must be recognisably the customer's ${what} from ${ref}, not the ${what} from @video_1 and not a mix of the two: take nothing of the original ${what}'s model, shape or details. ` +
  `Keep the ${what}'s own real shape, proportions and size (it may be longer, taller or smaller than the original); from @video_1 take only its place, path, distance, angle and movement. ` +
  "Do not invent or change any of its details.";
/**
 * A vehicle's number plate exactly as on the customer's photos: the same letters and digits, region
 * code, flag (the Kazakhstan flag and "KZ" on Kazakh plates, or whatever flag is there), colors, font
 * and layout. Nothing for other things.
 */
const VEHICLES = /\b(car|sedan|suv|jeep|truck|pickup|van|bus|motorcycle|motorbike|scooter|vehicle)\b/i;
const PLATE = (what: string, ref: string) => VEHICLES.test(what)
  ? `Number plates: copy them exactly as on ${ref} — the same letters and digits in the same order, the same region code, the same flag and country mark (for example the Kazakhstan flag with "KZ" if the photo has it, or whatever flag is on the plate), the same colors, font, frame and layout, front and back. Never make up or change a plate; if a plate cannot be read on the photos, keep it as in @video_1. `
  : "";
const listRefs = (r: string[]) => (r.length < 2 ? r[0] ?? "" : `${r.slice(0, -1).join(", ")} and ${r[r.length - 1]}`);
/** "@image_2 is a photo of a car" / "@image_2, @image_3 and @image_4 are photos of the same car from different sides (front, side, back)". */
const thingIntro = (refs: string[], what: string, notPerson: boolean) => refs.length < 2
  ? `${refs[0]} is a photo of a ${what}${notPerson ? ", not a person" : ""}.`
  : `${listRefs(refs)} are photos of the same ${what} from different sides (front, side, back)${notPerson ? ", not a person" : ""}: together they show exactly how it looks all around, so every side of it in the video matches them.`;

/**
 * A template where only things are replaced (a car, a horse…), nobody's face: no person rules at all,
 * and every person in the video stays exactly as they are.
 */
function thingsOnlyPrompt(mode: KlingMode, adminPrompt: string, wish: string, objects: { what: string; look?: string; n?: number }[], targetRefs: string[], shot: boolean): string {
  const tr = thingRefs(objects, 0);
  const things = objects.map((o, j) => ({ what: o.what.trim().toLowerCase(), look: o.look?.trim() ?? "", refs: tr[j], ref: listRefs(tr[j]), shown: targetRefs[j] ? ` shown in ${targetRefs[j]}` : "" }));
  const parts: string[] = [mode === "edit" ? "Edit @video_1." : "Follow the motion, actions, timing, camera movement, framing and cuts of @video_1, and recreate its location, background and lighting."];
  for (const t of things) {
    parts.push(`${thingIntro(t.refs, t.what, false)} Replace the ${t.what}${t.look ? ` (${t.look})` : ""}${t.shown} in @video_1 with the ${t.what} from ${t.ref}, 1:1: exactly the same make and model or breed, body shape, color and shade, wheels or markings, logos, number plates, stickers and every detail, from every side. ${KEEP_OWN(t.what, t.ref)} ${PLATE(t.what, t.ref)}${RELIGHT(t.what)}`);
  }
  parts.push(mode === "edit"
    ? "Keep everything else in @video_1 unchanged: every person with their own face and body, background, location, other objects, lighting, camera movement, framing, cuts, motion and timing."
    : "Keep every person as in @video_1.");
  const cutouts = targetRefs.filter(Boolean);
  if (cutouts.length) parts.push(`${cutouts.join(", ")} ${cutouts.length === 1 ? "is a cut-out" : "are cut-outs"} from @video_1 that only show${cutouts.length === 1 ? "s" : ""} which one to replace. Never copy anything else from them into the result.`);
  parts.push("Photorealistic, natural, sharp, no text, no watermark.");
  if (adminPrompt && !shot) parts.push(`Scene and motion to keep from @video_1: ${adminPrompt}`);
  parts.push(`Final check: every replaced ${things.map((t) => t.what).join(", ")} in the result is the one from ${things.map((t) => t.ref).join(", ")} in every frame where it is seen.`);
  if (wish) parts.push("Everything above is mandatory and has priority.", `Optional customer wish (lower priority): "${wish}". Apply it only where it does not contradict the mandatory rules above.`);
  return parts.join(" ");
}

export function buildKlingDirectPrompt(mode: KlingMode, outfit: "photo" | "template", adminPrompt: string, wish: string, people = 1, positions: string[] = [], objects: { what: string; look?: string; n?: number }[] = [], targetRefs: string[] = [], shot = false): string {
  // Optional cut-outs from the template (@image_k) that show which person or thing is meant: people first, then things.
  if (people === 0) return thingsOnlyPrompt(mode, adminPrompt, wish, objects, targetRefs, shot);
  const shown = (i: number) => (targetRefs[i] ? ` shown in ${targetRefs[i]}` : "");
  const refs = Array.from({ length: people }, (_, i) => `@image_${i + 1}`);
  const tr = thingRefs(objects, people);
  const things = objects.map((o, j) => ({ what: o.what.trim().toLowerCase(), look: o.look?.trim() ?? "", refs: tr[j], ref: listRefs(tr[j]), shown: shown(people + j) }));
  const outfitRef = things.find((t) => ["outfit", "clothes", "clothing"].includes(t.what))?.ref;
  // Who is who by their look first, the side only as a hint: with a moving camera one person is often
  // alone and centred in the frame, and "on the right" then matched nobody (TM-100064/71: the woman stayed).
  const spot = (i: number) => {
    const by = findBy(positions[i]);
    const [side, ...rest] = by.split(",");
    const look = rest.join(",").trim();
    if (!by) return `person number ${i + 1} from the left${shown(i)}`;
    return look
      ? `${look} (${side.trim()} when both are in the frame; the same person wherever they are, also alone or centred in the frame)${shown(i)}`
      : `person ${by}${shown(i)}`;
  };
  const who = people === 1
    ? `Replace ${findBy(positions[0]) ? `the person ${findBy(positions[0])}` : "the main person"}${shown(0)} in @video_1 with the person from @image_1. ` +
      "That description only tells which person in @video_1 to replace; their face, hair and body all become the person from @image_1."
    : [
        `There are ${people} people to replace in @video_1. Replace every one of them, in every frame:`,
        ...refs.map((r, i) => `- The ${spot(i)} becomes the person from ${r}.`),
        `All ${people} must be replaced; none of them may keep the face or look of the original person.`,
        `${refs.join(", ")} are ${people} different people: each one goes only to their own place. Do not swap, blend or mix their faces.`,
      ].join("\n");
  const hasOutfitPhoto = things.some((t) => ["outfit", "clothes", "clothing"].includes(t.what));
  const same = [
    `The new ${people === 1 ? "person" : "people"} must look 100% identical to ${refs.join(", ")} in every frame, from the first frame to the very last: the same face shape, eyes, eyebrows, nose, lips, jaw, ears, moles, hairstyle, hair color, skin tone and age.`,
    `Replace the whole person, not only the face: head, hair, neck, arms, hands, legs and feet, with the skin color and skin tone of ${refs.join(", ")} everywhere on the body, and their body build and proportions. No part of the original person's body or skin may remain${outfit === "template" && !hasOutfitPhoto ? " (their clothing is the only thing that stays, see below)" : ""}.`,
    // TM-100047: the hands kept the original person's skin color and size. Hands and arms often fill the
    // frame on their own (holding, pointing, close-ups), where Kling saw no face and left them as they were.
    `Hands and arms count as the person too, also when they are the only part in the frame (close-ups, holding things, reaching to the camera): give them the skin color and tone of ${refs.join(", ")} (from the face and neck when only the face is shown) and the size and build of that person's hands, fingers and arms. Never leave the original person's hands or skin in any frame.`,
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
    parts.push(`${thingIntro(t.refs, t.what, true)} Replace the ${t.what}${t.look ? ` (${t.look})` : ""}${t.shown} in @video_1 with the ${t.what} from ${t.ref}, 1:1: exactly the same make and model or breed, body shape, color and shade, wheels or markings, logos, number plates, stickers and every detail, from every side. ${KEEP_OWN(t.what, t.ref)} ${PLATE(t.what, t.ref)}${RELIGHT(t.what)}`);
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
    // One person per run (2–3 people are edited one after another): "every replaced person is @image_1" also
    // pointed at the person replaced in the earlier run, and the two faces blended (TM-100058).
    parts.push(
      (people === 1
        ? `Final check: the person you replace in this edit is the person from ${photosRef}, with their face, hair, skin and body. `
        : `Final check: every replaced person in the result is the person from ${photosRef}, with their face, hair, skin and body. `) +
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

export async function submitKlingOmni(opts: { videoUrl: string; photoUrls: string[]; mode: KlingMode; prompt: string; durationSec: number; aspectRatio: string; resolution?: "720p" | "1080p"; flash?: boolean; elementIds?: string[] }): Promise<string> {
  const duration = Math.min(30, Math.max(3, Math.round(opts.durationSec)));
  // Edit: the template itself is edited (base_video), so place and motion stay 1:1. Reference: a new video following it.
  const videoType = opts.mode === "edit" ? "base_video" : "feature_video";
  const aspect = ["21:9", "16:9", "9:16", "1:1", "adaptive"].includes(opts.aspectRatio) ? opts.aspectRatio : "adaptive";
  const photos = opts.photoUrls.slice(0, KLING_MAX_IMAGES);
  // Flash: the cheaper, faster Kling 4.0 (720p only), same request.
  const d = await call<{ data?: { id?: string } }>(opts.flash ? "/omni-video/kling-4.0-flash" : "/omni-video/kling-4.0", {
    method: "POST",
    body: JSON.stringify({
      contents: [
        { type: "prompt", text: opts.prompt },
        { type: videoType, url: opts.videoUrl, id: "video_1" },
        ...photos.map((url, i) => ({ type: "refer_image", url, id: `image_${i + 1}` })),
        // Elements (one per person, made from their photo): referenced as @element_N.
        ...(opts.elementIds ?? []).slice(0, 7).map((element_id, i) => ({ type: "element", element_id, id: `element_${i + 1}` })),
      ],
      // original keeps the template video's soundtrack.
      // With Elements Kling refused duration 21 for a 21 s template ("duration value '21' is invalid", TM-100074).
      // Editing takes the template's own length when duration is left out (Kling docs), so it is left out there.
      settings: { resolution: opts.resolution === "1080p" && !opts.flash ? "1080p" : "720p", ...(opts.elementIds?.length && videoType === "base_video" ? {} : { duration }), aspect_ratio: aspect, audio: "original" },
    }),
  });
  const id = d.data?.id;
  if (!id) throw new ProviderError("provider_bad_response", false, "kling: missing task id");
  console.log("[kling] video task", id, `${opts.flash ? "flash " : ""}video=${videoType} mode=${opts.mode} images=${photos.length} elements=${(opts.elementIds ?? []).slice(0, 7).length}`);
  return id;
}

/**
 * Kling 4.0 Omni without a video: a new video from reference images + prompt («Видео товара»).
 * Sound is left to Kling's default (native audio); "original" needs a base video.
 */
export async function submitKlingRefVideo(o: { photoUrls: string[]; prompt: string; durationSec: number; aspectRatio: string; resolution?: "720p" | "1080p" }): Promise<string> {
  const duration = Math.min(15, Math.max(3, Math.round(o.durationSec)));
  const aspect = ["16:9", "9:16", "1:1"].includes(o.aspectRatio) ? o.aspectRatio : "9:16";
  const photos = o.photoUrls.slice(0, KLING_MAX_IMAGES);
  const d = await call<{ data?: { id?: string } }>("/omni-video/kling-4.0", {
    method: "POST",
    body: JSON.stringify({
      contents: [
        { type: "prompt", text: o.prompt },
        ...photos.map((url, i) => ({ type: "refer_image", url, id: `image_${i + 1}` })),
      ],
      settings: { resolution: o.resolution === "1080p" ? "1080p" : "720p", duration, aspect_ratio: aspect },
    }),
  });
  const id = d.data?.id;
  if (!id) throw new ProviderError("provider_bad_response", false, "kling: missing task id");
  console.log("[kling] product video task", id, `images=${photos.length} duration=${duration} aspect=${aspect}`);
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
 * Kling Elements (official API): a person made from photos, held more firmly than a plain reference image.
 *   POST /v1/general/advanced-custom-elements { element_name, element_description, reference_type: "image_refer",
 *        element_image_list: { frontal_image, refer_images: [{ image_url }] } }   (1–3 refer images, unlike the front one)
 *   GET  /v1/general/advanced-custom-elements/{task_id} → task_status, task_result.elements[0].element_id
 *   POST /v1/general/delete-advanced-elements { element_id }
 */
export async function createKlingElement(o: { name: string; frontal: string; refer: string[] }): Promise<string> {
  const d = await call<{ data?: { task_id?: string } }>("/v1/general/advanced-custom-elements", {
    method: "POST",
    body: JSON.stringify({
      element_name: o.name.slice(0, 20), element_description: "Customer photo: this exact person, face and hair", reference_type: "image_refer",
      element_image_list: { frontal_image: o.frontal, refer_images: o.refer.slice(0, 3).map((image_url) => ({ image_url })) },
      tag_list: [{ tag_id: "o_102" }],
    }),
  });
  const id = d.data?.task_id;
  if (!id) throw new ProviderError("provider_bad_response", false, "kling element: no task_id");
  console.log("[kling] element task", id);
  return String(id);
}

export async function getKlingElementTask(id: string): Promise<{ state: "waiting" } | { state: "done"; elementId: string } | { state: "failed"; reason: string }> {
  const d = await call<{ data?: { task_status?: string; task_status_msg?: string; task_result?: { elements?: { element_id?: string | number }[] } } }>(
    `/v1/general/advanced-custom-elements/${encodeURIComponent(id)}`);
  const status = String(d.data?.task_status ?? "");
  if (status === "succeed" || status === "succeeded") {
    const el = d.data?.task_result?.elements?.[0]?.element_id;
    return el != null ? { state: "done", elementId: String(el) } : { state: "failed", reason: "no element_id" };
  }
  if (status === "failed") return { state: "failed", reason: String(d.data?.task_status_msg ?? "").slice(0, 200) };
  return { state: "waiting" };
}

export async function deleteKlingElement(elementId: string) {
  await call("/v1/general/delete-advanced-elements", { method: "POST", body: JSON.stringify({ element_id: elementId }) })
    .catch((err) => console.error("[kling] element not deleted", err instanceof ProviderError ? err.code : "error"));
}

/**
 * Kling 3.0 Omni video (official API), for templates set to it:
 *   POST /v1/videos/omni-video { model_name: "kling-v3-omni", prompt (<<<video_1>>>, <<<image_N>>>),
 *        image_list: [{ image_url }], video_list: [{ video_url, refer_type: "base", keep_original_sound: "yes" }], mode: std|pro, sound: off }
 *   GET  /v1/videos/omni-video/{task_id} → data.task_status: submitted|processing|succeed|failed, task_result.videos[0].url
 * With a video at most 4 images; editing ("base") keeps the video's own length and framing.
 */
export async function submitKlingV3Omni(o: { videoUrl: string; photoUrls: string[]; prompt: string; resolution: "720p" | "1080p" }): Promise<string> {
  const prompt = o.prompt.replace(/@video_(\d+)/g, "<<<video_$1>>>").replace(/@image_(\d+)/g, "<<<image_$1>>>").slice(0, 2500);
  const d = await call<{ data?: { task_id?: string; task_status?: string } }>("/v1/videos/omni-video", {
    method: "POST",
    body: JSON.stringify({
      model_name: "kling-v3-omni", prompt,
      image_list: o.photoUrls.slice(0, 4).map((url) => ({ image_url: url })),
      video_list: [{ video_url: o.videoUrl, refer_type: "base", keep_original_sound: "yes" }],
      mode: o.resolution === "1080p" ? "pro" : "std", sound: "off",
    }),
  });
  const id = d.data?.task_id;
  if (!id) throw new ProviderError("provider_bad_response", false, "kling v3: no task_id");
  console.log("[kling] v3 omni task", id, `images=${Math.min(4, o.photoUrls.length)}`);
  return String(id);
}

export async function getKlingV3OmniTask(id: string): Promise<ProviderJobStatus> {
  const d = await call<{ data?: { task_status?: string; task_status_msg?: string; task_result?: { videos?: { url?: string }[] } } }>(
    `/v1/videos/omni-video/${encodeURIComponent(id)}`);
  const t = d.data;
  const status = String(t?.task_status ?? "");
  if (status === "succeed" || status === "succeeded") {
    const url = t?.task_result?.videos?.find((v) => v.url)?.url;
    return url ? { state: "succeeded", outputUrl: url } : { state: "failed", errorCode: "provider_no_output", retryable: false };
  }
  if (status === "failed") {
    const reason = String(t?.task_status_msg ?? "").slice(0, 300);
    console.error("[kling] v3 omni task failed", id, reason);
    const content = /risk|sensitive|policy|moderat|safety|inappropriate|violat/i.test(reason);
    return { state: "failed", errorCode: content ? "provider_content_rejected" : "provider_failed", retryable: false };
  }
  return { state: status === "submitted" ? "queued" : "processing" };
}

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

/**
 * Kling image generation with a face/subject reference (official API): POST /v1/images/generations
 *   { model_name: "kling-v2-1", prompt, image (url), image_reference: "subject"|"face", image_fidelity, human_fidelity, n, aspect_ratio }
 * The reference keeps the person's identity much closer than omni-image. GET /v1/images/generations/{id}.
 */
export async function submitKlingFaceImage(o: { imageUrl: string; prompt: string; reference: "subject" | "face"; imageFidelity: number; humanFidelity: number; aspectRatio: string }): Promise<string> {
  const clamp = (x: number) => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0.5));
  const d = await call<{ data?: { task_id?: string; task_status?: string } }>("/v1/images/generations", {
    method: "POST",
    body: JSON.stringify({
      model_name: "kling-v2-1", prompt: o.prompt.slice(0, 2400), image: o.imageUrl, image_reference: o.reference,
      image_fidelity: clamp(o.imageFidelity), ...(o.reference === "subject" ? { human_fidelity: clamp(o.humanFidelity) } : {}),
      n: 1, aspect_ratio: o.aspectRatio,
    }),
  });
  const id = d.data?.task_id;
  if (!id) throw new ProviderError("provider_bad_response", false, "no task_id");
  console.log("[kling] face image task", id, d.data?.task_status ?? "");
  return String(id);
}

export async function getKlingFaceImageTask(id: string): Promise<ProviderJobStatus> {
  const d = await call<{ data?: { task_status?: string; task_status_msg?: string; task_result?: { images?: { url?: string }[] } } }>(
    `/v1/images/generations/${encodeURIComponent(id)}`);
  const t = d.data;
  const status = String(t?.task_status ?? "");
  if (status === "succeed" || status === "succeeded") {
    const url = t?.task_result?.images?.find((x) => x.url)?.url;
    return url ? { state: "succeeded", outputUrl: url } : { state: "failed", errorCode: "provider_no_output", retryable: false };
  }
  if (status === "failed") {
    const reason = String(t?.task_status_msg ?? "").slice(0, 300);
    console.error("[kling] face image task failed", id, reason);
    const content = /risk|sensitive|policy|moderat|safety|inappropriate|violat/i.test(reason);
    return { state: "failed", errorCode: content ? "provider_content_rejected" : /face/i.test(reason) ? "provider_no_face" : "provider_failed", retryable: false };
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
