import Link from "next/link";
import { kk } from "@/lib/i18n/kk";
import type { TemplateDetail } from "@/lib/templates/queries";
import { calculatePrice, formatKzt } from "@/lib/pricing";
import { AutoVideo } from "@/components/auto-video";

/** Per-quality prices (server-computed). Shown to guests and in admin preview. */
export function QualityPriceList({ t }: { t: TemplateDetail }) {
  const available = t.qualities.filter((q) => q.available);
  if (available.length === 1) {
    return (
      <section className="flex items-center justify-between gap-4 rounded-card border border-line bg-surface px-5 py-4">
        <h2 className="font-semibold">{kk.template.priceTitle}</h2>
        <p className="font-display text-xl font-bold">{formatKzt(calculatePrice(t.pricing, available[0], t.faceCount).totalKzt)}</p>
      </section>
    );
  }
  return (
    <section>
      <h2 className="font-semibold">{kk.template.qualitiesTitle}</h2>
      <ul className="mt-3 divide-y divide-line rounded-card border border-line bg-surface">
        {t.qualities.filter((q) => q.available).map((q) => {
          const price = calculatePrice(t.pricing, q, t.faceCount);
          const specs = [
            q.resolution,
            q.fps ? `${q.fps} ${kk.template.fps}` : null,
            q.maxDurationSec ? kk.template.upToSec(q.maxDurationSec) : null,
          ].filter(Boolean).join(", ");
          return (
            <li key={q.key} className="flex items-center justify-between gap-4 px-5 py-4">
              <div>
                <p className="font-medium">{q.labelKk}</p>
                {specs && <p className="text-sm text-muted">{specs}</p>}
              </div>
              <p className="font-display font-semibold">{formatKzt(price.totalKzt)}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

type ComboPart = { id: string; title: string; cover: string | null };

export function TemplateDetailView({ t, cta, combo }: { t: TemplateDetail; cta?: React.ReactNode; combo?: ComboPart[] }) {
  return (
    <div className="mt-3 grid gap-5 md:mt-6 md:grid-cols-[minmax(0,360px)_1fr] md:gap-12">
      {combo ? <ComboGrid parts={combo} /> : (
      <>
      {/* On phones the sample is capped so the photo step stays close; the title sits on the video. */}
      <figure className="mx-auto w-full max-w-[min(100%,calc(60svh*9/16))] md:sticky md:top-24 md:max-w-none md:self-start">
        <div className="relative aspect-[9/16] overflow-hidden rounded-[1.75rem] bg-night shadow-[0_24px_60px_-24px_rgba(0,0,0,0.35)] ring-1 ring-black/5">
          {t.previewUrl ? (
            <AutoVideo src={t.previewUrl} poster={t.coverUrl ?? undefined} soundToggle preferSound className="h-full w-full object-cover" />
          ) : t.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={t.coverUrl} alt="" className="h-full w-full object-cover" />
          ) : null}
          <span className="absolute left-3 top-3 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-night">
            {t.media === "photo" ? kk.photos.sample : kk.catalog.sample}
          </span>
        </div>
        <figcaption className="mt-3 hidden text-sm text-muted md:block">{kk.template.sampleNote}</figcaption>
      </figure>
      </>
      )}

      <div className="min-w-0">
        <div className="hidden md:block">
          {t.category && (
            <Link href={`/?category=${t.category.slug}`} className="text-sm font-semibold text-brand hover:underline">
              {t.category.title}
            </Link>
          )}
          <h1 className="mt-2 font-display text-4xl font-bold tracking-tight">{t.title}</h1>
          <div className="mt-4 flex flex-wrap gap-2 text-sm">
            {t.startingPriceKzt !== null && (
              <span className="rounded-full bg-ink px-3 py-1.5 font-semibold text-paper">
                {formatKzt(t.startingPriceKzt)} {kk.catalog.from}
              </span>
            )}
            <span className="rounded-full border border-line bg-surface px-3 py-1.5 font-medium">{kk.catalog.faces(t.faceCount)}</span>
            {t.isTrending && <span className="rounded-full bg-flash px-3 py-1.5 font-bold text-night">{kk.catalog2.trendBadge}</span>}
          </div>
        </div>
        {/* Phones: title, facts and how it works, right under the sample */}
        <div className="md:hidden">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-[26px] font-extrabold leading-tight tracking-tight">{t.title}</h1>
            {t.startingPriceKzt !== null && <span className="mt-1 shrink-0 rounded-full bg-ink px-3 py-1.5 text-sm font-extrabold text-paper">{formatKzt(t.startingPriceKzt)}</span>}
          </div>
          {t.description && <p className="mt-1 text-sm text-muted">{t.description}</p>}
          <ul className="mt-3 flex flex-wrap gap-1.5 text-[12px] font-semibold">
            {combo ? <li className="rounded-full bg-brand px-2.5 py-1 text-night">{kk.combo.badge(combo.length)}</li>
              : <li className="rounded-full bg-surface px-2.5 py-1 ring-1 ring-line">👤 {kk.catalog.faces(t.faceCount)}</li>}
            {t.media === "video" && t.durationSec ? <li className="rounded-full bg-surface px-2.5 py-1 ring-1 ring-line">⏱ ≈ {Math.round(t.durationSec)} {kk.template.sec}</li> : null}
            <li className="rounded-full bg-surface px-2.5 py-1 ring-1 ring-line">{t.media === "photo" ? "📸 2K" : "🎬 HD 720p"}</li>
            {t.isTrending && <li className="rounded-full bg-brand px-2.5 py-1 text-night">🔥 {kk.catalog2.trendBadge}</li>}
          </ul>
          <ol className="mt-4 grid grid-cols-3 gap-2 text-[12px]">
            {(combo ? kk.combo.how(combo.length) : t.media === "photo" ? kk.template.howPhoto : kk.template.howVideo).map((x, i) => (
              <li key={x} className="rounded-2xl bg-surface p-2.5 ring-1 ring-line">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-[11px] font-extrabold text-night">{i + 1}</span>
                <span className="mt-1.5 block font-semibold leading-snug">{x}</span>
              </li>
            ))}
          </ol>
        </div>
        {t.description && <p className="hidden max-w-prose text-muted md:mt-5 md:block md:text-lg">{t.description}</p>}


        <div className="mt-5 md:mt-8">
          {cta ?? (
            <>
              <QualityPriceList t={t} />
              <p className="mt-6 rounded-card bg-brand-soft p-5 text-sm text-muted">{kk.template.uploadSoon}</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Photo combo: every photo of the set as a numbered grid (the customer gets all of them). */
function ComboGrid({ parts }: { parts: ComboPart[] }) {
  return (
    <figure className="w-full md:sticky md:top-24 md:self-start">
      <ul className="grid grid-cols-3 gap-2">
        {parts.map((p, i) => (
          <li key={p.id} className="relative aspect-[3/4] overflow-hidden rounded-[18px] bg-night ring-1 ring-line">
            {p.cover
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={p.cover} alt={p.title} loading={i < 6 ? "eager" : "lazy"} className="h-full w-full object-cover" />
              : <span className="flex h-full items-center justify-center text-2xl" aria-hidden>📸</span>}
            <span className="absolute left-1.5 top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-white/90 px-1 text-[10px] font-extrabold text-night">{i + 1}</span>
          </li>
        ))}
      </ul>
      <figcaption className="mt-2 text-[12px] text-muted">{kk.combo.gridNote}</figcaption>
    </figure>
  );
}
