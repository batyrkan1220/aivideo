import { z } from "zod";

// One face slot. `key` is stable and is what uploads reference;
// `providerInput` is the name of the provider's input field for this face.
export const faceSlotSchema = z.object({
  key: z.string().regex(/^[a-z0-9_]+$/),
  labelKk: z.string().min(1),
  position: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
  providerInput: z.string().min(1),
  /** Optional preview of the person in the video this photo replaces (template-media path). */
  previewImagePath: z.string().max(300).optional(),
  order: z.number().int().min(0),
});

export const qualitySchema = z.object({
  key: z.string().regex(/^[a-z0-9_]+$/),
  labelKk: z.string().min(1),
  resolution: z.string().optional(), // e.g. "1280x720"
  fps: z.number().int().positive().optional(),
  maxDurationSec: z.number().positive().optional(),
  providerQuality: z.string().min(1),
  surchargeKzt: z.number().int().min(0),
  estimatedSec: z.number().positive().optional(),
  available: z.boolean().default(true),
});

export const pricingConfigSchema = z.object({
  basePriceKzt: z.number().int().min(0),
  chargeExtraFaces: z.boolean().default(false),
  extraFacePriceKzt: z.number().int().min(0).default(0),
  includedFaces: z.number().int().min(1).default(1),
  platformFeeKzt: z.number().int().min(0).default(0),
  discount: z
    .object({
      type: z.enum(["percent", "fixed"]),
      value: z.number().min(0),
      startsAt: z.string().datetime().optional(),
      endsAt: z.string().datetime().optional(),
    })
    .optional(),
  minPriceKzt: z.number().int().min(0).default(0),
  maxPriceKzt: z.number().int().positive().optional(),
});

export type FaceSlot = z.infer<typeof faceSlotSchema>;
export type Quality = z.infer<typeof qualitySchema>;
export type PricingConfig = z.infer<typeof pricingConfigSchema>;

/** Validates face slots against the declared face count. Returns error list (empty = ok). */
export function validateFaceSlots(slots: FaceSlot[], requiredCount: number): string[] {
  const errs: string[] = [];
  if (slots.length !== requiredCount) errs.push("face_count_mismatch");
  const keys = new Set(slots.map((s) => s.key));
  if (keys.size !== slots.length) errs.push("duplicate_slot_key");
  const inputs = new Set(slots.map((s) => s.providerInput));
  if (inputs.size !== slots.length) errs.push("duplicate_provider_input");
  return errs;
}

/** Slot label by position: left → right. */
export function autoFaceLabel(i: number, n: number): string {
  if (n === 1) return "Загрузите фото лица";
  const num = `${i + 1}-е лицо`;
  if (n === 2) return `${num} — ${i === 0 ? "слева" : "справа"}`;
  if (n === 3) return `${num} — ${["слева", "в центре", "справа"][i]}`;
  if (i === 0) return `${num} — крайнее слева`;
  if (i === n - 1) return `${num} — крайнее справа`;
  return num;
}

/**
 * Faces are placed side by side, evenly from left to right. Slot i always maps to
 * provider input `face_{i+1}`, so the mapping is deterministic and needs no manual setup.
 */
export function autoFaceSlots(n: number): FaceSlot[] {
  const count = Math.min(10, Math.max(1, Math.round(n)));
  return Array.from({ length: count }, (_, i) => ({
    key: `face_${i + 1}`,
    labelKk: autoFaceLabel(i, count),
    position: { x: (i + 1) / (count + 1), y: 0.42 },
    providerInput: `face_${i + 1}`,
    order: i,
  }));
}

/** Slots always rendered and sent in admin-defined order — never reordered implicitly. */
export function orderedSlots(slots: FaceSlot[]): FaceSlot[] {
  return [...slots].sort((a, b) => a.order - b.order);
}

/** Image src for a slot's person preview: absolute URL as-is, else relative to the media base. */
export function slotPreviewSrc(path: string | undefined, mediaBase = ""): string | null {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${mediaBase}/${path}`;
}
