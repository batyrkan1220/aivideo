import { z } from "zod";
import type { PricingConfig, Quality } from "@/lib/templates/schema";

/**
 * Akool Character Swap pricing. Akool bills credits per second of video, more for higher
 * resolution. Admin sets the rates and what one credit costs in tenge (by the exchange rate);
 * the customer price is cost × (1 + markup), rounded up, never below the minimum.
 *
 * Shared by server (orders, checkout) and browser (live price after a video upload).
 */
export const AKOOL_RESOLUTIONS = ["720p", "480p"] as const;
export type AkoolResolution = (typeof AKOOL_RESOLUTIONS)[number];

export const akoolPricingSchema = z.object({
  tengePerCredit: z.number().positive().max(100_000).default(25),
  markupPercent: z.number().min(0).max(1000).default(100),
  minPriceKzt: z.number().int().min(0).max(1_000_000).default(990),
  roundToKzt: z.number().int().min(1).max(10_000).default(10),
  /** Akool bills per started block of seconds (Character Swap V5: 5 s). */
  blockSec: z.number().int().min(1).max(60).default(5),
  creditsPerSec: z.object({
    "480p": z.number().positive().max(100).default(1),
    "720p": z.number().positive().max(100).default(2),
  }).default({ "480p": 1, "720p": 2 }),
});
export type AkoolPricing = z.infer<typeof akoolPricingSchema>;
export const DEFAULT_AKOOL_PRICING: AkoolPricing = akoolPricingSchema.parse({});

/** Customer-facing qualities for every Akool template (Akool output resolutions). */
export const AKOOL_QUALITY_LABELS: Record<AkoolResolution, string> = { "720p": "Жоғары сапа · 720p", "480p": "Стандарт · 480p" };

export function akoolBilledSeconds(durationSec: number, s: AkoolPricing): number {
  return Math.max(1, Math.ceil(durationSec / s.blockSec)) * s.blockSec;
}

export function akoolCredits(durationSec: number, res: AkoolResolution, s: AkoolPricing): number {
  return Math.ceil(akoolBilledSeconds(durationSec, s) * s.creditsPerSec[res]);
}

export function akoolCostKzt(durationSec: number, res: AkoolResolution, s: AkoolPricing): number {
  return Math.round(akoolCredits(durationSec, res, s) * s.tengePerCredit);
}

export function akoolAutoPriceKzt(durationSec: number, res: AkoolResolution, s: AkoolPricing): number {
  const raw = akoolCostKzt(durationSec, res, s) * (1 + s.markupPercent / 100);
  return Math.max(s.minPriceKzt, Math.ceil(raw / s.roundToKzt) * s.roundToKzt);
}

/**
 * Price per resolution. A manual template price (> 0) is the 720p price; 480p is cheaper by
 * the automatic difference. Without a manual price the price is fully automatic and needs
 * the duration (null = not priceable yet).
 */
export function akoolTierPrices(durationSec: number | null, manualKzt: number, s: AkoolPricing): Record<AkoolResolution, number> | null {
  const has = durationSec !== null && durationSec > 0;
  if (manualKzt > 0) {
    if (!has) return { "720p": manualKzt, "480p": manualKzt };
    const diff = akoolAutoPriceKzt(durationSec!, "720p", s) - akoolAutoPriceKzt(durationSec!, "480p", s);
    return { "720p": manualKzt, "480p": Math.max(Math.min(manualKzt, s.minPriceKzt), manualKzt - diff) };
  }
  if (!has) return null;
  return { "720p": akoolAutoPriceKzt(durationSec!, "720p", s), "480p": akoolAutoPriceKzt(durationSec!, "480p", s) };
}

/**
 * Turns tier prices into the generic pricing model (base + per-quality surcharge), so the
 * existing calculator, order snapshot and checkout re-validation work unchanged.
 */
export function applyAkoolPricing(pricing: PricingConfig, tiers: Record<AkoolResolution, number>): { pricing: PricingConfig; qualities: Quality[] } {
  const base = Math.min(tiers["480p"], tiers["720p"]);
  return {
    pricing: { ...pricing, basePriceKzt: base },
    qualities: AKOOL_RESOLUTIONS.map((r) => ({
      key: r, labelKk: AKOOL_QUALITY_LABELS[r], resolution: r, providerQuality: r,
      surchargeKzt: tiers[r] - base, available: true,
    })),
  };
}

export const isAkoolResolution = (v: unknown): v is AkoolResolution => v === "480p" || v === "720p";
