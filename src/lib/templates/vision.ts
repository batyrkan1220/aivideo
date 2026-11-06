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
import type { Analysis, Box } from "./analysis";
export type VisionResult = Analysis;
type VisionBox = { frame: number; box: Box | null };

const KINDS = Object.values(OBJECT_PRESETS).map((p) => p.en);

const resultSchema = z.object({
  people: z.array(z.object({
    where: z.string().max(80).catch(""),
    look: z.string().max(120).catch(""),
    ru: z.string().max(160).catch(""),
    frame: z.number().int().min(0).max(20).catch(0),
    box: z.array(z.number()).length(4).nullable().catch(null),
    face: z.array(z.number()).length(4).nullable().optional().catch(null),
  })).catch([]),
  objects: z.array(z.object({
    what: z.string().max(40).catch(""),
    look: z.string().max(120).catch(""),
    ru: z.string().max(160).catch(""),
    frame: z.number().int().min(0).max(20).catch(0),
    box: z.array(z.number()).length(4).nullable().catch(null),
  })).catch([]),
  scene: z.string().max(600).catch(""),
});

const promptFor = (kinds: string[]) => `These are frames, in time order, from one short video. A customer will upload photos to replace the people in it (and maybe some things) with an AI video model.
List the people who are clearly visible and important in the video (ignore tiny background passers-by), ordered from left to right as they mainly appear. At most ${SEEDANCE_MAX_PEOPLE}.
For each person give:
- where: short English position, e.g. "on the left", "in the center", "on the right", "in the foreground", "in the background". Use "" if there is only one person.
- look: short English description that tells this person apart in every frame: gender, approximate age, clothing and color, hair, what they hold or do. Max 12 words. No names. It must differ from every other person's look, and "where" must differ too when they stand in different places.
- ru: the same position and description in Russian, for the admin.
- frame: the 0-based index of the frame where this person is seen best (large, face visible).
- box: [ymin, xmin, ymax, xmax] of this person in that frame, from 0 to 1000 (head to at least the waist).
- face: [ymin, xmin, ymax, xmax] of this person's face and hair in the same frame, from 0 to 1000.
Also list up to ${SEEDANCE_MAX_OBJECTS} large, prominent things a customer might want to swap for their own, only of these kinds: ${kinds.join(", ")}. Skip small props.
A thing must be separate from every listed person: never list a person's worn clothes, hair or body as a thing. Never list the same person or thing twice. If nothing fits, return objects: [].
For each thing:
- what: exactly one of ${kinds.join(", ")}
- look: short English description and position, e.g. "the white sedan on the right". Max 12 words.
- ru: the same in Russian.
- frame and box: as for people, around the whole thing.
Finally write scene: 1–3 short English sentences (max 50 words) for the video model that lock everything that must stay exactly as in this video, 1:1: the location and background, lighting and colors, camera movement and framing, and what each person does and when (gestures, moves, turns, timing). Call people only "the person" (or "the first person", "the second person"): never their gender, age, hair, face, body or clothing, because they will be replaced by someone else. Only describe what is there; do not suggest any change.
Reply with JSON only.`;

const responseSchema = {
  type: "OBJECT",
  properties: {
    people: { type: "ARRAY", items: { type: "OBJECT", properties: { where: { type: "STRING" }, look: { type: "STRING" }, ru: { type: "STRING" }, frame: { type: "INTEGER" }, box: { type: "ARRAY", items: { type: "INTEGER" } }, face: { type: "ARRAY", items: { type: "INTEGER" } } }, required: ["where", "look", "ru", "frame", "box", "face"] } },
    objects: { type: "ARRAY", items: { type: "OBJECT", properties: { what: { type: "STRING", enum: KINDS }, look: { type: "STRING" }, ru: { type: "STRING" }, frame: { type: "INTEGER" }, box: { type: "ARRAY", items: { type: "INTEGER" } } }, required: ["what", "look", "ru", "frame", "box"] } },
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
function hintText(hint?: { people: number; objects: string[] }) {
  if (!hint) return "";
  const things = hint.objects.length ? `exactly these things: ${hint.objects.join(", ")}` : "no things (objects: [])";
  return `\nKnown: the video has exactly ${hint.people} main ${hint.people === 1 ? "person" : "people"} to replace (the most prominent ones) and ${things}. List exactly that.`;
}

/** Share of box a that lies inside box b (0–1). */
export function covered(a: Box | null, b: Box | null): number {
  if (!a || !b) return 0;
  const h = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const w = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const area = (a[2] - a[0]) * (a[3] - a[1]);
  return area > 0 ? (h * w) / area : 0;
}

/** The same person or thing listed twice (same frame, mostly the same box): keep the first. */
function dedupe<T extends { frame: number; box: Box | null; what?: string }>(list: T[]): T[] {
  const out: T[] = [];
  for (const x of list) {
    if (out.some((y) => y.frame === x.frame && y.what === x.what && Math.max(covered(x.box, y.box), covered(y.box, x.box)) > 0.7)) continue;
    out.push(x);
  }
  return out;
}

/** A usable box: inside 0–1000, not empty. */
function cleanBox(b: number[] | null): VisionBox["box"] {
  if (!b) return null;
  const [y0, x0, y1, x1] = b.map((v) => Math.min(1000, Math.max(0, Math.round(v))));
  return y1 - y0 >= 20 && x1 - x0 >= 20 ? [y0, x0, y1, x1] : null;
}

/** hint: the admin's numbers to keep (exactly this many people, these things only). */
export async function describeTemplateFrames(frames: string[], hint?: { people: number; objects: string[] }): Promise<VisionResult> {
  // Worn clothing is the template's outfit setting, not a thing to swap: "outfit" only when the admin already has one.
  const kinds: string[] = KINDS.filter((k) => k !== "outfit" || hint?.objects.includes("outfit"));
  const { GEMINI_API_KEY: key, GEMINI_MODEL: model } = env();
  if (!key) throw new VisionError("not_configured");
  // Busy models answer 503/429: try again, then the next model in the list.
  const models = [...new Set([model, ...FALLBACK_MODELS])];
  const payload = JSON.stringify({
    contents: [{ role: "user", parts: [...frames.map((data) => ({ inline_data: { mime_type: "image/jpeg", data } })), { text: promptFor(kinds) + hintText(hint) }] }],
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
  const people = dedupe(parsed.people.map((p) => ({ where: clean(p.where, 50), look: clean(p.look, 110), ru: clean(p.ru, 160), frame: Math.min(p.frame, frames.length - 1), box: cleanBox(p.box), face: cleanBox(p.face ?? null) })))
    .slice(0, SEEDANCE_MAX_PEOPLE);
  const objects = dedupe(parsed.objects
    .map((o) => ({ what: o.what.trim().toLowerCase(), look: clean(o.look, 110), ru: clean(o.ru, 160), frame: Math.min(o.frame, frames.length - 1), box: cleanBox(o.box) }))
    .filter((o) => kinds.includes(o.what)))
    // A "thing" that sits inside a found person (their clothes, their body) is that person again.
    .filter((o) => !people.some((p) => p.frame === o.frame && covered(o.box, p.box) > 0.6))
    .slice(0, SEEDANCE_MAX_OBJECTS);
  return { people, objects, scene: clean(parsed.scene, 500) };
}
