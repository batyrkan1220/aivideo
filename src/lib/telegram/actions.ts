"use server";
import { z } from "zod";
import { env } from "@/lib/env";
import { getSessionUser } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { allow } from "@/lib/security/rate-limit";

/**
 * Telegram → browser: one-time link that signs the same account into the regular browser and
 * opens the order there, where the Kaspi payment runs (not inside the Mini App).
 */
export async function createPaymentHandoff(orderId: string): Promise<{ ok: true; url: string } | { ok: false }> {
  const user = await getSessionUser();
  if (!user || !z.string().uuid().safeParse(orderId).success) return { ok: false };
  if (!(await allow("handoff", user.id))) return { ok: false };
  const db = supabaseAdmin();
  const { data: o } = await db.from("orders").select("id").eq("id", orderId).eq("user_id", user.id).maybeSingle();
  if (!o) return { ok: false };
  const { data: h, error } = await db.from("login_handoffs")
    .insert({ user_id: user.id, next_path: `/orders/${o.id}` }).select("id").single();
  if (error || !h) return { ok: false };
  return { ok: true, url: `${env().NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/auth/handoff/${h.id}` };
}
