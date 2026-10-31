"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit, requirePermission, ForbiddenError } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { clearMemo } from "@/lib/cache/memo";
import { ru } from "@/lib/i18n/ru";
import { PHOTO_QUALITY } from "@/lib/templates/photo-config";
import { comboEligibleTemplates, comboPrice } from "@/lib/combos/catalog";
import { COMBO_PROVIDER } from "@/lib/combos/worker";

export type ComboState = { ok?: string; error?: string; id?: string };
const T = ru.admin.combos;

const inputSchema = z.object({
  id: z.string().uuid().nullable(),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(""),
  discountPercent: z.number().min(0).max(90),
  templateIds: z.array(z.string().uuid()).min(2).max(20),
});

async function guard() {
  try { return await requirePermission("templates.manage"); } catch (e) { if (e instanceof ForbiddenError) return null; throw e; }
}

export async function saveCombo(raw: unknown): Promise<ComboState> {
  const u = await guard();
  if (!u) return { error: ru.admin.forbidden };
  const p = inputSchema.safeParse(raw);
  if (!p.success) return { error: p.error.issues.some((i) => i.path[0] === "templateIds") ? T.min2 : T.error };

  // Only eligible photo templates, in the admin's order; price from their current prices.
  const eligible = new Map((await comboEligibleTemplates()).map((t) => [t.id, t]));
  const items = p.data.templateIds.map((id) => eligible.get(id)).filter((x): x is NonNullable<typeof x> => !!x);
  if (items.length < 2) return { error: T.min2 };
  const { price } = comboPrice(items.map((i) => i.priceKzt), p.data.discountPercent);

  const db = supabaseAdmin();
  const { data: covers } = await db.from("templates").select("id,cover_asset_path").in("id", items.map((i) => i.id));
  const cover = covers?.find((c) => c.id === items[0].id)?.cover_asset_path ?? null;
  const row = {
    title_kk: p.data.title, description_kk: p.data.description, kind: "combo", status: "published" as const,
    provider_key: COMBO_PROVIDER,
    provider_config_json: { templateIds: items.map((i) => i.id), discountPercent: p.data.discountPercent },
    face_slots_json: [{ key: "face_1", labelKk: "Сіздің фотоңыз", position: { x: 0.5, y: 0.42 }, providerInput: "img_1", order: 0 }],
    required_face_count: 1,
    supported_qualities_json: [PHOTO_QUALITY],
    pricing_config_json: { basePriceKzt: price, chargeExtraFaces: false, extraFacePriceKzt: 0, includedFaces: 1, platformFeeKzt: 0, minPriceKzt: 0 },
    cover_asset_path: cover, preview_video_path: null, max_upload_bytes: 10485760,
  };

  let id = p.data.id;
  if (id) {
    const { error } = await db.from("templates").update(row).eq("id", id).eq("kind", "combo");
    if (error) { console.error("[admin.combo.update]", error.code, error.message); return { error: T.error }; }
  } else {
    const { data, error } = await db.from("templates")
      .insert({ ...row, published_at: new Date().toISOString(), created_by: u.id }).select("id").single();
    if (error || !data) { console.error("[admin.combo.create]", error?.code, error?.message); return { error: T.error }; }
    id = data.id;
  }

  // New version: orders are priced and generated from the version snapshot.
  const { data: last } = await db.from("template_versions").select("version_number").eq("template_id", id)
    .order("version_number", { ascending: false }).limit(1).maybeSingle();
  const { data: v, error: vErr } = await db.from("template_versions").insert({
    template_id: id, version_number: (last?.version_number ?? 0) + 1,
    configuration_snapshot: {
      title_kk: row.title_kk, required_face_count: 1, face_slots_json: row.face_slots_json,
      supported_qualities_json: row.supported_qualities_json, pricing_config_json: row.pricing_config_json,
      provider_key: row.provider_key, provider_config_json: row.provider_config_json,
      preview_video_path: null, cover_asset_path: cover, max_upload_bytes: row.max_upload_bytes,
    },
  }).select("id").single();
  if (vErr || !v) { console.error("[admin.combo.version]", vErr?.code, vErr?.message); return { error: T.error }; }
  await db.from("templates").update({ current_version_id: v.id }).eq("id", id);

  await audit(u.id, p.data.id ? "combo.update" : "combo.create", "template", id, { title: row.title_kk, items: items.length, price });
  clearMemo();
  revalidatePath("/admin/combos");
  return { ok: T.saved, id: id ?? undefined };
}

export async function deleteCombo(id: string): Promise<ComboState> {
  const u = await guard();
  if (!u) return { error: ru.admin.forbidden };
  if (!z.string().uuid().safeParse(id).success) return { error: T.error };
  const db = supabaseAdmin();
  const { count } = await db.from("orders").select("id", { count: "exact", head: true }).eq("template_id", id);
  if ((count ?? 0) > 0) {
    await db.from("templates").update({ status: "archived", deleted_at: new Date().toISOString() }).eq("id", id).eq("kind", "combo");
  } else {
    await db.from("templates").update({ current_version_id: null }).eq("id", id).eq("kind", "combo");
    await db.from("templates").delete().eq("id", id).eq("kind", "combo");
  }
  await audit(u.id, "combo.delete", "template", id, {});
  clearMemo();
  revalidatePath("/admin/combos");
  return { ok: T.removed };
}
