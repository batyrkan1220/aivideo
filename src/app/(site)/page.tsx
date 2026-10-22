import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { kk } from "@/lib/i18n/kk";
import { listCategories, listTemplates, listTrending } from "@/lib/templates/queries";
import { CategoryChips, GridSkeleton, SectionHeading, TemplateGrid, pickCard } from "@/components/catalog-bits";
import { VideoFeed } from "@/components/video-feed";
import { HeroShowcase } from "@/components/hero-showcase";
import { resolveShowcase } from "@/lib/templates/showcase";

export default function HomePage({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  return (
    <main>
      <Suspense fallback={null}>
        <Notice searchParams={searchParams} />
      </Suspense>
      {/* Phones: title → video showcase → categories. Desktop: text left, showcase right. */}
      <section className="mx-auto grid max-w-6xl gap-x-8 gap-y-6 px-4 pb-10 pt-8 sm:pt-16 md:grid-cols-[1.15fr_0.85fr] md:grid-rows-[auto_auto]">
        <div className="min-w-0 md:col-start-1 md:row-start-1 md:self-end">
          <h1 className="max-w-3xl font-display text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
            {kk.home.title}
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted">{kk.home.lead}</p>
        </div>
        <div className="min-w-0 md:col-start-2 md:row-span-2 md:row-start-1 md:self-center">
          <Suspense fallback={<div className="h-[21rem] sm:h-[26rem] md:h-[30rem]" />}>
            <Showcase />
          </Suspense>
        </div>
        {/* min-w-0: the scrollable category rail must not widen the grid column (and the phone's layout viewport) */}
        <div className="min-w-0 md:col-start-1 md:row-start-2 md:self-start">
          <Suspense fallback={<div className="h-10" />}>
            <Categories />
          </Suspense>
        </div>
      </section>

      <Suspense fallback={<div className="mx-auto max-w-6xl px-4"><GridSkeleton /></div>}>
        <Sections />
      </Suspense>

      <section className="mx-auto mt-20 max-w-6xl px-4">
        <h2 className="font-display text-xl font-bold sm:text-2xl">{kk.home.howTitle}</h2>
        <ol className="mt-6 grid gap-6 sm:grid-cols-3">
          {kk.home.steps.map((s, i) => (
            <li key={s.t} className="border-t-2 border-ink pt-4">
              <span className="font-display text-3xl font-bold text-brand">{i + 1}</span>
              <h3 className="mt-2 font-semibold">{s.t}</h3>
              <p className="mt-1 text-sm text-muted">{s.d}</p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

async function Categories() {
  await connection(); // always fresh — admins publish templates at any time
  return <CategoryChips categories={await listCategories()} />;
}

async function Sections() {
  await connection();
  const [trending, all] = await Promise.all([listTrending(8), listTemplates({ page: 1 })]);

  if (!trending.length && !all.items.length) {
    return (
      <div className="mx-auto max-w-6xl px-4">
        <div className="rounded-card border border-dashed border-line bg-white px-6 py-16 text-center">
          <h2 className="font-display text-xl font-bold">{kk.home.emptyTitle}</h2>
          <p className="mx-auto mt-2 max-w-md text-muted">{kk.home.emptyText}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-14 px-4">
      {trending.length > 0 && (
        <section>
          <SectionHeading title={kk.home.trendingTitle} />
          <TemplateGrid items={trending} priorityCount={4} mobileLimit={4} />
        </section>
      )}
      {/* Phones: only a few videos, then a button to the full video catalog. */}
      {!trending.length && (
        <section className="sm:hidden">
          <TemplateGrid items={all.items.slice(0, 4)} priorityCount={4} />
        </section>
      )}
      <MobileAllVideos />
      {/* Desktop: one endless feed of all videos, loaded page by page while scrolling. */}
      {all.items.length > 0 && (
        <section className="max-sm:hidden">
          <VideoFeed
            title={kk.home.allVideos}
            initial={all.items.map(pickCard)}
            initialHasMore={all.items.length < all.total}
            exclude={trending.map((t) => t.id)}
          />
        </section>
      )}
    </div>
  );
}

function MobileAllVideos() {
  return (
    <Link
      href="/templates"
      className="flex h-12 items-center justify-center gap-2 rounded-full bg-ink text-base font-semibold text-white sm:hidden"
    >
      {kk.home.allVideos} <span aria-hidden>→</span>
    </Link>
  );
}

async function Notice({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
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
