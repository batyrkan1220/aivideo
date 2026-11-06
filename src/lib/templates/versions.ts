import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";

/** Immutable configuration snapshot; orders reference the version that was current when created. */
export async function snapshotVersion(templateId: string) {
  const db = supabaseAdmin();
  const { data: t } = await db.from("templates").select("*").eq("id", templateId).single();
  if (!t) return;
  const { data: last } = await db.from("template_versions").select("version_number")
    .eq("template_id", templateId).order("version_number", { ascending: false }).limit(1).maybeSingle();
  const snapshot = {
    title_kk: t.title_kk, required_face_count: t.required_face_count, face_slots_json: t.face_slots_json,
    supported_qualities_json: t.supported_qualities_json, pricing_config_json: t.pricing_config_json,
    provider_key: t.provider_key, provider_config_json: t.provider_config_json,
    preview_video_path: t.preview_video_path, cover_asset_path: t.cover_asset_path, max_upload_bytes: t.max_upload_bytes,
  };
  const { data: v, error } = await db.from("template_versions")
    .insert({ template_id: templateId, version_number: (last?.version_number ?? 0) + 1, configuration_snapshot: snapshot })
    .select("id").single();
  if (error) { console.error("[admin.template.version]", error.code); return; }
  await db.from("templates").update({ current_version_id: v.id }).eq("id", templateId);
}

