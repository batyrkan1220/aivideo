import { z } from "zod";
import type { PricingConfig, Quality } from "@/lib/templates/schema";
import { seedanceOutputSec } from "@/lib/templates/seedance-config";

/**
 * Seedance 2.5 (muapi, Intl Omni Reference, 720p) pricing.
 * muapi bills per second in USD; with a video reference it bills `refFactor` of the rate on the
 * reference length + output length. Cost in tenge = USD × admin's exchange rate; the customer
 * price = cost × (1 + markup), rounded up, never below the minimum.
 *
 * Shared by server (orders, checkout) and browser (live price after a video upload).
 */
export const seedancePricingSchema = z.object({
  usdPerSec: z.number().positive().max(100).default(0.374),
  refFactor: z.number().positive().max(2).default(0.65),
  tengePerUsd: z.number().positive().max(10_000).default(470),
  markupPercent: z.number().min(0).max(1000).default(150),
  minPriceKzt: z.number().int().min(0).max(1_000_000).default(1990),
  roundToKzt: z.number().int().min(1).max(10_000).default(10),
  /** muapi ai-video-face-swap pass after Seedance (Seedance itself does not keep a real face). */
  /** ai-video-face-swap, USD per second of video per person (muapi bill: 8 s → $0.75, 14.2 s → $1.33). */
  faceSwapUsdPerSec: z.number().min(0).max(10).default(0.094),
  /** Kling 3.0 Pro Motion Control (muapi), USD per output second. */
  klingUsdPerSec: z.number().min(0).max(10).default(0.194), // muapi bill: 8.06 s video → $1.744 (9 s billed)
  /** Wan 2.2 Animate replace (muapi), USD per second (muapi bill: 8 s → $1.12, 14 s → $1.96, 20 s → $2.80). */
  wanUsdPerSec: z.number().min(0).max(20).default(0.14),
  /** Wan: full-body customer image prepared first (nano-banana-pro-edit 2k). */
  prepUsd: z.number().min(0).max(5).default(0.12),
  /** Replicate p-video-replace, USD per output second at 720p (all people in one run). */
  pvrUsdPerSec: z.number().min(0).max(10).default(0.03),
  /** Kling 4.0 reference-to-video with a reference video, 720p: per (reference + output) second, min 2× output. */
  k4UsdPerSec: z.number().min(0).max(10).default(0.094),
  /** Kling official API, Kling 4.0 with video input, 720p: 0.6 unit/s × $0.14 (output seconds). */
  kdUsdPerSec: z.number().min(0).max(10).default(0.084),
  /** Kling: the customer put into the template frame first (nano-banana-pro-edit 2k $0.12 + image face swap $0.02). */
  composeUsd: z.number().min(0).max(5).default(0.14),
});
export type SeedancePricing = z.infer<typeof seedancePricingSchema>;
export const DEFAULT_SEEDANCE_PRICING: SeedancePricing = seedancePricingSchema.parse({});

export const SEEDANCE_QUALITY: Quality = {
  key: "720p", labelKk: "Жоғары сапа · 720p", resolution: "720p", providerQuality: "720p", surchargeKzt: 0, available: true,
};

/**
 * Seconds muapi bills: reference video rounded UP to whole seconds + output video.
 * Checked on a real job: 8.06 s reference → 9 + 8 = 17 s × $0.374 × 65 % = $4.133.
 */
export function seedanceBilledSec(durationSec: number): number {
  const out = seedanceOutputSec(durationSec);
  return Math.ceil(Math.min(durationSec, 30) - 1e-6) + out;
}

/** What the template does: "scene" = Seedance + face swap (default here), "swap" = face swap only. */
export type CostOpts = { mode?: "swap" | "scene" | "kling" | "wan" | "pvr" | "k4" | "kd"; people?: number; prepare?: boolean; faceSwap?: boolean };

export function seedanceCostUsd(durationSec: number, s: SeedancePricing, o: CostOpts = {}): number {
  // Kling: per output second + putting the customer into the template frame first.
  if (o.mode === "kling") return Math.round((Math.ceil(Math.min(durationSec, 30) - 1e-6) * s.klingUsdPerSec + s.composeUsd) * 10_000) / 10_000;
  const sec = Math.min(durationSec, 120);
  if (o.mode === "kd") {
    const out = Math.min(30, Math.max(3, Math.round(durationSec)));
    const swap = o.faceSwap === true && durationSec <= 29.5 ? faceSwapCostUsd(durationSec, s) : 0;
    return Math.round((out * s.kdUsdPerSec + swap) * 10_000) / 10_000;
  }
  if (o.mode === "k4") {
    const out = seedanceOutputSec(durationSec);
    const swap = durationSec <= 29.5 ? faceSwapCostUsd(durationSec, s) : 0; // face swap up to 600 frames (20 fps for long videos)
    return Math.round((Math.max(2 * out, Math.ceil(Math.min(durationSec, 30) - 1e-6) + out) * s.k4UsdPerSec + swap) * 10_000) / 10_000;
  }
  if (o.mode === "pvr") return Math.round(Math.ceil(sec - 1e-6) * s.pvrUsdPerSec * 10_000) / 10_000;
  const swaps = Math.max(1, o.people ?? 1) * faceSwapCostUsd(durationSec, s);
  if (o.mode === "wan") return Math.round((Math.round(sec) * s.wanUsdPerSec + swaps + (o.prepare === false ? 0 : s.prepUsd)) * 10_000) / 10_000;
  const scene = o.mode === "swap" ? 0 : seedanceBilledSec(durationSec) * s.usdPerSec * s.refFactor;
  return Math.round((scene + swaps) * 10_000) / 10_000;
}

/** One face swap pass over a video of this length. */
export function faceSwapCostUsd(durationSec: number, s: SeedancePricing): number {
  return Math.round(Math.min(durationSec, 120) * s.faceSwapUsdPerSec * 10_000) / 10_000;
}

export function seedanceCostKzt(durationSec: number, s: SeedancePricing, o: CostOpts = {}): number {
  return Math.round(seedanceCostUsd(durationSec, s, o) * s.tengePerUsd);
}

export function seedanceAutoPriceKzt(durationSec: number, s: SeedancePricing, o: CostOpts = {}): number {
  const raw = seedanceCostKzt(durationSec, s, o) * (1 + s.markupPercent / 100);
  return Math.max(s.minPriceKzt, Math.ceil(raw / s.roundToKzt) * s.roundToKzt);
}

/** Template price: a manual price (> 0) wins; otherwise automatic from the video length (null = unknown yet). */
export function seedancePriceKzt(durationSec: number | null, manualKzt: number, s: SeedancePricing, o: CostOpts = {}): number | null {
  if (manualKzt > 0) return manualKzt;
  if (durationSec === null || !(durationSec > 0)) return null;
  return seedanceAutoPriceKzt(durationSec, s, o);
}

/** Turns the price into the generic pricing model, so the calculator and checkout work unchanged. */
export function applySeedancePricing(pricing: PricingConfig, priceKzt: number): { pricing: PricingConfig; qualities: Quality[] } {
  return { pricing: { ...pricing, basePriceKzt: priceKzt, chargeExtraFaces: false }, qualities: [SEEDANCE_QUALITY] };
}
