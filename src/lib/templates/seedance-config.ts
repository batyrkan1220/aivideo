import { z } from "zod";
import type { FaceSlot } from "./schema";

/**
 * Template config for Kling 4.0 (Kling AI official API, 720p, 9:16).
 * "edit": the template video itself is edited — the people are replaced by the customer's photos,
 * everything else (scene, camera, motion, sound) stays. "reference": a new video following it.
 * (The provider key stays "seedance" for existing rows.)
 */
export const SEEDANCE_MAX_PEOPLE = 5;
/** Besides people: up to 2 things to swap (car, horse, outfit…), one customer photo each. */
export const SEEDANCE_MAX_OBJECTS = 2;
/** A thing may ask for several photos (a car from the front, side, back). */
export const SEEDANCE_MAX_THING_PHOTOS = 3;
/** Photos sent to Kling 4.0 as reference images: people plus things (Kling takes 10 at most). */
export const SEEDANCE_MAX_REFS = 10;
/** Default names of a thing's photos, shown to the customer: "Фото машины — спереди". */
export const THING_VIEWS = ["спереди", "сбоку", "сзади"];

/** Ready-made things to swap: Russian label for the customer, English word for the model. */
export const OBJECT_PRESETS = {
  car: { ru: "Фото машины", en: "car" },
  horse: { ru: "Фото лошади", en: "horse" },
  motorcycle: { ru: "Фото мотоцикла", en: "motorcycle" },
  dog: { ru: "Фото собаки", en: "dog" },
  cat: { ru: "Фото кошки", en: "cat" },
  outfit: { ru: "Фото одежды", en: "outfit" },
} as const;
export const objectSchema = z.object({
  /** What it is, in English for the model ("car", "horse", "outfit", …). */
  what: z.string().trim().min(1).max(40),
  /** What the customer sees above the upload box. */
  label: z.string().trim().min(1).max(40),
  /** Optional: which one in the video and how it looks, in English ("the white sedan on the right"). */
  look: z.string().trim().max(120).optional(),
  /** Optional cut-out of this thing from the template video (storage path). */
  target: z.string().trim().max(300).optional(),
  /** How many photos the customer uploads of it (1–3, e.g. a car from the front, side and back). */
  photos: z.number().int().min(1).max(SEEDANCE_MAX_THING_PHOTOS).catch(1).default(1),
  /** Name of each photo for the customer ("спереди", "сбоку", "сзади"). */
  views: z.array(z.string().trim().max(30)).max(SEEDANCE_MAX_THING_PHOTOS).catch([]).default([]),
});
export type SwapObject = z.infer<typeof objectSchema>;
export const SEEDANCE_MIN_SEC = 3;
export const SEEDANCE_MAX_SEC = 30; // Kling 4.0: input video 3–30 s

export const seedanceConfigSchema = z.object({
  /** Only Kling 4.0 (official API) now; any older value is read as it. */
  mode: z.literal("kd").catch("kd").default("kd"),
  klingMode: z.enum(["edit", "reference"]).catch("edit").default("edit"),
  /** Which model makes the video: Kling 4.0 (own API) or a model on fal.ai (test: Seedance 2.5, Wan 2.2 Animate Replace). */
  engine: z.enum(["kling", "seedance25", "wan_replace", "minimax_recast", "kling_o3"]).catch("kling").default("kling"),
  /** How many people in the video are replaced (one customer photo each). 0 = only things (a car…), nobody is replaced. */
  people: z.number().int().min(0).max(SEEDANCE_MAX_PEOPLE).default(1),
  /** What photo the customer needs (shown on the order page). */
  framing: z.enum(["face", "half", "full"]).default("half"),
  aspectRatio: z.enum(["adaptive", "9:16", "16:9", "1:1", "3:4", "4:3"]).catch("9:16").default("9:16"),
  /** Admin's instruction for this template (scene, outfit, style…). */
  prompt: z.string().trim().max(1500).default(""),
  /** Customer may describe a wish (background, outfit…). */
  allowWish: z.boolean().default(true),
  /** Photo labels for the customer, one per person (e.g. "Фото ребёнка"). */
  labels: z.array(z.string().trim().max(40)).max(5).default([]),
  /** The outfit: the customer's own (photo), the original person's in the template, or the customer picks one (default: template). */
  outfit: z.enum(["photo", "template", "choice"]).catch("photo").default("photo"),
  /** Where each person is in the frame (English for the model), e.g. "on the left". */
  positions: z.array(z.string().trim().max(120)).max(5).default([]),
  /** Things in the video to replace with the customer's photos (after the people). */
  objects: z.array(objectSchema).max(SEEDANCE_MAX_OBJECTS).catch([]).default([]),
  /** Cut-out of each person from the template video (storage paths, same order as people), shown next to the customer's upload slots. Things keep theirs on the object. */
  targets: z.array(z.string().trim().max(300)).max(SEEDANCE_MAX_PEOPLE).catch([]).default([]),
  /** Also send those cut-outs to Kling, so it sees which one to replace. */
  showTargets: z.boolean().catch(false).default(false),
  /** Person cut-outs for Kling, with the original face hidden (same order as targets). */
  targetsKling: z.array(z.string().trim().max(300)).max(SEEDANCE_MAX_PEOPLE).catch([]).default([]),
  analysisVersion: z.number().int().optional(),
  /**
   * Who is in each shot of the video (admin marks it in "🎬 Кадры"), for shot-by-shot editing:
   * starts = where each shot begins (s), people[i] = indexes of the people seen in shot i (0 = first
   * person). A shot with nobody is left exactly as in the template, without Kling. Used only while
   * the shots found in the video still begin at these times.
   */
  shotMap: z.object({
    starts: z.array(z.number().min(0).max(60)).min(1).max(12),
    people: z.array(z.array(z.number().int().min(0).max(SEEDANCE_MAX_PEOPLE - 1)).max(SEEDANCE_MAX_PEOPLE)).max(12),
  }).optional().catch(undefined),
  /** When the AI analysis (people, things, cut-outs, scene) was applied. Catalog video templates need it to be ordered. */
  analyzedAt: z.string().max(40).optional(),
});
export type SeedanceConfig = z.infer<typeof seedanceConfigSchema>;
export type SeedanceMode = "kd";
/** Longest template video Kling 4.0 accepts. */
export const maxSecFor = (_mode?: unknown) => SEEDANCE_MAX_SEC;
export const parseSeedanceMode = (_v?: unknown): SeedanceMode => "kd";
export type PhotoFraming = SeedanceConfig["framing"];

export function parseSeedanceConfig(raw: unknown): SeedanceConfig {
  const p = seedanceConfigSchema.safeParse(raw ?? {});
  return p.success ? p.data : seedanceConfigSchema.parse({});
}

export function seedanceSlotLabel(i: number, n: number) {
  return n === 1 ? "Ваше фото" : `${i + 1}-й человек (слева)`;
}

/** Customer upload slots. providerInput = `img_<n>` (= @image_<n> in the prompt). People first, then objects. */
export function seedanceSlots(n: number, keyPrefix = "face_", labels: string[] = [], objects: (Pick<SwapObject, "label" | "target"> & { what?: string; photos?: number; views?: string[] })[] = [], targets: string[] = []): FaceSlot[] {
  const target = (i: number) => (targets[i]?.trim() ? { previewImagePath: targets[i].trim() } : {});
  const people: FaceSlot[] = Array.from({ length: n }, (_, i) => ({
    key: `${keyPrefix}${i + 1}`,
    labelKk: labels[i]?.trim() || seedanceSlotLabel(i, n),
    position: { x: (i + 1) / (n + 1), y: 0.42 },
    providerInput: `img_${i + 1}`,
    order: i,
    ...target(i),
  }));
  // A thing with several photos gets a slot per photo: obj_1 (the first, as before), obj_1_2, obj_1_3.
  const things: FaceSlot[] = [];
  objects.slice(0, SEEDANCE_MAX_OBJECTS).forEach((o, j) => {
    const count = Math.max(1, Math.min(SEEDANCE_MAX_THING_PHOTOS, o.photos ?? 1));
    for (let k = 0; k < count; k++) {
      const view = count > 1 ? (o.views?.[k]?.trim() || THING_VIEWS[k]) : "";
      things.push({
        key: k === 0 ? `obj_${j + 1}` : `obj_${j + 1}_${k + 1}`,
        labelKk: view ? `${o.label} — ${view}`.slice(0, 60) : o.label,
        position: { x: 0.5, y: 0.7 },
        providerInput: `img_${n + things.length + 1}`,
        order: n + things.length,
        kind: "object" as const,
        ...(k === 0 && o.target?.trim() ? { previewImagePath: o.target.trim() } : {}),
      });
    }
  });
  return [...people, ...things];
}

/** Seconds of output for a template video of this length (whole seconds, 3–30). */
export function seedanceOutputSec(durationSec: number): number {
  return Math.min(SEEDANCE_MAX_SEC, Math.max(SEEDANCE_MIN_SEC, Math.round(durationSec)));
}
