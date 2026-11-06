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
export type VisionResult = { people: VisionPerson[]; objects: VisionObject[] };

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
Reply with JSON only.`;

const responseSchema = {
  type: "OBJECT",
  properties: {
    people: { type: "ARRAY", items: { type: "OBJECT", properties: { where: { type: "STRING" }, look: { type: "STRING" }, ru: { type: "STRING" } }, required: ["where", "look", "ru"] } },
    objects: { type: "ARRAY", items: { type: "OBJECT", properties: { what: { type: "STRING", enum: KINDS }, look: { type: "STRING" }, ru: { type: "STRING" } }, required: ["what", "look", "ru"] } },
  },
  required: ["people", "objects"],
};

export class VisionError extends Error {
  constructor(public code: "not_configured" | "failed") { super(code); }
}

/** frames: base64 JPEG without the data: prefix. */
export async function describeTemplateFrames(frames: string[]): Promise<VisionResult> {
  const { GEMINI_API_KEY: key, GEMINI_MODEL: model } = env();
  if (!key) throw new VisionError("not_configured");
  let res: Response;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [...frames.map((data) => ({ inline_data: { mime_type: "image/jpeg", data } })), { text: PROMPT }] }],
        generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseSchema },
      }),
      signal: AbortSignal.timeout(60_000),
      cache: "no-store",
    });
  } catch {
    throw new VisionError("failed");
  }
  const body = (await res.json().catch(() => ({}))) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { status?: string } };
  if (!res.ok) {
    console.error("[vision] gemini", res.status, String(body.error?.status ?? "").slice(0, 60));
    throw new VisionError("failed");
  }
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
  };
}
