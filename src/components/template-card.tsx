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
const MAX_PLAYING = 2;
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
 *  - the video only downloads when it is about to play (hover/focus, or mostly visible on touch);
 *  - at most two previews play at the same time; off-screen videos are paused.
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
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setNear(true); io.disconnect(); } }, { rootMargin: "400px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [t.previewUrl]);

  const play = () => {
    const v = videoRef.current;
    if (!v) return;
    claimPlayback(v);
    v.play().then(() => setPlaying(true)).catch(() => releasePlayback(v));
  };
  const stop = () => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    releasePlayback(v);
    setPlaying(false);
  };

  // Touch screens have no hover: play while the card is mostly on screen.
  // Skipped for reduced-motion and data-saver users.
  useEffect(() => {
    const el = cardRef.current;
    if (!el || !near || !window.matchMedia("(hover: none)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? play() : stop()), { threshold: 0.75 });
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
      <div className="relative aspect-[9/16] overflow-hidden rounded-card bg-ink/90">
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
            preload={t.coverUrl ? "none" : "metadata"}
            aria-hidden
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/75 to-transparent" />
        <div className="absolute left-2.5 top-2.5 flex flex-col items-start gap-1.5 sm:left-3 sm:top-3">
          {t.isTrending && (
            <span className="rounded-full bg-flash px-2.5 py-1 text-xs font-bold text-ink">{kk.catalog2.trendBadge}</span>
          )}
          <span className="rounded-full bg-black/55 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm">
            {kk.catalog.faces(t.faceCount)}
          </span>
        </div>
        <div className="absolute inset-x-3 bottom-3 text-white">
          <h3 className="line-clamp-2 font-display text-sm font-semibold leading-snug sm:text-base">{t.title}</h3>
          {t.startingPriceKzt !== null && (
            <p className="mt-1 text-sm text-white/85">
              {formatKzt(t.startingPriceKzt)} {kk.catalog.from}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}
