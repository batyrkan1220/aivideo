import "server-only";
import { memo } from "@/lib/cache/memo";
import { connection } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { cachedNewest, cachedTemplate, cachedTrending, type TemplateDetail } from "./queries";

export const SHOWCASE_KEY = "home_showcase";
/** [center, left, right] template ids; null = fill automatically. */
export const showcaseSchema = z.array(z.string().uuid().nullable()).length(3);

export async function readShowcaseSetting(): Promise<(string | null)[]> {
  await connection();
  try {
    const { data } = await supabaseAdmin().from("site_settings").select("value").eq("key", SHOWCASE_KEY).maybeSingle();
    const parsed = showcaseSchema.safeParse(data?.value);
    return parsed.success ? parsed.data : [null, null, null];
  } catch {
    return [null, null, null];
  }
}

/**
 * Homepage showcase: admin-chosen templates first (in their slots), any empty or
 * unpublished slot is filled automatically (trending, then newest). Returns [center, left, right].
 */
export async function resolveShowcase(): Promise<TemplateDetail[]> {
  await connection();
  return memo("cat:showcase", 60_000, loadShowcase, { swr: true });
}

/** Server start: fill the showcase cache (no request scope here). */
export async function warmShowcase() {
  await memo("cat:showcase", 60_000, loadShowcase, { swr: true });
}

async function loadShowcase(): Promise<TemplateDetail[]> {
  const chosen = await readShowcaseSetting();
  const picked = await Promise.all(chosen.map((id) => (id ? cachedTemplate(id) : Promise.resolve(null))));
  const hasMedia = (t: TemplateDetail | null): t is TemplateDetail => !!t && !!(t.coverUrl || t.previewUrl);
  const used = new Set(picked.filter(hasMedia).map((t) => t.id));

  const [trending, latest] = await Promise.all([cachedTrending(6), cachedNewest(6)]);
  const pool = [...trending, ...latest].filter((t) => hasMedia(t) && !used.has(t.id));
  const seen = new Set<string>();
  const fallback = pool.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));

  const result: TemplateDetail[] = [];
  for (const slot of picked) {
    const t = hasMedia(slot) ? slot : fallback.shift();
    if (t) result.push(t);
  }
  return result;
}
