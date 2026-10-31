"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit, requirePermission, ForbiddenError } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { clearMemo } from "@/lib/cache/memo";
import { ru } from "@/lib/i18n/ru";
import { PHOTO_PROVIDER, PHOTO_QUALITY, photoSlots } from "@/lib/templates/photo-config";
import { comboPrice } from "@/lib/combos/catalog";
import { COMBO_PROVIDER } from "@/lib/combos/worker";

export type ComboState = { ok?: string; error?: string; id?: string };
const T = ru.admin.combos;

/** Each photo: an existing combo item (id) or a freshly uploaded example photo (template-media path). */
const photoSchema = z.union([
  z.object({ id: z.string().uuid() }),
  z.object({ path: z.string().regex(/^covers\/[0-9a-f-]{36}\.(jpg|png|webp)$/) }),
]);
const inputSchema = z.object({
  id: z.string().uuid().nullable(),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(""),
  discountPercent: z.number().min(0).max(90),
  pricePerPhoto: z.number().int().min(10).max(1_000_000),
  photos: z.array(photoSchema).min(2).max(20),
});

async function guard() {
  try { return await requirePermission("templates.manage"); } catch (e) { if (e instanceof ForbiddenError) return null; throw e; }
}

const PRICING = (price: number) => ({ basePriceKzt: price, chargeExtraFaces: false, extraFacePriceKzt: 0, includedFaces: 1, platformFeeKzt: 0, minPriceKzt: 0 });

/** Writes a new version snapshot (orders are priced and generated from it) and makes it current. */
async function snapshot(templateId: string) {
  const db = supabaseAdmin();
  const { data: t } = await db.from("templates").select("*").eq("id", templateId).single();
  if (!t) return false;
  const { data: last } = await db.from("template_versions").select("version_number").eq("template_id", templateId)
    .order("version_number", { ascending: false }).limit(1).maybeSingle();
  const { data: v, error } = await db.from("template_versions").insert({
    template_id: templateId, version_number: (last?.version_number ?? 0) + 1,
    configuration_snapshot: {
      title_kk: t.title_kk, required_face_count: t.required_face_count, face_slots_json: t.face_slots_json,
      supported_qualities_json: t.supported_qualities_json, pricing_config_json: t.pricing_config_json,
      provider_key: t.provider_key, provider_config_json: t.provider_config_json,
      preview_video_path: null, cover_asset_path: t.cover_asset_path, max_upload_bytes: t.max_upload_bytes,
    },
  }).select("id").single();
  if (error || !v) { console.error("[admin.combo.version]", error?.code); return false; }
  await db.from("templates").update({ current_version_id: v.id }).eq("id", templateId);
  return true;
}

export async function saveCombo(raw: unknown): Promise<ComboState> {
  const u = await guard();
  if (!u) return { error: ru.admin.forbidden };
  const p = inputSchema.safeParse(raw);
  if (!p.success) return { error: p.error.issues.some((i) => i.path[0] === "photos") ? T.min2 : T.error };
  const d = p.data;
  const db = supabaseAdmin();
  const now = new Date().toISOString();

  // Combo photos → hidden photo templates (kind 'combo_item'): the uploaded photo is the example to recreate.
  const itemIds: string[] = [];
  for (const ph of d.photos) {
    if ("id" in ph) {
      const { data: it } = await db.from("templates").select("id,pricing_config_json").eq("id", ph.id).eq("kind", "combo_item").maybeSingle();
      if (!it) continue;
      if ((it.pricing_config_json as { basePriceKzt?: number }).basePriceKzt !== d.pricePerPhoto) {
        await db.from("templates").update({ pricing_config_json: PRICING(d.pricePerPhoto) }).eq("id", it.id);
        await snapshot(it.id);
      }
      itemIds.push(it.id);
      continue;
    }
    const { data: it, error } = await db.from("templates").insert({
      kind: "combo_item", status: "published", published_at: now, created_by: u.id,
      title_kk: `${d.title} · ${itemIds.length + 1}`, description_kk: "",
      provider_key: PHOTO_PROVIDER,
      provider_config_json: { prompt: "", people: 1, aspectRatio: "3:4", useExample: true, allowWish: false, labels: [] },
      face_slots_json: photoSlots(1), required_face_count: 1,
      supported_qualities_json: [PHOTO_QUALITY], pricing_config_json: PRICING(d.pricePerPhoto),
      cover_asset_path: ph.path, preview_video_path: null, max_upload_bytes: 10485760,
    }).select("id").single();
    if (error || !it) { console.error("[admin.combo.item]", error?.code, error?.message); return { error: T.error }; }
    if (!(await snapshot(it.id))) return { error: T.error };
    itemIds.push(it.id);
  }
  if (itemIds.length < 2) return { error: T.min2 };

  const { price } = comboPrice(itemIds.map(() => d.pricePerPhoto), d.discountPercent);
  const { data: first } = await db.from("templates").select("cover_asset_path").eq("id", itemIds[0]).single();
  const row = {
    title_kk: d.title, description_kk: d.description, kind: "combo", status: "published" as const,
    provider_key: COMBO_PROVIDER,
    provider_config_json: { templateIds: itemIds, discountPercent: d.discountPercent, pricePerPhoto: d.pricePerPhoto },
    face_slots_json: [{ key: "face_1", labelKk: "Сіздің фотоңыз", position: { x: 0.5, y: 0.42 }, providerInput: "img_1", order: 0 }],
    required_face_count: 1, supported_qualities_json: [PHOTO_QUALITY], pricing_config_json: PRICING(price),
    cover_asset_path: first?.cover_asset_path ?? null, preview_video_path: null, max_upload_bytes: 10485760,
  };

  let id = d.id;
  if (id) {
    // Photos taken out of the combo are hidden (orders that used them keep working).
    const { data: before } = await db.from("templates").select("provider_config_json").eq("id", id).eq("kind", "combo").maybeSingle();
    const old = ((before?.provider_config_json as { templateIds?: string[] })?.templateIds ?? []).filter((x) => !itemIds.includes(x));
    if (old.length) await db.from("templates").update({ status: "archived", deleted_at: now }).in("id", old).eq("kind", "combo_item");
    const { error } = await db.from("templates").update(row).eq("id", id).eq("kind", "combo");
    if (error) { console.error("[admin.combo.update]", error.code, error.message); return { error: T.error }; }
  } else {
    const { data, error } = await db.from("templates").insert({ ...row, published_at: now, created_by: u.id }).select("id").single();
    if (error || !data) { console.error("[admin.combo.create]", error?.code, error?.message); return { error: T.error }; }
    id = data.id;
  }
  if (!id || !(await snapshot(id))) return { error: T.error };

  await audit(u.id, d.id ? "combo.update" : "combo.create", "template", id, { title: d.title, photos: itemIds.length, price });
  clearMemo();
  revalidatePath("/admin/combos");
  return { ok: T.saved, id };
}

export async function deleteCombo(id: string): Promise<ComboState> {
  const u = await guard();
  if (!u) return { error: ru.admin.forbidden };
  if (!z.string().uuid().safeParse(id).success) return { error: T.error };
  const db = supabaseAdmin();
  const now = new Date().toISOString();
  const { data: t } = await db.from("templates").select("provider_config_json").eq("id", id).eq("kind", "combo").maybeSingle();
  const items = (t?.provider_config_json as { templateIds?: string[] })?.templateIds ?? [];
  // Hidden, not removed: customers' orders keep their template and version references.
  await db.from("templates").update({ status: "archived", deleted_at: now }).eq("id", id).eq("kind", "combo");
  if (items.length) await db.from("templates").update({ status: "archived", deleted_at: now }).in("id", items).eq("kind", "combo_item");
  await audit(u.id, "combo.delete", "template", id, {});
  clearMemo();
  revalidatePath("/admin/combos");
  return { ok: T.removed };
}

/** Signed upload URL for one combo photo (browser → storage directly). */
export async function comboPhotoUploadUrl(raw: unknown) {
  const u = await guard();
  if (!u) return { ok: false as const };
  const p = z.object({ contentType: z.literal("image/jpeg"), size: z.number().int().positive().max(5 * 1024 * 1024) }).safeParse(raw);
  if (!p.success) return { ok: false as const };
  const path = `covers/${randomUUID()}.jpg`;
  const { data, error } = await supabaseAdmin().storage.from("template-media").createSignedUploadUrl(path);
  if (error) { console.error("[admin.combo.upload]", error.message); return { ok: false as const }; }
  return { ok: true as const, path: data.path, token: data.token };
}
