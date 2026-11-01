import Link from "next/link";
import { kk } from "@/lib/i18n/kk";
import { HeroVideo } from "./hero-video";

type Item = { id: string; title: string; coverUrl: string | null; previewUrl: string | null };

/**
 * The hero's one moment of motion: up to three real trend templates fanned like phones,
 * the front one playing muted. Reduced-motion users get the still covers.
 */
export function HeroShowcase({ items, compact = false }: { items: Item[]; compact?: boolean }) {
  if (!items.length) return null;

  // back-left, back-right, front-centre
  const order = items.length === 1 ? [items[0]] : items.length === 2 ? [items[1], items[0]] : [items[1], items[2], items[0]];
  const pose = (i: number, n: number) => {
    if (n === 1) return "z-20 rotate-0";
    if (n === 2) return i === 0 ? "z-10 -translate-x-[38%] -rotate-6 scale-90" : "z-20 translate-x-[8%] rotate-2";
    return i === 0 ? "z-10 -translate-x-[46%] -rotate-[8deg] scale-[0.86]"
      : i === 1 ? "z-10 translate-x-[46%] rotate-[8deg] scale-[0.86]"
      : "z-20";
  };

  return (
    <div className={`relative mx-auto flex w-full max-w-md items-center justify-center overflow-hidden ${compact ? "h-[16.25rem]" : "h-[21rem] sm:h-[26rem] sm:overflow-visible md:h-[30rem]"}`} aria-label={kk.home.trendingTitle}>
      <div className={`absolute -z-0 bg-brand-soft ${compact ? "inset-x-5 bottom-2 top-7 rounded-[2rem]" : "inset-x-4 bottom-4 top-8 rounded-[2.5rem] sm:inset-x-6 sm:bottom-6 sm:top-10 sm:rounded-[3rem]"}`} aria-hidden />
      {order.map((t, i) => {
        const front = i === order.length - 1;
        return (
          <Link
            key={t.id}
            href={`/templates/${t.id}`}
            className={`absolute aspect-[9/16] overflow-hidden ${compact ? "h-[14rem] rounded-[1.1rem] border-[3px]" : "h-[18rem] rounded-[1.4rem] border-[5px] sm:h-[22rem] sm:rounded-[1.75rem] sm:border-[6px] md:h-[26rem]"} border-surface bg-night shadow-[0_24px_60px_-20px_rgba(0,0,0,0.7)] transition-transform duration-300 hover:-translate-y-1 ${pose(i, order.length)}`}
          >
            {t.coverUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={t.coverUrl} alt="" fetchPriority="high" loading="eager" className="absolute inset-0 h-full w-full object-cover" />
            )}
            {!front && !t.coverUrl && t.previewUrl && (
              // No cover: show the first video frame on the side phones.
              <video src={`${t.previewUrl}#t=0.1`} muted playsInline preload="metadata" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
            )}
            {front && t.previewUrl && (
              <HeroVideo src={t.previewUrl} poster={t.coverUrl ?? undefined} />
            )}
            {front && (
              <span className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent font-display font-semibold text-white ${compact ? "line-clamp-2 p-2.5 pt-7 text-[11px]" : "p-3 pt-8 text-xs sm:p-4 sm:pt-10 sm:text-sm"}`}>
                {t.title}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
