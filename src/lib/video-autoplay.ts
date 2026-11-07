"use client";
import { useSyncExternalStore } from "react";

/**
 * iOS Low Power Mode / low battery (and some WebViews) refuse to autoplay <video>, even muted.
 * Images still animate there, so once a video is refused we switch every preview to its
 * animated WebP copy (made by the server next to the light MP4).
 */
let imgMode = false;
const subs = new Set<() => void>();

/** Call when video.play() rejects. Returns true if previews switched to animated images. */
export function autoplayRefused(err: unknown): boolean {
  if (imgMode) return true;
  if ((err as { name?: string } | null)?.name !== "NotAllowedError") return false;
  imgMode = true;
  subs.forEach((f) => f());
  return true;
}

/** True inside the Telegram Mini App (the bridge marks <html data-tg>). */
const inTelegram = () => document.documentElement.hasAttribute("data-tg");
export const useInTelegram = () => useSyncExternalStore(() => () => {}, inTelegram, () => false);

export function useImgPreviews(): boolean {
  return useSyncExternalStore(
    (f) => { subs.add(f); return () => subs.delete(f); },
    () => imgMode,
    () => false,
  );
}
