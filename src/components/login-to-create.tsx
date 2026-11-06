import { kk } from "@/lib/i18n/kk";
import { TelegramBotLogin } from "@/components/telegram-bot-login";
import { TelegramIcon } from "@/components/telegram-icon";

/** On the site, making a video needs a Telegram sign-in first (guests only come through the ad landing). */
export function LoginToCreate({ next }: { next: string }) {
  const T = kk.auth;
  return (
    <div className="rounded-card border border-line bg-surface p-5 sm:p-6">
      <span className="grid h-11 w-11 place-items-center rounded-full bg-[#2AABEE]/12 text-[#229ED9]"><TelegramIcon /></span>
      <h2 className="mt-3 text-lg font-extrabold">{T.createLoginTitle}</h2>
      <p className="mb-5 mt-1 text-sm text-muted">{T.createLoginText}</p>
      <TelegramBotLogin next={next} />
    </div>
  );
}
