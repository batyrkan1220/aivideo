import "server-only";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Teliks partner cabinet (teliks.ink) runs on its own Supabase project. TrendMe's admin creates
 * the partner's login there and processes payout requests; Teliks reads the numbers from
 * TrendMe's /api/partner-api with a shared secret.
 */
export function teliksConfigured() {
  const e = env();
  return !!(e.TELIKS_SUPABASE_URL && e.TELIKS_SUPABASE_SERVICE_ROLE_KEY);
}

function teliks() {
  const e = env();
  if (!e.TELIKS_SUPABASE_URL || !e.TELIKS_SUPABASE_SERVICE_ROLE_KEY) throw new Error("teliks_not_configured");
  return createClient(e.TELIKS_SUPABASE_URL, e.TELIKS_SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Readable one-time password: 14 chars, no look-alike characters. */
function newPassword() {
  const abc = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return [...randomBytes(14)].map((b) => abc[b % abc.length]).join("");
}

export async function createTeliksAccount(partnerId: string, email: string): Promise<{ ok: true; password: string } | { ok: false; error: "not_configured" | "exists" | "email_taken" | "failed" }> {
  if (!teliksConfigured()) return { ok: false, error: "not_configured" };
  const db = supabaseAdmin();
  const { data: p } = await db.from("partners").select("id,code,name,active,teliks_user_id").eq("id", partnerId).single();
  if (!p) return { ok: false, error: "failed" };
  if (p.teliks_user_id) return { ok: false, error: "exists" };
  const t = teliks();
  const password = newPassword();
  const { data: created, error } = await t.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: p.name } });
  if (error || !created.user) return { ok: false, error: /already|registered|exists/i.test(error?.message ?? "") ? "email_taken" : "failed" };
  const { error: insErr } = await t.from("partners").insert({ user_id: created.user.id, trendme_code: p.code, name: p.name, active: p.active });
  if (insErr) { await t.auth.admin.deleteUser(created.user.id); return { ok: false, error: "failed" }; }
  await db.from("partners").update({ teliks_user_id: created.user.id, teliks_email: email }).eq("id", partnerId);
  return { ok: true, password };
}

export async function resetTeliksPassword(partnerId: string): Promise<{ ok: true; password: string } | { ok: false }> {
  if (!teliksConfigured()) return { ok: false };
  const { data: p } = await supabaseAdmin().from("partners").select("teliks_user_id").eq("id", partnerId).single();
  if (!p?.teliks_user_id) return { ok: false };
  const password = newPassword();
  const { error } = await teliks().auth.admin.updateUserById(p.teliks_user_id, { password });
  return error ? { ok: false } : { ok: true, password };
}

/** Keeps the cabinet's copy of name / active in sync after an admin edit. */
export async function syncTeliksPartner(partnerId: string) {
  if (!teliksConfigured()) return;
  const { data: p } = await supabaseAdmin().from("partners").select("code,name,active,teliks_user_id").eq("id", partnerId).single();
  if (!p?.teliks_user_id) return;
  await teliks().from("partners").update({ name: p.name, active: p.active, trendme_code: p.code }).eq("user_id", p.teliks_user_id);
}

export type PayoutRequest = { id: string; amount_kzt: number; method: string; details: string; status: string; created_at: string; processed_at: string | null; note: string | null };

export async function teliksPayoutRequests(teliksUserId: string | null): Promise<PayoutRequest[]> {
  if (!teliksUserId || !teliksConfigured()) return [];
  const { data } = await teliks().from("payout_requests").select("id,amount_kzt,method,details,status,created_at,processed_at,note")
    .eq("user_id", teliksUserId).order("created_at", { ascending: false }).limit(50);
  return (data ?? []) as PayoutRequest[];
}

export async function teliksPayoutDetails(teliksUserId: string | null): Promise<{ method: string | null; value: string | null } | null> {
  if (!teliksUserId || !teliksConfigured()) return null;
  const { data } = await teliks().from("partners").select("payout_method,payout_value").eq("user_id", teliksUserId).maybeSingle();
  return data ? { method: data.payout_method, value: data.payout_value } : null;
}

/** Pay → recorded as a TrendMe payout (balance) and the request closed; reject → just closed. */
export async function processTeliksPayout(partnerId: string, requestId: string, action: "paid" | "rejected", adminId: string): Promise<boolean> {
  if (!teliksConfigured()) return false;
  const { data: p } = await supabaseAdmin().from("partners").select("teliks_user_id").eq("id", partnerId).single();
  if (!p?.teliks_user_id) return false;
  const t = teliks();
  const { data: r } = await t.from("payout_requests").update({ status: action, processed_at: new Date().toISOString() })
    .eq("id", requestId).eq("user_id", p.teliks_user_id).eq("status", "processing").select("amount_kzt,method").maybeSingle();
  if (!r) return false;
  if (action === "paid") {
    await supabaseAdmin().from("partner_payouts").insert({ partner_id: partnerId, amount_kzt: r.amount_kzt, note: `Teliks · ${r.method}`, created_by: adminId });
  }
  return true;
}
