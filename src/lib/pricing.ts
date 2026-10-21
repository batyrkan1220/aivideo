import type { PricingConfig, Quality } from "./templates/schema";

export type PriceBreakdown = {
  basePriceKzt: number;
  qualityKey: string;
  qualitySurchargeKzt: number;
  extraFaces: number;
  extraFacesKzt: number;
  platformFeeKzt: number;
  discountKzt: number;
  totalKzt: number;
};

function discountActive(d: NonNullable<PricingConfig["discount"]>, now: Date) {
  if (d.startsAt && now < new Date(d.startsAt)) return false;
  if (d.endsAt && now > new Date(d.endsAt)) return false;
  return true;
}

/**
 * Server-side price calculation. Integer tenge only.
 * total = base + quality surcharge + extra faces + platform fee − discount,
 * clamped to [minPrice, maxPrice].
 */
export function calculatePrice(
  cfg: PricingConfig,
  quality: Quality,
  faceCount: number,
  now: Date = new Date(),
): PriceBreakdown {
  const extraFaces = cfg.chargeExtraFaces ? Math.max(0, faceCount - cfg.includedFaces) : 0;
  const extraFacesKzt = extraFaces * cfg.extraFacePriceKzt;
  const subtotal = cfg.basePriceKzt + quality.surchargeKzt + extraFacesKzt;

  let discountKzt = 0;
  if (cfg.discount && discountActive(cfg.discount, now)) {
    discountKzt =
      cfg.discount.type === "percent"
        ? Math.round((subtotal * Math.min(cfg.discount.value, 100)) / 100)
        : Math.round(cfg.discount.value);
    discountKzt = Math.min(discountKzt, subtotal);
  }

  let total = subtotal - discountKzt + cfg.platformFeeKzt;
  total = Math.max(total, cfg.minPriceKzt);
  if (cfg.maxPriceKzt !== undefined) total = Math.min(total, cfg.maxPriceKzt);

  return {
    basePriceKzt: cfg.basePriceKzt,
    qualityKey: quality.key,
    qualitySurchargeKzt: quality.surchargeKzt,
    extraFaces,
    extraFacesKzt,
    platformFeeKzt: cfg.platformFeeKzt,
    discountKzt,
    totalKzt: total,
  };
}

/** Lowest price across available qualities — for "бастап" on catalog cards. */
export function startingPrice(cfg: PricingConfig, qualities: Quality[], faceCount: number): number | null {
  const avail = qualities.filter((q) => q.available);
  if (!avail.length) return null;
  return Math.min(...avail.map((q) => calculatePrice(cfg, q, faceCount).totalKzt));
}

/** kk-KZ tenge formatting: "12 500 ₸" */
export function formatKzt(amount: number): string {
  return new Intl.NumberFormat("kk-KZ", {
    style: "currency",
    currency: "KZT",
    maximumFractionDigits: 0,
  }).format(amount);
}
