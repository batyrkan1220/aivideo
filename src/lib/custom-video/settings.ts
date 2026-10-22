import "server-only";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";

export const CUSTOM_VIDEO_KEY = "custom_video";
export const customVideoSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  priceKzt: z.number().int().min(100).max(1_000_000).default(2990),
  maxSeconds: z.number().int().min(3).max(60).default(20),
  maxMb: z.number().int().min(5).max(50).default(50),
});
export type CustomVideoSettings = z.infer<typeof customVideoSettingsSchema>;
export const MIN_VIDEO_SECONDS = 2;
export const VIDEO_TYPES = ["video/mp4", "video/quicktime"] as const;

export async function customVideoSettings(): Promise<CustomVideoSettings> {
  try {
    const { data } = await supabaseAdmin().from("site_settings").select("value").eq("key", CUSTOM_VIDEO_KEY).maybeSingle();
    const p = customVideoSettingsSchema.safeParse(data?.value ?? {});
    return p.success ? p.data : customVideoSettingsSchema.parse({});
  } catch {
    return customVideoSettingsSchema.parse({});
  }
}

/** The hidden published template that carries the photo slot + provider config for custom orders. */
export async function customTemplateId(): Promise<string | null> {
  const { data } = await supabaseAdmin().from("templates").select("id").eq("kind", "custom").eq("status", "published").limit(1).maybeSingle();
  return data?.id ?? null;
}
