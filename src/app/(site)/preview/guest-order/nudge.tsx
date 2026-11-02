"use client";
import { useState } from "react";

/** The order page's one-time Telegram sheet, for the preview (opens on load; "Не сейчас" closes it). */
export function NudgePreview({ ready, title, text, later, children }: { ready: boolean; title: string; text: string; later: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="w-full rounded-full bg-paper py-2.5 text-sm font-semibold ring-1 ring-line">Показать всплывающее окно ещё раз</button>;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 sm:items-center" onClick={() => setOpen(false)}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-t-[28px] bg-surface p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] text-center shadow-2xl sm:rounded-[28px]">
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line sm:hidden" />
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#2AABEE] text-2xl text-white" aria-hidden>{ready ? "🎬" : "⏳"}</span>
        <h2 className="mt-3 text-xl font-extrabold tracking-tight">{title}</h2>
        <p className="mb-4 mt-1.5 text-sm text-muted">{text}</p>
        {children}
        <button type="button" onClick={() => setOpen(false)} className="mt-3 text-sm font-semibold text-muted hover:text-ink">{later}</button>
      </div>
    </div>
  );
}
