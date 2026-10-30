import { z } from "zod";
import type { FaceSlot, Quality } from "./schema";
import { seedanceSlots } from "./seedance-config";

/**
 * Photo templates: the customer's photo(s) + the template's example photo → a new photo made by
 * Kling's image model (official API, omni-image). Provider key "kling_photo".
 */
export const PHOTO_PROVIDER = "kling_photo";
export const PHOTO_MAX_PEOPLE = 4;
export const PHOTO_ASPECTS = ["3:4", "9:16", "2:3", "1:1", "4:3", "16:9"] as const;

export const PHOTO_QUALITY: Quality = {
  key: "2k", labelKk: "Фото · 2K", resolution: "2k", providerQuality: "2k", surchargeKzt: 0, available: true,
};

export const photoConfigSchema = z.object({
  /** What to make: scene, style, clothing (English works best). */
  prompt: z.string().trim().max(2000).catch("").default(""),
  people: z.number().int().min(1).max(PHOTO_MAX_PEOPLE).catch(1).default(1),
  aspectRatio: z.enum(PHOTO_ASPECTS).catch("3:4").default("3:4"),
  /** Recreate the template's example photo (cover) with the customer in it. */
  useExample: z.boolean().catch(true).default(true),
  allowWish: z.boolean().catch(true).default(true),
  labels: z.array(z.string().trim().max(40)).max(PHOTO_MAX_PEOPLE).catch([]).default([]),
});
export type PhotoConfig = z.infer<typeof photoConfigSchema>;

export function parsePhotoConfig(raw: unknown): PhotoConfig {
  const p = photoConfigSchema.safeParse(raw ?? {});
  return p.success ? p.data : photoConfigSchema.parse({});
}

export function photoSlots(n: number, labels: string[] = []): FaceSlot[] {
  return seedanceSlots(n, "face_", labels);
}

export const isPhotoProvider = (key: string | null | undefined) => key === PHOTO_PROVIDER;
