import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { botConfigured, sendMessage, tg, appUrl } from "@/lib/telegram/bot";
import { listTemplates } from "@/lib/templates/queries";
import { formatKzt } from "@/lib/pricing";
import { FOLLOWUP_DISCOUNT_HOURS, FOLLOWUP_DISCOUNT_PCT, discounted } from "./discount";

/*
  Every 10 minutes (pg_cron → /api/worker/engage), Telegram users only, one message of each kind per order:
   - payment reminder: an order left unpaid for 30 min – 6 h → "your video is waiting" + pay button;
   - next-day offer: 24–48 h after a finished video, if nothing was ordered since and no offer in
     the last 7 days → a personal −20% for 24 h and three fresh trends.
*/
const MIN = 60_000, HOUR = 3_600_000;

export async function runEngage(now = Date.now()) {
  if (!botConfigured()) return { reminders: 0, offers: 0 };
  return { reminders: await reminders(now), offers: await offers(now) };
}

async function telegramIdOf(userId: string): Promise<number | null> {
  const { data } = await supabaseAdmin().from("profiles").select("telegram_id").eq("id", userId).maybeSingle();
  return data?.telegram_id ? Number(data.telegram_id) : null;
}

async function reminders(now: number): Promise<number> {
  const db = supabaseAdmin();
  const { data: rows } = await db.from("orders")
    .select("id,user_id,template_id,amount_kzt,created_at,template_snapshot_json")
    .eq("payment_status", "pending").is("reminder_sent_at", null).is("parent_order_id", null)
    .gt("amount_kzt", 0)
    .lt("created_at", new Date(now - 30 * MIN).toISOString()).gt("created_at", new Date(now - 6 * HOUR).toISOString())
    .limit(50);
  let sent = 0;
  for (const o of rows ?? []) {
    // Claim first, so a slow send never doubles the message.
    const { data: claimed } = await db.from("orders").update({ reminder_sent_at: new Date().toISOString() })
      .eq("id", o.id).is("reminder_sent_at", null).select("id");
    if (!claimed?.length) continue;
    // Already paid another order for the same video since? Then stay quiet.
    const { count: paid } = await db.from("orders").select("id", { count: "exact", head: true })
      .eq("user_id", o.user_id).eq("template_id", o.template_id).eq("payment_status", "succeeded").gt("created_at", o.created_at);
    if (paid) continue;
    const chat = await telegramIdOf(o.user_id);
    if (!chat) continue;
    const title = (o.template_snapshot_json as { title_kk?: string } | null)?.title_kk ?? "TrendMe";
    await sendMessage(chat,
      `⏳ <b>Ваше видео ждёт оплаты</b>\n\n«${esc(title)}» — ${formatKzt(o.amount_kzt)}. Фото уже загружены: оплатите, и через 3–5 минут видео будет готово.`,
      { text: "💳 Оплатить", path: `/orders/${o.id}` });
    sent++;
  }
  return sent;
}

async function offers(now: number): Promise<number> {
  const db = supabaseAdmin();
  const { data: rows } = await db.from("orders")
    .select("id,user_id,template_id,completed_at")
    .eq("generation_status", "completed").eq("payment_status", "succeeded").is("followup_sent_at", null).is("parent_order_id", null)
    .lt("completed_at", new Date(now - 24 * HOUR).toISOString()).gt("completed_at", new Date(now - 48 * HOUR).toISOString())
    .limit(50);
  if (!rows?.length) return 0;
  const { items } = await listTemplates({ page: 1, sort: "trending", media: "video" });
  let sent = 0;
  for (const o of rows) {
    const { data: claimed } = await db.from("orders").update({ followup_sent_at: new Date().toISOString() })
      .eq("id", o.id).is("followup_sent_at", null).select("id");
    if (!claimed?.length) continue;
    // Ordered again since, or got an offer this week → skip.
    const { count: newer } = await db.from("orders").select("id", { count: "exact", head: true })
      .eq("user_id", o.user_id).gt("created_at", o.completed_at);
    if (newer) continue;
    const { count: recent } = await db.from("orders").select("id", { count: "exact", head: true })
      .eq("user_id", o.user_id).neq("id", o.id).gt("followup_sent_at", new Date(now - 7 * 24 * HOUR).toISOString());
    if (recent) continue;
    const chat = await telegramIdOf(o.user_id);
    if (!chat) continue;

    const expires = new Date(now + FOLLOWUP_DISCOUNT_HOURS * HOUR).toISOString();
    const { error } = await db.from("user_discounts").insert({ user_id: o.user_id, percent: FOLLOWUP_DISCOUNT_PCT, reason: "followup", expires_at: expires });
    if (error) continue;
    const picks = items.filter((t) => t.id !== o.template_id).slice(0, 3);
    const keyboard = [
      ...picks.map((t) => [{ text: `🎬 ${t.title}${t.startingPriceKzt ? ` · ${formatKzt(discounted(t.startingPriceKzt, FOLLOWUP_DISCOUNT_PCT))}` : ""}`, web_app: { url: appUrl(`/templates/${t.id}`) } }]),
      [{ text: "🔥 Все тренды", web_app: { url: appUrl("/") } }],
    ];
    await tg("sendMessage", {
      chat_id: chat, parse_mode: "HTML", link_preview_options: { is_disabled: true },
      text: `🎁 <b>Второе видео −${FOLLOWUP_DISCOUNT_PCT}%</b>\n\nСкидка только для вас и действует 24 часа. Ваше фото уже у нас — новое видео можно сделать в один тап.\n\nВыберите тренд:`,
      reply_markup: { inline_keyboard: keyboard },
    });
    sent++;
  }
  return sent;
}

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
