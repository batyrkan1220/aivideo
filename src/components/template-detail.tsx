import Link from "next/link";
import { kk } from "@/lib/i18n/kk";
import type { TemplateDetail } from "@/lib/templates/queries";
import { calculatePrice, formatKzt } from "@/lib/pricing";
import { FaceMap } from "@/components/face-map";
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

export function TemplateDetailView({ t, cta }: { t: TemplateDetail; cta?: React.ReactNode }) {
  return (
    <div className="mt-3 grid gap-5 md:mt-6 md:grid-cols-[minmax(0,360px)_1fr] md:gap-12">
      {/* On phones the sample is capped so the photo step stays close; the title sits on the video. */}
      <figure className="mx-auto w-full max-w-[min(100%,calc(52svh*9/16))] md:sticky md:top-24 md:max-w-none md:self-start">
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
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-4 pt-16 text-white md:hidden">
            <p className="font-display text-xl font-bold leading-tight">{t.title}</p>
            <p className="mt-2 flex flex-wrap gap-1.5 text-xs">
              {t.startingPriceKzt !== null && <span className="rounded-full bg-surface px-2.5 py-1 font-bold text-ink">{formatKzt(t.startingPriceKzt)}</span>}
              <span className="rounded-full bg-white/20 px-2.5 py-1 font-medium backdrop-blur-sm">{kk.catalog.faces(t.faceCount)}</span>
              {t.isTrending && <span className="rounded-full bg-flash px-2.5 py-1 font-bold text-night">{kk.catalog2.trendBadge}</span>}
            </p>
          </div>
        </div>
        <figcaption className="mt-3 hidden text-sm text-muted md:block">{kk.template.sampleNote}</figcaption>
      </figure>

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
        <h1 className="sr-only md:hidden">{t.title}</h1>
        {t.description && <p className="max-w-prose text-muted md:mt-5 md:text-lg">{t.description}</p>}

        {t.faceCount > 1 && (
          <section className="mt-6 md:mt-8">
            <h2 className="font-semibold">{kk.template.facesTitle}</h2>
            <div className="mt-4">
              <FaceMap slots={t.faceSlots} />
            </div>
          </section>
        )}

        <div className={t.description || t.faceCount > 1 ? "mt-5 md:mt-8" : "md:mt-8"}>
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
