import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";
import { OBJECT_PRESETS, SEEDANCE_MAX_OBJECTS, SEEDANCE_MAX_PEOPLE } from "./seedance-config";

/**
 * Template editor helper: Gemini looks at a few frames of the template video and lists the people
 * and the replaceable things in it. The English descriptions go into the Kling prompt
 * ("the person on the left, a woman in a red dress"); the Russian ones are shown to the admin.
 * Only small JPEG frames made in the admin's browser are sent; the video itself never is.
 */
export type VisionPerson = { where: string; look: string; ru: string };
export type VisionObject = { what: string; look: string; ru: string };
export type VisionResult = { people: VisionPerson[]; objects: VisionObject[]; scene: string };

const KINDS = Object.values(OBJECT_PRESETS).map((p) => p.en);

const resultSchema = z.object({
  people: z.array(z.object({
    where: z.string().max(80).catch(""),
    look: z.string().max(120).catch(""),
    ru: z.string().max(160).catch(""),
  })).catch([]),
  objects: z.array(z.object({
    what: z.string().max(40).catch(""),
    look: z.string().max(120).catch(""),
    ru: z.string().max(160).catch(""),
  })).catch([]),
  scene: z.string().max(600).catch(""),
});

const PROMPT = `These are frames, in time order, from one short video. A customer will upload photos to replace the people in it (and maybe some things) with an AI video model.
List the people who are clearly visible and important in the video (ignore tiny background passers-by), ordered from left to right as they mainly appear. At most ${SEEDANCE_MAX_PEOPLE}.
For each person give:
- where: short English position, e.g. "on the left", "in the center", "on the right", "in the foreground", "in the background". Use "" if there is only one person.
- look: short English description that tells this person apart in every frame: gender, approximate age, clothing and color, hair, what they hold or do. Max 12 words. No names.
- ru: the same position and description in Russian, for the admin.
Also list up to ${SEEDANCE_MAX_OBJECTS} large, prominent things a customer might want to swap for their own, only of these kinds: ${KINDS.join(", ")}. "outfit" only if the clothing itself is the main subject. Skip small props. For each:
- what: exactly one of ${KINDS.join(", ")}
- look: short English description and position, e.g. "the white sedan on the right". Max 12 words.
- ru: the same in Russian.
Finally write scene: 1–3 short English sentences (max 50 words) for the video model that lock everything that must stay exactly as in this video, 1:1: the location and background, lighting and colors, camera movement and framing, and what each person does and when (gestures, moves, turns, timing). Only describe what is there; do not suggest any change and do not describe faces.
Reply with JSON only.`;

const responseSchema = {
  type: "OBJECT",
  properties: {
    people: { type: "ARRAY", items: { type: "OBJECT", properties: { where: { type: "STRING" }, look: { type: "STRING" }, ru: { type: "STRING" } }, required: ["where", "look", "ru"] } },
    objects: { type: "ARRAY", items: { type: "OBJECT", properties: { what: { type: "STRING", enum: KINDS }, look: { type: "STRING" }, ru: { type: "STRING" } }, required: ["what", "look", "ru"] } },
    scene: { type: "STRING" },
  },
  required: ["people", "objects", "scene"],
};

/** Tried in order after GEMINI_MODEL when it is busy or not available. */
const FALLBACK_MODELS = ["gemini-3.8-flash", "gemini-3.5-flash-lite"];

type GeminiBody = { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { status?: string } };

async function callGemini(key: string, model: string, payload: string): Promise<{ ok: true; body: GeminiBody } | { ok: false; status: number; reason: string; retry: boolean }> {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: payload,
      signal: AbortSignal.timeout(40_000),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => ({}))) as GeminiBody;
    if (res.ok) return { ok: true, body };
    return { ok: false, status: res.status, reason: String(body.error?.status ?? "").slice(0, 60), retry: res.status === 429 || res.status >= 500 };
  } catch {
    return { ok: false, status: 0, reason: "network", retry: true };
  }
}

export class VisionError extends Error {
  constructor(public code: "not_configured" | "failed") { super(code); }
}

/** frames: base64 JPEG without the data: prefix. */
export async function describeTemplateFrames(frames: string[]): Promise<VisionResult> {
  const { GEMINI_API_KEY: key, GEMINI_MODEL: model } = env();
  if (!key) throw new VisionError("not_configured");
  // Busy models answer 503/429: try again, then the next model in the list.
  const models = [...new Set([model, ...FALLBACK_MODELS])];
  const payload = JSON.stringify({
    contents: [{ role: "user", parts: [...frames.map((data) => ({ inline_data: { mime_type: "image/jpeg", data } })), { text: PROMPT }] }],
    generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseSchema },
  });
  let body: GeminiBody | null = null;
  outer: for (const m of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await callGemini(key, m, payload);
      if (r.ok) { body = r.body; break outer; }
      console.error("[vision] gemini", m, r.status, r.reason);
      if (!r.retry) { if (r.status === 400 || r.status === 401 || r.status === 403) throw new VisionError("failed"); break; }
      await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
    }
  }
  if (!body) throw new VisionError("failed");
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new VisionError("failed"); }
  const parsed = resultSchema.parse(raw);
  const clean = (s: string, n: number) => s.replace(/[@<>{}\[\]\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
  return {
    people: parsed.people.slice(0, SEEDANCE_MAX_PEOPLE).map((p) => ({ where: clean(p.where, 50), look: clean(p.look, 110), ru: clean(p.ru, 160) })),
    objects: parsed.objects
      .map((o) => ({ what: o.what.trim().toLowerCase(), look: clean(o.look, 110), ru: clean(o.ru, 160) }))
      .filter((o) => KINDS.includes(o.what as (typeof KINDS)[number]))
      .slice(0, SEEDANCE_MAX_OBJECTS),
    scene: clean(parsed.scene, 500),
  };
}
