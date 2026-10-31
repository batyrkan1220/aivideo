import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Every automatic bot text, editable in Admin → Бот. Texts may use Telegram HTML (<b>, <i>, <u>, <a>)
 * and placeholders: {name} (user's first name) and {title} (video title). Values are HTML-escaped.
 */
export const BOT_MESSAGES = {
  welcome: {
    group: "commands", vars: ["name"], button: "🎬 Видео жасау", max: 4000,
    text: "Сәлем, {name}! 👋\n\n<b>TrendMe</b> — өзіңізді трендтегі видеодан көріңіз.\n\n<b>Қалай жұмыс істейді:</b>\n1️⃣ Ұнаған видеоны таңдаңыз\n2️⃣ Өз фотоңызды жүктеңіз\n3️⃣ Kaspi арқылы төлеңіз\n4️⃣ Бірнеше минутта видео дайын — осы ботқа хабарлаймыз\n\nБастау үшін төмендегі батырманы басыңыз 👇",
  },
  help: {
    group: "commands", vars: [], button: "🎬 Видео жасау", max: 4000,
    text: "<b>TrendMe көмегі</b>\n\n🎬 <b>Видео жасау</b> — төмендегі батырма немесе /start\n📂 <b>Тапсырыстарым</b> — /videos\n\n<b>Фото бойынша кеңес:</b> беті анық көрінетін, жарығы жақсы, тек бір адам бар фото таңдаңыз.\n\n<b>Төлем:</b> Kaspi нөміріңізге шот келеді. Оны Kaspi қосымшасында → «Төлем шоттары» бөлімінен төлеңіз.\n\nВидео дайын болғанда, осы ботқа хабарлама келеді.",
  },
  videos: {
    group: "commands", vars: [], button: "📂 Тапсырыстарым", max: 4000,
    text: "Барлық тапсырысыңыз осында сақталады.",
  },
  hint: {
    group: "commands", vars: [], button: "🎬 Видео жасау", max: 4000,
    text: "Видео жасау үшін төмендегі батырманы басыңыз.",
  },
  invoice_sent: {
    group: "notifications", vars: ["title"], button: "Тапсырысты ашу", max: 4000,
    text: "🧾 Kaspi-ге шот жіберілді: <b>{title}</b>\n\nKaspi қосымшасында → «Менің Банкім» → «Төлем шоттары» бөлімінен төлеңіз. Төлем түскен бойда видео жасала бастайды.",
  },
  paid: {
    group: "notifications", vars: ["title"], button: "Тапсырысты ашу", max: 4000,
    text: "✅ Төлем алынды: <b>{title}</b>\nВидео жасалып жатыр — дайын болғанда осында хабарлаймыз.",
  },
  ready: {
    group: "notifications", vars: ["title"], button: "▶️ Видеоны көру", max: 4000,
    text: "🎉 Видеоңыз дайын: <b>{title}</b>\n\nКөріңіз, жүктеп алыңыз және достарыңызбен бөлісіңіз!",
  },
  failed: {
    group: "notifications", vars: ["title"], button: "Тапсырысты ашу", max: 4000,
    text: "⚠️ <b>{title}</b> видеосын жасау мүмкін болмады. Қолдау қызметі тапсырысты тексереді.",
  },
  description: {
    group: "profile", vars: [], button: null, max: 512,
    text: "TrendMe — өзіңізді трендтегі видеодан көріңіз!\n\n1️⃣ Видео таңдаңыз\n2️⃣ Фото жүктеңіз\n3️⃣ Kaspi арқылы төлеңіз\n4️⃣ Бірнеше минутта видео дайын\n\n«Бастау» батырмасын басыңыз 👇",
  },
  short_description: {
    group: "profile", vars: [], button: null, max: 120,
    text: "Өзіңізді трендтегі видеодан көріңіз. Фото жүктеңіз — видео бірнеше минутта дайын. trendme.kz",
  },
  menu_button: {
    group: "profile", vars: [], button: null, max: 64,
    text: "Видео жасау",
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
