import { z } from "zod";
import type { FaceSlot } from "./schema";

/**
 * Template provider config for Seedance 2.5 Omni Reference (muapi.ai, Intl endpoint, 720p).
 *
 * The template video is the motion reference (@Video1); each customer photo is a character
 * reference (@Image1…). Seedance re-creates the video: motion, timing and camera come from the
 * template, the person from the photo, and the admin's / customer's text can change the
 * background, outfit and style. Shared by the admin editor, the server save path and the adapter.
 */
export const SEEDANCE_MAX_PEOPLE = 5;
export const SEEDANCE_MIN_SEC = 4;
export const SEEDANCE_MAX_SEC = 30; // Seedance: reference video and output up to 30 s

export const seedanceConfigSchema = z.object({
  /**
   * swap  = only the face is replaced in the template video (muapi ai-video-face-swap; cheap, fast).
   * scene = Seedance re-creates the video (background, outfit, customer wish), then the face swap.
   * kling = Kling 3.0 Pro Motion Control: the customer's photo performs the template's motion
   *         (one person; face, hair, outfit and background come from the photo).
   * wan   = Wan 2.2 Animate "replace": the person in the template video is replaced by the person
   *         from the photo, the template's background/lighting stay; then a face swap pass.
   */
  mode: z.enum(["wan", "swap", "scene", "kling"]).default("wan"),
  /** How many people in the video are replaced (one customer photo each, left → right). */
  people: z.number().int().min(1).max(SEEDANCE_MAX_PEOPLE).default(1),
  /** What photo the customer needs (shown on the order page). */
  framing: z.enum(["face", "half", "full"]).default("half"),
  aspectRatio: z.enum(["adaptive", "9:16", "16:9", "1:1", "3:4", "4:3"]).default("adaptive"),
  /** Admin's instruction for this template (scene, outfit, style…), in any language. */
  prompt: z.string().trim().max(1500).default(""),
  /** Customer may describe a wish (background, outfit…). */
  allowWish: z.boolean().default(true),
  /** Kling: a full-size frame of the template video (storage path), the scene the customer is put into. */
  framePath: z.string().max(300).nullable().default(null),
});
export type SeedanceConfig = z.infer<typeof seedanceConfigSchema>;
export type SeedanceMode = SeedanceConfig["mode"];
/** Longest template video a mode accepts (Wan 2.2 Animate: up to 120 s; the others: 30 s). */
export const maxSecFor = (mode: unknown) => (mode === "wan" || mode === undefined || mode === null ? 120 : SEEDANCE_MAX_SEC);
export const parseSeedanceMode = (v: unknown): SeedanceMode => (v === "scene" || v === "swap" || v === "kling" ? v : "wan");
export type PhotoFraming = SeedanceConfig["framing"];

export function parseSeedanceConfig(raw: unknown): SeedanceConfig {
  const p = seedanceConfigSchema.safeParse(raw ?? {});
  return p.success ? p.data : seedanceConfigSchema.parse({});
}

export function seedanceSlotLabel(i: number, n: number) {
  return n === 1 ? "Сіздің фотоңыз" : `${i + 1}-адам (сол жақтан)`;
}

/** Customer upload slots, left → right. providerInput = `img_<n>` (= @Image<n> in the prompt). */
export function seedanceSlots(n: number, keyPrefix = "face_"): FaceSlot[] {
  return Array.from({ length: n }, (_, i) => ({
    key: `${keyPrefix}${i + 1}`,
    labelKk: seedanceSlotLabel(i, n),
    position: { x: (i + 1) / (n + 1), y: 0.42 },
    providerInput: `img_${i + 1}`,
    order: i,
  }));
}

/** Seconds of output for a reference video of this length (Seedance accepts whole seconds). */
export function seedanceOutputSec(durationSec: number): number {
  return Math.min(SEEDANCE_MAX_SEC, Math.max(SEEDANCE_MIN_SEC, Math.round(durationSec)));
}
