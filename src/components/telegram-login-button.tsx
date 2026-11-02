import { env } from "@/lib/env";
import { kk } from "@/lib/i18n/kk";
import { telegramLoginUrl } from "@/lib/telegram/login-widget";
import { TelegramIcon } from "./telegram-icon";

/** "Log in with Telegram" for the website (hidden inside the Mini App, which signs in by itself). */
export function TelegramLoginButton({ next }: { next: string }) {
  const e = env();
  if (!e.TELEGRAM_BOT_TOKEN) return null;
  const origin = e.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  const href = telegramLoginUrl(e.TELEGRAM_BOT_TOKEN, origin, `${origin}/telegram-login?next=${encodeURIComponent(next)}`);
  return (
    <div className="tg-hide">
      <a href={href} rel="nofollow"
        className="flex h-12 w-full items-center justify-center gap-2.5 rounded-full bg-[#2AABEE] text-[15px] font-semibold text-white shadow-[0_10px_24px_-12px_rgba(42,171,238,0.8)] transition-[transform,background-color] hover:bg-[#229ED9] active:scale-[0.98]">
        <TelegramIcon />
        {kk.auth.telegram}
      </a>
      <p className="mt-2 text-center text-xs text-muted">{kk.auth.telegramHint}</p>
      <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wider text-muted" aria-hidden>
        <span className="h-px flex-1 bg-line" />{kk.auth.or}<span className="h-px flex-1 bg-line" />
      </div>
    </div>
  );
}
