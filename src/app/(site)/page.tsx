import { Suspense } from "react";
import { connection } from "next/server";
import { kk } from "@/lib/i18n/kk";
import { listCategories, listNewest, listPopular, listTrending } from "@/lib/templates/queries";
import { CategoryChips, GridSkeleton, SearchForm, SectionHeading, TemplateGrid } from "@/components/catalog-bits";
import { HeroShowcase } from "@/components/hero-showcase";

export default function HomePage({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  return (
    <main>
      <Suspense fallback={null}>
        <Notice searchParams={searchParams} />
      </Suspense>
      <section className="mx-auto grid max-w-6xl items-center gap-8 px-4 pb-10 pt-10 sm:pt-16 md:grid-cols-[1.15fr_0.85fr]">
        <div>
          <h1 className="max-w-3xl font-display text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
            {kk.home.title}
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted">{kk.home.lead}</p>
          <div className="mt-8">
            <SearchForm />
          </div>
          <div className="mt-6">
            <Suspense fallback={<div className="h-10" />}>
              <Categories />
            </Suspense>
          </div>
        </div>
        <div className="hidden md:block">
          <Suspense fallback={<div className="h-[30rem]" />}>
            <Showcase />
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
  const [trending, popular, latest] = await Promise.all([listTrending(8), listPopular(8), listNewest(12)]);
  // Don't show the same template twice on one screen.
  const shown = new Set([...trending, ...popular].map((t) => t.id));
  const newest = latest.filter((t) => !shown.has(t.id)).slice(0, 8);

  if (!trending.length && !latest.length) {
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
          <SectionHeading title={kk.home.trendingTitle} href="/templates?sort=trending" />
          <TemplateGrid items={trending} priorityCount={4} />
        </section>
      )}
      {popular.length > 0 && (
        <section>
          <SectionHeading title={kk.home.popularTitle} />
          <TemplateGrid items={popular} />
        </section>
      )}
      {newest.length > 0 && (
        <section>
          <SectionHeading title={kk.home.newTitle} href="/templates" />
          <TemplateGrid items={newest} priorityCount={trending.length ? 0 : 4} />
        </section>
      )}
    </div>
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
  const [trending, latest] = await Promise.all([listTrending(3), listNewest(3)]);
  const pick = [...trending, ...latest.filter((t) => !trending.some((x) => x.id === t.id))]
    .filter((t) => t.coverUrl || t.previewUrl).slice(0, 3)
    .map(({ id, title, coverUrl, previewUrl }) => ({ id, title, coverUrl, previewUrl }));
  return <HeroShowcase items={pick} />;
}
