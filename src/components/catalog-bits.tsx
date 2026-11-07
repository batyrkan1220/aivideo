import Link from "next/link";
import { kk } from "@/lib/i18n/kk";
import type { Category } from "@/lib/templates/queries";
import { TemplateCard, type CardData } from "./template-card";

/** mobileLimit: on phones only the first N cards are shown (hidden cards never load video). */
export function TemplateGrid({ items, priorityCount = 0, mobileLimit }: { items: CardData[]; priorityCount?: number; mobileLimit?: number }) {
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3 lg:grid-cols-6">
      {items.map((t, i) => (
        <li key={t.id} className={mobileLimit !== undefined && i >= mobileLimit ? "max-sm:hidden" : undefined}>
          <TemplateCard t={pickCard(t)} priority={i < priorityCount} />
        </li>
      ))}
    </ul>
  );
}

/** Send only what the card needs to the client bundle. */
export function pickCard(t: CardData & { coverThumbUrl?: string | null }): CardData {
  const { id, title, description, faceCount, qualityLabels, startingPriceKzt, coverUrl, previewUrl, previewLiteUrl, previewAnimUrl, isTrending } = t;
  return { id, title, description, faceCount, qualityLabels, startingPriceKzt, coverUrl: t.coverThumbUrl ?? coverUrl, previewUrl, previewLiteUrl, previewAnimUrl, isTrending };
}

export function SearchForm({ defaultValue = "", category }: { defaultValue?: string; category?: string }) {
  return (
    <form action="/templates" role="search" className="flex w-full max-w-xl items-center gap-2 rounded-full border border-line bg-surface p-1.5 pl-5 elev-xs transition-[border-color,box-shadow] focus-within:border-ink focus-within:shadow-[0_0_0_4px_rgba(22,22,22,0.08)]">
      {category && <input type="hidden" name="category" value={category} />}
      <label htmlFor="q" className="sr-only">{kk.nav.search}</label>
      <input
        id="q"
        name="q"
        type="search"
        defaultValue={defaultValue}
        placeholder={kk.catalog.searchPlaceholder}
        className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-faint"
      />
      <button className="btn-glow h-10 rounded-full px-5 text-sm font-semibold">
        {kk.nav.search}
      </button>
    </form>
  );
}

/** Category rail; keeps the current search/sort in the link. */
export function CategoryChips({
  categories, active, extraParams = {},
}: { categories: Category[]; active?: string; extraParams?: Record<string, string | undefined> }) {
  const href = (slug?: string) => {
    const p = new URLSearchParams();
    Object.entries({ ...extraParams, category: slug }).forEach(([k, v]) => v && p.set(k, v));
    const s = p.toString();
    return `/${s ? `?${s}` : ""}`;
  };
  const chip = (isActive: boolean) =>
    `inline-flex h-10 shrink-0 items-center rounded-full border px-4 text-sm font-semibold transition-[background-color,border-color,color,box-shadow,transform] duration-200 active:scale-95 ${
      isActive ? "border-ink bg-ink text-paper shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_6px_16px_-8px_rgb(14_14_14/0.5)]" : "border-line bg-surface text-ink/80 elev-xs hover:border-line-strong hover:text-ink"
    }`;
  return (
    <nav aria-label={kk.nav.categories} className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
      <Link href={href()} className={chip(!active)} aria-current={!active ? "page" : undefined}>{kk.catalog.all}</Link>
      {categories.map((c) => (
        <Link key={c.id} href={href(c.slug)} className={chip(active === c.slug)} aria-current={active === c.slug ? "page" : undefined}>
          {c.title}
        </Link>
      ))}
    </nav>
  );
}

export function SectionHeading({ title, href }: { title: string; href?: string }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <h2 className="t-h2">{title}</h2>
      {href && (
        <Link href={href} className="shrink-0 text-sm font-semibold text-brand hover:underline">
          {kk.home.seeAll}
        </Link>
      )}
    </div>
  );
}

export function GridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3 lg:grid-cols-6" aria-busy="true" aria-label={kk.common.loading}>
      {Array.from({ length: count }).map((_, i) => (
        <li key={i} className="skeleton aspect-[3/4] rounded-[1rem] sm:rounded-[1.25rem]" />
      ))}
    </ul>
  );
}
