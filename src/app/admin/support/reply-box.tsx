"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { SendHorizontal } from "lucide-react";
import { sendReply, type SupportState } from "./actions";
import { QUICK_REPLIES } from "./quick-replies";

/** Answer box: quick replies fill it, Enter sends (Shift+Enter — new line). */
export function ReplyBox({ threadId, disabled }: { threadId: string; disabled?: boolean }) {
  const [state, run, pending] = useActionState<SupportState, FormData>(sendReply, {});
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const form = useRef<HTMLFormElement>(null);

  // Clear after a successful send (adjusting state during render, React's pattern for derived resets).
  const [sentAt, setSentAt] = useState(0);
  if (state.at && state.at !== sentAt) { setSentAt(state.at); setText(""); }
  useEffect(() => { if (state.at) ref.current?.focus(); }, [state.at]);

  return (
    <div className="border-t border-line bg-surface p-3 sm:p-4">
      <div className="no-scrollbar -mx-1 mb-2.5 flex gap-1.5 overflow-x-auto px-1">
        {QUICK_REPLIES.map((r) => (
          <button key={r.label} type="button" onClick={() => { setText(r.text); ref.current?.focus(); }}
            className="shrink-0 rounded-full border border-line bg-paper px-3 py-1.5 text-xs font-medium text-ink/80 transition-colors hover:border-ink hover:text-ink">
            {r.label}
          </button>
        ))}
      </div>
      <form ref={form} action={run} className="flex items-end gap-2">
        <input type="hidden" name="threadId" value={threadId} />
        <textarea ref={ref} name="text" value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={4000}
          disabled={disabled || pending} placeholder={disabled ? "Клиент не может получить сообщение" : "Ответ клиенту…"}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (text.trim()) form.current?.requestSubmit(); } }}
          className="max-h-48 min-h-[3rem] flex-1 resize-y rounded-2xl border border-line bg-paper px-4 py-3 text-[15px] leading-snug outline-none focus:border-ink disabled:opacity-60" />
        <button type="submit" disabled={pending || !text.trim() || disabled} aria-label="Отправить"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-ink text-paper transition-opacity disabled:opacity-40">
          <SendHorizontal size={19} aria-hidden />
        </button>
      </form>
      {state.error && <p className="mt-2 text-sm text-danger" role="alert">{state.error}</p>}
      <p className="mt-1.5 hidden text-[11px] text-muted sm:block">Enter — отправить · Shift+Enter — новая строка. Ответ придёт клиенту в чат с ботом.</p>
    </div>
  );
}
