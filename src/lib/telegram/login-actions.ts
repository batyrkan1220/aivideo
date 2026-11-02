"use server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { allow, clientIp } from "@/lib/security/rate-limit";
import { botUsername } from "@/lib/partners";
import { isGuestEmail } from "./session";
import { LOGIN_PREFIX, finishLogin, takeConfirmedLogin } from "./bot-login";

const nextSchema = z.string().max(200).regex(/^\/[A-Za-z0-9/_?=&-]*$/).refine((s) => !s.startsWith("//"));

/** Starts a sign-in through the bot; the browser opens `botUrl` and then polls. */
export async function startTelegramLogin(next: string): Promise<{ ok: true; id: string; botUrl: string; appUrl: string } | { ok: false }> {
  if (!(await allow("tg_login", await clientIp()))) return { ok: false };
  const bot = await botUsername().catch(() => null);
  if (!bot) return { ok: false };
  const path = nextSchema.safeParse(next).success ? next : "/";
  const u = await getSessionUser();
  const guest = u && isGuestEmail(u.email) ? u.id : null;
  const { data, error } = await supabaseAdmin().from("telegram_logins").insert({ guest_user_id: guest, next_path: path }).select("id").single();
  if (error || !data) return { ok: false };
  const start = `${LOGIN_PREFIX}${data.id}`;
  return { ok: true, id: data.id, botUrl: `https://t.me/${bot}?start=${start}`, appUrl: `tg://resolve?domain=${bot}&start=${start}` };
}

/** Polled by the waiting browser: once the bot has confirmed, signs this browser in. */
export async function pollTelegramLogin(id: string): Promise<{ state: "waiting" | "done" | "expired"; next?: string }> {
  if (!z.string().uuid().safeParse(id).success) return { state: "expired" };
  const row = await takeConfirmedLogin(id);
  if (row) {
    try { return { state: "done", next: await finishLogin(row) }; } catch (err) {
      console.error(JSON.stringify({ src: "telegram", event: "bot_login_failed", reason: err instanceof Error ? err.message : "error" }));
      return { state: "expired" };
    }
  }
  const { data } = await supabaseAdmin().from("telegram_logins").select("expires_at,used_at").eq("id", id).maybeSingle();
  if (!data || data.used_at || new Date(data.expires_at).getTime() < Date.now()) return { state: "expired" };
  return { state: "waiting" };
}
