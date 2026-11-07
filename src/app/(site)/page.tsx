import { Clapperboard } from "lucide-react";
import { Alert, EmptyState } from "@/components/ui/states";
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
      <section className="relative mx-auto hidden max-w-6xl grid-cols-[1.15fr_0.85fr] items-center gap-10 px-6 pb-8 pt-16 md:grid">
        <div className="pointer-events-none absolute -left-40 -top-24 h-96 w-96 rounded-full bg-brand/30 blur-3xl" aria-hidden />
        <div className="relative min-w-0">
          <span className="t-micro inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 elev-xs">
            <span className="h-2 w-2 rounded-full bg-[#9cbf12]" aria-hidden />{kk.home.badge}
          </span>
          <h1 className="mt-5 max-w-3xl font-display text-5xl font-extrabold leading-[1.04] tracking-[-0.035em] lg:text-6xl">{kk.home.title}</h1>
          <p className="mt-5 max-w-xl text-lg leading-7 text-muted">{kk.home.lead}</p>
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
        {/* Same hero as the website: three trend templates fanned like phones, the front one playing (lite preview). */}
        <p className="text-center text-[17px] font-extrabold leading-tight tracking-tight">{kk.home.heroMini} <span className="rounded-md bg-brand px-1.5 text-night">{kk.home.heroMiniAccent}</span></p>
        <PhoneOnly fallback={<div className="h-[16.25rem]" />}>
          <Suspense fallback={<div className="h-[16.25rem]" />}>
            <Showcase compact />
          </Suspense>
        </PhoneOnly>
        <p className="mt-0.5 text-center text-[12px] font-medium text-muted">{kk.home.heroMiniHint}</p>
      </section>

      <Suspense fallback={<div className="mx-auto mt-4 max-w-6xl px-4"><CachedFeedFallback /></div>}>
        <Feed searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

function HowItWorks({ compact = false }: { compact?: boolean }) {
  return (
    <ol className={compact ? "no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 text-xs" : "mt-8 grid max-w-xl grid-cols-3 gap-3 text-sm"}>
      {kk.home.steps.map((s, i) => (
        <li key={s.t} className={compact ? "flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full bg-surface py-1.5 pl-1.5 pr-3 ring-1 ring-line" : "rounded-2xl border border-line/80 bg-surface p-4 elev-xs"}>
          <span className={compact ? "flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand text-[10px] font-bold text-night" : `grid h-8 w-8 place-items-center rounded-full text-sm font-extrabold ${["bg-peach", "bg-lavender", "bg-rose"][i % 3]}`}>{i + 1}</span>
          <span className={compact ? "font-medium" : "mt-3 block font-semibold leading-5"}>{compact ? s.short : s.t}</span>
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
    // The video wall runs wider than the rest of the page, with thin side margins.
    <div className="mx-auto max-w-[1600px] px-1.5 sm:px-3">
      {/* Sticky category chips, like an app's filter bar */}
      <h2 id="templates" className="section-title mt-5 scroll-mt-20 px-2.5 text-muted md:hidden">{kk.home.templatesTitle}</h2>
      {categories.length > 0 && (
        <div className="under-header sticky z-20 -mx-1.5 bg-paper/90 px-4 py-2.5 backdrop-blur-xl sm:-mx-3 sm:py-3">
          <CategoryChips categories={categories} active={category} />
        </div>
      )}
      {first.items.length === 0 ? (
        <div className="mt-4"><EmptyState icon={<Clapperboard size={26} strokeWidth={1.8} aria-hidden />} title={kk.home.emptyTitle} text={kk.home.emptyText} /></div>
      ) : (
        <VideoFeed
          key={category ?? "all"}
          category={category}
          initial={first.items.map(pickCard)}
          initialHasMore={first.items.length < first.total}
          priorityCount={6}
          wall
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
      <Alert tone="success">{kk.account.accountDeleted}</Alert>
    </p>
  );
}

async function Showcase({ compact = false }: { compact?: boolean }) {
  const items = (await resolveShowcase()).map(({ id, title, coverUrl, coverThumbUrl, previewUrl, previewLiteUrl, previewAnimUrl }) => ({ id, title, coverUrl: coverThumbUrl ?? coverUrl, previewUrl: previewLiteUrl ?? previewUrl, animUrl: previewAnimUrl }));
  return <HeroShowcase items={items} compact={compact} />;
}
