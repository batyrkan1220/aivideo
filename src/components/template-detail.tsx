import Link from "next/link";
import { kk } from "@/lib/i18n/kk";
import type { TemplateDetail } from "@/lib/templates/queries";
import { calculatePrice, formatKzt } from "@/lib/pricing";
import { FaceMap } from "@/components/face-map";

/** Per-quality prices (server-computed). Shown to guests and in admin preview. */
export function QualityPriceList({ t }: { t: TemplateDetail }) {
  return (
    <section>
      <h2 className="font-semibold">{kk.template.qualitiesTitle}</h2>
      <ul className="mt-3 divide-y divide-line rounded-card border border-line bg-white">
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
    <div className="mt-6 grid gap-8 md:grid-cols-[minmax(0,360px)_1fr] md:gap-12">
      {/* On phones the sample is capped to ~2/3 of the screen height so the price and upload stay close. */}
      <figure className="mx-auto w-full max-w-[min(100%,calc(66svh*9/16))] md:sticky md:top-24 md:max-w-none md:self-start">
        <div className="relative aspect-[9/16] overflow-hidden rounded-card bg-ink">
          {t.previewUrl ? (
            <video
              src={t.previewUrl}
              poster={t.coverUrl ?? undefined}
              controls
              muted
              loop
              playsInline
              preload="metadata"
              className="h-full w-full object-cover"
            />
          ) : t.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={t.coverUrl} alt="" className="h-full w-full object-cover" />
          ) : null}
          <span className="absolute left-3 top-3 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-ink">
            {kk.catalog.sample}
          </span>
        </div>
        <figcaption className="mt-3 text-sm text-muted">{kk.template.sampleNote}</figcaption>
      </figure>

      <div className="min-w-0">
        {t.category && (
          <Link href={`/templates?category=${t.category.slug}`} className="text-sm font-semibold text-brand hover:underline">
            {t.category.title}
          </Link>
        )}
        <h1 className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl">{t.title}</h1>
        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          {t.startingPriceKzt !== null && (
            <span className="rounded-full bg-ink px-3 py-1.5 font-semibold text-white">
              {formatKzt(t.startingPriceKzt)} {kk.catalog.from}
            </span>
          )}
          <span className="rounded-full border border-line bg-white px-3 py-1.5 font-medium">{kk.catalog.faces(t.faceCount)}</span>
          {t.isTrending && <span className="rounded-full bg-flash px-3 py-1.5 font-bold">{kk.catalog2.trendBadge}</span>}
        </div>
        {t.description && <p className="mt-5 max-w-prose text-lg text-muted">{t.description}</p>}

        {t.faceCount > 1 && (
          <section className="mt-8">
            <h2 className="font-semibold">{kk.template.facesTitle}</h2>
            <div className="mt-4">
              <FaceMap slots={t.faceSlots} />
            </div>
          </section>
        )}

        <div className="mt-8">
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
