"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit, requirePermission, ForbiddenError } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  templateInputSchema, publishProblems, rowToInput, inputToRow, type PublishProblem,
} from "@/lib/templates/admin-schema";

export type SaveResult =
  | { ok: true; id: string }
  | { ok: false; error: "invalid" | "forbidden" | "generic"; fields?: string[] };

async function guard(perm: Parameters<typeof requirePermission>[0]) {
  try {
    return await requirePermission(perm);
  } catch (e) {
    if (e instanceof ForbiddenError) return null;
    throw e;
  }
}

export async function saveTemplate(raw: unknown, id: string | null): Promise<SaveResult> {
  const user = await guard("templates.manage");
  if (!user) return { ok: false, error: "forbidden" };

  const parsed = templateInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "invalid", fields: parsed.error.issues.map((i) => i.path.join(".")) };
  }
  const row = inputToRow(parsed.data);
  const db = supabaseAdmin();

  if (!id) {
    const { data, error } = await db.from("templates")
      .insert({ ...row, status: "draft", created_by: user.id }).select("id").single();
    if (error) { console.error("[admin.template.create]", error.code, error.message); return { ok: false, error: "generic" }; }
    await audit(user.id, "template.create", "template", data.id, { title: row.title_kk });
    revalidatePath("/admin/templates");
    return { ok: true, id: data.id };
  }

  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "generic" };
  const { data: before } = await db.from("templates")
    .select("pricing_config_json, supported_qualities_json, status").eq("id", id).single();
  if (!before) return { ok: false, error: "generic" };

  const { error } = await db.from("templates").update(row).eq("id", id);
  if (error) { console.error("[admin.template.update]", error.code, error.message); return { ok: false, error: "generic" }; }

  await audit(user.id, "template.update", "template", id, { title: row.title_kk });
  const pricingChanged =
    JSON.stringify(before.pricing_config_json) !== JSON.stringify(row.pricing_config_json) ||
    JSON.stringify(before.supported_qualities_json) !== JSON.stringify(row.supported_qualities_json);
  if (pricingChanged) {
    await audit(user.id, "template.pricing_changed", "template", id, {
      before: { pricing: before.pricing_config_json, qualities: before.supported_qualities_json },
      after: { pricing: row.pricing_config_json, qualities: row.supported_qualities_json },
    });
  }
  // A published template's live configuration changed → snapshot a new version for future orders.
  if (before.status === "published") await snapshotVersion(id);

  revalidatePath("/admin/templates");
  revalidatePath(`/templates/${id}`);
  return { ok: true, id };
}

/** Immutable configuration snapshot; orders reference the version that was current when created. */
async function snapshotVersion(templateId: string) {
  const db = supabaseAdmin();
  const { data: t } = await db.from("templates").select("*").eq("id", templateId).single();
  if (!t) return;
  const { data: last } = await db.from("template_versions").select("version_number")
    .eq("template_id", templateId).order("version_number", { ascending: false }).limit(1).maybeSingle();
  const snapshot = {
    title_kk: t.title_kk, required_face_count: t.required_face_count, face_slots_json: t.face_slots_json,
    supported_qualities_json: t.supported_qualities_json, pricing_config_json: t.pricing_config_json,
    provider_key: t.provider_key, provider_config_json: t.provider_config_json,
    preview_video_path: t.preview_video_path, max_upload_bytes: t.max_upload_bytes,
  };
  const { data: v, error } = await db.from("template_versions")
    .insert({ template_id: templateId, version_number: (last?.version_number ?? 0) + 1, configuration_snapshot: snapshot })
    .select("id").single();
  if (error) { console.error("[admin.template.version]", error.code); return; }
  await db.from("templates").update({ current_version_id: v.id }).eq("id", templateId);
}

export type StatusResult = { ok: true } | { ok: false; error: "forbidden" | "generic"; problems?: PublishProblem[] };

export async function changeStatus(
  id: string, action: "publish" | "unpublish" | "archive" | "restore",
): Promise<StatusResult> {
  const user = await guard("templates.publish");
  if (!user) return { ok: false, error: "forbidden" };
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "generic" };
  const db = supabaseAdmin();

  if (action === "publish") {
    const { data: r } = await db.from("templates").select("*").eq("id", id).single();
    if (!r) return { ok: false, error: "generic" };
    const input = templateInputSchema.safeParse(rowToInput(r));
    const problems = input.success ? publishProblems(input.data) : (["invalid_face_slots"] as PublishProblem[]);
    if (problems.length) return { ok: false, error: "generic", problems };
    const { error } = await db.from("templates")
      .update({ status: "published", published_at: r.published_at ?? new Date().toISOString() }).eq("id", id);
    if (error) return { ok: false, error: "generic" };
    await snapshotVersion(id);
  } else {
    const status = action === "unpublish" ? "disabled" : action === "archive" ? "archived" : "draft";
    const { error } = await db.from("templates").update({ status }).eq("id", id);
    if (error) return { ok: false, error: "generic" };
  }

  await audit(user.id, `template.${action}`, "template", id);
  revalidatePath("/admin/templates");
  revalidatePath("/templates");
  revalidatePath("/");
  return { ok: true };
}

const uploadSchema = z.object({
  kind: z.enum(["cover", "preview"]),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm"]),
  size: z.number().int().positive(),
});
const LIMITS = { cover: 5 * 1024 * 1024, preview: 50 * 1024 * 1024 } as const;
const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4", "video/webm": "webm",
};

/**
 * Issues a one-time signed upload URL so the browser uploads straight to storage
 * (large videos never pass through our server). Bucket policy enforces type/size again.
 */
export async function createUploadUrl(raw: unknown) {
  const user = await guard("templates.manage");
  if (!user) return { ok: false as const };
  const p = uploadSchema.safeParse(raw);
  if (!p.success) return { ok: false as const };
  const { kind, contentType, size } = p.data;
  const isImage = contentType.startsWith("image/");
  if ((kind === "cover") !== isImage || size > LIMITS[kind]) return { ok: false as const };

  const path = `${kind === "cover" ? "covers" : "previews"}/${randomUUID()}.${EXT[contentType]}`;
  const { data, error } = await supabaseAdmin().storage.from("template-media").createSignedUploadUrl(path);
  if (error) { console.error("[admin.upload]", error.message); return { ok: false as const }; }
  return { ok: true as const, path: data.path, token: data.token };
}
