import "server-only";
import { randomBytes } from "node:crypto";
import { env } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Private link to one order: trendme.kz/o/<token>. It goes into the Kaspi invoice comment, so a
 * customer without Telegram can always reopen the order (and the video) from Kaspi's history.
 */
export async function orderAccessLink(orderId: string): Promise<string | null> {
  const db = supabaseAdmin();
  const { data: o } = await db.from("orders").select("access_token").eq("id", orderId).maybeSingle();
  let token = o?.access_token as string | null | undefined;
  if (!token) {
    token = randomBytes(16).toString("base64url");
    const { data: set } = await db.from("orders").update({ access_token: token }).eq("id", orderId).is("access_token", null).select("access_token").maybeSingle();
    if (!set) {
      const { data: again } = await db.from("orders").select("access_token").eq("id", orderId).maybeSingle();
      token = again?.access_token ?? null;
    }
  }
  if (!token) return null;
  return `${env().NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/o/${token}`;
}
