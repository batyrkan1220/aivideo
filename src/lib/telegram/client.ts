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
  BackButton: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
};
declare global { interface Window { Telegram?: { WebApp?: TelegramWebApp } } }

export const TG_READY_EVENT = "trendme:tg-ready";
const INIT_KEY = "trendme.tgInitData";

const ss = {
  get: (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } },
};

/**
 * Signed launch data. Telegram puts it into the first URL's hash (#tgWebAppData=…); we keep it for
 * the whole Mini App session, so sign-in never depends on Telegram's script loading.
 */
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
