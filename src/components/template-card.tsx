"use client";
import { Flame } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { kk } from "@/lib/i18n/kk";
import { formatKzt } from "@/lib/pricing";
import { autoplayRefused, useImgPreviews, useInTelegram } from "@/lib/video-autoplay";
import { primeSound, videoShown } from "@/lib/sound-handoff";

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
  previewAnimUrl?: string | null;
  isTrending: boolean;
};

/**
 * Keeps at most MAX_PLAYING previews running at once across the whole page: starting a new
 * one pauses the oldest. Many cards on screen then never decode/stream videos in parallel.
 */
let pageGate: Promise<void> | null = null;
/**
 * Resolves once the page has finished loading (plus a short idle), so the heavy animated previews
 * never compete with the first screen's covers and text — they keep LCP fast.
 */
function heroReady(): Promise<void> {
  if (pageGate) return pageGate;
  pageGate = new Promise<void>((resolve) => {
    const idle = () => ("requestIdleCallback" in window ? window.requestIdleCallback(() => resolve(), { timeout: 1500 }) : setTimeout(resolve, 300));
    if (document.readyState === "complete") idle();
    else window.addEventListener("load", idle, { once: true });
  });
  return pageGate;
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
/**
 * aspect: the card's shape (the home wall mixes several); wall: tight corners for the edge-to-edge feed.
 * The website plays the light MP4; the Mini App shows the animated WebP (Telegram's WebView is weak at many videos).
 */
export function TemplateCard({ t, priority = false, aspect = "aspect-[3/4]", wall = false }: { t: CardData; priority?: boolean; aspect?: string; wall?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cardRef = useRef<HTMLAnchorElement>(null);
  const [playing, setPlaying] = useState(false);
  const [near, setNear] = useState(false); // card is within ~1 screen: attach the video src
  // Website: the light MP4. Mini App (or autoplay refused): the animated WebP, when there is one.
  const tg = useInTelegram();
  const imgMode = useImgPreviews() || (tg && !!t.previewAnimUrl);
  const imgModeRef = useRef(imgMode);
  const wantRef = useRef(false); // the card is on screen and should be playing
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
    if (!videoShown(v)) return;
    claimPlayback(v);
    wantRef.current = true;
    // Some WebViews (Telegram on iPad/iPhone) neither play nor reject: if the video still sits
    // paused a few seconds after we asked, treat autoplay as refused and use animated images.
    window.setTimeout(() => {
      if (wantRef.current && videoRef.current === v && v.paused && v.readyState >= 1 && playingNow.includes(v)) {
        if (autoplayRefused({ name: "NotAllowedError" })) { releasePlayback(v); setPlaying(true); }
      }
    }, 3500);
    const again = () => {
      if (videoRef.current !== v || !videoShown(v)) { waitingForGesture.delete(again); return; }
      v.play().then(() => { waitingForGesture.delete(again); setPlaying(true); }).catch(() => {});
    };
    v.play().then(() => setPlaying(true)).catch((err) => {
      if (autoplayRefused(err)) { releasePlayback(v); setPlaying(true); return; }
      // Not enough data yet: retry once the first frame is loaded; autoplay blocked: retry on first touch.
      if (v.readyState < 2) v.addEventListener("loadeddata", () => { if (videoShown(v)) v.play().then(() => setPlaying(true)).catch(() => retryOnGesture(again)); }, { once: true });
      else retryOnGesture(again);
    });
  };
  const stop = () => {
    wantRef.current = false;
    if (imgModeRef.current) { setPlaying(false); return; }
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    releasePlayback(v);
    setPlaying(false);
  };

  // Every card plays while it is on screen (phones, Telegram and desktop alike).
  // Plays even with iOS "Reduce Motion" on: the preview is the product, people expect to see it move.
  useEffect(() => {
    const el = cardRef.current;
    if (!el || !near) return;
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
      className={`group block ${wall ? "rounded-xl" : "rounded-[1.25rem]"} focus-visible:outline-offset-4`}
      // The tap itself starts the template's video with sound (see sound-handoff).
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        stop();
        primeSound(t.previewUrl);
      }}
      onMouseEnter={start}
      onMouseLeave={stop}
      onFocus={start}
      onBlur={stop}
    >
      <div className={`relative ${aspect} overflow-hidden bg-night transition-[transform,box-shadow] duration-300 ease-[var(--ease-out)] group-active:scale-[0.98] ${wall ? "rounded-lg sm:rounded-xl group-hover:brightness-110" : "rounded-[1rem] ring-1 ring-black/5 elev-sm group-hover:-translate-y-0.5 group-hover:elev-md sm:rounded-[1.25rem]"}`}>
        {t.coverUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={t.coverUrl}
            alt=""
            loading={priority ? "eager" : "lazy"}
            className={`absolute inset-0 h-full w-full object-cover transition-[opacity,transform] duration-500 ease-[var(--ease-out)] ${wall ? "group-hover:scale-[1.03]" : ""} ${playing && !imgMode ? "opacity-0" : "opacity-100"}`}
          />
        )}
        {t.previewAnimUrl && near && imgMode && playing && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={t.previewAnimUrl} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
        )}
        {t.previewUrl && near && !imgMode && (
          <video
            ref={videoRef}
            // Without a cover image the first video frame acts as the poster.
            src={t.coverUrl ? (t.previewLiteUrl ?? t.previewUrl) : `${t.previewLiteUrl ?? t.previewUrl}#t=0.1`}
            muted
            loop
            // iOS sometimes ignores "loop" and freezes on the last frame: restart it ourselves.
            onEnded={(e) => { const v = e.currentTarget; v.currentTime = 0; if (wantRef.current) void v.play().catch(() => {}); }}
            playsInline
            preload="metadata"
            aria-hidden
            // The light copy is missing (e.g. replaced during a re-encode): fall back to the original.
            onError={(e) => {
              const v = e.currentTarget;
              if (t.previewLiteUrl && t.previewUrl && !v.src.startsWith(t.previewUrl)) { v.src = t.previewUrl; play(); }
            }}
            className={`absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-[var(--ease-out)] ${wall ? "group-hover:scale-[1.03]" : ""}`}
          />
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />
        <div className="absolute left-2 top-2 flex flex-col items-start gap-1 sm:left-2.5 sm:top-2.5">
          {t.isTrending && (
            <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-night shadow-[0_4px_12px_-4px_rgba(0,0,0,0.35)] sm:px-2.5 sm:py-1 sm:text-[11px]"><Flame size={11} strokeWidth={2.6} aria-hidden />{kk.catalog2.trendBadge}</span>
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
          <h3 className="line-clamp-2 font-display text-[13px] font-semibold leading-tight tracking-tight sm:text-[14px]">{t.title}</h3>
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
