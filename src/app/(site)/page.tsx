import { Suspense } from "react";
import { connection } from "next/server";
import { kk } from "@/lib/i18n/kk";
import { listCategories, listTemplates, listTrending } from "@/lib/templates/queries";
import { CategoryChips, pickCard } from "@/components/catalog-bits";
import { VideoFeed } from "@/components/video-feed";
import { HeroShowcase } from "@/components/hero-showcase";
import { Logo } from "@/components/logo";
import { DesktopOnly } from "@/components/desktop-only";
import { formatKzt } from "@/lib/pricing";
import { CachedFeedFallback } from "@/components/cached-feed";
import { resolveShowcase } from "@/lib/templates/showcase";

type SP = { account?: string; category?: string };

/**
 * App-style home: every video in one endless feed (trending first), filtered by category chips.
 * Phones get a compact intro; desktops keep the hero showcase above the feed.
 */
export default function HomePage({ searchParams }: { searchParams: Promise<SP> }) {
  return (
    <main className="pb-6">
      <Suspense fallback={null}>
        <Notice searchParams={searchParams} />
      </Suspense>

      {/* Desktop hero */}
      <section className="mx-auto hidden max-w-6xl grid-cols-[1.15fr_0.85fr] items-center gap-8 px-4 pb-6 pt-12 md:grid">
        <div className="min-w-0">
          <h1 className="max-w-3xl font-display text-5xl font-extrabold leading-[1.05] tracking-tight lg:text-6xl">{kk.home.title}</h1>
          <p className="mt-5 max-w-xl text-lg text-muted">{kk.home.lead}</p>
          <HowItWorks />
        </div>
        <div className="min-w-0">
          <DesktopOnly>
            <Suspense fallback={<div className="h-[30rem]" />}>
              <Showcase />
            </Suspense>
          </DesktopOnly>
        </div>
      </section>

      {/* Phones / Mini App: brand bar (Telegram hides the site header) + a light, text-only hero (no videos) */}
      <section className="mx-auto max-w-6xl px-4 pt-3 md:hidden">
        <div className="tg-only">
          <div className="mb-3 flex items-center">
            <Logo className="text-base" />
          </div>
        </div>
        <Suspense fallback={<HeroView covers={[]} minPrice={null} />}>
          <TextHero />
        </Suspense>
      </section>

      <Suspense fallback={<div className="mx-auto mt-4 max-w-6xl px-4"><CachedFeedFallback /></div>}>
        <Feed searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

/** Phone hero (conversion): one promise, visual proof (real template covers, images only),
    the 3-step path, one primary button with the real starting price, short trust line. */
async function TextHero() {
  const [show, trending] = await Promise.all([resolveShowcase(), listTrending(12)]);
  const covers = [...show, ...trending].map((t) => t.coverUrl).filter((u): u is string => !!u);
  const prices = [...show, ...trending].map((t) => t.startingPriceKzt).filter((p): p is number => p !== null && p > 0);
  return <HeroView covers={[...new Set(covers)].slice(0, 3)} minPrice={prices.length ? Math.min(...prices) : null} />;
}

function HeroView({ covers, minPrice }: { covers: string[]; minPrice: number | null }) {
  const H = kk.home;
  const fan = ["-rotate-[10deg] -translate-x-[38%] translate-y-1 scale-[0.84]", "rotate-[10deg] translate-x-[38%] translate-y-1 scale-[0.84]", "rotate-0"];
  const off = fan.length - covers.length;
  return (
    <div className="relative overflow-hidden rounded-[24px] bg-night p-4 text-white shadow-[0_20px_40px_-26px_rgba(22,22,22,0.7)]">
      <span aria-hidden className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-[radial-gradient(circle,rgba(215,244,67,0.28),transparent_65%)]" />
      <div className="relative flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <span className="inline-flex items-center gap-1 rounded-full bg-[#d7f443]/15 px-2 py-0.5 text-[11px] font-bold text-[#d7f443]">🔥 {H.heroBadge}</span>
          <h1 className="mt-2 text-[22px] font-extrabold leading-[1.1] tracking-tight">
            {H.heroLine1} <span className="text-[#d7f443]">{H.heroLine2}</span>
          </h1>
        </div>
        {/* Visual proof: three real template covers fanned like phones */}
        <div className="relative h-[112px] w-[96px] shrink-0" aria-hidden>
          {covers.length ? covers.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={src} src={src} alt="" className={`absolute inset-x-[18px] top-0 h-[104px] w-[60px] rounded-[12px] object-cover ring-2 ring-white/90 shadow-[0_10px_20px_-8px_rgba(0,0,0,0.6)] ${fan[off + i]}`} />
          )) : <span className="absolute inset-x-[18px] top-0 h-[104px] w-[60px] rounded-[12px] bg-white/10" />}
          <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 rounded-full bg-[#d7f443] px-2 py-0.5 text-[10px] font-extrabold text-night">AI</span>
        </div>
      </div>

      {/* The path: 1 photo → AI → video */}
      <ol className="relative mt-3 flex items-center gap-1.5 text-[12px] font-semibold">
        {H.heroPath.map((step, i) => (
          <li key={step} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-white/35" aria-hidden>→</span>}
            <span className="rounded-full bg-white/[0.08] px-2.5 py-1 text-white/85">{step}</span>
          </li>
        ))}
      </ol>

      <a href="#templates" className="btn-lime relative mt-3.5 flex h-12 items-center justify-center gap-1.5 rounded-full text-[15px] font-extrabold">
        {H.heroPick}{minPrice ? <span className="font-bold opacity-70">· {H.heroFrom(formatKzt(minPrice))}</span> : null} ↓
      </a>
    </div>
  );
}

function HowItWorks({ compact = false }: { compact?: boolean }) {
  return (
    <ol className={compact ? "no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 text-xs" : "mt-8 grid max-w-xl grid-cols-3 gap-4 text-sm"}>
      {kk.home.steps.map((s, i) => (
        <li key={s.t} className={compact ? "flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full bg-surface py-1.5 pl-1.5 pr-3 ring-1 ring-line" : "border-t-2 border-ink pt-3"}>
          <span className={compact ? "flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand text-[10px] font-bold text-night" : "font-display text-2xl font-bold text-brand"}>{i + 1}</span>
          <span className={compact ? "font-medium" : "mt-1 block font-semibold"}>{compact ? s.short : s.t}</span>
        </li>
      ))}
    </ol>
  );
}

async function Feed({ searchParams }: { searchParams: Promise<SP> }) {
  await connection(); // always fresh — admins publish templates at any time
  const sp = await searchParams;
  const categories = await listCategories();
  const category = categories.some((c) => c.slug === sp.category) ? sp.category : undefined;
  const first = await listTemplates({ page: 1, sort: "trending", category });

  return (
    <div className="mx-auto max-w-6xl px-4">
      {/* Sticky category chips, like an app's filter bar */}
      <h2 id="templates" className="section-title mt-5 scroll-mt-20 text-muted md:hidden">{kk.home.templatesTitle}</h2>
      {categories.length > 0 && (
        <div className="under-header sticky z-20 -mx-4 bg-paper/90 px-4 py-2.5 backdrop-blur-xl sm:py-3">
          <CategoryChips categories={categories} active={category} />
        </div>
      )}
      {first.items.length === 0 ? (
        <div className="mt-4 rounded-card border border-dashed border-line bg-surface px-6 py-16 text-center">
          <h2 className="font-display text-xl font-bold">{kk.home.emptyTitle}</h2>
          <p className="mx-auto mt-2 max-w-md text-muted">{kk.home.emptyText}</p>
        </div>
      ) : (
        <VideoFeed
          key={category ?? "all"}
          category={category}
          initial={first.items.map(pickCard)}
          initialHasMore={first.items.length < first.total}
          priorityCount={4}
        />
      )}
    </div>
  );
}

async function Notice({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  if (sp.account !== "deleted") return null;
  return (
    <p role="status" className="mx-auto mt-6 max-w-6xl px-4">
      <span className="block rounded-card bg-paper p-4 text-sm ring-1 ring-line">{kk.account.accountDeleted}</span>
    </p>
  );
}

async function Showcase() {
  const items = (await resolveShowcase()).map(({ id, title, coverUrl, previewUrl }) => ({ id, title, coverUrl, previewUrl }));
  return <HeroShowcase items={items} />;
}
