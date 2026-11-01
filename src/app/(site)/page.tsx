import { Suspense } from "react";
import { connection } from "next/server";
import { kk } from "@/lib/i18n/kk";
import { listCategories, listTemplates } from "@/lib/templates/queries";
import { CategoryChips, pickCard } from "@/components/catalog-bits";
import { VideoFeed } from "@/components/video-feed";
import { HeroShowcase } from "@/components/hero-showcase";
import { Logo } from "@/components/logo";
import { DesktopOnly, PhoneOnly } from "@/components/desktop-only";
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

      {/* Phones / Mini App: brand bar (Telegram hides the site header) + the 3-video hero */}
      <section className="mx-auto max-w-6xl px-4 pt-3 md:hidden">
        <div className="tg-only">
          <div className="mb-3 flex items-center">
            <Logo className="text-base" />
          </div>
        </div>
        {/* Conversion hero: promise → proof (3 real trend videos, the front one playing) → reassurance → one button. */}
        <div className="relative overflow-hidden rounded-[26px] bg-night px-4 pb-4 pt-4 text-white shadow-[0_20px_40px_-26px_rgba(22,22,22,0.7)]">
          <span aria-hidden className="pointer-events-none absolute -right-12 -top-16 h-48 w-48 rounded-full bg-[radial-gradient(circle,rgba(215,244,67,0.3),transparent_65%)]" />
          <span aria-hidden className="pointer-events-none absolute -bottom-20 -left-16 h-48 w-48 rounded-full bg-[radial-gradient(circle,rgba(47,101,246,0.22),transparent_65%)]" />
          <div className="relative text-center">
            <span className="inline-flex items-center rounded-full bg-[#d7f443]/15 px-2.5 py-1 text-[11px] font-bold text-[#d7f443]">{kk.home.heroKicker}</span>
            <h1 className="mt-2 text-[23px] font-extrabold leading-[1.08] tracking-tight">
              {kk.home.heroTitleA} <span className="text-[#d7f443]">{kk.home.heroTitleB}</span>
            </h1>
            <p className="mx-auto mt-1.5 max-w-[17rem] text-[13px] leading-snug text-white/70">{kk.home.heroSubline}</p>
          </div>
          <div className="relative -mx-2 mt-1">
            <PhoneOnly fallback={<div className="h-[13.5rem]" />}>
              <Suspense fallback={<div className="h-[13.5rem]" />}>
                <Showcase compact onDark />
              </Suspense>
            </PhoneOnly>
          </div>
          <ul className="relative mt-1 flex justify-center gap-1.5 text-[12px] font-semibold">
            {kk.home.heroProof.map((x) => <li key={x} className="rounded-full bg-white/[0.08] px-2.5 py-1 text-white/85">{x}</li>)}
          </ul>
          <a href="#templates" className="btn-lime relative mt-3 flex h-12 items-center justify-center gap-1.5 rounded-full text-[15px] font-extrabold">
            {kk.home.heroCta} <span aria-hidden>↓</span>
          </a>
        </div>
      </section>

      <Suspense fallback={<div className="mx-auto mt-4 max-w-6xl px-4"><CachedFeedFallback /></div>}>
        <Feed searchParams={searchParams} />
      </Suspense>
    </main>
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

async function Showcase({ compact = false, onDark = false }: { compact?: boolean; onDark?: boolean }) {
  const items = (await resolveShowcase()).map(({ id, title, coverUrl, previewUrl, previewLiteUrl }) => ({ id, title, coverUrl, previewUrl: previewLiteUrl ?? previewUrl }));
  return <HeroShowcase items={items} compact={compact} onDark={onDark} />;
}
