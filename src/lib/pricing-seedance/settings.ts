import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { seedancePricingSchema, DEFAULT_SEEDANCE_PRICING, type SeedancePricing } from "./index";

export const SEEDANCE_PRICING_KEY = "seedance_pricing";

export async function seedancePricingSettings(): Promise<SeedancePricing> {
  try {
    const { data } = await supabaseAdmin().from("site_settings").select("value").eq("key", SEEDANCE_PRICING_KEY).maybeSingle();
    const p = seedancePricingSchema.safeParse(data?.value ?? {});
    return p.success ? p.data : DEFAULT_SEEDANCE_PRICING;
  } catch {
    return DEFAULT_SEEDANCE_PRICING;
  }
}
