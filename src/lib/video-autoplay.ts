"use client";
import { useSyncExternalStore } from "react";

/**
 * iOS Low Power Mode (and some WebViews) refuse to autoplay <video>, even muted. Apple's WebKit,
 * however, plays an MP4 given to an <img> tag as a looping silent animation, and Low Power Mode
 * does not block that. Once a video is refused on Apple WebKit we switch every preview to <img>.
 */
let imgMode = false;
const subs = new Set<() => void>();

export function isAppleWebKit(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** Call when video.play() rejects. Returns true if previews switched to <img> mode. */
export function autoplayRefused(err: unknown): boolean {
  if (imgMode) return true;
  if ((err as { name?: string } | null)?.name !== "NotAllowedError" || !isAppleWebKit()) return false;
  imgMode = true;
  subs.forEach((f) => f());
  return true;
}

export function useImgPreviews(): boolean {
  return useSyncExternalStore(
    (f) => { subs.add(f); return () => subs.delete(f); },
    () => imgMode,
    () => false,
  );
}
