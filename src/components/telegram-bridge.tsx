"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { kk } from "@/lib/i18n/kk";
import { TG_READY_EVENT, launchInitData, noAutoLogin, setNoAutoLogin, telegramApp } from "@/lib/telegram/client";

const SCRIPT = "https://telegram.org/js/telegram-web-app.js";
const AUTH_PAGES = ["/login", "/signup"];
let signInRef: (() => void) | null = null;
let navDepth = -1; // in-app page changes since launch (first render = 0)
let lastPath = "";
const TAB_ROOTS = ["/", "/photos", "/create", "/orders", "/account", ...AUTH_PAGES];

/** Where Back goes when there is no in-app history (e.g. opened from a direct link). Null on tab roots. */
function backTarget(path: string): string | null {
  if (TAB_ROOTS.includes(path)) return null;
  if (path.startsWith("/orders/")) return "/orders";
  if (path.startsWith("/account/")) return "/account";
  if (path.startsWith("/photos/")) return "/photos";
  return "/";
}

/**
 * Inside the Telegram Mini App:
 *  - signs the user in right away from the signed launch data (no waiting for Telegram's script);
 *  - covers the login form with "signing in…" until that finishes, then continues to `next`;
 *  - loads Telegram's script only for UI (Back button, colours, openLink).
 * Does nothing in a normal browser.
 */
export function TelegramBridge() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  // Cover the login form only while a Telegram sign-in is still running.
  const [pending, setPending] = useState(true);
  const tgOnAuthPage = useSyncExternalStore(
    () => () => {},
    () => !!launchInitData() && AUTH_PAGES.includes(window.location.pathname),
    () => false,
  );
  // After an explicit logout in Telegram: no auto sign-in; show a one-tap button on login pages.
  const manual = useSyncExternalStore(() => () => {}, () => !!launchInitData() && noAutoLogin(), () => false);
  const setSigningIn = (v: boolean) => setPending(v);
  // Re-run the Back button effect once Telegram's script has loaded.
  const [tgUi, setTgUi] = useState(0);

  useEffect(() => {
    const initData = launchInitData();
    if (!initData) return;
    document.documentElement.dataset.tg = "1";
    window.dispatchEvent(new Event(TG_READY_EVENT));

    // Direct link to a template: t.me/<bot>?startapp=t_<template id> opens that card (once per launch).
    const start = new URLSearchParams(initData).get("start_param") ?? "";
    const tpl = /^t_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(start)?.[1];
    if (tpl) {
      try {
        if (sessionStorage.getItem("trendme.tgStartDone") !== start) {
          sessionStorage.setItem("trendme.tgStartDone", start);
          if (window.location.pathname === "/") { navDepth = -1; lastPath = ""; router.replace(`/templates/${tpl}`); }
        }
      } catch { /* storage unavailable: skip the jump */ }
    }

    // Sign in (cheap no-op on the server when this Telegram user is already signed in).
    let tries = 0;
    if (noAutoLogin()) { setTimeout(() => setSigningIn(false), 0); }
    const signIn = async (): Promise<void> => {
      try {
        const r = await fetch("/api/telegram/auth", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData }), credentials: "same-origin",
        });
        const j = (await r.json().catch(() => ({}))) as { ok?: boolean; signedIn?: boolean; error?: string };
        if (!j.ok) {
          if (r.status >= 500 && tries++ < 2) { await new Promise((res) => setTimeout(res, 800)); return signIn(); }
          console.warn("[telegram] sign-in failed:", j.error ?? r.status);
          setSigningIn(false);
          return;
        }
        if (AUTH_PAGES.includes(window.location.pathname)) {
          const next = new URLSearchParams(window.location.search).get("next");
          router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
        } else if (j.signedIn) {
          router.refresh();
        }
        setTimeout(() => setSigningIn(false), 400);
      } catch {
        if (tries++ < 2) { await new Promise((res) => setTimeout(res, 800)); return signIn(); }
        setSigningIn(false);
      }
    };
    if (!noAutoLogin()) void signIn();
    signInRef = () => { setNoAutoLogin(false); setSigningIn(true); tries = 0; void signIn(); };

    // Telegram UI helpers (optional).
    const ui = () => {
      const wa = telegramApp();
      if (!wa) return;
      wa.ready(); wa.expand();
      wa.setHeaderColor?.("#faf5f1"); wa.setBackgroundColor?.("#faf5f1"); wa.setBottomBarColor?.("#faf5f1");
      window.dispatchEvent(new Event(TG_READY_EVENT));
      setTgUi((n) => n + 1);
    };
    if (window.Telegram?.WebApp) ui();
    else {
      const s = document.createElement("script");
      s.src = SCRIPT; s.async = true; s.onload = ui;
      document.head.appendChild(s);
    }
  }, [router]);

  // Telegram's native Back button (it replaces the × in the header) on inner pages;
  // tab roots keep the × so the Mini App closes in one tap. On-page "←" links are hidden in Telegram.
  useEffect(() => {
    if (pathname !== lastPath) { lastPath = pathname; navDepth++; }
    const bb = telegramApp()?.BackButton;
    if (!bb) return;
    const parent = backTarget(pathname);
    if (!parent) { bb.hide(); return; }
    const onBack = () => {
      // Go back only through pages opened inside the app; otherwise jump to the parent page.
      if (navDepth > 0) { navDepth = Math.max(0, navDepth - 2); router.back(); }
      else router.replace(parent);
    };
    bb.onClick(onBack);
    bb.show();
    return () => { bb.offClick(onBack); };
  }, [pathname, search, router, tgUi]);

  if (manual && tgOnAuthPage && !pending) {
    return (
      <div className="fixed inset-x-0 bottom-24 z-[60] px-4">
        <button type="button" onClick={() => signInRef?.()}
          className="mx-auto flex h-13 w-full max-w-md items-center justify-center rounded-full bg-[#2AABEE] font-semibold text-white shadow-lg">
          {kk.telegram.signInButton}
        </button>
      </div>
    );
  }
  if (!(pending && tgOnAuthPage) || manual) return null;
  return (
    <div className="theme-app theme-mono fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-paper" role="status" aria-live="polite">
      <span className="h-10 w-10 animate-spin rounded-full border-4 border-brand/20 border-t-brand" aria-hidden />
      <p className="text-sm font-medium text-muted">{kk.telegram.signingIn}</p>
    </div>
  );
}
