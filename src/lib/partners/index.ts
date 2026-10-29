import "server-only";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/server";
import { formatKzt } from "@/lib/pricing";
import { tg, escapeHtml } from "@/lib/telegram/bot";

/**
 * Partner program. A partner shares a link; the first partner a customer arrives with is kept
 * on their profile (first touch, never overwritten), and every real payment of that customer
 * earns the partner `percent` % (a DB trigger writes the commission, refunds reverse it).
 *
 * Links: Telegram bot  https://t.me/<bot>?start=p_<code>
 *        Mini App      https://t.me/<bot>?startapp=p_<code>   (needs the bot's Main Mini App)
 *        Website       https://trendme.kz/?ref=<code>
 */
export const CODE_RE = /^[a-z0-9]{4,24}$/;
export const REF_COOKIE = "tm_ref";
const PAYLOAD_RE = /^p_([a-z0-9]{4,24})$/;

export const codeFromPayload = (payload: string | null | undefined) => PAYLOAD_RE.exec((payload ?? "").trim().toLowerCase())?.[1] ?? null;

type Partner = { id: string; code: string; percent: number; telegram_id: number | null };

export async function partnerByCode(code: string | null | undefined): Promise<Partner | null> {
  if (!code || !CODE_RE.test(code)) return null;
  const { data } = await supabaseAdmin().from("partners").select("id,code,percent,telegram_id").eq("code", code).eq("active", true).maybeSingle();
  return data ? { ...data, percent: Number(data.percent), telegram_id: data.telegram_id ? Number(data.telegram_id) : null } : null;
}

export async function recordVisit(partnerId: string, source: "bot" | "app" | "site") {
  try { await supabaseAdmin().from("partner_visits").insert({ partner_id: partnerId, source }); } catch { /* stats only */ }
}

/** Sets the profile's partner once (first touch). Partners cannot refer themselves. */
export async function attributeProfile(userId: string, partner: Partner, telegramId?: number | null) {
  if (partner.telegram_id && telegramId && partner.telegram_id === telegramId) return;
  // Also by username: a partner who registered in Teliks may not have written to the bot yet.
  const db = supabaseAdmin();
  const [{ data: prof }, { data: pa }] = await Promise.all([
    db.from("profiles").select("telegram_username").eq("id", userId).maybeSingle(),
    db.from("partners").select("telegram_username").eq("id", partner.id).maybeSingle(),
  ]);
  if (prof?.telegram_username && pa?.telegram_username && prof.telegram_username.toLowerCase() === pa.telegram_username.toLowerCase()) return;
  await supabaseAdmin().from("profiles")
    .update({ referred_by: partner.id, referred_at: new Date().toISOString() })
    .eq("id", userId).is("referred_by", null);
}

/** Bot /start p_<code>: remember the Telegram user (they may not have an account yet). */
export async function touchFromBot(telegramId: number, code: string, username?: string): Promise<"unknown_code" | "self" | "new" | "existing_user" | "already_referred"> {
  const partner = await partnerByCode(code);
  if (!partner) return "unknown_code";
  if (partner.telegram_id === telegramId) return "self";
  if (username) {
    const { data: pa } = await supabaseAdmin().from("partners").select("telegram_username").eq("id", partner.id).maybeSingle();
    if (pa?.telegram_username && pa.telegram_username.toLowerCase() === username.toLowerCase()) return "self";
  }
  const db = supabaseAdmin();
  await db.from("partner_touches").upsert({ telegram_id: telegramId, partner_id: partner.id }, { onConflict: "telegram_id", ignoreDuplicates: true });
  await recordVisit(partner.id, "bot");
  const { data: prof } = await db.from("profiles").select("id,referred_by").eq("telegram_id", telegramId).maybeSingle();
  if (!prof) return "new";
  if (prof.referred_by) return "already_referred";
  await attributeProfile(prof.id, partner, telegramId);
  return "existing_user";
}

/** After Mini App sign-in: partner from the start parameter, else from an earlier bot touch. */
export async function attributeTelegramUser(userId: string, telegramId: number, startParam: string | null) {
  try {
    const code = codeFromPayload(startParam);
    let partner = code ? await partnerByCode(code) : null;
    if (partner) {
      await recordVisit(partner.id, "app");
    } else {
      const { data: t } = await supabaseAdmin().from("partner_touches").select("partner_id").eq("telegram_id", telegramId).maybeSingle();
      if (t) {
        const { data: p } = await supabaseAdmin().from("partners").select("id,code,percent,telegram_id").eq("id", t.partner_id).eq("active", true).maybeSingle();
        partner = p ? { ...p, percent: Number(p.percent), telegram_id: p.telegram_id ? Number(p.telegram_id) : null } : null;
      }
    }
    if (partner) await attributeProfile(userId, partner, telegramId);
  } catch (err) {
    console.error("[partners.attribute.tg]", err instanceof Error ? err.message : err);
  }
}

/** Website visitors: the ?ref= code is kept in a cookie and applied when they order. */
export async function attributeFromCookie(userId: string) {
  try {
    const code = (await cookies()).get(REF_COOKIE)?.value;
    const partner = await partnerByCode(code);
    if (partner) await attributeProfile(userId, partner);
  } catch { /* never block an order */ }
}

/** A partner writing to the bot is linked by their username (set in the admin panel). */
export async function linkPartnerTelegram(username: string | undefined, telegramId: number) {
  if (!username) return;
  await supabaseAdmin().from("partners").update({ telegram_id: telegramId })
    .ilike("telegram_username", username).is("telegram_id", null);
}

let botName: { at: number; name: string | null } | null = null;
export async function botUsername(): Promise<string | null> {
  if (botName && Date.now() - botName.at < 3600_000) return botName.name;
  const me = await tg<{ username?: string }>("getMe", {});
  botName = { at: Date.now(), name: me?.username ?? botName?.name ?? null };
  return botName.name;
}

export function partnerLinks(code: string, bot: string | null) {
  const site = `${env().NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/?ref=${code}`;
  return {
    bot: bot ? `https://t.me/${bot}?start=p_${code}` : null,
    app: bot ? `https://t.me/${bot}?startapp=p_${code}` : null,
    site,
  };
}

/** Tells the partner in Telegram that they earned a commission. Never throws. */
export async function notifyPartnerCommission(orderId: string) {
  try {
    const db = supabaseAdmin();
    const { data: c } = await db.from("partner_commissions").select("partner_id,commission_kzt,order_amount_kzt,status").eq("order_id", orderId).maybeSingle();
    if (!c || c.status !== "earned") return;
    const { data: p } = await db.from("partners").select("telegram_id").eq("id", c.partner_id).maybeSingle();
    if (!p?.telegram_id) return;
    const { data: o } = await db.from("orders").select("public_order_number").eq("id", orderId).maybeSingle();
    await tg("sendMessage", {
      chat_id: Number(p.telegram_id), parse_mode: "HTML",
      text: `💰 <b>+${formatKzt(c.commission_kzt)}</b>\nКлиент по вашей ссылке оплатил заказ: ${escapeHtml(o?.public_order_number ?? "")} · ${formatKzt(c.order_amount_kzt)}\n\nВаш баланс: /partner`,
    });
  } catch {
    console.error(JSON.stringify({ src: "partners", event: "notify_failed" }));
  }
}

export type PartnerTotals = { visits: number; users: number; paidOrders: number; revenueKzt: number; earnedKzt: number; reversedKzt: number; paidOutKzt: number; balanceKzt: number };

export async function partnerTotals(): Promise<Map<string, PartnerTotals>> {
  const { data } = await supabaseAdmin().rpc("partner_stats");
  const m = new Map<string, PartnerTotals>();
  for (const r of (data ?? []) as Record<string, number | string>[]) {
    const n = (k: string) => Number(r[k] ?? 0);
    m.set(String(r.partner_id), {
      visits: n("visits"), users: n("users"), paidOrders: n("paid_orders"), revenueKzt: n("revenue_kzt"),
      earnedKzt: n("earned_kzt"), reversedKzt: n("reversed_kzt"), paidOutKzt: n("paid_out_kzt"),
      balanceKzt: n("earned_kzt") - n("paid_out_kzt"),
    });
  }
  return m;
}

/** /partner in the bot: the partner's own numbers and links. */
export async function partnerSelfReport(telegramId: number): Promise<string | null> {
  const { data: p } = await supabaseAdmin().from("partners").select("id,code,name,percent,active").eq("telegram_id", telegramId).maybeSingle();
  if (!p) return null;
  const one = await partnerOneTotals(p.id, new Date(0).toISOString(), new Date(Date.now() + 86400_000).toISOString());
  const t = { visits: one.period.visits, users: one.period.users, paidOrders: one.period.paidOrders, revenueKzt: one.period.revenueKzt, earnedKzt: one.lifetime.earnedKzt, paidOutKzt: one.lifetime.paidOutKzt, balanceKzt: one.lifetime.earnedKzt - one.lifetime.paidOutKzt };
  const links = partnerLinks(p.code, await botUsername());
  return [
    `🤝 <b>${escapeHtml(p.name)}</b> — партнёрская программа${p.active ? "" : " (приостановлена)"}`,
    `Вознаграждение: <b>${Number(p.percent)}%</b> с каждой оплаты`,
    "",
    `👀 Переходы: ${t?.visits ?? 0} · 👤 Клиенты: ${t?.users ?? 0}`,
    `🧾 Оплаты: ${t?.paidOrders ?? 0} · на сумму ${formatKzt(t?.revenueKzt ?? 0)}`,
    `💰 Заработано: <b>${formatKzt(t?.earnedKzt ?? 0)}</b> · выплачено: ${formatKzt(t?.paidOutKzt ?? 0)}`,
    `💳 Баланс: <b>${formatKzt(t?.balanceKzt ?? 0)}</b>`,
    "",
    "<b>Ваши ссылки:</b>",
    ...(links.bot ? [`Telegram бот: ${links.bot}`] : []),
    `Сайт: ${links.site}`,
  ].join("\n");
}

/** Date range from ?from=&to= (Asia/Almaty calendar days), default last 30 days. */
export function partnerPeriod(sp: { from?: string; to?: string }) {
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty" }).format(d);
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : day(new Date());
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : day(new Date(Date.parse(to) - 29 * 86400_000));
  return {
    from, to,
    fromIso: new Date(`${from}T00:00:00+05:00`).toISOString(),
    toIso: new Date(new Date(`${to}T00:00:00+05:00`).getTime() + 86400_000).toISOString(),
  };
}

export type PeriodTotals = { visits: number; users: number; buyers: number; paidOrders: number; revenueKzt: number; earnedKzt: number; reversedKzt: number; paidOutKzt: number };

export async function partnerPeriodTotals(fromIso: string, toIso: string): Promise<Map<string, PeriodTotals>> {
  const { data } = await supabaseAdmin().rpc("partner_stats_period", { p_from: fromIso, p_to: toIso });
  const m = new Map<string, PeriodTotals>();
  for (const r of (data ?? []) as Record<string, number | string>[]) {
    const n = (k: string) => Number(r[k] ?? 0);
    m.set(String(r.partner_id), { visits: n("visits"), users: n("users"), buyers: n("buyers"), paidOrders: n("paid_orders"), revenueKzt: n("revenue_kzt"), earnedKzt: n("earned_kzt"), reversedKzt: n("reversed_kzt"), paidOutKzt: n("paid_out_kzt") });
  }
  return m;
}

export async function partnerDaily(partnerId: string | null, fromIso: string, toIso: string) {
  const { data } = await supabaseAdmin().rpc("partner_daily", { p_partner: partnerId, p_from: fromIso, p_to: toIso });
  return ((data ?? []) as Record<string, number | string>[]).map((r) => ({
    day: String(r.day), visits: Number(r.visits), users: Number(r.users), paidOrders: Number(r.paid_orders),
    revenueKzt: Number(r.revenue_kzt), earnedKzt: Number(r.earned_kzt),
  }));
}

/** Defaults for partners who register themselves in Teliks (admin-editable). */
export const PARTNER_DEFAULTS_KEY = "partner_defaults";
export async function partnerDefaults(): Promise<{ percent: number; autoActivate: boolean }> {
  try {
    const { data } = await supabaseAdmin().from("site_settings").select("value").eq("key", PARTNER_DEFAULTS_KEY).maybeSingle();
    const v = (data?.value ?? {}) as { percent?: unknown; autoActivate?: unknown };
    const percent = Number(v.percent);
    return { percent: Number.isFinite(percent) && percent >= 0 && percent <= 90 ? percent : 20, autoActivate: v.autoActivate !== false };
  } catch {
    return { percent: 20, autoActivate: true };
  }
}

/** One partner: period totals and lifetime earned / reversed / paid out. */
export async function partnerOneTotals(partnerId: string, fromIso: string, toIso: string) {
  const { data } = await supabaseAdmin().rpc("partner_stats_one", { p_partner: partnerId, p_from: fromIso, p_to: toIso });
  const r = ((Array.isArray(data) ? data[0] : data) ?? {}) as Record<string, number | string>;
  const n = (k: string) => Number(r[k] ?? 0);
  return {
    period: { visits: n("visits"), users: n("users"), buyers: n("buyers"), paidOrders: n("paid_orders"), revenueKzt: n("revenue_kzt"), earnedKzt: n("earned_kzt"), reversedKzt: n("reversed_kzt"), paidOutKzt: n("paid_out_kzt") },
    lifetime: { earnedKzt: n("life_earned_kzt"), reversedKzt: n("life_reversed_kzt"), paidOutKzt: n("life_paid_out_kzt") },
  };
}
