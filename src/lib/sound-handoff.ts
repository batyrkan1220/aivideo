"use client";

/*
  Sound on the template page. Browsers (iPhone above all) play a video with sound only if play()
  was called during a tap. So the tap on a card starts the template's video right there (with
  sound), and the template page then takes over that same, already "allowed" video element
  instead of starting a new one — the sample opens playing with sound.
*/
const SOUND_KEY = "trendme.videoSound";
let primed: { src: string; el: HTMLVideoElement; at: number } | null = null;

const soundOff = () => { try { return sessionStorage.getItem(SOUND_KEY) === "off"; } catch { return false; } };

/** Call inside the tap handler that opens a template. */
export function primeSound(src: string | null | undefined) {
  if (!src || soundOff() || typeof document === "undefined") return;
  drop();
  try {
    const el = document.createElement("video");
    el.setAttribute("playsinline", "");
    el.playsInline = true;
    el.loop = true;
    el.preload = "auto";
    el.muted = false;
    el.src = src;
    el.play().catch(() => {});
    primed = { src, el, at: Date.now() };
  } catch { primed = null; }
}

/** The page takes the primed element for this video (once, within 15 s of the tap). */
export function takePrimed(src: string): HTMLVideoElement | null {
  if (primed && primed.src === src && Date.now() - primed.at < 15_000) {
    const el = primed.el;
    primed = null;
    return el;
  }
  drop();
  return null;
}

function drop() {
  if (!primed) return;
  primed.el.pause();
  primed.el.removeAttribute("src");
  primed.el.load();
  primed = null;
}

/** True when the video element is actually on screen, not just still mounted under another page. */
export function videoShown(v: HTMLVideoElement): boolean {
  if (!v.isConnected) return false;
  if (typeof v.checkVisibility === "function" && !v.checkVisibility()) return false;
  const r = v.getBoundingClientRect();
  if (r.width < 8 || r.height < 8) return false;
  const vh = window.innerHeight || 0;
  const vw = window.innerWidth || 0;
  const visibleH = Math.min(r.bottom, vh) - Math.max(r.top, 0);
  const visibleW = Math.min(r.right, vw) - Math.max(r.left, 0);
  return visibleH > r.height * 0.5 && visibleW > r.width * 0.5;
}

/** Stops previews that are no longer on a visible card (payment page, another route, scrolled away). */
export function pauseHiddenVideos() {
  // A card tap starts an off-screen video so the template page can take it over. Leave that
  // one alone for a moment; drop it only if the viewer never landed on the template.
  if (
    primed &&
    !primed.el.isConnected &&
    Date.now() - primed.at > 2000 &&
    !window.location.pathname.startsWith("/templates/")
  ) drop();
  document.querySelectorAll("video").forEach((node) => {
    const v = node as HTMLVideoElement;
    if (!videoShown(v)) v.pause();
  });
}
