"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { kk } from "@/lib/i18n/kk";
import { formatKzt } from "@/lib/pricing";
import { autoplayRefused, useImgPreviews } from "@/lib/video-autoplay";

export type CardData = {
  id: string;
  title: string;
  description: string;
  faceCount: number;
  qualityLabels: string[];
  startingPriceKzt: number | null;
  coverUrl: string | null;
  previewUrl: string | null;
  /** Light 480p copy made by the server; cards prefer it. */
  previewLiteUrl?: string | null;
  isTrending: boolean;
};

/**
 * Keeps at most MAX_PLAYING previews running at once across the whole page: starting a new
 * one pauses the oldest. Many cards on screen then never decode/stream videos in parallel.
 */
const heroGates = new WeakMap<HTMLVideoElement, Promise<void>>();
/** Resolves when the hero video (if this page has one) has buffered enough to play, or after 4 s. */
function heroReady(): Promise<void> {
  const v = document.querySelector<HTMLVideoElement>("video[data-hero-video]");
  if (!v || v.readyState >= 3 || !v.offsetParent) return Promise.resolve();
  const known = heroGates.get(v);
  if (known) return known;
  const gate = new Promise<void>((resolve) => {
    const done = () => resolve();
    v.addEventListener("canplay", done, { once: true });
    v.addEventListener("error", done, { once: true });
    setTimeout(done, 4000);
  });
  heroGates.set(v, gate);
  return gate;
}

const MAX_PLAYING = 16; // every card on screen plays, tablets and desktops included

// Some browsers (iOS Low Power Mode, data saver, some Android tablets) refuse autoplay until the
// person taps the page. iOS counts only taps (touchend / click) as a gesture, not scrolling, so
// blocked cards retry on every tap until they start.
const waitingForGesture = new Set<() => void>();
let gestureHooked = false;
function retryOnGesture(fn: () => void) {
  waitingForGesture.add(fn);
  if (gestureHooked) return;
  gestureHooked = true;
  const go = () => [...waitingForGesture].forEach((f) => f());
  for (const ev of ["touchend", "click", "keydown"]) window.addEventListener(ev, go, { passive: true, capture: true });
}

const playingNow: HTMLVideoElement[] = [];
function claimPlayback(v: HTMLVideoElement) {
  const i = playingNow.indexOf(v);
  if (i >= 0) playingNow.splice(i, 1);
  playingNow.push(v);
  while (playingNow.length > MAX_PLAYING) playingNow.shift()?.pause();
}
function releasePlayback(v: HTMLVideoElement) {
  const i = playingNow.indexOf(v);
  if (i >= 0) playingNow.splice(i, 1);
}

/**
 * 9:16 template card, built for long grids of video:
 *  - the cover image is lazy-loaded; the video has NO src until the card is near the screen;
 *  - visible cards autoplay (muted, inline); off-screen videos are paused.
 */
export function TemplateCard({ t, priority = false }: { t: CardData; priority?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cardRef = useRef<HTMLAnchorElement>(null);
  const [playing, setPlaying] = useState(false);
  const [near, setNear] = useState(false); // card is within ~1 screen: attach the video src
  const imgMode = useImgPreviews(); // iOS refused autoplay: the MP4 plays through <img> instead
  const imgModeRef = useRef(imgMode);
  useEffect(() => { imgModeRef.current = imgMode; }, [imgMode]);

  // Attach the video only when the card approaches the viewport.
  useEffect(() => {
    const el = cardRef.current;
    if (!el || !t.previewUrl) return;
    let alive = true;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      // The hero video downloads first; grid videos start once it can play.
      heroReady().then(() => alive && setNear(true));
    }, { rootMargin: "200px 0px" });
    io.observe(el);
    return () => { alive = false; io.disconnect(); };
  }, [t.previewUrl]);

  const play = () => {
    if (imgModeRef.current) { setPlaying(true); return; }
    const v = videoRef.current;
    if (!v) return;
    v.muted = true; // Telegram WebView: the property must be set before play()
    v.defaultMuted = true;
    claimPlayback(v);
    const onScreen = () => { const r = v.getBoundingClientRect(); return r.bottom > 0 && r.top < window.innerHeight; };
    const again = () => {
      if (videoRef.current !== v || !v.isConnected) { waitingForGesture.delete(again); return; }
      if (onScreen()) v.play().then(() => { waitingForGesture.delete(again); setPlaying(true); }).catch(() => {});
    };
    v.play().then(() => setPlaying(true)).catch((err) => {
      if (autoplayRefused(err)) { releasePlayback(v); setPlaying(true); return; }
      // Not enough data yet: retry once the first frame is loaded; autoplay blocked: retry on first touch.
      if (v.readyState < 2) v.addEventListener("loadeddata", () => { v.play().then(() => setPlaying(true)).catch(() => retryOnGesture(again)); }, { once: true });
      else retryOnGesture(again);
    });
  };
  const stop = () => {
    if (imgModeRef.current) { setPlaying(false); return; }
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    releasePlayback(v);
    setPlaying(false);
  };

  // Every card plays while it is on screen (phones, Telegram and desktop alike).
  // Skipped for reduced-motion and data-saver users.
  useEffect(() => {
    const el = cardRef.current;
    if (!el || !near) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? play() : stop()), { threshold: 0.6 });
    io.observe(el);
    return () => { io.disconnect(); stop(); };
  }, [near]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the UI in sync when the playback manager pauses this video.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPause = () => setPlaying(false);
    v.addEventListener("pause", onPause);
    return () => v.removeEventListener("pause", onPause);
  }, [near]);

  const start = play;

  return (
    <Link
      ref={cardRef}
      href={`/templates/${t.id}`}
      className="group block"
      onMouseEnter={start}
      onMouseLeave={stop}
      onFocus={start}
      onBlur={stop}
    >
      <div className="relative aspect-[3/4] overflow-hidden rounded-[14px] bg-night sm:rounded-[18px] ring-1 ring-black/5 transition-transform duration-200 group-active:scale-[0.97]">
        {t.coverUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={t.coverUrl}
            alt=""
            loading={priority ? "eager" : "lazy"}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${playing && !imgMode ? "opacity-0" : "opacity-100"}`}
          />
        )}
        {t.previewUrl && near && imgMode && playing && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={t.previewLiteUrl ?? t.previewUrl} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
        )}
        {t.previewUrl && near && !imgMode && (
          <video
            ref={videoRef}
            // Without a cover image the first video frame acts as the poster.
            src={t.coverUrl ? (t.previewLiteUrl ?? t.previewUrl) : `${t.previewLiteUrl ?? t.previewUrl}#t=0.1`}
            muted
            loop
            playsInline
            preload="metadata"
            aria-hidden
            // The light copy is missing (e.g. replaced during a re-encode): fall back to the original.
            onError={(e) => {
              const v = e.currentTarget;
              if (t.previewLiteUrl && t.previewUrl && !v.src.startsWith(t.previewUrl)) { v.src = t.previewUrl; play(); }
            }}
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
        <div className="absolute left-2 top-2 flex flex-col items-start gap-1 sm:left-2.5 sm:top-2.5">
          {t.isTrending && (
            <span className="rounded-full bg-brand px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-night sm:px-2.5 sm:py-1 sm:text-[11px]">{kk.catalog2.trendBadge}</span>
          )}
          {/* People in the template (only worth showing for 2+). */}
          {t.faceCount > 1 && (
            // Overlapping avatar stack (+count) — one circle per person in the video.
            <span className="flex items-center" aria-label={kk.catalog.faces(t.faceCount)}>
              {["bg-brand-soft", "bg-peach", "bg-rose"].slice(0, Math.min(t.faceCount, 3)).map((bg, i) => (
                <span key={bg} className={`-ml-1.5 flex h-5 w-5 items-center justify-center rounded-full text-night ring-2 ring-white first:ml-0 sm:h-6 sm:w-6 ${bg}`} style={{ zIndex: 3 - i }} aria-hidden>
                  <svg viewBox="0 0 24 24" className="h-3 w-3 sm:h-3.5 sm:w-3.5" fill="currentColor"><path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zm-8.5 9a8.5 8.5 0 0 1 17 0z" /></svg>
                </span>
              ))}
              {t.faceCount > 3 && <span className="-ml-1.5 flex h-5 min-w-5 items-center sm:h-6 sm:min-w-6 justify-center rounded-full bg-night px-1 text-[10px] font-bold text-white ring-2 ring-white">+{t.faceCount - 3}</span>}
            </span>
          )}
        </div>
        <div className="absolute inset-x-2.5 bottom-2.5 text-white sm:inset-x-3 sm:bottom-3">
          <h3 className="line-clamp-2 text-[14px] font-bold leading-tight tracking-tight sm:text-[15px]">{t.title}</h3>
          {t.startingPriceKzt !== null && (
            <p className="mt-0.5 text-[12px] font-semibold text-lime sm:mt-1 sm:text-sm">
              {formatKzt(t.startingPriceKzt)}<span className="hidden sm:inline"> {kk.catalog.from}</span>
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}
