import "server-only";
import { DISCOUNTS_ON } from "@/lib/engage/price";
import { supabaseAdmin } from "@/lib/supabase/server";
import { forgetProfile } from "@/lib/auth/session";
import { attributeTelegramUser } from "@/lib/partners";
import { notifyOrderOwner } from "./bot";
import { track } from "@/lib/analytics";
import { isGuestEmail, signInByEmail, signInTelegramUser, telegramEmail } from "./session";
import type { TelegramUser } from "./init-data";

/*
  Website sign-in through the bot (no email, no password, no phone number):
   1. the browser asks for a login → row in telegram_logins, link t.me/<bot>?start=l_<id>;
   2. the person taps Start in Telegram → the webhook confirms the row with their Telegram id;
   3. the waiting browser (polling) or the one-time link the bot sends finishes the sign-in.
  A guest account (photos uploaded before signing in) becomes the Telegram account, or — if that
  Telegram user already has one — its photos, videos and orders move there.
*/
export const LOGIN_PREFIX = "l_";
/** Bonus for guests who link Telegram (shown on the order page). */
export const TELEGRAM_BONUS_PCT = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const loginIdFromStart = (payload: string | null | undefined) => {
  const id = payload?.startsWith(LOGIN_PREFIX) ? payload.slice(LOGIN_PREFIX.length) : "";
  return UUID.test(id) ? id : null;
};

/** Webhook: the Telegram user tapped Start with our login payload. Returns true if confirmed. */
export async function confirmLoginFromBot(id: string, from: { id: number; first_name?: string; last_name?: string; username?: string }): Promise<boolean> {
  const { data } = await supabaseAdmin().from("telegram_logins")
    .update({
      telegram_id: from.id, tg_first_name: from.first_name?.slice(0, 80) ?? null, tg_last_name: from.last_name?.slice(0, 80) ?? null,
      tg_username: from.username?.slice(0, 64) ?? null, confirmed_at: new Date().toISOString(),
    })
    .eq("id", id).is("telegram_id", null).gt("expires_at", new Date().toISOString())
    .select("id").maybeSingle();
  return !!data;
}

type Row = { id: string; guest_user_id: string | null; next_path: string; telegram_id: number; tg_first_name: string | null; tg_last_name: string | null; tg_username: string | null };

/** Atomically takes a confirmed, unused, fresh request (works once). */
export async function takeConfirmedLogin(id: string): Promise<Row | null> {
  if (!UUID.test(id)) return null;
  const { data } = await supabaseAdmin().from("telegram_logins")
    .update({ used_at: new Date().toISOString() })
    .eq("id", id).is("used_at", null).not("telegram_id", "is", null).gt("expires_at", new Date().toISOString())
    .select("id,guest_user_id,next_path,telegram_id,tg_first_name,tg_last_name,tg_username").maybeSingle();
  return (data as Row | null) ?? null;
}

/** The one-time link the bot sends (to finish in whichever browser the person opens it): works once. */
export async function takeLinkLogin(id: string): Promise<Row | null> {
  if (!UUID.test(id)) return null;
  const { data } = await supabaseAdmin().from("telegram_logins")
    .update({ link_used_at: new Date().toISOString() })
    .eq("id", id).is("link_used_at", null).not("telegram_id", "is", null).gt("expires_at", new Date().toISOString())
    .select("id,guest_user_id,next_path,telegram_id,tg_first_name,tg_last_name,tg_username").maybeSingle();
  return (data as Row | null) ?? null;
}

/** Signs this browser into the Telegram account of a confirmed request, merging the guest first. */
export async function finishLogin(row: Row): Promise<string> {
  const admin = supabaseAdmin();
  const tu: TelegramUser = { id: Number(row.telegram_id), first_name: row.tg_first_name ?? undefined, last_name: row.tg_last_name ?? undefined, username: row.tg_username ?? undefined };
  const { data: existing } = await admin.from("profiles").select("id").eq("telegram_id", tu.id).maybeSingle();

  let guestId: string | null = null;
  if (row.guest_user_id) {
    const { data: g } = await admin.auth.admin.getUserById(row.guest_user_id);
    if (g.user && isGuestEmail(g.user.email)) guestId = g.user.id;
  }

  let userId: string;
  if (guestId && !existing) {
    // The guest becomes the Telegram account (same id: photos and orders stay in place).
    const email = telegramEmail(tu.id);
    const name = [tu.first_name, tu.last_name].filter(Boolean).join(" ").slice(0, 80) || tu.username || "Telegram";
    const { error } = await admin.auth.admin.updateUserById(guestId, {
      email, email_confirm: true, app_metadata: { telegram_id: tu.id, guest: false }, user_metadata: { display_name: name },
    });
    if (error) throw new Error("convert_failed");
    await admin.from("profiles").update({ email, telegram_id: tu.id, telegram_username: tu.username ?? null, display_name: name }).eq("id", guestId);
    forgetProfile(guestId);
    await signInByEmail(email);
    userId = guestId;
  } else {
    if (guestId && existing) {
      // Known Telegram user: bring the guest's photos, videos and orders over, then drop the guest.
      for (const t of ["orders", "order_assets", "order_videos", "analytics_events"] as const) {
        await admin.from(t).update({ user_id: existing.id }).eq("user_id", guestId);
      }
      await admin.auth.admin.deleteUser(guestId).catch(() => {});
    }
    userId = await signInTelegramUser(tu);
  }
  await attributeTelegramUser(userId, tu.id, null);
  await track(guestId ? "telegram_linked" : "telegram_login", { userId, props: { via: "site", merged: !!(guestId && existing) } });
  // A guest who linked Telegram gets the promised bonus: −20% on the next video for 7 days.
  if (guestId && DISCOUNTS_ON) {
    const { count } = await admin.from("user_discounts").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("reason", "telegram_link");
    if (!count) {
      await admin.from("user_discounts").insert({ user_id: userId, percent: TELEGRAM_BONUS_PCT, reason: "telegram_link", expires_at: new Date(Date.now() + 7 * 86400_000).toISOString() });
    }
  }
  // Signed in to get a finished video (paid as a guest): the "video is ready" message goes to the chat now.
  const orderId = /^\/orders\/([0-9a-f-]{36})/.exec(row.next_path)?.[1];
  if (orderId) {
    const { data: o } = await admin.from("orders").select("generation_status,user_id").eq("id", orderId).maybeSingle();
    if (o?.generation_status === "completed" && o.user_id === userId) await notifyOrderOwner(orderId, "ready");
  }
  return row.next_path;
}
