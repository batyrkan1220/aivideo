import "server-only";
import { z } from "zod";
import { memo } from "@/lib/cache/memo";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Catalog switches. multiPeople: templates with 2–3 people (one Kling run per person, still being
 * tested) are shown to customers only when this is on; off = they show "Шаблон недоступен".
 */
export const CATALOG_KEY = "catalog";
const schema = z.object({ multiPeople: z.boolean().default(false) });
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
