import "server-only";
import { SEEDANCE_MIN_SEC, maxSecFor, parseSeedanceMode, type PhotoFraming, type SeedanceMode } from "./seedance-config";
import { after, connection } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { env } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/server";
import { faceSlotSchema, qualitySchema, pricingConfigSchema, orderedSlots, type FaceSlot, type Quality } from "./schema";
import { startingPrice } from "@/lib/pricing";
import { seedancePriceKzt, applySeedancePricing, DEFAULT_SEEDANCE_PRICING, type SeedancePricing } from "@/lib/pricing-seedance";
import { seedancePricingSettings } from "@/lib/pricing-seedance/settings";
import { ensureTemplateDuration } from "./duration";

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
  /** Template video length (automatic Seedance pricing). */
  durationSec: number | null;
  /** false = automatic price not known yet (video length still being read). */
  priced: boolean;
  /** What photo the customer needs (the AI takes face, hair, body type and outfit from it). */
  photoFraming: PhotoFraming;
  /** The customer may write a wish for the AI (background, outfit, style). */
  allowWish: boolean;
  /** swap = face swap only (no wish), scene = Seedance + face swap. */
  seedanceMode: SeedanceMode;
};

const CARD_COLUMNS =
  "id,title_kk,description_kk,required_face_count,cover_asset_path,preview_video_path,supported_qualities_json,pricing_config_json,face_slots_json,max_upload_bytes,is_trending,provider_key,video_duration_sec,photo_framing:provider_config_json->>framing,allow_wish:provider_config_json->>allowWish,seedance_mode:provider_config_json->>mode,seedance_prepare:provider_config_json->>prepare,categories(id,title_kk,slug)";

type Row = {
  id: string; title_kk: string; description_kk: string; required_face_count: number;
  cover_asset_path: string | null; preview_video_path: string | null;
  supported_qualities_json: unknown; pricing_config_json: unknown; face_slots_json: unknown;
  max_upload_bytes: number; is_trending: boolean;
  provider_key?: string | null; video_duration_sec?: number | string | null; photo_framing?: string | null; allow_wish?: string | null; seedance_mode?: string | null; seedance_prepare?: string | null;
  categories: { id: string; title_kk: string; slug: string } | { id: string; title_kk: string; slug: string }[] | null;
};

/** Public media URL from the `template-media` bucket (or pass-through for absolute URLs). */
export function mediaUrl(path: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return `${env().NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/template-media/${path.replace(/^\/+/, "")}`;
}

export function parseRow(r: Row, seedancePricing: SeedancePricing = DEFAULT_SEEDANCE_PRICING): TemplateDetail | null {
  const parsedQ = z.array(qualitySchema).safeParse(r.supported_qualities_json);
  const parsedP = pricingConfigSchema.safeParse(r.pricing_config_json);
  const slots = z.array(faceSlotSchema).safeParse(r.face_slots_json);
  if (!parsedQ.success || !parsedP.success || !slots.success) {
    console.error("[templates] invalid config", r.id);
    return null; // never show a template whose configuration can't be priced
  }
  let qualities = parsedQ;
  let pricing = parsedP;
  let priced = true;
  if (r.provider_key === "seedance") {
    // Seedance: one quality (720p); price from the video length (or a manual price).
    const duration = r.video_duration_sec == null ? null : Number(r.video_duration_sec);
    // A video outside Seedance's 4–30 s cannot be generated: no price, so it cannot be ordered.
    const usable = duration === null || (duration >= SEEDANCE_MIN_SEC - 0.5 && duration <= maxSecFor(parseSeedanceMode(r.seedance_mode)) + 0.5);
    const price = usable ? seedancePriceKzt(duration, parsedP.data.basePriceKzt, seedancePricing, { mode: parseSeedanceMode(r.seedance_mode), people: r.required_face_count, prepare: r.seedance_prepare !== "false" }) : null;
    const eff = applySeedancePricing(parsedP.data, price ?? 0);
    qualities = { success: true, data: eff.qualities } as typeof parsedQ;
    pricing = { success: true, data: eff.pricing } as typeof parsedP;
    priced = price !== null;
  } else if (r.provider_key !== "dev") {
    priced = false; // a provider this build does not run (e.g. old Akool rows) is never sold
  }
  const cat = Array.isArray(r.categories) ? r.categories[0] : r.categories;
  const available = qualities.data.filter((q) => q.available);
  return {
    id: r.id,
    title: r.title_kk,
    description: r.description_kk,
    faceCount: r.required_face_count,
    qualityLabels: available.map((q) => q.labelKk),
    startingPriceKzt: priced ? startingPrice(pricing.data, qualities.data, r.required_face_count) : null,
    coverUrl: mediaUrl(r.cover_asset_path),
    previewUrl: mediaUrl(r.preview_video_path),
    isTrending: r.is_trending,
    category: cat ? { id: cat.id, title: cat.title_kk, slug: cat.slug } : null,
    // Slot preview images (if any) as absolute public URLs, so any component can show them.
    faceSlots: orderedSlots(slots.data).map((s) => (s.previewImagePath ? { ...s, previewImagePath: mediaUrl(s.previewImagePath)! } : s)),
    qualities: qualities.data,
    pricing: pricing.data,
    maxUploadBytes: r.max_upload_bytes,
    durationSec: r.video_duration_sec == null ? null : Number(r.video_duration_sec),
    priced,
    photoFraming: r.photo_framing === "face" || r.photo_framing === "full" ? r.photo_framing : "half",
    allowWish: ["scene", "kling"].includes(parseSeedanceMode(r.seedance_mode)) && r.allow_wish !== "false",
    seedanceMode: parseSeedanceMode(r.seedance_mode),
  };
}

/** Parses rows; templates whose video length is unknown get it filled after the response. */
async function toCards(rows: Row[] | null): Promise<TemplateDetail[]> {
  const s = await seedancePricingSettings();
  const missing = (rows ?? []).filter((r) => r.provider_key === "seedance" && r.video_duration_sec == null && r.preview_video_path).slice(0, 3);
  if (missing.length) after(async () => { for (const r of missing) await ensureTemplateDuration(r.id, mediaUrl(r.preview_video_path)); });
  return (rows ?? []).map((r) => parseRow(r, s)).filter((t): t is TemplateDetail => t !== null);
}

async function parseOne(r: Row): Promise<TemplateDetail | null> {
  if (r.provider_key === "seedance" && r.video_duration_sec == null && r.preview_video_path) {
    const d = await ensureTemplateDuration(r.id, mediaUrl(r.preview_video_path));
    if (d) r = { ...r, video_duration_sec: d };
  }
  return parseRow(r, await seedancePricingSettings());
}

export async function listCategories(): Promise<Category[]> {
  await connection(); // request-time only: never run during prerender
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
  await connection(); // request-time only: never run during prerender
  const page = Math.max(1, opts.page ?? 1);
  const from = (page - 1) * PAGE_SIZE;
  const cols = opts.category ? CARD_COLUMNS.replace("categories(", "categories!inner(") : CARD_COLUMNS;
  let query = supabasePublic().from("templates").select(cols, { count: "exact" }).eq("status", "published").eq("kind", "catalog");

  if (opts.category) query = query.eq("categories.slug", opts.category);
  const q = opts.q ? sanitizeSearch(opts.q) : "";
  if (q) query = query.or(`title_kk.ilike.%${q}%,description_kk.ilike.%${q}%`);

  query = opts.sort === "trending"
    ? query.order("is_trending", { ascending: false }).order("sort_order").order("published_at", { ascending: false })
    : query.order("published_at", { ascending: false, nullsFirst: false });

  const { data, error, count } = await query.range(from, from + PAGE_SIZE - 1);
  if (error) { console.error("[templates.list]", error.code, error.message); return { items: [], total: 0, page }; }
  return { items: await toCards(data as unknown as Row[]), total: count ?? 0, page };
}

export async function listTrending(limit = 8) {
  await connection(); // request-time only: never run during prerender
  const { data } = await supabasePublic().from("templates").select(CARD_COLUMNS)
    .eq("status", "published").eq("kind", "catalog").eq("is_trending", true).order("sort_order").limit(limit);
  return await toCards(data as unknown as Row[]);
}

export async function listNewest(limit = 8) {
  await connection(); // request-time only: never run during prerender
  const { data } = await supabasePublic().from("templates").select(CARD_COLUMNS)
    .eq("status", "published").eq("kind", "catalog").order("published_at", { ascending: false, nullsFirst: false }).limit(limit);
  return await toCards(data as unknown as Row[]);
}

export async function getTemplate(id: string): Promise<TemplateDetail | null> {
  await connection(); // request-time only: never run during prerender
  if (!z.string().uuid().safeParse(id).success) return null;
  const { data } = await supabasePublic().from("templates").select(CARD_COLUMNS)
    .eq("id", id).eq("status", "published").eq("kind", "catalog").maybeSingle();
  return data ? await parseOne(data as unknown as Row) : null;
}

/** Staff-only preview of any template regardless of status (caller must check permissions). */
export async function getTemplateForAdmin(id: string): Promise<TemplateDetail | null> {
  await connection();
  if (!z.string().uuid().safeParse(id).success) return null;
  const { data } = await supabaseAdmin().from("templates").select(CARD_COLUMNS).eq("id", id).maybeSingle();
  return data ? await parseOne(data as unknown as Row) : null;
}
