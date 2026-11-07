import "server-only";
import { z } from "zod";
import { memo } from "@/lib/cache/memo";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Catalog switches. multiPeople: templates with 2–3 people (one Kling run per person, still being
 * tested) are shown to customers only when this is on; off = they show "Шаблон недоступен".
 * requireAnalysis: catalog video templates need the AI analysis before customers can order them;
 * off = they are open without it (while Gemini is not available).
 */
export const CATALOG_KEY = "catalog";
// splitShots: edit a template with cuts shot by shot (off: the whole video goes to Kling at once;
// shot by shot kept the face after cuts but every shot came out a little different, TM-100040).
const schema = z.object({ multiPeople: z.boolean().default(false), requireAnalysis: z.boolean().default(true), splitShots: z.boolean().default(false) });
export type CatalogSettings = z.infer<typeof schema>;

export function catalogSettings(): Promise<CatalogSettings> {
  return memo("settings:catalog", 60_000, async () => {
    try {
      const { data } = await supabaseAdmin().from("site_settings").select("value").eq("key", CATALOG_KEY).maybeSingle();
      return schema.parse(data?.value ?? {});
    } catch {
      return schema.parse({});
    }
  });
}
