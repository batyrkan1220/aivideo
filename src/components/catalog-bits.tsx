import Link from "next/link";
import { kk } from "@/lib/i18n/kk";
import type { Category } from "@/lib/templates/queries";
import { TemplateCard, type CardData } from "./template-card";

/** mobileLimit: on phones only the first N cards are shown (hidden cards never load video). */
export function TemplateGrid({ items, priorityCount = 0, mobileLimit }: { items: CardData[]; priorityCount?: number; mobileLimit?: number }) {
  return (
    <ul className="grid grid-cols-3 gap-1.5 sm:gap-4 lg:grid-cols-4">
      {items.map((t, i) => (
        <li key={t.id} className={mobileLimit !== undefined && i >= mobileLimit ? "max-sm:hidden" : undefined}>
          <TemplateCard t={pickCard(t)} priority={i < priorityCount} />
        </li>
      ))}
    </ul>
  );
}

/** Send only what the card needs to the client bundle. */
export function pickCard(t: CardData): CardData {
  const { id, title, description, faceCount, qualityLabels, startingPriceKzt, coverUrl, previewUrl, isTrending } = t;
  return { id, title, description, faceCount, qualityLabels, startingPriceKzt, coverUrl, previewUrl, isTrending };
}

export function SearchForm({ defaultValue = "", category }: { defaultValue?: string; category?: string }) {
  return (
    <form action="/templates" role="search" className="flex w-full max-w-xl items-center gap-2 rounded-full border border-line bg-surface p-1.5 pl-5 focus-within:border-brand">
      {category && <input type="hidden" name="category" value={category} />}
      <label htmlFor="q" className="sr-only">{kk.nav.search}</label>
      <input
        id="q"
        name="q"
        type="search"
        defaultValue={defaultValue}
        placeholder={kk.catalog.searchPlaceholder}
        className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted"
      />
      <button className="h-10 rounded-full bg-ink px-5 text-sm font-semibold text-paper hover:bg-brand">
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
    `shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors active:scale-95 sm:px-4 sm:py-2 sm:text-sm sm:font-medium ${
      isActive ? "btn-glow border-transparent text-white" : "border-white/10 bg-surface/70 text-ink/85 hover:border-white/25"
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
      <h2 className="font-display text-xl font-bold tracking-tight sm:text-2xl">{title}</h2>
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
    <ul className="grid grid-cols-3 gap-1.5 sm:gap-4 lg:grid-cols-4" aria-busy="true" aria-label={kk.common.loading}>
      {Array.from({ length: count }).map((_, i) => (
        <li key={i} className="aspect-[9/16] animate-pulse rounded-xl bg-line sm:rounded-card" />
      ))}
    </ul>
  );
}
