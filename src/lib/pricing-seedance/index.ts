import { z } from "zod";
import type { PricingConfig, Quality } from "@/lib/templates/schema";
import { seedanceOutputSec } from "@/lib/templates/seedance-config";

/**
 * Kling 4.0 (official Kling API, 720p, with the template video) pricing.
 * Kling bills `klingUnitsPerSec` units for every second of the template video (exact) + every
 * second of the result (the whole seconds we ask for). Real bills: 10.04 s + 10 s → 12.02 units,
 * 15.04 s + 15 s → 18.02. Cost = units × unit price
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
  /** Estimated Kling cost of one photo (image model, 2K), $. */
  photoCostUsd: z.number().min(0).max(10).default(0.1),
});
export type SeedancePricing = z.infer<typeof seedancePricingSchema>;
export const DEFAULT_SEEDANCE_PRICING: SeedancePricing = seedancePricingSchema.parse({});

export const SEEDANCE_QUALITY: Quality = {
  key: "720p", labelKk: "Высокое качество · 720p", resolution: "720p", providerQuality: "720p", surchargeKzt: 0, available: true,
};
/** Full HD costs Kling ~1.5× of 720p (same per-second billing), so the customer pays +50%. */
export const HD1080_FACTOR = 1.5;
export const SEEDANCE_QUALITY_1080: Quality = {
  key: "1080p", labelKk: "Full HD · 1080p", resolution: "1080p", providerQuality: "1080p", surchargeKzt: 0, available: true,
};
/** Kling cost multiplier for a provider quality. */
export const qualityCostFactor = (providerQuality?: string | null) => (providerQuality === "1080p" ? HD1080_FACTOR : 1);

/** Kept for call sites; every template is Kling 4.0 now. */
export type CostOpts = { mode?: string; people?: number };

/** Kling units for a template video of this length (720p). 1080p is this × HD1080_FACTOR. */
export function klingUnits(durationSec: number, s: SeedancePricing): number {
  const input = Math.min(Math.max(durationSec, 0), 30);
  const output = seedanceOutputSec(durationSec);
  return Math.round((input + output) * s.klingUnitsPerSec * 100) / 100;
}

/** Units a stored provider cost stands for (cost ÷ unit price). Null when nothing was spent. */
export function unitsFromUsd(costUsd: number, s: SeedancePricing): number | null {
  if (!(costUsd > 0) || !(s.klingUnitUsd > 0)) return null;
  return Math.round((costUsd / s.klingUnitUsd) * 100) / 100;
}

/** Admin-facing line: units this video takes at 720p and at 1080p. */
export function klingUnitLabel(durationSec: number, s: SeedancePricing): string {
  const u = klingUnits(durationSec, s);
  const hd = Math.round(u * HD1080_FACTOR * 100) / 100;
  const text = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
  return `Kling: ${text(u)} юн. (720p) · ${text(hd)} юн. (1080p)`;
}

export function seedanceCostUsd(durationSec: number, s: SeedancePricing, _o: CostOpts = {}, providerQuality?: string | null): number {
  return Math.round(klingUnits(durationSec, s) * s.klingUnitUsd * qualityCostFactor(providerQuality) * 10_000) / 10_000;
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
  // 720p is the default; 1080p adds half of the price (rounded up to 10 ₸).
  const hd = Math.ceil((priceKzt * (HD1080_FACTOR - 1)) / 10) * 10;
  return {
    pricing: { ...pricing, basePriceKzt: priceKzt, chargeExtraFaces: false },
    qualities: [SEEDANCE_QUALITY, { ...SEEDANCE_QUALITY_1080, surchargeKzt: hd }],
  };
}
