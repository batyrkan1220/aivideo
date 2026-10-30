import { Suspense } from "react";
import { connection } from "next/server";
import { kk } from "@/lib/i18n/kk";
import { listCategories, listTemplates } from "@/lib/templates/queries";
import { CategoryChips, GridSkeleton, pickCard } from "@/components/catalog-bits";
import { VideoFeed } from "@/components/video-feed";
import { HeroShowcase } from "@/components/hero-showcase";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { AutoVideo } from "@/components/auto-video";
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
          <Suspense fallback={<div className="h-[30rem]" />}>
            <Showcase />
          </Suspense>
        </div>
      </section>

      {/* Phones / Mini App: brand bar (Telegram hides the site header), then a hero banner */}
      <section className="mx-auto max-w-6xl px-4 pt-3 md:hidden">
        <div className="tg-only">
          <div className="mb-3 flex items-center justify-between gap-3">
            <Logo className="text-base" />
            <Link href="/create" className="btn-promo inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-bold">🔥 {kk.home.promo}</Link>
          </div>
        </div>
        <h1 className="sr-only">{kk.home.title}</h1>
        <Suspense fallback={<div className="h-56 animate-pulse rounded-[24px] bg-surface" />}>
          <HeroBanner />
        </Suspense>
      </section>

      <Suspense fallback={<div className="mx-auto mt-4 max-w-6xl px-4"><GridSkeleton /></div>}>
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
      <h2 className="section-title mt-5 text-muted md:hidden">{kk.home.templatesTitle}</h2>
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

/** Phone hero: the main showcase template as a rounded banner with a "Try it" button. */
async function HeroBanner() {
  const [t] = await resolveShowcase();
  if (!t) return null;
  return (
    <Link href={`/templates/${t.id}`} className="relative block h-56 overflow-hidden rounded-[24px] bg-night ring-1 ring-black/5">
      {t.previewUrl ? (
        <AutoVideo src={t.previewUrl} poster={t.coverUrl ?? undefined} className="absolute inset-0 h-full w-full object-cover" />
      ) : t.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={t.coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : null}
      <span className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/85 via-black/45 to-transparent" />
      <span className="absolute inset-y-0 left-0 flex max-w-[70%] flex-col justify-end gap-2 p-4 text-white">
        <span className="section-title text-lime">{kk.home.heroEyebrow}</span>
        <span className="text-2xl font-extrabold leading-tight tracking-tight">{t.title}</span>
        <span className="text-[13px] leading-snug text-white/75">{kk.home.title}</span>
        <span className="btn-glow mt-1 inline-flex h-10 w-fit items-center rounded-full px-5 text-sm font-bold">{kk.home.tryIt}</span>
      </span>
    </Link>
  );
}
