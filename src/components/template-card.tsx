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
 * 9:16 template card. The preview video is not downloaded until the user
 * hovers or focuses the card (preload="none"), so the grid stays light.
 */
export function TemplateCard({ t, priority = false }: { t: CardData; priority?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  const cardRef = useRef<HTMLAnchorElement>(null);

  // Touch screens have no hover: play the preview while the card is mostly on screen.
  // Skipped for reduced-motion and data-saver users.
  useEffect(() => {
    const el = cardRef.current;
    const v = videoRef.current;
    if (!el || !v || !window.matchMedia("(hover: none)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) v.play().then(() => setPlaying(true)).catch(() => {});
      else { v.pause(); setPlaying(false); }
    }, { threshold: 0.6 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const start = () => {
    const v = videoRef.current;
    if (!v) return;
    v.play().then(() => setPlaying(true)).catch(() => {});
  };
  const stop = () => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    setPlaying(false);
  };

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
        {t.previewUrl && (
          <video
            ref={videoRef}
            src={t.previewUrl}
            muted
            loop
            playsInline
            preload="none"
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
