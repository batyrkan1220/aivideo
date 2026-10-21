import { Suspense } from "react";
import Link from "next/link";
import { kk } from "@/lib/i18n/kk";
import { listCategories, listTemplates, PAGE_SIZE, type CatalogSort } from "@/lib/templates/queries";
import { CategoryChips, GridSkeleton, SearchForm, TemplateGrid } from "@/components/catalog-bits";

export const metadata = { title: kk.catalog2.title };

type SP = { q?: string; category?: string; sort?: string; page?: string };

export default function CatalogPage({ searchParams }: { searchParams: Promise<SP> }) {
  return (
    <main className="mx-auto max-w-6xl px-4 pt-10">
      <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{kk.catalog2.title}</h1>
      <Suspense fallback={<div className="mt-8"><GridSkeleton /></div>}>
        <Catalog searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

function hrefWith(sp: SP, patch: Partial<SP>) {
  const p = new URLSearchParams();
  Object.entries({ ...sp, ...patch }).forEach(([k, v]) => v && p.set(k, v));
  const s = p.toString();
  return `/templates${s ? `?${s}` : ""}`;
}

async function Catalog({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const sort: CatalogSort = sp.sort === "trending" ? "trending" : "new";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const [categories, { items, total }] = await Promise.all([
    listCategories(),
    listTemplates({ q: sp.q, category: sp.category, sort, page }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = !!(sp.q || sp.category);
  const base: SP = { q: sp.q, category: sp.category, sort: sp.sort };

  const sortLink = (value: CatalogSort, label: string) => (
    <Link
      href={hrefWith(base, { sort: value === "new" ? undefined : value, page: undefined })}
      aria-current={sort === value ? "true" : undefined}
      className={`rounded-full px-4 py-2 text-sm font-medium ${sort === value ? "bg-brand-soft text-brand" : "text-muted hover:text-ink"}`}
    >
      {label}
    </Link>
  );

  return (
    <>
      <div className="mt-6 space-y-5">
        <SearchForm defaultValue={sp.q} category={sp.category} />
        <CategoryChips categories={categories} active={sp.category} extraParams={{ q: sp.q, sort: sp.sort }} />
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted" aria-live="polite">{kk.catalog2.results(total)}</p>
        <div className="flex gap-1">
          {sortLink("new", kk.catalog2.sortNew)}
          {sortLink("trending", kk.catalog2.sortTrending)}
        </div>
      </div>

      <div className="mt-5">
        {items.length ? (
          <TemplateGrid items={items} priorityCount={4} />
        ) : (
          <div className="rounded-card border border-dashed border-line bg-white px-6 py-16 text-center">
            <p className="mx-auto max-w-md text-muted">{filtered ? kk.catalog2.noResults : kk.home.emptyText}</p>
            {filtered && (
              <Link href="/templates" className="mt-4 inline-block font-semibold text-brand hover:underline">
                {kk.catalog2.reset}
              </Link>
            )}
          </div>
        )}
      </div>

      {pages > 1 && (
        <nav className="mt-10 flex items-center justify-center gap-4" aria-label={kk.catalog2.pageOf(page, pages)}>
          {page > 1 ? (
            <Link href={hrefWith(base, { page: String(page - 1) })} className="rounded-full border border-line bg-white px-5 py-2 text-sm font-medium hover:border-ink">
              {kk.catalog2.prev}
            </Link>
          ) : <span />}
          <span className="text-sm text-muted">{kk.catalog2.pageOf(page, pages)}</span>
          {page < pages ? (
            <Link href={hrefWith(base, { page: String(page + 1) })} className="rounded-full border border-line bg-white px-5 py-2 text-sm font-medium hover:border-ink">
              {kk.catalog2.next}
            </Link>
          ) : <span />}
        </nav>
      )}
    </>
  );
}
