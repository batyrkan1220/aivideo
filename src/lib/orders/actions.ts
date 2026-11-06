"use server";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { imageSize } from "image-size";
import { z } from "zod";
import { audit, getSessionUser } from "@/lib/auth/session";
import { isFreeOrderUser, placeFreeOrder } from "./free";
import { supabaseAdmin } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { calculatePrice } from "@/lib/pricing";
import { faceSlotSchema, qualitySchema, pricingConfigSchema } from "@/lib/templates/schema";
import { PHOTO_EXT, sniffImageType, validatePhotoMeta, type PhotoError, type PhotoType } from "@/lib/uploads/validate";
import { track } from "@/lib/analytics";
import { allow } from "@/lib/security/rate-limit";
import { nearestOutputAspect } from "@/lib/custom-video/aspect";
import { activeDiscount, discounted } from "@/lib/engage/discount";
import { adOffer } from "@/lib/engage/offer";
import { captureAdContext } from "@/lib/pixels/context";
import { customVideoSettings } from "@/lib/custom-video/settings";
import { attributeFromCookie } from "@/lib/partners";
import { seedancePriceKzt, applySeedancePricing } from "@/lib/pricing-seedance";
import { parseSeedanceConfig, seedanceSlots, SEEDANCE_MAX_PEOPLE, SEEDANCE_MIN_SEC, maxSecFor } from "@/lib/templates/seedance-config";
import { seedancePricingSettings } from "@/lib/pricing-seedance/settings";
import { ensureTemplateDuration } from "@/lib/templates/duration";
import { cleanWish } from "@/lib/generation/seedance";
import { isPhotoProvider, parsePhotoConfig } from "@/lib/templates/photo-config";
import { PHOTOS_SOON } from "@/lib/features";
import { mediaUrl } from "@/lib/templates/queries";

type Fail<E extends string> = { ok: false; error: E | "unauthorized" | "generic" };
const BUCKET = "user-uploads";
const UPLOADS_PER_HOUR = 60;

/** Loads a published template's *current version* — orders are always priced from the snapshot. */
async function loadPublishedVersion(templateId: string) {
  if (!z.string().uuid().safeParse(templateId).success) return null;
  const db = supabaseAdmin();
  const { data: t } = await db.from("templates")
    .select("id,title_kk,status,current_version_id,cover_asset_path,kind,video_duration_sec").eq("id", templateId).maybeSingle();
  if (!t || t.status !== "published" || !t.current_version_id) return null;
  const { data: v } = await db.from("template_versions")
    .select("id,configuration_snapshot").eq("id", t.current_version_id).single();
  if (!v) return null;
  const snap = v.configuration_snapshot as Record<string, unknown>;
  // Catalog video templates are orderable only after the AI analysis (people, cut-outs, scene).
  if (t.kind === "catalog" && snap.provider_key === "seedance" && !(snap.provider_config_json as { analyzedAt?: unknown } | null)?.analyzedAt) return null;
  const slots = z.array(faceSlotSchema).safeParse(snap.face_slots_json);
  const qualities = z.array(qualitySchema).safeParse(snap.supported_qualities_json);
  const pricing = pricingConfigSchema.safeParse(snap.pricing_config_json);
  if (!slots.success || !qualities.success || !pricing.success) return null;
  return {
    template: t, versionId: v.id, snapshot: snap,
    slots: slots.data, qualities: qualities.data, pricing: pricing.data,
    maxUploadBytes: Number(snap.max_upload_bytes) || env().UPLOAD_MAX_BYTES,
  };
}

const limits = (maxBytes: number) => ({
  maxBytes: Math.min(maxBytes, env().UPLOAD_MAX_BYTES),
  minDimension: env().UPLOAD_MIN_DIMENSION,
  maxDimension: env().UPLOAD_MAX_DIMENSION,
});

// ---------------------------------------------------------------- uploads

const requestSchema = z.object({
  templateId: z.string().uuid(),
  slotKey: z.string().regex(/^[a-z0-9_]+$/),
  contentType: z.string(),
  size: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export async function requestPhotoUpload(raw: unknown): Promise<
  { ok: true; assetId: string; path: string; token: string } | Fail<PhotoError | "rate_limited" | "template_unavailable">
> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "unauthorized" };
  const p = requestSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: "generic" };
  const tv = await loadPublishedVersion(p.data.templateId);
  // Өз видеом: the customer chooses how many people to replace (slots p_1…p_5, left → right).
  const customPersonSlot = tv?.template.kind === "custom" && new RegExp(`^p_[1-${SEEDANCE_MAX_PEOPLE}]$`).test(p.data.slotKey);
  if (!tv || (!customPersonSlot && !tv.slots.some((s) => s.key === p.data.slotKey))) return { ok: false, error: "template_unavailable" };

  const problem = validatePhotoMeta(p.data, limits(tv.maxUploadBytes));
  if (problem) return { ok: false, error: problem };

  const db = supabaseAdmin();
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await db.from("order_assets").select("id", { count: "exact", head: true })
    .eq("user_id", user.id).gte("created_at", since);
  if ((count ?? 0) >= UPLOADS_PER_HOUR) return { ok: false, error: "rate_limited" };

  const path = `${user.id}/${randomUUID()}.${PHOTO_EXT[p.data.contentType as PhotoType]}`;
  const { data: signed, error: sErr } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
  if (sErr || !signed) { console.error("[upload.sign]", sErr?.message); return { ok: false, error: "generic" }; }

  const expires = new Date(Date.now() + env().UPLOAD_RETENTION_DAYS * 86400_000).toISOString();
  const { data: asset, error } = await db.from("order_assets").insert({
    user_id: user.id, template_id: tv.template.id, face_slot_key: p.data.slotKey,
    private_storage_path: path, mime_type: p.data.contentType, file_size: p.data.size,
    width: p.data.width, height: p.data.height, expires_at: expires,
  }).select("id").single();
  if (error) { console.error("[upload.row]", error.code); return { ok: false, error: "generic" }; }

  await track("upload_started", { userId: user.id, templateId: tv.template.id });
  return { ok: true, assetId: asset.id, path: signed.path, token: signed.token };
}

/** Re-validates the stored bytes (real type + dimensions). Invalid files are deleted. */
export async function confirmPhotoUpload(assetId: string): Promise<{ ok: true } | Fail<PhotoError>> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "unauthorized" };
  if (!z.string().uuid().safeParse(assetId).success) return { ok: false, error: "generic" };
  const db = supabaseAdmin();
  const { data: a } = await db.from("order_assets").select("*")
    .eq("id", assetId).eq("user_id", user.id).is("order_id", null).maybeSingle();
  if (!a) return { ok: false, error: "generic" };

  const reject = async (error: PhotoError) => {
    await db.storage.from(BUCKET).remove([a.private_storage_path]);
    await db.from("order_assets").delete().eq("id", a.id);
    return { ok: false as const, error };
  };

  const { data: blob, error } = await db.storage.from(BUCKET).download(a.private_storage_path);
  if (error || !blob) return reject("unreadable");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const realType = sniffImageType(bytes);
  if (!realType) return reject("bad_type");
  let dims: { width?: number; height?: number };
  try { dims = imageSize(bytes); } catch { return reject("unreadable"); }

  const tv = await loadPublishedVersion(a.template_id);
  if (!tv) return reject("unreadable");
  const problem = validatePhotoMeta({ contentType: realType, size: bytes.byteLength, width: dims.width, height: dims.height }, limits(tv.maxUploadBytes));
  if (problem) return reject(problem);

  await db.from("order_assets").update({
    verified_at: new Date().toISOString(), mime_type: realType, file_size: bytes.byteLength,
    width: dims.width, height: dims.height,
  }).eq("id", a.id);
  await track("upload_completed", { userId: user.id, templateId: a.template_id });
  return { ok: true };
}

export async function removePhotoUpload(assetId: string): Promise<{ ok: boolean }> {
  const user = await getSessionUser();
  if (!user || !z.string().uuid().safeParse(assetId).success) return { ok: false };
  const db = supabaseAdmin();
  const { data: a } = await db.from("order_assets").select("id,private_storage_path")
    .eq("id", assetId).eq("user_id", user.id).is("order_id", null).maybeSingle();
  if (!a) return { ok: false };
  await db.storage.from(BUCKET).remove([a.private_storage_path]);
  await db.from("order_assets").delete().eq("id", a.id);
  return { ok: true };
}

// ---------------------------------------------------------------- reuse a photo

/**
 * "Another video with this photo": copies one of the customer's own earlier photos (still kept,
 * not deleted) into a new, already verified upload for this template slot.
 */
export async function reusePhoto(raw: unknown): Promise<{ ok: true; assetId: string } | Fail<"rate_limited" | "template_unavailable">> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "unauthorized" };
  const p = z.object({ templateId: z.string().uuid(), slotKey: z.string().regex(/^[a-z0-9_]+$/), sourceAssetId: z.string().uuid() }).safeParse(raw);
  if (!p.success) return { ok: false, error: "generic" };
  const tv = await loadPublishedVersion(p.data.templateId);
  const customPersonSlot = tv?.template.kind === "custom" && new RegExp(`^p_[1-${SEEDANCE_MAX_PEOPLE}]$`).test(p.data.slotKey);
  if (!tv || (!customPersonSlot && !tv.slots.some((s) => s.key === p.data.slotKey))) return { ok: false, error: "template_unavailable" };

  const db = supabaseAdmin();
  const { data: src } = await db.from("order_assets").select("private_storage_path,mime_type,file_size,width,height,expires_at,verified_at")
    .eq("id", p.data.sourceAssetId).eq("user_id", user.id).maybeSingle();
  if (!src?.verified_at || new Date(src.expires_at).getTime() < Date.now()) return { ok: false, error: "generic" };
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await db.from("order_assets").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", since);
  if ((count ?? 0) >= UPLOADS_PER_HOUR) return { ok: false, error: "rate_limited" };

  const ext = src.private_storage_path.split(".").pop() ?? "jpg";
  const path = `${user.id}/${randomUUID()}.${ext}`;
  const { error: cErr } = await db.storage.from(BUCKET).copy(src.private_storage_path, path);
  if (cErr) { console.error("[reuse.copy]", cErr.message); return { ok: false, error: "generic" }; }
  const now = new Date();
  const { data: asset, error } = await db.from("order_assets").insert({
    user_id: user.id, template_id: tv.template.id, face_slot_key: p.data.slotKey,
    private_storage_path: path, mime_type: src.mime_type, file_size: src.file_size, width: src.width, height: src.height,
    expires_at: new Date(now.getTime() + env().UPLOAD_RETENTION_DAYS * 86400_000).toISOString(), verified_at: now.toISOString(),
  }).select("id").single();
  if (error || !asset) { await db.storage.from(BUCKET).remove([path]); return { ok: false, error: "generic" }; }
  await track("upload_completed", { userId: user.id, templateId: tv.template.id, props: { reused: true } });
  return { ok: true, assetId: asset.id };
}

/** Keeps the photos of one of the customer's orders for 30 days (so new videos take one tap). */
export async function keepOrderPhotos(fd: FormData): Promise<void> {
  const user = await getSessionUser();
  const id = z.string().uuid().safeParse(fd.get("orderId"));
  if (!user || !id.success) return;
  const db = supabaseAdmin();
  const { data: o } = await db.from("orders").select("id,photos_deleted_at").eq("id", id.data).eq("user_id", user.id).maybeSingle();
  if (!o || o.photos_deleted_at) return;
  const now = new Date();
  await db.from("order_assets").update({ saved_at: now.toISOString(), expires_at: new Date(now.getTime() + 30 * 86400_000).toISOString() })
    .eq("order_id", o.id).eq("user_id", user.id);
  await track("photos_kept", { userId: user.id, orderId: o.id });
  revalidatePath(`/orders/${o.id}`);
}

// ---------------------------------------------------------------- orders

const orderSchema = z.object({
  templateId: z.string().uuid(),
  quality: z.string().regex(/^[a-z0-9_]+$/),
  assets: z.record(z.string(), z.string().uuid()),
  consent: z.literal(true),
  /** "Өз видеом" orders: the customer's own verified video. */
  videoId: z.string().uuid().optional(),
  /** Customer's wish for the AI (background, outfit, style…). */
  wish: z.string().max(600).optional(),
  /** Templates with outfit "choice": what the customer picked. */
  outfit: z.enum(["photo", "template"]).optional(),
});

export async function createOrder(raw: unknown): Promise<
  { ok: true; orderId: string; free?: boolean } |
  Fail<"consent_required" | "template_unavailable" | "quality_unavailable" | "photos_missing" | "photos_expired" | "rate_limited" | "video_missing" | "wish_required">
> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "unauthorized" };
  if (!(await allow("order", user.id))) return { ok: false, error: "rate_limited" };
  const p = orderSchema.safeParse(raw);
  if (!p.success) {
    const consentMissing = typeof raw === "object" && raw !== null && (raw as { consent?: unknown }).consent !== true;
    return { ok: false, error: consentMissing ? "consent_required" : "generic" };
  }
  const tv = await loadPublishedVersion(p.data.templateId);
  if (!tv) return { ok: false, error: "template_unavailable" };
  await attributeFromCookie(user.id); // partner program (website ?ref= links)

  const db = supabaseAdmin();
  const now = Date.now();

  // Custom video: the customer's own verified, unattached video = the motion reference.
  const custom = tv.template.kind === "custom";
  let snapshotExtra: Record<string, unknown> = {};
  let durationSec: number | null = null;
  let slots = tv.slots;
  if (custom) {
    const cs = await customVideoSettings();
    if (!cs.enabled) return { ok: false, error: "template_unavailable" };
    if (!p.data.videoId) return { ok: false, error: "video_missing" };
    const { data: v } = await db.from("order_videos")
      .select("id,storage_path,verified_at,expires_at,duration_sec,aspect")
      .eq("id", p.data.videoId).eq("user_id", user.id).is("order_id", null).maybeSingle();
    if (!v?.verified_at || new Date(v.expires_at).getTime() < now) return { ok: false, error: "video_missing" };
    durationSec = Number(v.duration_sec);
    // People to replace = photos given, numbered p_1…p_n from the left without gaps.
    const n = Object.keys(p.data.assets).length;
    if (n < 1 || n > SEEDANCE_MAX_PEOPLE || Object.keys(p.data.assets).some((k) => !new RegExp(`^p_[1-${n}]$`).test(k))) {
      return { ok: false, error: "photos_missing" };
    }
    slots = seedanceSlots(n, "p_");
    snapshotExtra = {
      user_video_path: v.storage_path, user_video_duration_sec: durationSec,
      face_slots_json: slots, required_face_count: n,
      // Output follows the customer's video: vertical, square or horizontal (nothing cropped away).
      provider_config_json: { ...parseSeedanceConfig(tv.snapshot.provider_config_json), people: n, aspectRatio: nearestOutputAspect(v.aspect == null ? null : Number(v.aspect)) },
    };
  } else if (p.data.videoId) {
    return { ok: false, error: "generic" };
  }

  // Every slot must have exactly one verified, unattached, unexpired photo owned by this user.
  const slotKeys = slots.map((s) => s.key);
  const ids = slotKeys.map((k) => p.data.assets[k]);
  if (ids.some((x) => !x) || Object.keys(p.data.assets).length !== slotKeys.length) {
    return { ok: false, error: "photos_missing" };
  }
  const { data: assets } = await db.from("order_assets")
    .select("id,face_slot_key,verified_at,expires_at,template_id")
    .in("id", ids).eq("user_id", user.id).is("order_id", null);
  for (const k of slotKeys) {
    const a = assets?.find((x) => x.id === p.data.assets[k]);
    if (!a || a.face_slot_key !== k || a.template_id !== tv.template.id || !a.verified_at) {
      return { ok: false, error: "photos_missing" };
    }
    if (new Date(a.expires_at).getTime() < now) return { ok: false, error: "photos_expired" };
  }

  const photo = isPhotoProvider(tv.snapshot.provider_key as string);
  const combo = tv.snapshot.provider_key === "combo" && tv.template.kind === "combo";
  if (tv.snapshot.provider_key !== "seedance" && tv.snapshot.provider_key !== "dev" && !photo && !combo) return { ok: false, error: "template_unavailable" };
  // Photo combo: one selfie, the combo's computed price; its photos are made after payment.
  if ((photo || combo) && PHOTOS_SOON) return { ok: false, error: "template_unavailable" };
  if (combo && !(tv.pricing.basePriceKzt > 0)) return { ok: false, error: "template_unavailable" };
  // Seedance: one quality (720p), price from the reference video length (or a manual template price).
  let pricing = tv.pricing;
  let qualities = tv.qualities;
  if (photo) {
    // Photo templates: the admin's fixed price; the customer may add a wish.
    if (!(tv.pricing.basePriceKzt > 0)) return { ok: false, error: "template_unavailable" };
    const cfg = parsePhotoConfig(tv.snapshot.provider_config_json);
    const wish = cfg.allowWish ? cleanWish(p.data.wish) : "";
    if (tv.template.kind === "custom_photo") {
      // Create → AI photo: the customer's example photo (or, without one, the description) is the brief.
      const hasExample = slots.some((s) => s.providerInput === "example");
      if (!hasExample && wish.length < 3) return { ok: false, error: "wish_required" };
      pricing = { ...pricing, basePriceKzt: (await customVideoSettings()).photoPriceKzt };
    }
    if (wish) snapshotExtra = { ...snapshotExtra, customer_wish: wish };
  }
  if (tv.snapshot.provider_key === "seedance") {
    if (!custom) {
      durationSec = tv.template.video_duration_sec == null ? null : Number(tv.template.video_duration_sec);
      if (durationSec === null) durationSec = await ensureTemplateDuration(tv.template.id, mediaUrl((tv.snapshot.preview_video_path as string) ?? null));
    }
    const cfg = parseSeedanceConfig((snapshotExtra.provider_config_json as unknown) ?? tv.snapshot.provider_config_json);
    if (durationSec === null || durationSec < SEEDANCE_MIN_SEC - 0.5 || durationSec > maxSecFor(cfg.mode) + 0.5) return { ok: false, error: custom ? "video_missing" : "template_unavailable" };
    if (["kling", "k4"].includes(cfg.mode) && slots.length > 1) return { ok: false, error: "photos_missing" }; // Kling: one photo
    const price = seedancePriceKzt(durationSec, custom ? 0 : tv.pricing.basePriceKzt, await seedancePricingSettings(), { people: slots.length });
    if (price === null) return { ok: false, error: "template_unavailable" };
    const eff = applySeedancePricing(tv.pricing, price);
    pricing = eff.pricing;
    qualities = eff.qualities;
    const wish = custom && cfg.allowWish ? cleanWish(p.data.wish) : ""; // catalog templates take no customer prompt
    snapshotExtra = {
      ...snapshotExtra, pricing_config_json: pricing, video_duration_sec: durationSec, ...(wish ? { customer_wish: wish } : {}),
      ...(cfg.outfit === "choice" ? { customer_outfit: p.data.outfit ?? "template" } : {}),
    };
  }
  const quality = qualities.find((q) => q.key === p.data.quality && q.available) ?? (qualities.length === 1 ? qualities[0] : undefined);
  if (!quality) return { ok: false, error: "quality_unavailable" };

  // Price is computed here, from the version snapshot — never taken from the browser.
  const base = calculatePrice(pricing, quality, slots.length);
  // Personal discount (e.g. "second video −20%"): applied here, marked used when the order is paid.
  const eligible = base.totalKzt > 0 && !(await isFreeOrderUser(user.id));
  const disc = eligible ? await activeDiscount(user.id) : null;
  // Otherwise: the first-video offer for ad visitors (signed cookie, 24 h, until the first payment).
  const first = eligible && !disc ? await adOffer(user.id) : null;
  const breakdown = disc
    ? { ...base, totalKzt: discounted(base.totalKzt, disc.percent), discount: { id: disc.id, percent: disc.percent, beforeKzt: base.totalKzt } }
    : first
    ? { ...base, totalKzt: discounted(base.totalKzt, first.percent), discount: { kind: "first_ad", percent: first.percent, beforeKzt: base.totalKzt } }
    : base;
  const { data: order, error } = await db.from("orders").insert({
    user_id: user.id,
    template_id: tv.template.id,
    template_version_id: tv.versionId,
    template_snapshot_json: { ...tv.snapshot, ...snapshotExtra, quality },
    quality: quality.key,
    face_count: slots.length,
    pricing_breakdown_json: breakdown,
    amount_kzt: breakdown.totalKzt,
    currency: "KZT",
    consent_accepted_at: new Date().toISOString(),
    ad_ctx: await captureAdContext(),
  }).select("id").single();
  if (error || !order) { console.error("[order.create]", error?.code, error?.message); return { ok: false, error: "generic" }; }

  // Attach photos atomically-enough: only rows still unattached are claimed; on mismatch, roll back.
  const { data: claimed } = await db.from("order_assets").update({ order_id: order.id })
    .in("id", ids).eq("user_id", user.id).is("order_id", null).select("id");
  if ((claimed?.length ?? 0) !== ids.length) {
    await db.from("order_assets").update({ order_id: null }).eq("order_id", order.id);
    await db.from("orders").delete().eq("id", order.id);
    return { ok: false, error: "photos_missing" };
  }
  if (custom) {
    const { data: vClaim } = await db.from("order_videos").update({ order_id: order.id })
      .eq("id", p.data.videoId!).eq("user_id", user.id).is("order_id", null).select("id");
    if (!vClaim?.length) {
      await db.from("order_assets").update({ order_id: null }).eq("order_id", order.id);
      await db.from("orders").delete().eq("id", order.id);
      return { ok: false, error: "video_missing" };
    }
  }

  // Admin-approved test/gift users: no payment, generation is queued right away.
  if (await isFreeOrderUser(user.id)) {
    const free = await placeFreeOrder(order.id, user.id);
    if (free) await audit(user.id, "order.free", "order", order.id);
    return { ok: true, orderId: order.id, free };
  }
  await track("checkout_initiated", { userId: user.id, templateId: tv.template.id, orderId: order.id, props: { quality: quality.key } });
  return { ok: true, orderId: order.id };
}
