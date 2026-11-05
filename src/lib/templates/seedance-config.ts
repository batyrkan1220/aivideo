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
/** Kling 4.0 takes up to 10 reference images; we send people + objects. */
export const SEEDANCE_MAX_REFS = SEEDANCE_MAX_PEOPLE + SEEDANCE_MAX_OBJECTS;

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
});
export type SwapObject = z.infer<typeof objectSchema>;
export const SEEDANCE_MIN_SEC = 3;
export const SEEDANCE_MAX_SEC = 30; // Kling 4.0: input video 3–30 s

export const seedanceConfigSchema = z.object({
  /** Only Kling 4.0 (official API) now; any older value is read as it. */
  mode: z.literal("kd").catch("kd").default("kd"),
  klingMode: z.enum(["edit", "reference"]).catch("edit").default("edit"),
  /** How many people in the video are replaced (one customer photo each). */
  people: z.number().int().min(1).max(SEEDANCE_MAX_PEOPLE).default(1),
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
  positions: z.array(z.string().trim().max(60)).max(5).default([]),
  /** Things in the video to replace with the customer's photos (after the people). */
  objects: z.array(objectSchema).max(SEEDANCE_MAX_OBJECTS).catch([]).default([]),
  /**
   * People Kling found in the template video, in slot order.
   * elements[0].id is the person client photo 1 replaces, elements[1].id is photo 2, and so on.
   */
  klingElements: z.array(z.object({
    id: z.string().trim().min(1).max(80),
    previewPath: z.string().trim().min(1).max(2000),
    startMs: z.number().int().min(0).max(120_000).optional(),
    endMs: z.number().int().min(0).max(120_000).optional(),
  })).max(SEEDANCE_MAX_PEOPLE).catch([]).default([]),
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
export function seedanceSlots(n: number, keyPrefix = "face_", labels: string[] = [], objects: SwapObject[] = [], previews: string[] = [], klingIds: string[] = []): FaceSlot[] {
  const people: FaceSlot[] = Array.from({ length: n }, (_, i) => ({
    key: `${keyPrefix}${i + 1}`,
    labelKk: labels[i]?.trim() || seedanceSlotLabel(i, n),
    position: { x: (i + 1) / (n + 1), y: 0.42 },
    providerInput: `img_${i + 1}`,
    order: i,
    ...(previews[i] ? { previewImagePath: previews[i] } : {}),
    ...(klingIds[i] ? { klingId: klingIds[i] } : {}),
  }));
  const things: FaceSlot[] = objects.slice(0, SEEDANCE_MAX_OBJECTS).map((o, j) => ({
    key: `obj_${j + 1}`,
    labelKk: o.label,
    position: { x: 0.5, y: 0.7 },
    providerInput: `img_${n + j + 1}`,
    order: n + j,
    kind: "object" as const,
  }));
  return [...people, ...things];
}

/** Seconds of output for a template video of this length (whole seconds, 3–30). */
export function seedanceOutputSec(durationSec: number): number {
  return Math.min(SEEDANCE_MAX_SEC, Math.max(SEEDANCE_MIN_SEC, Math.round(durationSec)));
}
