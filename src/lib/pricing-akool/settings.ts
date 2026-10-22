import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { akoolPricingSchema, DEFAULT_AKOOL_PRICING, type AkoolPricing } from "./index";

export const AKOOL_PRICING_KEY = "akool_pricing";

export async function akoolPricingSettings(): Promise<AkoolPricing> {
  try {
    const { data } = await supabaseAdmin().from("site_settings").select("value").eq("key", AKOOL_PRICING_KEY).maybeSingle();
    const p = akoolPricingSchema.safeParse(data?.value ?? {});
    return p.success ? p.data : DEFAULT_AKOOL_PRICING;
  } catch {
    return DEFAULT_AKOOL_PRICING;
  }
}
