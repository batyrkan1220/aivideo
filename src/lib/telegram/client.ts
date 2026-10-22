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

/** The Mini App API, only when the page really runs inside Telegram (signed initData present). */
export function telegramApp(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  const wa = window.Telegram?.WebApp;
  return wa && wa.initData ? wa : null;
}

const subscribe = (cb: () => void) => {
  window.addEventListener(TG_READY_EVENT, cb);
  return () => window.removeEventListener(TG_READY_EVENT, cb);
};
/** True inside the Telegram Mini App (re-renders once the Telegram script is ready). */
export function useIsTelegram() {
  return useSyncExternalStore(subscribe, () => !!telegramApp(), () => false);
}
