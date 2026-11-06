import { Suspense } from "react";
import { kk } from "@/lib/i18n/kk";
import { safeNext } from "@/lib/auth/redirect";
import { TelegramBotLogin } from "@/components/telegram-bot-login";

export const metadata = { title: kk.auth.loginTitle };

export default function LoginPage(props: { searchParams: Promise<Record<string, string | undefined>> }) {
  return (
    <Suspense fallback={null}>
      <Content searchParams={props.searchParams} />
    </Suspense>
  );
}

/** Everyone signs in with Telegram only, staff included (their Telegram account carries the role). No email or password. */
async function Content({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next, "/account");
  return (
    <>
      <h1 className="font-display text-2xl font-bold">{kk.auth.loginTitle}</h1>
      <p className="mb-6 mt-1.5 text-sm text-muted">{kk.auth.loginLead}</p>
      <TelegramBotLogin next={next} />
    </>
  );
}
