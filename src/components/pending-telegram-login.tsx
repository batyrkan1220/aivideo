"use client";
import { useEffect, useState } from "react";
import { kk } from "@/lib/i18n/kk";
import { pollTelegramLogin } from "@/lib/telegram/login-actions";
import { PENDING_KEY, activeWidgets, readPending } from "./telegram-bot-login";
import { TelegramIcon } from "./telegram-icon";

/**
 * Finishes a Telegram sign-in that was started on a page the browser has since reloaded or left
 * (TikTok / Instagram in-app browsers do this while the person is in Telegram): keeps polling and
 * then opens the page the sign-in was for — e.g. the order waiting for payment.
 */
export function PendingTelegramLogin() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (stop) return;
      const p = readPending();
      if (!p) { setShow(false); return; }
      if (activeWidgets.n > 0) { timer = setTimeout(tick, 2500); return; } // the page's own widget is handling it
      setShow(true);
      const r = await pollTelegramLogin(p.id).catch(() => ({ state: "waiting" as const }));
      if (stop) return;
      if (r.state === "done") {
        try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
        window.location.replace("next" in r && r.next ? r.next : p.next);
        return;
      }
      if (r.state === "expired") { try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ } setShow(false); return; }
      timer = setTimeout(tick, 2500);
    };
    timer = setTimeout(tick, 300);
    const back = () => { if (document.visibilityState === "visible") { if (timer) clearTimeout(timer); void tick(); } };
    document.addEventListener("visibilitychange", back);
    return () => { stop = true; if (timer) clearTimeout(timer); document.removeEventListener("visibilitychange", back); };
  }, []);

  if (!show) return null;
  return (
    <div className="fixed inset-x-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-[80] mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-night px-4 py-3 text-white shadow-2xl" role="status" aria-live="polite">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#2AABEE]"><TelegramIcon className="h-5 w-5" /></span>
      <span className="min-w-0 flex-1 text-sm">
        <span className="block font-bold">{kk.auth.tgWaiting}</span>
        <span className="block text-white/70">{kk.auth.tgResumeHint}</span>
      </span>
      <span className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden />
    </div>
  );
}
