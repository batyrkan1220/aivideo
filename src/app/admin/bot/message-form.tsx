"use client";
import { useActionState, useState } from "react";
import { ru } from "@/lib/i18n/ru";
import { saveBotMessage, type BotMessageState } from "./actions";

export function BotMessageForm(props: {
  k: string; label: string; text: string; button: string | null; max: number;
  vars: readonly string[]; customizedAt: string | null;
}) {
  const B = ru.admin.bot;
  const [state, action, pending] = useActionState<BotMessageState, FormData>(saveBotMessage, {});
  const [text, setText] = useState(props.text);
  const rows = Math.min(12, Math.max(2, text.split("\n").length + 1));
  return (
    <form action={action} className="rounded-card border border-line bg-white p-4 sm:p-5">
      <input type="hidden" name="key" value={props.k} />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">{props.label}</h3>
        <span className={`text-xs ${props.customizedAt ? "text-brand" : "text-muted"}`}>
          {props.customizedAt ? B.customized(props.customizedAt) : B.standard}
        </span>
      </div>
      <label className="mt-3 block text-sm font-medium" htmlFor={`t-${props.k}`}>{B.text}</label>
      <textarea
        id={`t-${props.k}`} name="text" value={text} onChange={(e) => setText(e.target.value)} rows={rows} maxLength={props.max} required
        className="mt-1 w-full rounded-xl border border-line px-3 py-2 font-mono text-sm leading-relaxed focus:border-brand focus:outline-none"
      />
      <div className="mt-1 flex flex-wrap justify-between gap-2 text-xs text-muted">
        <span>{props.vars.map((v) => B.vars[v as keyof typeof B.vars]).join(" · ")}</span>
        <span className={text.length > props.max ? "text-danger" : ""}>{B.chars(text.length, props.max)}</span>
      </div>
      {props.button !== null && (
        <>
          <label className="mt-3 block text-sm font-medium" htmlFor={`b-${props.k}`}>{B.button}</label>
          <input
            id={`b-${props.k}`} name="button" defaultValue={props.button} maxLength={64} required
            className="mt-1 h-10 w-full rounded-xl border border-line px-3 text-sm focus:border-brand focus:outline-none sm:max-w-sm"
          />
        </>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button disabled={pending} className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {pending ? ru.common.loading : B.save}
        </button>
        {props.customizedAt && (
          <button name="intent" value="reset" disabled={pending} className="rounded-full px-3 py-2 text-sm font-medium text-muted hover:bg-brand-soft hover:text-ink">
            {B.reset}
          </button>
        )}
        {state.ok && <span className="text-sm text-success">{B.saved}</span>}
        {state.error && <span className="text-sm text-danger">{B.errors[state.error]}</span>}
      </div>
    </form>
  );
}
