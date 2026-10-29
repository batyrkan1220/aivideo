import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Every automatic bot text, editable in Admin → Бот. Texts may use Telegram HTML (<b>, <i>, <u>, <a>)
 * and placeholders: {name} (user's first name) and {title} (video title). Values are HTML-escaped.
 */
export const BOT_MESSAGES = {
  welcome: {
    group: "commands", vars: ["name"], button: "🎬 Создать видео", max: 4000,
    text: "Привет, {name}! 👋\n\n<b>TrendMe</b> — увидьте себя в трендовых видео.\n\n<b>Как это работает:</b>\n1️⃣ Выберите понравившееся видео\n2️⃣ Загрузите своё фото\n3️⃣ Оплатите через Kaspi\n4️⃣ Через несколько минут видео готово — мы сообщим в этом боте\n\nНажмите кнопку ниже, чтобы начать 👇",
  },
  help: {
    group: "commands", vars: [], button: "🎬 Создать видео", max: 4000,
    text: "<b>Помощь TrendMe</b>\n\n🎬 <b>Создать видео</b> — кнопка ниже или /start\n📂 <b>Мои заказы</b> — /videos\n\n<b>Совет по фото:</b> выберите фото, где хорошо видно лицо, хороший свет и только один человек.\n\n<b>Оплата:</b> на ваш номер Kaspi придёт счёт. Оплатите его в приложении Kaspi → «Счета на оплату».\n\nКогда видео будет готово, в этот бот придёт сообщение.",
  },
  videos: {
    group: "commands", vars: [], button: "📂 Мои заказы", max: 4000,
    text: "Все ваши заказы хранятся здесь.",
  },
  hint: {
    group: "commands", vars: [], button: "🎬 Создать видео", max: 4000,
    text: "Чтобы создать видео, нажмите кнопку ниже.",
  },
  invoice_sent: {
    group: "notifications", vars: ["title"], button: "Открыть заказ", max: 4000,
    text: "🧾 Счёт в Kaspi отправлен: <b>{title}</b>\n\nОплатите в приложении Kaspi → «Мой Банк» → «Счета на оплату». Как только оплата поступит, видео начнёт создаваться.",
  },
  paid: {
    group: "notifications", vars: ["title"], button: "Открыть заказ", max: 4000,
    text: "✅ Оплата получена: <b>{title}</b>\nВидео создаётся — сообщим здесь, когда будет готово.",
  },
  ready: {
    group: "notifications", vars: ["title"], button: "▶️ Смотреть видео", max: 4000,
    text: "🎉 Ваше видео готово: <b>{title}</b>\n\nСмотрите, скачивайте и делитесь с друзьями!",
  },
  failed: {
    group: "notifications", vars: ["title"], button: "Открыть заказ", max: 4000,
    text: "⚠️ Не удалось создать видео <b>{title}</b>. Поддержка проверит заказ.",
  },
  description: {
    group: "profile", vars: [], button: null, max: 512,
    text: "TrendMe — увидьте себя в трендовых видео!\n\n1️⃣ Выберите видео\n2️⃣ Загрузите фото\n3️⃣ Оплатите через Kaspi\n4️⃣ Через несколько минут видео готово\n\nНажмите «Начать» 👇",
  },
  short_description: {
    group: "profile", vars: [], button: null, max: 120,
    text: "Увидьте себя в трендовых видео. Загрузите фото — видео готово за несколько минут. trendme.kz",
  },
  menu_button: {
    group: "profile", vars: [], button: null, max: 64,
    text: "Создать видео",
  },
} as const satisfies Record<string, { group: "commands" | "notifications" | "profile"; vars: readonly string[]; button: string | null; max: number; text: string }>;

export type BotMessageKey = keyof typeof BOT_MESSAGES;
export const BOT_MESSAGE_KEYS = Object.keys(BOT_MESSAGES) as BotMessageKey[];
export const isBotMessageKey = (k: string): k is BotMessageKey => k in BOT_MESSAGES;

type Row = { key: string; text: string; button: string | null; updated_at: string };
let cache: { at: number; rows: Map<string, Row> } | null = null;
const TTL_MS = 30_000;

export function clearBotMessageCache() { cache = null; }

/** Saved overrides (admin edits), cached briefly. Never throws: falls back to defaults. */
export async function botMessageOverrides(): Promise<Map<string, Row>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  try {
    const { data } = await supabaseAdmin().from("bot_messages").select("key,text,button,updated_at");
    cache = { at: Date.now(), rows: new Map((data ?? []).map((r) => [r.key, r as Row])) };
  } catch {
    cache = { at: Date.now(), rows: cache?.rows ?? new Map() };
  }
  return cache.rows;
}

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

/** Final text + button for a message, with placeholders filled (escaped). */
export async function botMessage(key: BotMessageKey, vars: Record<string, string> = {}): Promise<{ text: string; button: string | null }> {
  const def = BOT_MESSAGES[key];
  const o = (await botMessageOverrides()).get(key);
  let text = o?.text ?? def.text;
  for (const v of def.vars) text = text.replaceAll(`{${v}}`, esc((vars[v] ?? "").slice(0, 80)));
  // "Сәлем, !" when Telegram gives no first name → "Сәлем!"
  text = text.replace(/,\s*!/g, "!");
  return { text, button: def.button === null ? null : (o?.button ?? def.button) };
}
