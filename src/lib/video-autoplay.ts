"use client";
import { useSyncExternalStore } from "react";

/**
 * iOS Low Power Mode (and some WebViews) refuse to autoplay <video>, even muted. Apple's WebKit,
 * however, plays an MP4 given to an <img> tag as a looping silent animation, and Low Power Mode
 * does not block that. So on Apple devices previews use <img> from the start; if an <img> cannot
 * show the MP4 (very old iOS), we go back to <video>.
 */
let imgMode: boolean | null = null;
let imgBroken = false;
const subs = new Set<() => void>();

export function isAppleWebKit(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** Call when video.play() rejects. Returns true if previews switched to <img> mode. */
export function autoplayRefused(err: unknown): boolean {
  if (imgMode) return true;
  if (imgBroken || (err as { name?: string } | null)?.name !== "NotAllowedError" || !isAppleWebKit()) return false;
  imgMode = true;
  subs.forEach((f) => f());
  return true;
}

/** An <img> failed to show an MP4: use <video> everywhere. */
export function imgPreviewFailed() {
  if (imgBroken) return;
  imgBroken = true;
  imgMode = false;
  subs.forEach((f) => f());
}

export function useImgPreviews(): boolean {
  return useSyncExternalStore(
    (f) => { subs.add(f); return () => subs.delete(f); },
    () => (imgMode ??= isAppleWebKit()),
    () => false,
  );
}
