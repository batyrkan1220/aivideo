"use client";
import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TG_READY_EVENT, telegramApp } from "@/lib/telegram/client";

const SCRIPT = "https://telegram.org/js/telegram-web-app.js";
const FLAG = "trendme.tg";
const AUTHED = "trendme.tgAuthed";
const ss = {
  get: (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } },
};

/**
 * Inside the Telegram Mini App: loads Telegram's script, signs the user in from the signed
 * initData, hides the site header and wires Telegram's Back button. Does nothing in a browser.
 */
export function TelegramBridge() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  // 1) Detect a Telegram launch (Telegram appends #tgWebApp… to the first URL) and boot.
  useEffect(() => {
    const launched = window.location.hash.includes("tgWebApp") || ss.get(FLAG) === "1";
    if (!launched) return;
    ss.set(FLAG, "1");

    const boot = async () => {
      const wa = telegramApp();
      if (!wa) return;
      wa.ready();
      wa.expand();
      wa.setHeaderColor?.("#fafafc");
      wa.setBackgroundColor?.("#fafafc");
      document.documentElement.dataset.tg = "1";
      window.dispatchEvent(new Event(TG_READY_EVENT));

      if (ss.get(AUTHED) === "1") return;
      try {
        const r = await fetch("/api/telegram/auth", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ initData: wa.initData }),
        });
        const j = (await r.json().catch(() => ({}))) as { ok?: boolean; signedIn?: boolean };
        if (!j.ok) return;
        ss.set(AUTHED, "1");
        if (j.signedIn) {
          const p = window.location.pathname;
          if (p === "/login" || p === "/signup") {
            const next = new URLSearchParams(window.location.search).get("next");
            router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
          } else {
            router.refresh();
          }
        }
      } catch { /* offline: the normal login page still works */ }
    };

    if (window.Telegram?.WebApp) { void boot(); return; }
    const s = document.createElement("script");
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => void boot();
    document.head.appendChild(s);
  }, [router]);

  // 2) Telegram's native Back button on every page except home.
  useEffect(() => {
    const wa = telegramApp();
    if (!wa) return;
    const back = () => router.back();
    if (pathname === "/") wa.BackButton.hide();
    else { wa.BackButton.show(); wa.BackButton.onClick(back); }
    return () => wa.BackButton.offClick(back);
  }, [pathname, search, router]);

  return null;
}
