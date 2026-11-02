import { Suspense } from "react";
import { notFound } from "next/navigation";
import { kk } from "@/lib/i18n/kk";
import { env } from "@/lib/env";
import { getTemplate, listTemplates, type TemplateDetail } from "@/lib/templates/queries";
import { botUsername } from "@/lib/partners";
import { TelegramIcon } from "@/components/telegram-icon";
import { getSessionUser } from "@/lib/auth/session";
import { isGuestEmail } from "@/lib/telegram/session";
import { isFreeOrderUser } from "@/lib/orders/free";
import { formatKzt } from "@/lib/pricing";
import { track } from "@/lib/analytics";
import { AutoVideo } from "@/components/auto-video";
import { CreateFlow } from "@/components/create-flow";
import { LogoMark } from "@/components/logo";

const L = kk.landing;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const t = await getTemplate((await params).id).catch(() => null);
  return { title: t ? L.metaTitle(t.title) : kk.brand.name, robots: { index: false } };
}

/**
 * Ad landing for one template (admin → "Реклама" link): the sample, one promise, three trust
 * points and the order form — nothing else to click away to.
 */
export default function LandingPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="mx-auto w-full max-w-md px-4 pb-6 pt-3">
      <Suspense fallback={<div className="mt-10 aspect-[9/16] w-full animate-pulse rounded-[1.75rem] bg-line" />}>
        <Body params={params} />
      </Suspense>
    </main>
  );
}

async function Body({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTemplate(id);
  if (!t || t.comboIds) notFound();
  void track("template_viewed", { templateId: t.id, props: { landing: true } });
  const a = t.videoAspect ?? 9 / 16;
  const photo = t.media === "photo";

  return (
    <>
      {/* Brand + speed promise, one line */}
      <header className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[15px] font-extrabold tracking-tight text-[#283040]"><LogoMark className="!h-[1.6em]" />TrendMe</span>
        <span className="rounded-full bg-brand-soft px-2.5 py-1 text-[11px] font-bold text-night">⚡ {L.speed}</span>
      </header>

      {/* The sample, in its real shape, with sound on tap */}
      <figure className="mt-3">
        <div
          style={{ "--a": String(a), aspectRatio: String(a) } as React.CSSProperties}
          className="relative mx-auto w-[min(100%,calc(56svh*var(--a)))] overflow-hidden rounded-[1.75rem] bg-night shadow-[0_24px_60px_-24px_rgba(0,0,0,0.45)] ring-1 ring-black/5">
          {t.previewUrl
            ? <AutoVideo src={t.previewUrl} poster={t.coverUrl ?? undefined} soundToggle className="block h-full w-full object-cover" />
            // eslint-disable-next-line @next/next/no-img-element
            : t.coverUrl ? <img src={t.coverUrl} alt="" className="block h-full w-full object-cover" /> : null}
          <span className="absolute left-3 top-3 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-night">{photo ? kk.photos.sample : kk.catalog.sample}</span>
          {t.startingPriceKzt !== null && (
            <span className="absolute bottom-3 left-3 rounded-full bg-night/85 px-3 py-1.5 text-sm font-extrabold text-white backdrop-blur">
              {formatKzt(t.startingPriceKzt)}
            </span>
          )}
        </div>
      </figure>

      {/* One promise */}
      <h1 className="mt-5 text-center text-[26px] font-extrabold leading-[1.1] tracking-tight">
        {L.title1} <span className="rounded-lg bg-brand px-1.5">{L.titleAccent}</span>
      </h1>
      <p className="mt-2 text-center text-[15px] text-muted">{photo ? L.leadPhoto(t.title) : L.lead(t.title)}</p>

      {/* Three trust points */}
      <ul className="mt-4 grid grid-cols-3 gap-2 text-center">
        {L.points.map((p) => (
          <li key={p.t} className="rounded-2xl bg-surface px-1.5 py-2.5 ring-1 ring-line">
            <span className="block text-xl" aria-hidden>{p.i}</span>
            <span className="mt-0.5 block text-[12px] font-bold leading-tight">{p.t}</span>
            <span className="block text-[11px] leading-tight text-muted">{p.d}</span>
          </li>
        ))}
      </ul>

      {/* The order form */}
      <div className="mt-5" id="order">
        <Suspense fallback={<div className="h-64 animate-pulse rounded-card bg-line" />}>
          <Order t={t} />
        </Suspense>
      </div>

      {/* Second chance: other trends here, or all of them in the Telegram app */}
      <Suspense fallback={null}>
        <More currentId={t.id} />
      </Suspense>

      {/* Short answers to what stops people */}
      <section className="mt-6 space-y-2">
        {L.faq.map((f) => (
          <details key={f.q} className="group rounded-2xl bg-surface px-4 py-3 ring-1 ring-line">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[14px] font-bold">
              {f.q}<span className="text-muted transition-transform group-open:rotate-45" aria-hidden>+</span>
            </summary>
            <p className="mt-2 text-sm text-muted">{f.a}</p>
          </details>
        ))}
      </section>
      <p className="mt-6 text-center text-[11px] text-muted">© TrendMe · <a href="/terms" className="underline-offset-2 hover:underline">{L.terms}</a> · <a href="/privacy" className="underline-offset-2 hover:underline">{L.privacy}</a></p>
    </>
  );
}

async function Order({ t }: { t: TemplateDetail }) {
  if (!t.priced) return <p className="rounded-card border border-line bg-surface p-5 text-sm text-muted">{kk.template.pricePending}</p>;
  const user = await getSessionUser();
  const e = env();
  return (
    <CreateFlow
      templateId={t.id}
      slots={t.faceSlots}
      qualities={t.qualities}
      pricing={t.pricing}
      maxUploadBytes={Math.min(t.maxUploadBytes, e.UPLOAD_MAX_BYTES)}
      minDimension={e.UPLOAD_MIN_DIMENSION}
      maxDimension={e.UPLOAD_MAX_DIMENSION}
      supabaseUrl={e.NEXT_PUBLIC_SUPABASE_URL}
      anonKey={e.NEXT_PUBLIC_SUPABASE_ANON_KEY}
      askPhone={e.PAYMENT_PROVIDER === "tole" || e.PAYMENT_PROVIDER === "tole_sandbox"}
      freeOrders={user ? await isFreeOrderUser(user.id) : false}
      signedIn={!!user}
      needTelegram={!user || isGuestEmail(user.email)}
      framing={t.photoFraming}
      allowWish={t.allowWish}
      outfit={t.outfit}
      media={t.media}
      noTabBar
    />
  );
}

/** Other trending templates (each opens its own landing) + an invitation to the Telegram app. */
async function More({ currentId }: { currentId: string }) {
  const [{ items, total }, bot] = await Promise.all([
    listTemplates({ page: 1, sort: "trending", media: "video" }),
    botUsername().catch(() => null),
  ]);
  const others = items.filter((x) => x.id !== currentId).slice(0, 8);
  if (!others.length && !bot) return null;
  return (
    <section className="mt-7">
      {others.length > 0 && (
        <>
          <div className="flex items-baseline justify-between">
            <h2 className="text-[17px] font-extrabold tracking-tight">{L.moreTitle}</h2>
            <span className="text-xs font-semibold text-muted">{L.moreCount(total)}</span>
          </div>
          <ul className="no-scrollbar -mx-4 mt-2.5 flex snap-x gap-2.5 overflow-x-auto px-4 pb-1">
            {others.map((x) => (
              <li key={x.id} className="w-[8.5rem] shrink-0 snap-start">
                <a href={`/go/${x.id}`} className="block">
                  <span className="relative block aspect-[3/4] overflow-hidden rounded-[14px] bg-night ring-1 ring-black/5">
                    {(x.coverThumbUrl ?? x.coverUrl) && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={x.coverThumbUrl ?? x.coverUrl ?? ""} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                    )}
                    <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2 pt-6 text-white">
                      <span className="line-clamp-2 block text-[12px] font-bold leading-tight">{x.title}</span>
                      {x.startingPriceKzt !== null && <span className="mt-0.5 block text-[11px] font-extrabold text-brand">{formatKzt(x.startingPriceKzt)}</span>}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
      {bot && (
        <a href={`https://t.me/${bot}?startapp=home`} rel="noopener"
          className="mt-4 flex items-center gap-3 rounded-[22px] bg-[#2AABEE] p-4 text-white shadow-[0_14px_32px_-16px_rgba(42,171,238,0.9)] transition-transform active:scale-[0.99]">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/20"><TelegramIcon className="h-6 w-6" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-extrabold leading-tight">{L.tgTitle}</span>
            <span className="mt-0.5 block text-[12px] leading-snug text-white/85">{L.tgText}</span>
          </span>
          <span className="text-xl" aria-hidden>›</span>
        </a>
      )}
    </section>
  );
}
