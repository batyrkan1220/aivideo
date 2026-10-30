"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { kk } from "@/lib/i18n/kk";
import { formatKzt } from "@/lib/pricing";

export type CardData = {
  id: string;
  title: string;
  description: string;
  faceCount: number;
  qualityLabels: string[];
  startingPriceKzt: number | null;
  coverUrl: string | null;
  previewUrl: string | null;
  isTrending: boolean;
};

/**
 * Keeps at most MAX_PLAYING previews running at once across the whole page: starting a new
 * one pauses the oldest. Many cards on screen then never decode/stream videos in parallel.
 */
const MAX_PLAYING = 4; // phones: the cards in view; fewer parallel downloads keep taps responsive
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
 *  - visible cards autoplay (muted, inline), up to six at once; off-screen videos are paused.
 */
export function TemplateCard({ t, priority = false }: { t: CardData; priority?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const cardRef = useRef<HTMLAnchorElement>(null);
  const [playing, setPlaying] = useState(false);
  const [near, setNear] = useState(false); // card is within ~1 screen: attach the video src

  // Attach the video only when the card approaches the viewport.
  useEffect(() => {
    const el = cardRef.current;
    if (!el || !t.previewUrl) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setNear(true); io.disconnect(); } }, { rootMargin: "200px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [t.previewUrl]);

  const play = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = true; // Telegram WebView: the property must be set before play()
    v.defaultMuted = true;
    claimPlayback(v);
    v.play().then(() => setPlaying(true)).catch(() => {
      // Not enough data yet (or WebView refused): retry once the first frame is loaded.
      v.addEventListener("loadeddata", () => { v.play().then(() => setPlaying(true)).catch(() => releasePlayback(v)); }, { once: true });
    });
  };
  const stop = () => {
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
      <div className="relative aspect-[9/16] overflow-hidden rounded-[20px] bg-night ring-1 ring-black/5 transition-transform duration-200 group-active:scale-[0.97]">
        {t.coverUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={t.coverUrl}
            alt=""
            loading={priority ? "eager" : "lazy"}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${playing ? "opacity-0" : "opacity-100"}`}
          />
        )}
        {t.previewUrl && near && (
          <video
            ref={videoRef}
            // Without a cover image the first video frame acts as the poster.
            src={t.coverUrl ? t.previewUrl : `${t.previewUrl}#t=0.1`}
            muted
            loop
            playsInline
            preload="metadata"
            aria-hidden
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
        <div className="absolute left-2.5 top-2.5 flex flex-col items-start gap-1.5 sm:left-3 sm:top-3">
          {t.isTrending && (
            <span className="rounded-full bg-brand px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-night">{kk.catalog2.trendBadge}</span>
          )}
          {/* People in the template (only worth showing for 2+). */}
          {t.faceCount > 1 && (
            <span className="flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[11px] font-semibold text-white" aria-label={kk.catalog.faces(t.faceCount)}>
              <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor" aria-hidden><path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zm-8.5 9a8.5 8.5 0 0 1 17 0z" /></svg>
              <span>{t.faceCount}</span>
            </span>
          )}
        </div>
        <div className="absolute inset-x-3 bottom-3 text-white">
          <h3 className="line-clamp-2 text-[15px] font-bold leading-tight tracking-tight sm:text-base">{t.title}</h3>
          {t.startingPriceKzt !== null && (
            <p className="mt-1 text-[12px] font-semibold text-lime sm:text-sm">
              {formatKzt(t.startingPriceKzt)}<span className="hidden sm:inline"> {kk.catalog.from}</span>
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}
