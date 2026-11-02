"use client";
import { useEffect, useState } from "react";
import { kk } from "@/lib/i18n/kk";
import { TelegramBotLogin } from "./telegram-bot-login";

/**
 * Paid guest on the order page: once per order, a bottom sheet offers Telegram while the video is
 * being made (or right when it is ready) — the moment the offer is most useful.
 */
export function TelegramNudge({ orderId, ready }: { orderId: string; ready: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const key = `tm.tgNudge.${orderId}`;
    let seen = false;
    try { seen = !!localStorage.getItem(key); } catch { /* storage off */ }
    if (seen) return;
    const t = setTimeout(() => { setOpen(true); try { localStorage.setItem(key, "1"); } catch { /* ignore */ } }, 1500);
    return () => clearTimeout(t);
  }, [orderId]);
  if (!open) return null;
  const O = kk.order;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 sm:items-center" onClick={() => setOpen(false)} role="dialog" aria-modal aria-label={ready ? O.nudgeTitleReady : O.nudgeTitleWait}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-t-[28px] bg-surface p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] text-center shadow-2xl sm:rounded-[28px]">
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line sm:hidden" />
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#2AABEE] text-2xl text-white" aria-hidden>{ready ? "🎬" : "⏳"}</span>
        <h2 className="mt-3 text-xl font-extrabold tracking-tight">{ready ? O.nudgeTitleReady : O.nudgeTitleWait}</h2>
        <p className="mb-4 mt-1.5 text-sm text-muted">{O.nudgeText}</p>
        <TelegramBotLogin next={`/orders/${orderId}`} compact />
        <button type="button" onClick={() => setOpen(false)} className="mt-3 text-sm font-semibold text-muted hover:text-ink">{O.nudgeLater}</button>
      </div>
    </div>
  );
}
