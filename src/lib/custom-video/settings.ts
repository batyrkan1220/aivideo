import "server-only";
import { memo } from "@/lib/cache/memo";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { SEEDANCE_MAX_SEC, SEEDANCE_MIN_SEC } from "@/lib/templates/seedance-config";

export const CUSTOM_VIDEO_KEY = "custom_video";
export const customVideoSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  priceKzt: z.number().int().min(100).max(1_000_000).default(2990),
  maxSeconds: z.number().int().min(3).max(60).default(20),
  maxMb: z.number().int().min(5).max(50).default(50),
  /** Price of an AI photo made from the customer's own description (Create → Photo). */
  photoPriceKzt: z.number().int().min(100).max(1_000_000).default(990),
});
export type CustomVideoSettings = z.infer<typeof customVideoSettingsSchema>;
/** Seedance: the customer's video is the motion reference (4–30 s). */
export const MIN_VIDEO_SECONDS = SEEDANCE_MIN_SEC;
export const VIDEO_TYPES = ["video/mp4", "video/quicktime"] as const;

export async function customVideoSettings(): Promise<CustomVideoSettings> {
  return memo("settings:custom", 60_000, loadCustom);
}

async function loadCustom(): Promise<CustomVideoSettings> {
  try {
    const { data } = await supabaseAdmin().from("site_settings").select("value").eq("key", CUSTOM_VIDEO_KEY).maybeSingle();
    const p = customVideoSettingsSchema.safeParse(data?.value ?? {});
    const v = p.success ? p.data : customVideoSettingsSchema.parse({});
    return { ...v, maxSeconds: Math.min(v.maxSeconds, SEEDANCE_MAX_SEC) };
  } catch {
    const v = customVideoSettingsSchema.parse({});
    return { ...v, maxSeconds: Math.min(v.maxSeconds, SEEDANCE_MAX_SEC) };
  }
}

/** The hidden published template that carries the photo slot + provider config for custom orders. */
export async function customTemplateId(): Promise<string | null> {
  return memo("tpl:custom", 300_000, async () => {
  const { data } = await supabaseAdmin().from("templates").select("id").eq("kind", "custom").eq("status", "published").limit(1).maybeSingle();
  return data?.id ?? null;
  });
}

/** The hidden published photo template for Create → AI photo (Kling image, the customer's description). */
export async function customPhotoTemplateId(): Promise<string | null> {
  return memo("tpl:custom_photo", 300_000, async () => {
  const { data } = await supabaseAdmin().from("templates").select("id").eq("kind", "custom_photo").eq("status", "published").limit(1).maybeSingle();
  return data?.id ?? null;
  });
}
