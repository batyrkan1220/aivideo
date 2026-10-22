import "server-only";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import type { TelegramUser } from "./init-data";

/** Telegram accounts get a non-deliverable placeholder email (Supabase Auth needs one). */
export const TELEGRAM_EMAIL_DOMAIN = "telegram.trendme.kz";
export const telegramEmail = (id: number) => `tg${id}@${TELEGRAM_EMAIL_DOMAIN}`;
export const isTelegramEmail = (email: string | null | undefined) => !!email && email.endsWith(`@${TELEGRAM_EMAIL_DOMAIN}`);

/** Signs the current request in as `email` (sets the normal Supabase session cookies). */
async function signInByEmail(email: string) {
  const admin = supabaseAdmin();
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data.properties?.hashed_token) throw new Error("link_failed");
  const sb = await supabaseServer();
  const { error: vErr } = await sb.auth.verifyOtp({ type: "magiclink", token_hash: data.properties.hashed_token });
  if (vErr) throw new Error("verify_failed");
}

/** Finds or creates the account for a verified Telegram user, then signs it in. Returns the user id. */
export async function signInTelegramUser(u: TelegramUser): Promise<string> {
  const admin = supabaseAdmin();
  const name = [u.first_name, u.last_name].filter(Boolean).join(" ").slice(0, 80) || u.username || "Telegram";

  const { data: existing } = await admin.from("profiles").select("id,email").eq("telegram_id", u.id).maybeSingle();
  let userId = existing?.id as string | undefined;
  let email = existing?.email as string | undefined;

  if (!userId) {
    email = telegramEmail(u.id);
    const { data: created, error } = await admin.auth.admin.createUser({
      email, email_confirm: true,
      user_metadata: { display_name: name },
      app_metadata: { telegram_id: u.id },   // server-only: users cannot set app_metadata themselves
    });
    if (error || !created.user) {
      // Already created by a concurrent request: accept it only if WE created it for this Telegram id.
      const { data: again } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
      if (!again) throw new Error("create_failed");
      const { data: au } = await admin.auth.admin.getUserById(again.id);
      if (Number(au.user?.app_metadata?.telegram_id) !== u.id) throw new Error("email_conflict");
      userId = again.id;
    } else {
      userId = created.user.id;
    }
  }
  await admin.from("profiles").update({
    telegram_id: u.id, telegram_username: u.username ?? null,
  }).eq("id", userId);
  await admin.from("profiles").update({ display_name: name }).eq("id", userId).is("display_name", null);

  if (!email) {
    const { data } = await admin.auth.admin.getUserById(userId!);
    email = data.user?.email ?? undefined;
  }
  if (!email) throw new Error("no_email");
  await signInByEmail(email);
  return userId!;
}

/**
 * Redeems a one-time hand-off link (Telegram → regular browser). Atomic: a link works once,
 * for 10 minutes. Returns the path to continue to, or null.
 */
export async function redeemHandoff(id: string): Promise<string | null> {
  const admin = supabaseAdmin();
  const { data } = await admin.from("login_handoffs")
    .update({ used_at: new Date().toISOString() })
    .eq("id", id).is("used_at", null).gt("expires_at", new Date().toISOString())
    .select("user_id,next_path").maybeSingle();
  if (!data) return null;
  const { data: u } = await admin.auth.admin.getUserById(data.user_id);
  if (!u.user?.email) return null;
  await signInByEmail(u.user.email);
  return data.next_path;
}
