import "server-only";
import { z } from "zod";
import { memo } from "@/lib/cache/memo";
import { supabaseAdmin } from "@/lib/supabase/server";

/** Ad pixels and analytics. IDs are public (they go to the page); tokens/secrets stay on the server. */
export const PIXELS_KEY = "pixels";
const id = (re: RegExp) => z.string().trim().regex(re).or(z.literal("")).default("");
export const pixelSettingsSchema = z.object({
  tiktokPixelId: id(/^[A-Z0-9]{10,30}$/),
  tiktokToken: z.string().trim().max(400).default(""),
  tiktokTestCode: z.string().trim().max(40).default(""),
  metaPixelId: id(/^\d{8,20}$/),
  metaToken: z.string().trim().max(600).default(""),
  metaTestCode: z.string().trim().max(40).default(""),
  ga4Id: id(/^G-[A-Z0-9]{4,15}$/),
  ga4Secret: z.string().trim().max(100).default(""),
  ymId: id(/^\d{5,12}$/),
});
export type PixelSettings = z.infer<typeof pixelSettingsSchema>;
export type PublicPixels = { tiktok: string | null; meta: string | null; ga4: string | null; ym: string | null };

export async function pixelSettings(): Promise<PixelSettings> {
  return memo("settings:pixels", 60_000, async () => {
    try {
      const { data } = await supabaseAdmin().from("site_settings").select("value").eq("key", PIXELS_KEY).maybeSingle();
      const p = pixelSettingsSchema.safeParse(data?.value ?? {});
      return p.success ? p.data : pixelSettingsSchema.parse({});
    } catch {
      return pixelSettingsSchema.parse({});
    }
  }, { swr: true });
}

export async function publicPixels(): Promise<PublicPixels> {
  const s = await pixelSettings();
  return { tiktok: s.tiktokPixelId || null, meta: s.metaPixelId || null, ga4: s.ga4Id || null, ym: s.ymId || null };
}
