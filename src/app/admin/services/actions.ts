"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit, getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { clearMemo } from "@/lib/cache/memo";
import { supabaseAdmin } from "@/lib/supabase/server";

/** Admin: the Gemini balance after a top-up (counts from now) and the token prices. */
export async function saveGeminiBilling(_: { ok?: boolean; error?: string }, fd: FormData): Promise<{ ok?: boolean; error?: string }> {
  const u = await getSessionUser();
  if (!u || !can(u.role, "templates.manage")) return { error: "Нет доступа" };
  const num = (k: string) => { const v = String(fd.get(k) ?? "").replace(",", ".").trim(); return v === "" ? null : Number(v); };
  const p = z.object({
    balanceUsd: z.number().min(0).max(100_000).nullable(),
    inputUsdPer1M: z.number().min(0).max(100),
    outputUsdPer1M: z.number().min(0).max(200),
  }).safeParse({ balanceUsd: num("balanceUsd"), inputUsdPer1M: num("inputUsdPer1M") ?? 0.3, outputUsdPer1M: num("outputUsdPer1M") ?? 2.5 });
  if (!p.success) return { error: "Проверьте числа" };
  const db = supabaseAdmin();
  const { data: cur } = await db.from("site_settings").select("value").eq("key", "gemini_billing").maybeSingle();
  const old = (cur?.value as { balanceUsd?: number | null; balanceAt?: string | null } | null) ?? {};
  // A new balance starts counting now; the same number keeps its date.
  const balanceAt = p.data.balanceUsd === null ? null : p.data.balanceUsd === old.balanceUsd ? old.balanceAt ?? new Date().toISOString() : new Date().toISOString();
  const value = { ...p.data, balanceAt };
  const { error } = await db.from("site_settings").upsert({ key: "gemini_billing", value, updated_by: u.id, updated_at: new Date().toISOString() });
  if (error) return { error: "Не сохранилось" };
  await audit(u.id, "settings.gemini_billing", "site_settings", null, { balanceUsd: p.data.balanceUsd });
  clearMemo();
  revalidatePath("/admin/services");
  return { ok: true };
}
