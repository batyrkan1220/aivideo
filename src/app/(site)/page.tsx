import { Suspense } from "react";
import { connection } from "next/server";
import { kk } from "@/lib/i18n/kk";
import { listCategories, listTemplates } from "@/lib/templates/queries";
import { CategoryChips, GridSkeleton, pickCard } from "@/components/catalog-bits";
import { VideoFeed } from "@/components/video-feed";
import { HeroShowcase } from "@/components/hero-showcase";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { DesktopOnly } from "@/components/desktop-only";
import { getSessionUser } from "@/lib/auth/session";
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

      {/* Phones / Mini App: brand bar (Telegram hides the site header) + a light, text-only hero (no videos) */}
      <section className="mx-auto max-w-6xl px-4 pt-3 md:hidden">
        <div className="tg-only">
          <div className="mb-3 flex items-center">
            <Logo className="text-base" />
          </div>
          <Suspense fallback={<div className="mb-3 h-12" />}>
            <Greeting />
          </Suspense>
        </div>
        <TextHero />
      </section>

      <Suspense fallback={<div className="mx-auto mt-4 max-w-6xl px-4"><GridSkeleton /></div>}>
        <Feed searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

/** Phone hero: dark "metric" card (chartreuse progress ring + stat list) — pure CSS/SVG, no media. */
function TextHero() {
  const H = kk.home;
  const r = 34, c = 2 * Math.PI * r;
  return (
    <div className="relative overflow-hidden rounded-[28px] bg-night p-5 text-white shadow-[0_24px_48px_-28px_rgba(22,22,22,0.7)]">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white/80">
            <span className="h-1.5 w-1.5 rounded-full bg-[#d7f443]" aria-hidden />
            {H.heroBadge}
          </span>
          <h1 className="mt-3 text-[27px] font-extrabold leading-[1.08] tracking-tight">
            {H.heroLine1} <span className="text-[#d7f443]">{H.heroLine2}</span>
          </h1>
        </div>
        {/* progress ring: "3 min" */}
        <div className="relative h-[84px] w-[84px] shrink-0" aria-hidden>
          <svg viewBox="0 0 84 84" className="h-full w-full -rotate-90">
            <circle cx="42" cy="42" r={r} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="8" />
            <circle cx="42" cy="42" r={r} fill="none" stroke="#d7f443" strokeWidth="8" strokeLinecap="round" strokeDasharray={`${c * 0.72} ${c}`} />
          </svg>
          <span className="absolute inset-0 flex flex-col items-center justify-center leading-none">
            <span className="text-[22px] font-extrabold">3</span>
            <span className="mt-0.5 text-[10px] font-medium text-white/60">{H.heroRingUnit}</span>
          </span>
        </div>
      </div>
      <p className="mt-3 text-[14px] leading-snug text-white/65">{H.heroText}</p>
      <dl className="mt-4 divide-y divide-white/10 rounded-2xl bg-white/[0.06] px-4">
        {H.heroStats.map((st) => (
          <div key={st.k} className="flex items-center justify-between py-2.5 text-[13px]">
            <dt className="text-white/60">{st.k}</dt>
            <dd className="font-semibold">{st.v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 grid grid-cols-[1.4fr_1fr] gap-2">
        <a href="#templates" className="btn-lime flex h-12 items-center justify-center rounded-full text-[15px] font-extrabold">{H.heroPick} ↓</a>
        <Link href="/photos" className="flex h-12 items-center justify-center rounded-full bg-white/10 text-[15px] font-semibold text-white active:bg-white/20">📸 {H.heroPhoto}</Link>
      </div>
    </div>
  );
}

/** Friendly greeting for a signed-in customer (Mini App header). */
async function Greeting() {
  const user = await getSessionUser();
  const name = user?.displayName?.trim().split(/\s+/)[0];
  return (
    <div className="mb-3">
      <p className="text-[13px] font-medium text-muted">{kk.home.greetingSub}</p>
      <p className="text-[22px] font-extrabold leading-tight tracking-tight">{name ? kk.home.greeting(name) : kk.home.greetingGuest}</p>
    </div>
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

async function Showcase() {
  const items = (await resolveShowcase()).map(({ id, title, coverUrl, previewUrl }) => ({ id, title, coverUrl, previewUrl }));
  return <HeroShowcase items={items} />;
}
