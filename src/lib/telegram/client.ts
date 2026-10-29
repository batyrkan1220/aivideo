"use client";
import { useSyncExternalStore } from "react";

/** The subset of Telegram.WebApp we use (https://core.telegram.org/bots/webapps). */
export type TelegramWebApp = {
  initData: string;
  ready(): void;
  expand(): void;
  openLink(url: string, opts?: { try_instant_view?: boolean }): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  showConfirm?(message: string, cb: (ok: boolean) => void): void;
  close?(): void;
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  /** Bot API 8.0+: native "save file" dialog. */
  downloadFile?(params: { url: string; file_name: string }, cb?: (accepted: boolean) => void): void;
  isVersionAtLeast?(version: string): boolean;
  HapticFeedback?: { impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void; notificationOccurred(type: "error" | "success" | "warning"): void; selectionChanged(): void };
};

/** Telegram vibration feedback; does nothing outside the Mini App. */
export function haptic(kind: "tap" | "success" | "error" | "select") {
  try {
    const h = window.Telegram?.WebApp?.HapticFeedback;
    if (!h) return;
    if (kind === "tap") h.impactOccurred("medium");
    else if (kind === "select") h.selectionChanged();
    else h.notificationOccurred(kind);
  } catch { /* old Telegram clients */ }
}
declare global { interface Window { Telegram?: { WebApp?: TelegramWebApp } } }

export const TG_READY_EVENT = "trendme:tg-ready";
/** Set after an explicit logout inside Telegram: no automatic sign-in for the rest of this session. */
export const NO_AUTO_KEY = "trendme.tgNoAutoLogin";
const INIT_KEY = "trendme.tgInitData";

const ss = {
  get: (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } },
};

/**
 * Signed launch data. Telegram puts it into the first URL's hash (#tgWebAppData=…); we keep it for
 * the whole Mini App session, so sign-in never depends on Telegram's script loading.
 */
export function setNoAutoLogin(on: boolean) {
  try { if (on) sessionStorage.setItem(NO_AUTO_KEY, "1"); else sessionStorage.removeItem(NO_AUTO_KEY); } catch { /* ignore */ }
}
export const noAutoLogin = () => ss.get(NO_AUTO_KEY) === "1";

/** confirm() that also works inside Telegram (native window.confirm is blocked in many Telegram clients). */
export function confirmAsync(message: string): Promise<boolean> {
  const wa = telegramApp();
  if (wa?.showConfirm) return new Promise((res) => wa.showConfirm!(message.slice(0, 250), res));
  if (launchInitData()) return inPageConfirm(message); // Telegram without its script: never rely on window.confirm
  return Promise.resolve(window.confirm(message));
}

/** Minimal accessible confirm dialog drawn in the page. */
function inPageConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.setAttribute("role", "alertdialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.style.cssText = "position:fixed;inset:0;z-index:200;display:flex;align-items:flex-end;justify-content:center;background:rgba(30,27,46,.45);padding:16px";
    const box = document.createElement("div");
    box.style.cssText = "width:100%;max-width:420px;background:#fff;border-radius:20px;padding:20px;font:14px/1.45 system-ui,sans-serif;color:#1e1b2e";
    const p = document.createElement("p");
    p.textContent = message;
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;margin-top:16px";
    const mk = (label: string, primary: boolean, val: boolean) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.style.cssText = `flex:1;height:44px;border-radius:999px;font-weight:600;border:${primary ? "0" : "1px solid #e5e3ee"};background:${primary ? "#e5484d" : "#fff"};color:${primary ? "#fff" : "#1e1b2e"}`;
      b.onclick = () => { wrap.remove(); resolve(val); };
      return b;
    };
    row.append(mk("Бас тарту", false, false), mk("Растау", true, true));
    box.append(p, row);
    wrap.append(box);
    document.body.append(wrap);
    (row.lastChild as HTMLButtonElement).focus();
  });
}

export function launchInitData(): string | null {
  if (typeof window === "undefined") return null;
  const fromHash = new URLSearchParams(window.location.hash.slice(1)).get("tgWebAppData");
  if (fromHash) { ss.set(INIT_KEY, fromHash); return fromHash; }
  return window.Telegram?.WebApp?.initData || ss.get(INIT_KEY);
}

/** The Mini App API (after Telegram's script loaded), only inside Telegram. */
export function telegramApp(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  const wa = window.Telegram?.WebApp;
  return wa && wa.initData ? wa : null;
}

const subscribe = (cb: () => void) => {
  window.addEventListener(TG_READY_EVENT, cb);
  return () => window.removeEventListener(TG_READY_EVENT, cb);
};
/** True inside the Telegram Mini App (from the first render on the client). */
export function useIsTelegram() {
  return useSyncExternalStore(subscribe, () => !!launchInitData(), () => false);
}
