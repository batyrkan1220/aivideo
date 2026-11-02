"use server";
import { revalidatePath } from "next/cache";
import { clearMemo } from "@/lib/cache/memo";
import { audit, getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { PIXELS_KEY, pixelSettings, pixelSettingsSchema } from "@/lib/pixels/settings";

export type PixelsState = { ok?: boolean; error?: "forbidden" | "invalid" | "failed"; field?: string };
const SECRETS = ["tiktokToken", "metaToken", "ga4Secret"] as const;

/** Saves IDs as typed; a secret field left empty keeps the stored one ("clear_<field>" removes it). */
export async function savePixels(_: PixelsState, fd: FormData): Promise<PixelsState> {
  const u = await getSessionUser();
  if (!u || !can(u.role, "users.manage")) return { error: "forbidden" };
  const cur = await pixelSettings();
  const raw: Record<string, string> = {};
  for (const k of Object.keys(pixelSettingsSchema.shape)) raw[k] = String(fd.get(k) ?? "").trim();
  for (const k of SECRETS) {
    if (fd.get(`clear_${k}`) === "on") raw[k] = "";
    else if (!raw[k]) raw[k] = cur[k];
  }
  const p = pixelSettingsSchema.safeParse(raw);
  if (!p.success) return { error: "invalid", field: String(p.error.issues[0]?.path[0] ?? "") };
  const { error } = await supabaseAdmin().from("site_settings").upsert({
    key: PIXELS_KEY, value: p.data, updated_by: u.id, updated_at: new Date().toISOString(),
  });
  if (error) return { error: "failed" };
  // Audit without secrets: only which tools are on.
  await audit(u.id, "pixels.settings", "site_settings", null, {
    tiktok: !!p.data.tiktokPixelId, tiktokApi: !!p.data.tiktokToken, meta: !!p.data.metaPixelId, metaApi: !!p.data.metaToken,
    ga4: !!p.data.ga4Id, ga4Api: !!p.data.ga4Secret, ym: !!p.data.ymId,
  });
  clearMemo();
  revalidatePath("/admin/pixels");
  return { ok: true };
}
