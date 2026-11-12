import "server-only";
import { z } from "zod";
import { memo } from "@/lib/cache/memo";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getTemplateForAdmin, type TemplateDetail } from "@/lib/templates/queries";

export const PRODUCT_VIDEO_KEY = "product_video";
export const productVideoSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  price5Kzt: z.number().int().min(100).max(1_000_000).default(1990),
  price10Kzt: z.number().int().min(100).max(1_000_000).default(2990),
});
export type ProductVideoSettings = z.infer<typeof productVideoSettingsSchema>;

export async function productVideoSettings(): Promise<ProductVideoSettings> {
  return memo("settings:product", 60_000, async () => {
    try {
      const { data } = await supabaseAdmin().from("site_settings").select("value").eq("key", PRODUCT_VIDEO_KEY).maybeSingle();
      const p = productVideoSettingsSchema.safeParse(data?.value ?? {});
      return p.success ? p.data : productVideoSettingsSchema.parse({});
    } catch {
      return productVideoSettingsSchema.parse({});
    }
  }, { swr: true });
}

export const productPriceKzt = (s: ProductVideoSettings, durationSec: number) => (durationSec > 5 ? s.price10Kzt : s.price5Kzt);

/** The hidden published template behind «Видео товара» (slots, quality, provider). */
export async function productTemplate(): Promise<TemplateDetail | null> {
  const id = await memo("tpl:product", 300_000, async () => {
    const { data } = await supabaseAdmin().from("templates").select("id").eq("kind", "product").eq("status", "published").limit(1).maybeSingle();
    return (data?.id as string | undefined) ?? null;
  }, { swr: true });
  if (!id) return null;
  return memo(`tpl:flow:${id}`, 300_000, () => getTemplateForAdmin(id), { swr: true });
}
