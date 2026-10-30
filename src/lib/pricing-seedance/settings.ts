import "server-only";
import { memo } from "@/lib/cache/memo";
import { supabaseAdmin } from "@/lib/supabase/server";
import { seedancePricingSchema, DEFAULT_SEEDANCE_PRICING, type SeedancePricing } from "./index";

export const SEEDANCE_PRICING_KEY = "seedance_pricing";

export async function seedancePricingSettings(): Promise<SeedancePricing> {
  return memo("settings:pricing", 60_000, loadPricing);
}

async function loadPricing(): Promise<SeedancePricing> {
  try {
    const { data } = await supabaseAdmin().from("site_settings").select("value").eq("key", SEEDANCE_PRICING_KEY).maybeSingle();
    const p = seedancePricingSchema.safeParse(data?.value ?? {});
    return p.success ? p.data : DEFAULT_SEEDANCE_PRICING;
  } catch {
    return DEFAULT_SEEDANCE_PRICING;
  }
}
