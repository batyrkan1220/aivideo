"use server";
import { revalidatePath } from "next/cache";
import { audit, getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { seedancePricingSchema } from "@/lib/pricing-seedance";
import { SEEDANCE_PRICING_KEY } from "@/lib/pricing-seedance/settings";

export type SeedancePricingState = { ok?: boolean; error?: "forbidden" | "invalid" | "failed" };

export async function saveSeedancePricing(_: SeedancePricingState, fd: FormData): Promise<SeedancePricingState> {
  const u = await getSessionUser();
  if (!u || !can(u.role, "templates.manage")) return { error: "forbidden" };
  const num = (k: string) => Number(String(fd.get(k) ?? "").replace(",", "."));
  const p = seedancePricingSchema.safeParse({
    usdPerSec: num("usdPerSec"), refFactor: num("refFactor") / 100, tengePerUsd: num("tengePerUsd"),
    markupPercent: num("markupPercent"), minPriceKzt: num("minPriceKzt"), roundToKzt: num("roundToKzt"),
  });
  if (!p.success) return { error: "invalid" };
  const { error } = await supabaseAdmin().from("site_settings").upsert({
    key: SEEDANCE_PRICING_KEY, value: p.data, updated_by: u.id, updated_at: new Date().toISOString(),
  });
  if (error) return { error: "failed" };
  await audit(u.id, "seedance_pricing.update", "site_settings", null, p.data);
  revalidatePath("/admin");
  revalidatePath("/");
  return { ok: true };
}
