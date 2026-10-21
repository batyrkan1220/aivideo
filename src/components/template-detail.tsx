import Link from "next/link";
import { kk } from "@/lib/i18n/kk";
import type { TemplateDetail } from "@/lib/templates/queries";
import { calculatePrice, formatKzt } from "@/lib/pricing";
import { FaceMap } from "@/components/face-map";

export function TemplateDetailView({ t }: { t: TemplateDetail }) {
  const available = t.qualities.filter((q) => q.available);

  return (
    <div className="mt-6 grid gap-10 md:grid-cols-[minmax(0,380px)_1fr]">
      <figure>
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

      <div>
        {t.category && (
          <Link href={`/templates?category=${t.category.slug}`} className="text-sm font-semibold text-brand hover:underline">
            {t.category.title}
          </Link>
        )}
        <h1 className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl">{t.title}</h1>
        {t.description && <p className="mt-4 max-w-prose text-lg text-muted">{t.description}</p>}

        <section className="mt-8">
          <h2 className="font-semibold">{kk.template.facesTitle}</h2>
          <p className="mt-1 text-sm text-muted">{kk.template.faceCount}: {t.faceCount}</p>
          <div className="mt-4">
            <FaceMap slots={t.faceSlots} />
          </div>
        </section>

        <section className="mt-8">
          <h2 className="font-semibold">{kk.template.qualitiesTitle}</h2>
          <ul className="mt-3 divide-y divide-line rounded-card border border-line bg-white">
            {available.map((q) => {
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

        <div className="mt-8 rounded-card bg-brand-soft p-5">
          <button
            disabled
            className="h-13 w-full rounded-full bg-brand px-7 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {kk.catalog.create}
          </button>
          <p className="mt-3 text-center text-sm text-muted">{kk.template.uploadSoon}</p>
        </div>
      </div>
    </div>
  );
}
