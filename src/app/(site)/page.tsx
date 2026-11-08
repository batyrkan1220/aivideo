import { ChevronLeft, ChevronRight, Clapperboard } from "lucide-react";
import Link from "next/link";
import { ShelfRow } from "@/components/shelf-row";
import { FavoritesShelf } from "@/components/favorites-shelf";
import { Alert, EmptyState } from "@/components/ui/states";
import { Suspense } from "react";
import { connection } from "next/server";
import { kk } from "@/lib/i18n/kk";
import { listCategories, listTemplates } from "@/lib/templates/queries";
import { pickCard } from "@/components/catalog-bits";
import { VideoFeed } from "@/components/video-feed";
import { CinematicHero, DepthStack, DepthStackShell } from "@/components/cinematic-hero";
import { Logo } from "@/components/logo";
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

      {/* Mini App: Telegram hides the site header, so the brand sits on top. */}
      <div className="tg-only px-4 pt-3">
        <Logo className="text-base" />
      </div>

      <CinematicHero newVideoHref="/create" stack={<Suspense fallback={<DepthStackShell />}><HeroCards /></Suspense>} />

      <Suspense fallback={<FeedFallback />}>
        <Feed searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function HeroCards() {
  const items = (await resolveShowcase()).map(({ id, title, coverUrl, coverThumbUrl, previewUrl, previewLiteUrl, previewAnimUrl }) => ({ id, title, coverUrl: coverThumbUrl ?? coverUrl, previewUrl: previewLiteUrl ?? previewUrl, animUrl: previewAnimUrl }));
  return <DepthStack items={items} />;
}

/** While the feed loads: a shelf heading in the same place as the real one (no jump), then the saved cards. */
function FeedFallback() {
  return (
    <div className="mx-auto max-w-[1600px] px-1.5 sm:px-3">
      <div className="mt-4 flex items-end justify-between px-2.5 pb-3" aria-hidden>
        <span className="skeleton h-7 w-40 rounded-full" />
        <span className="skeleton h-5 w-12 rounded-full" />
      </div>
      <CachedFeedFallback />
    </div>
  );
}

async function Feed({ searchParams }: { searchParams: Promise<SP> }) {
  await connection(); // always fresh — admins publish templates at any time
  const sp = await searchParams;
  const categories = await listCategories();
  const active = categories.find((c) => c.slug === sp.category);

  // One category opened ("Все →"): its full feed, with a way back.
  if (active) {
    const first = await listTemplates({ page: 1, sort: "trending", category: active.slug });
    return (
      <div id="templates" className="mx-auto max-w-[1600px] scroll-mt-20 px-1.5 sm:px-3">
        <div className="flex items-end justify-between gap-3 px-2.5 pb-3 pt-6">
          <div className="min-w-0">
            <Link href="/#templates" className="inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-ink"><ChevronLeft size={16} aria-hidden />{kk.home.allVideos}</Link>
            <h2 className="mt-1 truncate text-2xl text-ink sm:text-3xl">{active.title}</h2>
          </div>
          <span className="shrink-0 text-sm text-muted">{kk.home.count(first.total)}</span>
        </div>
        {first.items.length === 0
          ? <EmptyState icon={<Clapperboard size={26} strokeWidth={1.8} aria-hidden />} title={kk.home.emptyTitle} text={kk.home.emptyText} />
          : <VideoFeed key={active.slug} category={active.slug} initial={first.items.map(pickCard)} initialHasMore={first.items.length < first.total} priorityCount={6} wall />}
      </div>
    );
  }

  // Home: every category as its own shelf (its templates together, scrolling sideways), then all videos.
  const [shelves, all] = await Promise.all([
    Promise.all(categories.map(async (c) => ({ c, r: await listTemplates({ page: 1, sort: "trending", category: c.slug }) }))),
    listTemplates({ page: 1, sort: "trending" }),
  ]);
  const filled = shelves.filter((x) => x.r.items.length > 0);

  return (
    <div id="templates" className="mx-auto max-w-[1600px] scroll-mt-20 px-1.5 sm:px-3">
      <FavoritesShelf />
      {filled.map(({ c, r }) => (
        <section key={c.id} className="mt-6 first:mt-4" aria-labelledby={`shelf-${c.slug}`}>
          <ShelfHead id={`shelf-${c.slug}`} title={c.title} count={r.total} href={`/?category=${c.slug}`} />
          <ShelfRow items={r.items.map(pickCard)} label={c.title} />
        </section>
      ))}

      <section className={filled.length ? "mt-8" : "mt-4"} aria-labelledby="shelf-all">
        <ShelfHead id="shelf-all" title={kk.home.allVideos} count={all.total} />
        {all.items.length === 0
          ? <EmptyState icon={<Clapperboard size={26} strokeWidth={1.8} aria-hidden />} title={kk.home.emptyTitle} text={kk.home.emptyText} />
          : <VideoFeed key="all" initial={all.items.map(pickCard)} initialHasMore={all.items.length < all.total} priorityCount={filled.length ? 2 : 6} wall />}
      </section>
    </div>
  );
}

/** Shelf heading: the category name, how many videos, and "Все →" to open it. */
function ShelfHead({ id, title, count, href }: { id: string; title: string; count: number; href?: string }) {
  return (
    <div className="flex items-end justify-between gap-3 px-2.5 pb-3">
      <h2 id={id} className="min-w-0 truncate text-xl text-ink sm:text-2xl">
        {title} <span className="align-middle font-sans text-sm text-muted">{count}</span>
      </h2>
      {href && (
        <Link href={href} className="inline-flex shrink-0 items-center gap-0.5 rounded-full px-2 py-1 text-sm font-semibold text-ink hover:bg-ink/[0.05]">
          <span className="sm:hidden">{kk.catalog.all}</span><span className="hidden sm:inline">{kk.home.seeAll}</span><ChevronRight size={16} aria-hidden />
        </Link>
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
