import { z } from "zod";
import { faceSlotSchema, qualitySchema, pricingConfigSchema, validateFaceSlots, autoFaceSlots } from "./schema";
import { parseAkoolConfig, akoolSlots, akoolProblems } from "./akool-config";

/** Everything an admin can edit on a template. Validated on the server on every save. */
export const templateInputSchema = z.object({
  titleKk: z.string().trim().min(2).max(120),
  descriptionKk: z.string().trim().max(1000).default(""),
  categoryId: z.string().uuid().nullable(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  isTrending: z.boolean().default(false),
  sortOrder: z.number().int().min(-1000).max(1000).default(0),
  coverAssetPath: z.string().max(300).nullable(),
  previewVideoPath: z.string().max(300).nullable(),
  faceSlots: z.array(faceSlotSchema).min(1).max(10),
  qualities: z.array(qualitySchema).min(1).max(6),
  pricing: pricingConfigSchema,
  providerKey: z.string().trim().max(60).nullable(),
  providerConfig: z.record(z.string(), z.unknown()).default({}),
  maxUploadBytes: z.number().int().min(100_000).max(10 * 1024 * 1024),
});
export type TemplateInput = z.infer<typeof templateInputSchema>;

export type PublishProblem =
  | "missing_cover" | "missing_preview" | "invalid_face_slots" | "no_available_quality"
  | "duplicate_quality_key" | "missing_provider" | "price_out_of_range"
  | "akool_not_analyzed" | "akool_video_changed" | "akool_no_people";

/** A template may be published only when it is complete and coherent. */
export function publishProblems(t: TemplateInput): PublishProblem[] {
  const p: PublishProblem[] = [];
  if (!t.previewVideoPath) p.push("missing_preview");
  if (validateFaceSlots(t.faceSlots, t.faceSlots.length).length) p.push("invalid_face_slots");
  if (!t.qualities.some((q) => q.available)) p.push("no_available_quality");
  if (new Set(t.qualities.map((q) => q.key)).size !== t.qualities.length) p.push("duplicate_quality_key");
  if (!t.providerKey) p.push("missing_provider");
  const { minPriceKzt, maxPriceKzt } = t.pricing;
  if (maxPriceKzt !== undefined && maxPriceKzt < minPriceKzt) p.push("price_out_of_range");
  if (t.providerKey === "akool") p.push(...akoolProblems(parseAkoolConfig(t.providerConfig), t.previewVideoPath));
  return p;
}

/** Default config for a new template: Akool, one fixed quality (Akool controls output quality). */
export function emptyTemplate(): TemplateInput {
  return {
    titleKk: "",
    descriptionKk: "",
    categoryId: null,
    tags: [],
    isTrending: false,
    sortOrder: 0,
    coverAssetPath: null,
    previewVideoPath: null,
    faceSlots: autoFaceSlots(1),
    qualities: [{ key: "standard", labelKk: "Стандарт", resolution: "720x1280", fps: 30, providerQuality: "standard", surchargeKzt: 0, available: true }],
    pricing: { basePriceKzt: 1990, chargeExtraFaces: false, extraFacePriceKzt: 0, includedFaces: 1, platformFeeKzt: 0, minPriceKzt: 0 },
    providerKey: "akool",
    providerConfig: { resolution: "720p", selected: [] },
    maxUploadBytes: 10 * 1024 * 1024,
  };
}

/** DB row → editor input. */
export function rowToInput(r: {
  title_kk: string; description_kk: string; category_id: string | null; tags: string[] | null;
  is_trending: boolean; sort_order: number; cover_asset_path: string | null; preview_video_path: string | null;
  face_slots_json: unknown; supported_qualities_json: unknown; pricing_config_json: unknown;
  provider_key: string | null; provider_config_json: unknown; max_upload_bytes: number;
}): TemplateInput {
  const base = emptyTemplate();
  const slots = z.array(faceSlotSchema).safeParse(r.face_slots_json);
  const quals = z.array(qualitySchema).safeParse(r.supported_qualities_json);
  const pricing = pricingConfigSchema.safeParse(r.pricing_config_json);
  return {
    titleKk: r.title_kk,
    descriptionKk: r.description_kk,
    categoryId: r.category_id,
    tags: r.tags ?? [],
    isTrending: r.is_trending,
    sortOrder: r.sort_order,
    coverAssetPath: r.cover_asset_path,
    previewVideoPath: r.preview_video_path,
    faceSlots: slots.success && slots.data.length ? slots.data : base.faceSlots,
    qualities: quals.success && quals.data.length ? quals.data : base.qualities,
    pricing: pricing.success ? pricing.data : base.pricing,
    providerKey: r.provider_key,
    providerConfig: (r.provider_config_json as Record<string, unknown>) ?? {},
    maxUploadBytes: r.max_upload_bytes,
  };
}

/** Input → DB columns. Face count is always derived from the slot list. */
export function inputToRow(t: TemplateInput) {
  // Slots are always derived on the server, never trusted from the browser:
  //  - Akool: one slot per person the admin selected from the video analysis;
  //  - others: automatic left → right layout, face_1..face_N.
  let slots = autoFaceSlots(t.faceSlots.length);
  let config = t.providerConfig;
  if (t.providerKey === "akool") {
    const cfg = parseAkoolConfig(t.providerConfig);
    config = cfg;
    const derived = akoolSlots(cfg);
    slots = derived.length ? derived : autoFaceSlots(1);
  }
  return {
    title_kk: t.titleKk,
    description_kk: t.descriptionKk,
    category_id: t.categoryId,
    tags: t.tags,
    is_trending: t.isTrending,
    sort_order: t.sortOrder,
    cover_asset_path: t.coverAssetPath,
    preview_video_path: t.previewVideoPath,
    required_face_count: slots.length,
    face_slots_json: slots,
    supported_qualities_json: t.qualities,
    pricing_config_json: t.pricing,
    provider_key: t.providerKey,
    provider_config_json: config,
    max_upload_bytes: t.maxUploadBytes,
  };
}
