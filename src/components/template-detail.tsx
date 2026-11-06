import { Flame } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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

export function TemplateDetailView({ t, cta, combo, staffUnits }: { t: TemplateDetail; cta?: React.ReactNode; combo?: ComboPart[]; staffUnits?: string | null }) {
  return (
    <div className="mt-3 grid gap-5 md:mt-6 md:grid-cols-[minmax(0,360px)_1fr] md:gap-12">
      {combo ? <ComboGrid parts={combo} /> : (
      <>
      {/* On phones the sample is capped so the photo step stays close; the title sits on the video. */}
      {/* The sample in its original proportions (vertical, square or horizontal), never cropped. */}
      <figure className="mx-auto w-full md:sticky md:top-24 md:self-start">
        {/* The box is sized from the stored video proportions before anything loads: no jump. */}
        <div
          style={{ "--a": String(t.videoAspect ?? 9 / 16), aspectRatio: String(t.videoAspect ?? 9 / 16) } as React.CSSProperties}
          className="relative mx-auto w-[min(100%,calc(58svh*var(--a)))] overflow-hidden rounded-[1.75rem] bg-night ring-1 ring-black/5 elev-lg md:w-[min(100%,calc(80vh*var(--a)))]">
          {t.previewUrl ? (
            <AutoVideo src={t.previewUrl} poster={t.coverUrl ?? undefined} soundToggle preferSound className="block h-full w-full object-cover" />
          ) : t.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={t.coverUrl} alt="" className="block h-full w-full object-cover" />
          ) : null}
          <span className="glass t-micro absolute left-3 top-3 rounded-full px-3 py-1.5 text-night">
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
          <h1 className="t-display mt-2">{t.title}</h1>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {t.startingPriceKzt !== null && <Badge tone="dark" className="!text-sm !px-3.5 !py-1.5">{formatKzt(t.startingPriceKzt)} {kk.catalog.from}</Badge>}
            {t.isTrending && <Badge tone="brand" icon={<Flame size={13} strokeWidth={2.6} aria-hidden />} className="!text-sm !px-3.5 !py-1.5">{kk.catalog2.trendBadge}</Badge>}
            {staffUnits && <Badge tone="neutral">{staffUnits}</Badge>}
          </div>
        </div>
        {/* Phones: title, facts and how it works, right under the sample */}
        <div className="md:hidden">
          <div className="flex items-start justify-between gap-3">
            <h1 className="t-h1">{t.title}</h1>
            {t.startingPriceKzt !== null && <span className="mt-1 shrink-0 rounded-full bg-night px-3.5 py-1.5 text-sm font-extrabold text-white elev-sm">{formatKzt(t.startingPriceKzt)}</span>}
          </div>
          {staffUnits && <p className="mt-2 text-sm font-semibold text-night">{staffUnits}</p>}
          {t.description && <p className="t-small mt-2 text-muted">{t.description}</p>}
          {(combo || t.isTrending) && (
            <ul className="mt-3 flex flex-wrap gap-1.5 text-[12px] font-semibold">
              {combo && <li className="rounded-full bg-brand px-2.5 py-1 text-night">{kk.combo.badge(combo.length)}</li>}
              {t.isTrending && <li><Badge tone="brand" icon={<Flame size={12} strokeWidth={2.6} aria-hidden />}>{kk.catalog2.trendBadge}</Badge></li>}
            </ul>
          )}
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
