import "server-only";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { env } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/server";
import { faceSlotSchema, qualitySchema, pricingConfigSchema, orderedSlots, type FaceSlot, type Quality } from "./schema";
import { startingPrice } from "@/lib/pricing";

/** Cookie-less anon client for public catalog reads (RLS: published templates only). */
function supabasePublic() {
  const e = env();
  return createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type Category = { id: string; title: string; slug: string };

export type TemplateCard = {
  id: string;
  title: string;
  description: string;
  faceCount: number;
  qualityLabels: string[];
  startingPriceKzt: number | null;
  coverUrl: string | null;
  previewUrl: string | null;
  isTrending: boolean;
  category: Category | null;
};

export type TemplateDetail = TemplateCard & {
  faceSlots: FaceSlot[];
  qualities: Quality[];
  pricing: z.infer<typeof pricingConfigSchema>;
  maxUploadBytes: number;
};

const CARD_COLUMNS =
  "id,title_kk,description_kk,required_face_count,cover_asset_path,preview_video_path,supported_qualities_json,pricing_config_json,face_slots_json,max_upload_bytes,is_trending,categories(id,title_kk,slug)";

type Row = {
  id: string; title_kk: string; description_kk: string; required_face_count: number;
  cover_asset_path: string | null; preview_video_path: string | null;
  supported_qualities_json: unknown; pricing_config_json: unknown; face_slots_json: unknown;
  max_upload_bytes: number; is_trending: boolean;
  categories: { id: string; title_kk: string; slug: string } | { id: string; title_kk: string; slug: string }[] | null;
};

/** Public media URL from the `template-media` bucket (or pass-through for absolute URLs). */
export function mediaUrl(path: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return `${env().NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/template-media/${path.replace(/^\/+/, "")}`;
}

function parseRow(r: Row): TemplateDetail | null {
  const qualities = z.array(qualitySchema).safeParse(r.supported_qualities_json);
  const pricing = pricingConfigSchema.safeParse(r.pricing_config_json);
  const slots = z.array(faceSlotSchema).safeParse(r.face_slots_json);
  if (!qualities.success || !pricing.success || !slots.success) {
    console.error("[templates] invalid config", r.id);
    return null; // never show a template whose configuration can't be priced
  }
  const cat = Array.isArray(r.categories) ? r.categories[0] : r.categories;
  const available = qualities.data.filter((q) => q.available);
  return {
    id: r.id,
    title: r.title_kk,
    description: r.description_kk,
    faceCount: r.required_face_count,
    qualityLabels: available.map((q) => q.labelKk),
    startingPriceKzt: startingPrice(pricing.data, qualities.data, r.required_face_count),
    coverUrl: mediaUrl(r.cover_asset_path),
    previewUrl: mediaUrl(r.preview_video_path),
    isTrending: r.is_trending,
    category: cat ? { id: cat.id, title: cat.title_kk, slug: cat.slug } : null,
    faceSlots: orderedSlots(slots.data),
    qualities: qualities.data,
    pricing: pricing.data,
    maxUploadBytes: r.max_upload_bytes,
  };
}

const toCards = (rows: Row[] | null) =>
  (rows ?? []).map(parseRow).filter((t): t is TemplateDetail => t !== null);

export async function listCategories(): Promise<Category[]> {
  const { data, error } = await supabasePublic()
    .from("categories").select("id,title_kk,slug").order("sort_order");
  if (error) { console.error("[categories]", error.code); return []; }
  return data.map((c) => ({ id: c.id, title: c.title_kk, slug: c.slug }));
}

export type CatalogSort = "new" | "trending";
export const PAGE_SIZE = 12;

/** Strip characters that have meaning in PostgREST filter syntax. */
function sanitizeSearch(q: string) {
  return q.replace(/[%_,()*\\:."']/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

export async function listTemplates(opts: { q?: string; category?: string; sort?: CatalogSort; page?: number }) {
  const page = Math.max(1, opts.page ?? 1);
  const from = (page - 1) * PAGE_SIZE;
  const cols = opts.category ? CARD_COLUMNS.replace("categories(", "categories!inner(") : CARD_COLUMNS;
  let query = supabasePublic().from("templates").select(cols, { count: "exact" }).eq("status", "published");

  if (opts.category) query = query.eq("categories.slug", opts.category);
  const q = opts.q ? sanitizeSearch(opts.q) : "";
  if (q) query = query.or(`title_kk.ilike.%${q}%,description_kk.ilike.%${q}%`);

  query = opts.sort === "trending"
    ? query.order("is_trending", { ascending: false }).order("sort_order").order("published_at", { ascending: false })
    : query.order("published_at", { ascending: false, nullsFirst: false });

  const { data, error, count } = await query.range(from, from + PAGE_SIZE - 1);
  if (error) { console.error("[templates.list]", error.code, error.message); return { items: [], total: 0, page }; }
  return { items: toCards(data as unknown as Row[]), total: count ?? 0, page };
}

export async function listTrending(limit = 8) {
  const { data } = await supabasePublic().from("templates").select(CARD_COLUMNS)
    .eq("status", "published").eq("is_trending", true).order("sort_order").limit(limit);
  return toCards(data as unknown as Row[]);
}

export async function listNewest(limit = 8) {
  const { data } = await supabasePublic().from("templates").select(CARD_COLUMNS)
    .eq("status", "published").order("published_at", { ascending: false, nullsFirst: false }).limit(limit);
  return toCards(data as unknown as Row[]);
}

/** Popular = most paid orders in the last 30 days. Empty when there's no real data yet. */
export async function listPopular(limit = 8) {
  if (!env().SUPABASE_SERVICE_ROLE_KEY) return [];
  try {
    const { data: ranks, error } = await supabaseAdmin().rpc("popular_template_ids", { days: 30, max_rows: limit });
    if (error || !ranks?.length) return [];
    const ids = (ranks as { template_id: string }[]).map((r) => r.template_id);
    const { data } = await supabasePublic().from("templates").select(CARD_COLUMNS).in("id", ids);
    const cards = toCards(data as unknown as Row[]);
    return ids.map((id) => cards.find((c) => c.id === id)).filter((c): c is TemplateDetail => !!c);
  } catch (err) {
    console.error("[templates.popular]", err);
    return [];
  }
}

export async function getTemplate(id: string): Promise<TemplateDetail | null> {
  if (!z.string().uuid().safeParse(id).success) return null;
  const { data } = await supabasePublic().from("templates").select(CARD_COLUMNS)
    .eq("id", id).eq("status", "published").maybeSingle();
  return data ? parseRow(data as unknown as Row) : null;
}
