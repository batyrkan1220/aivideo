"use client";
import { useActionState } from "react";
import { ru } from "@/lib/i18n/ru";
import { setupTelegram, type TelegramSetupState } from "./actions";

export function TelegramSetup({ configured, appUrl }: { configured: boolean; appUrl: string }) {
  const [state, action, pending] = useActionState<TelegramSetupState, FormData>(setupTelegram, {});
  const T = ru.admin.telegram;
  return (
    <section className="rounded-card border border-line bg-white p-5">
      <h2 className="font-semibold">{T.title}</h2>
      <p className="mt-1 text-sm text-muted">{configured ? T.hint(appUrl) : T.noToken}</p>
      {configured && (
        <form action={action} className="mt-3 flex flex-wrap items-center gap-3">
          <button disabled={pending} className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {pending ? ru.common.loading : T.connect}
          </button>
          {state.ok && <span className="text-sm text-success">{T.done(state.bot ?? "")}</span>}
          {state.error && <span className="text-sm text-danger">{T.errors[state.error]}</span>}
        </form>
      )}
    </section>
  );
}
