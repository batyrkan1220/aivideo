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
    <div className="relative mx-auto flex h-[30rem] w-full max-w-md items-center justify-center" aria-label={kk.home.trendingTitle}>
      <div className="absolute inset-x-6 bottom-6 top-10 -z-0 rounded-[3rem] bg-brand-soft" aria-hidden />
      {order.map((t, i) => {
        const front = i === order.length - 1;
        return (
          <Link
            key={t.id}
            href={`/templates/${t.id}`}
            className={`absolute aspect-[9/16] h-[26rem] overflow-hidden rounded-[1.75rem] border-[6px] border-ink bg-ink shadow-[0_24px_60px_-20px_rgba(30,27,46,0.55)] transition-transform duration-300 hover:-translate-y-1 ${pose(i, order.length)}`}
          >
            {t.coverUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={t.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
            )}
            {front && t.previewUrl && (
              <video src={t.previewUrl} poster={t.coverUrl ?? undefined} autoPlay muted loop playsInline preload="metadata" aria-hidden className="absolute inset-0 h-full w-full object-cover motion-reduce:hidden" />
            )}
            {front && (
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-4 pt-10 font-display text-sm font-semibold text-white">
                {t.title}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
