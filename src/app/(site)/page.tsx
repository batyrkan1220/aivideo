import { Clapperboard } from "lucide-react";
import { Alert, EmptyState } from "@/components/ui/states";
import { Suspense } from "react";
import { connection } from "next/server";
import { kk } from "@/lib/i18n/kk";
import { listCategories, listTemplates } from "@/lib/templates/queries";
import { CategoryChips, pickCard } from "@/components/catalog-bits";
import { VideoFeed } from "@/components/video-feed";
import { CinematicHero } from "@/components/cinematic-hero";
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
    // data-dark: the cinematic dark theme for this page only (see globals.css).
    <main data-dark="" className="pb-6">
      <Suspense fallback={null}>
        <Notice searchParams={searchParams} />
      </Suspense>

      {/* Mini App: Telegram hides the site header, so the brand sits on top. */}
      <div className="tg-only px-4 pt-3">
        <Logo className="text-base" />
      </div>

      <Suspense fallback={<HeroFallback />}>
        <Hero />
      </Suspense>

      <Suspense fallback={<div className="mx-auto mt-4 max-w-[1600px] px-1.5 sm:px-3"><CachedFeedFallback /></div>}>
        <Feed searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Hero() {
  const items = (await resolveShowcase()).map(({ id, title, coverUrl, coverThumbUrl, previewUrl, previewLiteUrl, previewAnimUrl }) => ({ id, title, coverUrl: coverThumbUrl ?? coverUrl, previewUrl: previewLiteUrl ?? previewUrl, animUrl: previewAnimUrl }));
  return <CinematicHero items={items} newVideoHref="/create" />;
}

/** Same size as the hero while the showcase loads, so the feed below does not jump. */
function HeroFallback() {
  return <div className="h-[37rem] md:h-[40rem]" aria-hidden />;
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
