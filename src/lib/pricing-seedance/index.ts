import { z } from "zod";
import type { PricingConfig, Quality } from "@/lib/templates/schema";
import { seedanceOutputSec } from "@/lib/templates/seedance-config";

/**
 * Kling 4.0 (official Kling API, 720p, with the template video) pricing.
 * Kling bills `klingUnitsPerSec` units for every second of the template video (rounded) + every
 * second of the result (real bills: 12.88 s → 15.6 units, 6.96 s → 8.4). Cost = units × unit price
 * × $ rate; the customer price = cost × (1 + markup), rounded up, never below the minimum.
 *
 * Shared by server (orders, checkout) and browser (live price after a video upload).
 */
export const seedancePricingSchema = z.object({
  tengePerUsd: z.number().positive().max(10_000).default(470),
  markupPercent: z.number().min(0).max(1000).default(150),
  minPriceKzt: z.number().int().min(0).max(1_000_000).default(1990),
  roundToKzt: z.number().int().min(1).max(10_000).default(10),
  /** Price of one Kling unit in your resource pack, $ (pack price ÷ units). */
  klingUnitUsd: z.number().min(0).max(10).default(0.14),
  /** Units per counted second (template video + result), Kling 4.0 720p. */
  klingUnitsPerSec: z.number().min(0).max(10).default(0.6),
});
export type SeedancePricing = z.infer<typeof seedancePricingSchema>;
export const DEFAULT_SEEDANCE_PRICING: SeedancePricing = seedancePricingSchema.parse({});

export const SEEDANCE_QUALITY: Quality = {
  key: "720p", labelKk: "Высокое качество · 720p", resolution: "720p", providerQuality: "720p", surchargeKzt: 0, available: true,
};

/** Kept for call sites; every template is Kling 4.0 now. */
export type CostOpts = { mode?: string; people?: number };

/** Kling units for a template video of this length. */
export function klingUnits(durationSec: number, s: SeedancePricing): number {
  const counted = Math.round(Math.min(durationSec, 30)) + seedanceOutputSec(durationSec);
  return Math.round(counted * s.klingUnitsPerSec * 100) / 100;
}

export function seedanceCostUsd(durationSec: number, s: SeedancePricing, _o: CostOpts = {}): number {
  return Math.round(klingUnits(durationSec, s) * s.klingUnitUsd * 10_000) / 10_000;
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
