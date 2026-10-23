"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit, getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { CPA_KEY, cpaSettingsSchema, retryCpaPostback } from "@/lib/cpa";

export type CpaState = { ok?: boolean; error?: "forbidden" | "invalid" | "failed" };

export async function saveCpaSettings(_: CpaState, fd: FormData): Promise<CpaState> {
  const u = await getSessionUser();
  if (!u || !can(u.role, "users.manage")) return { error: "forbidden" };
  const url = String(fd.get("postbackUrl") ?? "").trim();
  if (url && (!/^https:\/\/[^\s]+$/.test(url) || !/\{(click_id|tid|aff_click_id)\}/.test(url))) return { error: "invalid" };
  const p = cpaSettingsSchema.safeParse({
    enabled: fd.get("enabled") === "on", network: "offer18", postbackUrl: url,
    sendLead: fd.get("sendLead") === "on", sendSale: fd.get("sendSale") === "on",
  });
  if (!p.success) return { error: "invalid" };
  const { error } = await supabaseAdmin().from("site_settings").upsert({ key: CPA_KEY, value: p.data, updated_by: u.id, updated_at: new Date().toISOString() });
  if (error) return { error: "failed" };
  await audit(u.id, "cpa.settings", "site_settings", null, { enabled: p.data.enabled, sendLead: p.data.sendLead, sendSale: p.data.sendSale });
  revalidatePath("/admin/cpa");
  return { ok: true };
}

export async function retryPostback(fd: FormData) {
  const u = await getSessionUser();
  if (!u || !can(u.role, "users.manage")) return;
  const id = z.string().uuid().safeParse(fd.get("id"));
  if (!id.success) return;
  await retryCpaPostback(id.data);
  revalidatePath("/admin/cpa");
}
