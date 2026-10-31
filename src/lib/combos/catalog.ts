import "server-only";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { faceSlotSchema, pricingConfigSchema } from "@/lib/templates/schema";
import { PHOTO_PROVIDER } from "@/lib/templates/photo-config";
import { mediaUrl } from "@/lib/templates/queries";
import { memo } from "@/lib/cache/memo";
import { comboConfigSchema } from "./worker";

/** A photo template that can go into a combo: published, catalog, Kling photo, one person. */
export type ComboItem = { id: string; title: string; priceKzt: number; cover: string | null };

export async function comboEligibleTemplates(): Promise<ComboItem[]> {
  const { data } = await supabaseAdmin().from("templates")
    .select("id,title_kk,cover_asset_path,face_slots_json,pricing_config_json")
    .eq("status", "published").eq("kind", "catalog").eq("provider_key", PHOTO_PROVIDER).is("deleted_at", null)
    .order("sort_order").order("title_kk");
  return (data ?? []).flatMap((t) => {
    const slots = z.array(faceSlotSchema).safeParse(t.face_slots_json);
    const pricing = pricingConfigSchema.safeParse(t.pricing_config_json);
    if (!slots.success || slots.data.length !== 1 || !pricing.success || !(pricing.data.basePriceKzt > 0)) return [];
    return [{ id: t.id, title: t.title_kk, priceKzt: pricing.data.basePriceKzt, cover: mediaUrl(t.cover_asset_path) }];
  });
}

/** Combo price: sum of the photo prices, minus the discount, rounded to 10 ₸. */
export function comboPrice(prices: number[], discountPercent: number): { sum: number; price: number } {
  const sum = prices.reduce((a, b) => a + b, 0);
  return { sum, price: Math.max(10, Math.round((sum * (1 - discountPercent / 100)) / 10) * 10) };
}

export type ComboCard = { id: string; title: string; count: number; priceKzt: number; sumKzt: number; covers: string[] };

/** Published combos for the Photos page (cached; cleared by admin writes). */
export async function listCombos(): Promise<ComboCard[]> {
  return memo("cat:combos", 120_000, async () => {
    const db = supabaseAdmin();
    const { data } = await db.from("templates")
      .select("id,title_kk,provider_config_json,pricing_config_json")
      .eq("status", "published").eq("kind", "combo").is("deleted_at", null).order("sort_order").order("created_at", { ascending: false });
    const combos = (data ?? []).flatMap((t) => {
      const cfg = comboConfigSchema.safeParse(t.provider_config_json);
      const p = pricingConfigSchema.safeParse(t.pricing_config_json);
      return cfg.success && p.success ? [{ t, cfg: cfg.data, price: p.data.basePriceKzt }] : [];
    });
    const ids = [...new Set(combos.flatMap((c) => c.cfg.templateIds))];
    const { data: items } = ids.length
      ? await db.from("templates").select("id,cover_asset_path,pricing_config_json").in("id", ids)
      : { data: [] as { id: string; cover_asset_path: string | null; pricing_config_json: unknown }[] };
    const byId = new Map((items ?? []).map((i) => [i.id, i]));
    return combos.map(({ t, cfg, price }) => {
      const parts = cfg.templateIds.map((id) => byId.get(id)).filter((x): x is NonNullable<typeof x> => !!x);
      const sum = parts.reduce((s, i) => s + (pricingConfigSchema.safeParse(i.pricing_config_json).data?.basePriceKzt ?? 0), 0);
      return {
        id: t.id, title: t.title_kk, count: cfg.templateIds.length, priceKzt: price, sumKzt: sum,
        covers: parts.map((i) => mediaUrl(i.cover_asset_path)).filter((u): u is string => !!u).slice(0, 4),
      };
    });
  });
}

/** Covers + titles of a combo's photos, for its page. */
export async function comboItems(templateIds: string[]): Promise<{ id: string; title: string; cover: string | null }[]> {
  if (!templateIds.length) return [];
  const { data } = await supabaseAdmin().from("templates").select("id,title_kk,cover_asset_path").in("id", templateIds);
  const byId = new Map((data ?? []).map((t) => [t.id, t]));
  return templateIds.flatMap((id) => {
    const t = byId.get(id);
    return t ? [{ id: t.id, title: t.title_kk, cover: mediaUrl(t.cover_asset_path) }] : [];
  });
}
