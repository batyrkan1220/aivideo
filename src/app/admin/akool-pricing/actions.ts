"use server";
import { revalidatePath } from "next/cache";
import { audit, getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { akoolPricingSchema } from "@/lib/pricing-akool";
import { AKOOL_PRICING_KEY } from "@/lib/pricing-akool/settings";

export type AkoolPricingState = { ok?: boolean; error?: "forbidden" | "invalid" | "failed" };

export async function saveAkoolPricing(_: AkoolPricingState, fd: FormData): Promise<AkoolPricingState> {
  const u = await getSessionUser();
  if (!u || !can(u.role, "templates.manage")) return { error: "forbidden" };
  const num = (k: string) => Number(String(fd.get(k) ?? "").replace(",", "."));
  const p = akoolPricingSchema.safeParse({
    tengePerCredit: num("tengePerCredit"),
    markupPercent: num("markupPercent"),
    minPriceKzt: num("minPriceKzt"),
    roundToKzt: num("roundToKzt"),
    blockSec: num("blockSec"),
    creditsPerSec: { "480p": num("cps480"), "720p": num("cps720") },
  });
  if (!p.success) return { error: "invalid" };
  const { error } = await supabaseAdmin().from("site_settings").upsert({
    key: AKOOL_PRICING_KEY, value: p.data, updated_by: u.id, updated_at: new Date().toISOString(),
  });
  if (error) return { error: "failed" };
  await audit(u.id, "akool_pricing.update", "site_settings", null, p.data);
  revalidatePath("/admin");
  revalidatePath("/");
  return { ok: true };
}
