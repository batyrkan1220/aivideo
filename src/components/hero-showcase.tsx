import Link from "next/link";
import { kk } from "@/lib/i18n/kk";

type Item = { id: string; title: string; coverUrl: string | null; previewUrl: string | null };

/**
 * The hero's one moment of motion: up to three real trend templates fanned like phones,
 * the front one playing muted. Reduced-motion users get the still covers.
 */
export function HeroShowcase({ items }: { items: Item[] }) {
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
    <div className="relative mx-auto flex h-[21rem] w-full max-w-md items-center justify-center overflow-hidden sm:h-[26rem] sm:overflow-visible md:h-[30rem]" aria-label={kk.home.trendingTitle}>
      <div className="absolute inset-x-4 bottom-4 top-8 -z-0 rounded-[2.5rem] bg-brand-soft sm:inset-x-6 sm:bottom-6 sm:top-10 sm:rounded-[3rem]" aria-hidden />
      {order.map((t, i) => {
        const front = i === order.length - 1;
        return (
          <Link
            key={t.id}
            href={`/templates/${t.id}`}
            className={`absolute aspect-[9/16] h-[18rem] overflow-hidden rounded-[1.4rem] border-[5px] sm:h-[22rem] sm:rounded-[1.75rem] sm:border-[6px] md:h-[26rem] border-surface bg-night shadow-[0_24px_60px_-20px_rgba(0,0,0,0.7)] transition-transform duration-300 hover:-translate-y-1 ${pose(i, order.length)}`}
          >
            {t.coverUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={t.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
            )}
            {!front && !t.coverUrl && t.previewUrl && (
              // No cover: show the first video frame on the side phones.
              <video src={`${t.previewUrl}#t=0.1`} muted playsInline preload="metadata" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
            )}
            {front && t.previewUrl && (
              <video src={t.previewUrl} poster={t.coverUrl ?? undefined} autoPlay muted loop playsInline preload="metadata" aria-hidden className="absolute inset-0 h-full w-full object-cover motion-reduce:hidden" />
            )}
            {front && (
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-3 pt-8 font-display text-xs font-semibold text-white sm:p-4 sm:pt-10 sm:text-sm">
                {t.title}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
