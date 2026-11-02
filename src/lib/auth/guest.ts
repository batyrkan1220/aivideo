"use server";
import { randomUUID } from "node:crypto";
import { getSessionUser } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { allow, clientIp } from "@/lib/security/rate-limit";
import { GUEST_EMAIL_DOMAIN, signInByEmail } from "@/lib/telegram/session";

/**
 * A visitor from an ad can upload a photo right away: the first upload quietly creates a guest
 * account (no email, no password) and signs this browser in. At payment the guest confirms with
 * Telegram and the guest becomes (or is merged into) their Telegram account.
 */
export async function ensureGuestSession(): Promise<{ ok: boolean }> {
  if (await getSessionUser()) return { ok: true };
  if (!(await allow("guest", await clientIp()))) return { ok: false };
  const email = `g${randomUUID().replace(/-/g, "")}@${GUEST_EMAIL_DOMAIN}`;
  const { error } = await supabaseAdmin().auth.admin.createUser({
    email, email_confirm: true, app_metadata: { guest: true }, user_metadata: { display_name: null },
  });
  if (error) { console.error("[guest] create failed"); return { ok: false }; }
  try { await signInByEmail(email); } catch { return { ok: false }; }
  return { ok: true };
}
