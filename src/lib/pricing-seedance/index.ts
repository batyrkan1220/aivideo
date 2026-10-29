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
  faceSwapUsd: z.number().min(0).max(10).default(0.1),
  /** Kling 3.0 Pro Motion Control (muapi), USD per output second. */
  klingUsdPerSec: z.number().min(0).max(10).default(0.16),
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
export type CostOpts = { mode?: "swap" | "scene" | "kling"; people?: number };

export function seedanceCostUsd(durationSec: number, s: SeedancePricing, o: CostOpts = {}): number {
  if (o.mode === "kling") return Math.round(Math.ceil(Math.min(durationSec, 30) - 1e-6) * s.klingUsdPerSec * 10_000) / 10_000;
  const swaps = Math.max(1, o.people ?? 1) * s.faceSwapUsd;
  const scene = o.mode === "swap" ? 0 : seedanceBilledSec(durationSec) * s.usdPerSec * s.refFactor;
  return Math.round((scene + swaps) * 10_000) / 10_000;
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
