import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { kk } from "@/lib/i18n/kk";
import { Logo } from "@/components/logo";
import { listCombos } from "@/lib/combos/catalog";
import { formatKzt } from "@/lib/pricing";

export const metadata = { title: kk.photos.title };

/** AI photo templates (Kling image model): choose a style, upload a selfie, get a new photo. */
export default function PhotosPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 pb-6 pt-3 md:pt-10">
      <div className="tg-only">
        <div className="mb-3 flex items-center">
          <Logo className="text-base" />
        </div>
      </div>
      <h1 className="sr-only">{kk.photos.title}</h1>
      <Suspense fallback={null}>
        <Combos />
      </Suspense>
    </main>
  );
}

/** Combos: a vertical list; each card shows its photos fanned like a stack. */
async function Combos() {
  await connection();
  const combos = await listCombos();
  if (!combos.length) return null;
  const C = kk.combo;
  const fan = ["-rotate-[9deg] -translate-x-[34%] scale-[0.86]", "rotate-[9deg] translate-x-[34%] scale-[0.86]", "-rotate-[3deg] -translate-x-[12%] scale-[0.93]", "rotate-0"];
  return (
    <section className="mb-5">
      <div className="mb-3 mt-1 flex items-baseline justify-between gap-3">
        <h2 className="section-title text-muted">{C.section}</h2>
        <span className="truncate text-xs text-muted">{C.sectionLead}</span>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {combos.map((c) => {
          const covers = c.covers.slice(0, 4);
          const off = fan.length - covers.length; // the last cover sits on top, straight
          const save = c.sumKzt > c.priceKzt ? Math.round((1 - c.priceKzt / c.sumKzt) * 100) : 0;
          return (
            <li key={c.id}>
              <Link href={`/templates/${c.id}`} className="block rounded-[24px] bg-surface p-3 ring-1 ring-line transition-transform active:scale-[0.99]">
                <div className="relative flex h-52 items-center justify-center overflow-hidden rounded-[18px] bg-lavender">
                  {covers.map((src, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={src} src={src} alt="" loading="lazy"
                      className={`absolute h-[82%] aspect-[3/4] rounded-[14px] object-cover shadow-[0_10px_24px_-10px_rgba(22,22,22,0.5)] ring-2 ring-white ${fan[off + i]}`} />
                  ))}
                  <span className="absolute left-2 top-2 rounded-full bg-night px-2.5 py-1 text-[11px] font-extrabold text-white">{C.badge(c.count)}</span>
                  {save > 0 && <span className="absolute right-2 top-2 rounded-full bg-brand px-2 py-1 text-[11px] font-extrabold text-night">{C.save(save)}</span>}
                </div>
                <div className="mt-2.5 flex items-center justify-between gap-2 px-0.5">
                  <p className="min-w-0 truncate text-[15px] font-extrabold">{c.title}</p>
                  <p className="shrink-0 text-[14px] font-extrabold">{formatKzt(c.priceKzt)}</p>
                </div>
                {save > 0 && <p className="px-0.5 text-[12px] text-muted line-through">{formatKzt(c.sumKzt)}</p>}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
