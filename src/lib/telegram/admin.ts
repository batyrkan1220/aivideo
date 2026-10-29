import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/server";
import { formatKzt } from "@/lib/pricing";
import { seedancePricingSettings } from "@/lib/pricing-seedance/settings";
import { tg, escapeHtml } from "./bot";

/**
 * Admin mode of the Telegram bot: key numbers, recent orders, problems and order lookup,
 * plus instant alerts. Who is an admin is decided by numeric Telegram user ids stored in
 * site_settings.telegram_admins (usernames can change hands, ids cannot).
 * Everything else is managed in the website admin panel.
 */
const ADMINS_KEY = "telegram_admins";
let cache: { at: number; ids: number[] } | null = null;

export async function botAdminIds(): Promise<number[]> {
  if (cache && Date.now() - cache.at < 60_000) return cache.ids;
  try {
    const { data } = await supabaseAdmin().from("site_settings").select("value").eq("key", ADMINS_KEY).maybeSingle();
    const p = z.object({ ids: z.array(z.coerce.number().int().positive()).max(20) }).safeParse(data?.value);
    cache = { at: Date.now(), ids: p.success ? p.data.ids : [] };
  } catch {
    cache = { at: Date.now(), ids: cache?.ids ?? [] };
  }
  return cache.ids;
}

export async function isBotAdmin(telegramUserId: number | undefined): Promise<boolean> {
  return !!telegramUserId && (await botAdminIds()).includes(telegramUserId);
}

const siteUrl = (path: string) => `${env().NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}${path}`;
const fmtTime = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Almaty" });

const MENU = {
  inline_keyboard: [
    [{ text: "📊 Сегодня", callback_data: "a:stats:1" }, { text: "📅 7 дней", callback_data: "a:stats:7" }, { text: "🗓 30 дней", callback_data: "a:stats:30" }],
    [{ text: "🧾 Последние заказы", callback_data: "a:orders" }, { text: "⚠️ Проблемы", callback_data: "a:problems" }],
  ],
};
const siteButton = (path = "/admin") => ({ text: "🌐 Админ-панель на сайте", url: siteUrl(path) });

function send(chatId: number, text: string, markup?: unknown) {
  return tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...(markup ? { reply_markup: markup } : {}) });
}

const PAY: Record<string, string> = { pending: "⏳ ожидает оплаты", succeeded: "✅ оплачено", failed: "❌ оплата не прошла", cancelled: "🚫 отменено", refunded: "↩️ возвращено" };
const GEN: Record<string, string> = { awaiting_payment: "", queued: "🕒 в очереди", processing: "⚙️ создаётся", postprocessing: "⚙️ обработка", completed: "🎬 готово", failed: "⚠️ не создано" };
const title = (snap: unknown) => escapeHtml(((snap as { title_kk?: string } | null)?.title_kk ?? "—").slice(0, 40));

async function stats(days: number) {
  const db = supabaseAdmin();
  const now = new Date();
  // "Today" = since midnight in Almaty (UTC+5, no DST).
  const ALMATY = 5 * 3600_000;
  const from = days === 1
    ? new Date(Math.floor((now.getTime() + ALMATY) / 86400_000) * 86400_000 - ALMATY)
    : new Date(now.getTime() - days * 86400_000);
  const [{ data: s }, { count: users }, { data: jobs }, ap] = await Promise.all([
    db.rpc("admin_stats", { p_from: from.toISOString(), p_to: now.toISOString() }),
    db.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", from.toISOString()),
    db.from("generation_jobs").select("provider_cost").gte("created_at", from.toISOString()).not("provider_cost", "is", null),
    seedancePricingSettings(),
  ]);
  const st = (s ?? {}) as Record<string, number | null> & { top_templates?: { title: string; paid: number }[] };
  const usd = (jobs ?? []).reduce((n, j) => n + (Number(j.provider_cost) || 0), 0);
  const cost = Math.round(usd * ap.tengePerUsd);
  const revenue = Number(st.revenue_kzt ?? 0) - Number(st.refunds_kzt ?? 0);
  const label = days === 1 ? "Сегодня" : `Последние ${days} дней`;
  const top = (st.top_templates ?? []).slice(0, 3).map((t, i) => `${i + 1}. ${escapeHtml(t.title)} — ${t.paid}`).join("\n");
  return [
    `📊 <b>${label}</b>`,
    "",
    `🧾 Заказов: <b>${st.orders_total ?? 0}</b> · оплачено: <b>${st.orders_paid ?? 0}</b>`,
    `💰 Выручка: <b>${formatKzt(Number(st.revenue_kzt ?? 0))}</b>${st.refunds_count ? ` · возвраты: ${formatKzt(Number(st.refunds_kzt ?? 0))} (${st.refunds_count})` : ""}`,
    `🎬 Готовых видео: <b>${st.generations_completed ?? 0}</b> · не создано: <b>${st.generations_failed ?? 0}</b>`,
    `🤖 AI (Kling): <b>$${usd.toFixed(2)}</b> ≈ ${formatKzt(cost)}`,
    `📈 Чистая прибыль ≈ <b>${formatKzt(revenue - cost)}</b>`,
    `👤 Новых пользователей: <b>${users ?? 0}</b>`,
    ...(Number(st.duplicate_charges ?? 0) > 0 ? ["", `🚨 Повторных списаний: <b>${st.duplicate_charges}</b> — проверьте в админке на сайте`] : []),
    ...(top ? ["", "🔥 <b>Топ продаж</b>", top] : []),
  ].join("\n");
}

async function recentOrders() {
  const { data } = await supabaseAdmin().from("orders")
    .select("public_order_number,created_at,amount_kzt,quality,payment_status,generation_status,template_snapshot_json")
    .order("created_at", { ascending: false }).limit(10);
  if (!data?.length) return "🧾 Заказов пока нет.";
  return ["🧾 <b>Последние 10 заказов</b>", "", ...data.map((o) =>
    `<code>${o.public_order_number}</code> · ${title(o.template_snapshot_json)} · ${formatKzt(o.amount_kzt)}${o.quality ? ` · ${escapeHtml(o.quality)}` : ""}\n   ${fmtTime.format(new Date(o.created_at))} · ${PAY[o.payment_status] ?? o.payment_status}${o.payment_status === "succeeded" && GEN[o.generation_status] ? ` · ${GEN[o.generation_status]}` : ""}`),
    "", "Подробнее: /order TV-100001"].join("\n");
}

async function problems() {
  const db = supabaseAdmin();
  const week = new Date(Date.now() - 7 * 86400_000).toISOString();
  const stuck = new Date(Date.now() - 30 * 60_000).toISOString();
  const [{ data: failed }, { data: slow }, { data: unpaid }] = await Promise.all([
    db.from("generation_jobs").select("error_code,completed_at,orders(public_order_number,template_snapshot_json)")
      .eq("status", "failed").gte("created_at", week).order("created_at", { ascending: false }).limit(10),
    db.from("generation_jobs").select("status,started_at,orders(public_order_number)")
      .in("status", ["queued", "processing", "postprocessing"]).lt("created_at", stuck).limit(10),
    db.from("payments").select("provider,failure_reason,created_at,orders(public_order_number)")
      .eq("status", "failed").gte("created_at", week).order("created_at", { ascending: false }).limit(5),
  ]);
  const num = (o: unknown) => ((Array.isArray(o) ? o[0] : o) as { public_order_number?: string } | null)?.public_order_number ?? "—";
  const lines = ["⚠️ <b>Проблемы (7 дней)</b>", ""];
  lines.push(failed?.length ? `<b>Несозданных видео: ${failed.length}</b>` : "✅ Несозданных видео нет");
  for (const j of failed ?? []) lines.push(`<code>${num(j.orders)}</code> · ${escapeHtml(j.error_code ?? "—")}`);
  lines.push("", slow?.length ? `<b>Ждут дольше 30 минут: ${slow.length}</b>` : "✅ Зависших видео нет");
  for (const j of slow ?? []) lines.push(`<code>${num(j.orders)}</code> · ${GEN[j.status] ?? j.status}`);
  lines.push("", unpaid?.length ? `<b>Неудачных оплат: ${unpaid.length}</b>` : "✅ Неудачных оплат нет");
  for (const p of unpaid ?? []) lines.push(`<code>${num(p.orders)}</code> · ${escapeHtml(p.provider)} · ${escapeHtml(p.failure_reason ?? "—")}`);
  return lines.join("\n");
}

async function orderDetails(raw: string) {
  const n = raw.trim().toUpperCase().replace(/^TV-?/, "");
  if (!/^\d{1,9}$/.test(n)) return { text: "Напишите номер так: <code>/order TV-100014</code>" };
  const db = supabaseAdmin();
  const { data: o } = await db.from("orders")
    .select("id,public_order_number,created_at,completed_at,amount_kzt,quality,face_count,payment_status,generation_status,template_snapshot_json,user_id,profiles(email,telegram_username,display_name),payments(provider,status,provider_phone_last4,failure_reason,created_at),generation_jobs(status,error_code,provider_cost,attempt_count)")
    .eq("public_order_number", `TV-${n}`).maybeSingle();
  if (!o) return { text: `TV-${n} не найден.` };
  const prof = (Array.isArray(o.profiles) ? o.profiles[0] : o.profiles) as { email?: string; telegram_username?: string; display_name?: string } | null;
  const who = prof?.telegram_username ? `@${escapeHtml(prof.telegram_username)}` : prof?.email && !prof.email.endsWith("@telegram.trendme.kz") ? escapeHtml(prof.email) : prof?.display_name ? escapeHtml(prof.display_name) : "—";
  const pays = ((o.payments ?? []) as { provider: string; status: string; provider_phone_last4: string | null; failure_reason: string | null; created_at: string }[])
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const jobs = (o.generation_jobs ?? []) as { status: string; error_code: string | null; provider_cost: number | null; attempt_count: number }[];
  const usd = jobs.reduce((s, j) => s + (Number(j.provider_cost) || 0), 0);
  const ap = await seedancePricingSettings();
  const cost = Math.round(usd * ap.tengePerUsd);
  const snap = o.template_snapshot_json as { user_video_path?: string } | null;
  const lines = [
    `🧾 <b>${o.public_order_number}</b> · ${title(o.template_snapshot_json)}${snap?.user_video_path ? " (своё видео)" : ""}`,
    `👤 ${who}`,
    `🕒 ${fmtTime.format(new Date(o.created_at))}${o.completed_at ? ` → готово ${fmtTime.format(new Date(o.completed_at))}` : ""}`,
    `💰 ${formatKzt(o.amount_kzt)} · ${escapeHtml(o.quality ?? "")} · ${o.face_count} чел.`,
    `💳 ${PAY[o.payment_status] ?? o.payment_status}${pays[0] ? ` · ${escapeHtml(pays[0].provider)}${pays[0].provider_phone_last4 ? ` · ••${escapeHtml(pays[0].provider_phone_last4)}` : ""}${pays[0].failure_reason ? ` · ${escapeHtml(pays[0].failure_reason)}` : ""}` : ""}`,
    `🎬 ${GEN[o.generation_status] || "ожидает оплаты"}${jobs.find((j) => j.error_code) ? ` · ${escapeHtml(jobs.find((j) => j.error_code)!.error_code!)}` : ""}${jobs.length ? ` · попыток: ${Math.max(...jobs.map((j) => j.attempt_count))}` : ""}`,
    ...(usd ? [`🤖 AI: $${usd.toFixed(2)} ≈ ${formatKzt(cost)} · прибыль ≈ ${formatKzt(o.amount_kzt - cost)}`] : []),
  ];
  return { text: lines.join("\n"), markup: { inline_keyboard: [[siteButton(`/admin/orders/${o.id}`)]] } };
}

/** Handles an admin's text command. Returns false when the text is not an admin command. */
export async function handleAdminMessage(chatId: number, text: string): Promise<boolean> {
  const [cmd, ...rest] = text.trim().split(/\s+/);
  const c = cmd.toLowerCase().replace(/@\w+$/, "");
  if (c === "/admin") {
    await send(chatId, "🛠 <b>TrendMe админ</b>\nЧто показать? Уведомления о новых оплатах и ошибках видео приходят сюда автоматически.", { inline_keyboard: [...MENU.inline_keyboard, [siteButton()]] });
    return true;
  }
  if (c === "/stats") { await send(chatId, await stats(Number(rest[0]) || 1), MENU); return true; }
  if (c === "/orders") { await send(chatId, await recentOrders(), MENU); return true; }
  if (c === "/problems") { await send(chatId, await problems(), MENU); return true; }
  if (c === "/order") { const r = await orderDetails(rest.join(" ")); await send(chatId, r.text, r.markup); return true; }
  if (/^tv-?\d{5,9}$/i.test(c)) { const r = await orderDetails(c); await send(chatId, r.text, r.markup); return true; }
  return false;
}

export async function handleAdminCallback(chatId: number, data: string) {
  const [, kind, arg] = data.split(":");
  if (kind === "stats") await send(chatId, await stats([1, 7, 30].includes(Number(arg)) ? Number(arg) : 1), MENU);
  else if (kind === "orders") await send(chatId, await recentOrders(), MENU);
  else if (kind === "problems") await send(chatId, await problems(), MENU);
}

/** Instant alert to every bot admin. Best effort, never throws. */
export async function notifyAdmins(orderId: string, event: "paid" | "failed" | "ready") {
  try {
    const ids = await botAdminIds();
    if (!ids.length || !env().TELEGRAM_BOT_TOKEN) return;
    const { data: o } = await supabaseAdmin().from("orders")
      .select("id,public_order_number,amount_kzt,quality,template_snapshot_json,generation_jobs(error_code)").eq("id", orderId).maybeSingle();
    if (!o) return;
    const err = ((o.generation_jobs ?? []) as { error_code: string | null }[]).find((j) => j.error_code)?.error_code;
    const head = event === "paid" ? "💰 <b>Новая оплата</b>" : event === "ready" ? "🎬 <b>Видео готово</b>" : "⚠️ <b>Видео не создано</b>";
    const text = `${head}\n<code>${o.public_order_number}</code> · ${title(o.template_snapshot_json)} · ${formatKzt(o.amount_kzt)}${o.quality ? ` · ${escapeHtml(o.quality)}` : ""}${event === "failed" && err ? `\nОшибка: ${escapeHtml(err)}` : ""}`;
    const markup = { inline_keyboard: [[siteButton(`/admin/orders/${o.id}`)]] };
    await Promise.all(ids.map((id) => send(id, text, markup)));
  } catch {
    console.error(JSON.stringify({ src: "telegram", event: "admin_notify_failed" }));
  }
}
