import { z } from "zod";
import type { FaceSlot } from "./schema";

/**
 * Template config for Kling 4.0 (Kling AI official API, 720p, 9:16).
 * "edit": the template video itself is edited — the people are replaced by the customer's photos,
 * everything else (scene, camera, motion, sound) stays. "reference": a new video following it.
 * (The provider key stays "seedance" for existing rows.)
 */
export const SEEDANCE_MAX_PEOPLE = 5;
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
  /** Photo labels for the customer, one per person (e.g. "Баланың фотосы"). */
  labels: z.array(z.string().trim().max(40)).max(5).default([]),
  /** The outfit: the customer's own (photo) or the original person's in the template. */
  outfit: z.enum(["photo", "template"]).default("photo"),
  /** Where each person is in the frame (English for the model), e.g. "on the left". */
  positions: z.array(z.string().trim().max(60)).max(5).default([]),
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
  return n === 1 ? "Сіздің фотоңыз" : `${i + 1}-адам (сол жақтан)`;
}

/** Customer upload slots. providerInput = `img_<n>` (= @image_<n> in the prompt). */
export function seedanceSlots(n: number, keyPrefix = "face_", labels: string[] = []): FaceSlot[] {
  return Array.from({ length: n }, (_, i) => ({
    key: `${keyPrefix}${i + 1}`,
    labelKk: labels[i]?.trim() || seedanceSlotLabel(i, n),
    position: { x: (i + 1) / (n + 1), y: 0.42 },
    providerInput: `img_${i + 1}`,
    order: i,
  }));
}

/** Seconds of output for a template video of this length (whole seconds, 3–30). */
export function seedanceOutputSec(durationSec: number): number {
  return Math.min(SEEDANCE_MAX_SEC, Math.max(SEEDANCE_MIN_SEC, Math.round(durationSec)));
}
