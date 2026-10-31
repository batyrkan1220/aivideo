import { Suspense } from "react";
import { connection } from "next/server";
import { kk } from "@/lib/i18n/kk";
import { listCategories, listTemplates } from "@/lib/templates/queries";
import { CategoryChips, pickCard } from "@/components/catalog-bits";
import { VideoFeed } from "@/components/video-feed";
import { HeroShowcase } from "@/components/hero-showcase";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { DesktopOnly } from "@/components/desktop-only";
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
        <TextHero />
      </section>

      <Suspense fallback={<div className="mx-auto mt-4 max-w-6xl px-4"><CachedFeedFallback /></div>}>
        <Feed searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

/** Phone hero: compact dark card — small chartreuse/white progress ring, two-line title,
    one row of perk chips, two buttons. Pure CSS/SVG, no media. */
function TextHero() {
  const H = kk.home;
  const r = 22, c = 2 * Math.PI * r;
  return (
    <div className="relative overflow-hidden rounded-[24px] bg-night px-4 py-4 text-white shadow-[0_20px_40px_-26px_rgba(22,22,22,0.7)]">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/55">
            <span className="h-1.5 w-1.5 rounded-full bg-[#d7f443]" aria-hidden />
            {H.heroBadge}
          </span>
          <h1 className="mt-1.5 text-[21px] font-extrabold leading-[1.12] tracking-tight">
            {H.heroLine1} <span className="text-[#d7f443]">{H.heroLine2}</span>
          </h1>
        </div>
        {/* progress ring: "3 min" (chartreuse + white) */}
        <div className="relative h-[58px] w-[58px] shrink-0" aria-hidden>
          <svg viewBox="0 0 58 58" className="h-full w-full -rotate-90">
            <circle cx="29" cy="29" r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="6" />
            <circle cx="29" cy="29" r={r} fill="none" stroke="#d7f443" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${c * 0.72} ${c}`} />
            <circle cx="29" cy="29" r={r} fill="none" stroke="#ffffff" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${c * 0.08} ${c}`} strokeDashoffset={-c * 0.79} />
          </svg>
          <span className="absolute inset-0 flex flex-col items-center justify-center leading-none">
            <span className="text-[16px] font-extrabold">3</span>
            <span className="text-[8px] font-medium text-white/55">{H.heroRingUnit}</span>
          </span>
        </div>
      </div>
      <ul className="mt-3 flex gap-1.5">
        {H.heroChips.map((x) => (
          <li key={x} className="rounded-full bg-white/[0.08] px-2.5 py-1 text-[11.5px] font-medium text-white/80">{x}</li>
        ))}
      </ul>
      <div className="mt-3.5 grid grid-cols-[1.35fr_1fr] gap-2">
        <a href="#templates" className="btn-lime flex h-11 items-center justify-center rounded-full text-[14px] font-extrabold">{H.heroPick} ↓</a>
        <Link href="/photos" className="flex h-11 items-center justify-center gap-1.5 rounded-full bg-white/10 text-[14px] font-semibold text-white active:bg-white/20">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><rect x="3" y="5" width="18" height="15" rx="4" /><circle cx="12" cy="12.5" r="3.5" /><path d="M8 5l1.5-2h5L16 5" /></svg>
          {H.heroPhoto}
        </Link>
      </div>
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
