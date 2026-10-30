import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { kk } from "@/lib/i18n/kk";
import { getTemplate } from "@/lib/templates/queries";
import { TemplateDetailView } from "@/components/template-detail";
import { formatKzt } from "@/lib/pricing";
import { track } from "@/lib/analytics";
import { CreateFlow } from "@/components/create-flow";
import { isFreeOrderUser } from "@/lib/orders/free";
import { getSessionUser } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { ButtonLink } from "@/components/ui/button";
import type { TemplateDetail } from "@/lib/templates/queries";

export default function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="mx-auto max-w-6xl px-4 pt-3 md:pt-8">
      <Link href="/" className="tg-hide -my-2 inline-block py-2 text-sm font-medium text-muted hover:text-ink">← {kk.template.back}</Link>
      <Suspense fallback={<div className="mt-6 aspect-[9/16] max-w-sm animate-pulse rounded-card bg-line" />}>
        <Detail params={params} />
      </Suspense>
    </main>
  );
}

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTemplate(id);
  if (!t) notFound();
  void track("template_viewed", { templateId: t.id });
  return (
    <TemplateDetailView
      t={t}
      cta={
        <Suspense fallback={<div className="h-64 animate-pulse rounded-card bg-line" />}>
          <CreateSection t={t} />
        </Suspense>
      }
    />
  );
}

async function CreateSection({ t }: { t: TemplateDetail }) {
  const user = await getSessionUser();
  if (!user) {
    const price = t.startingPriceKzt;
    const next = encodeURIComponent(`/templates/${t.id}`);
    return (
      <>
        <div className="rounded-card border border-line bg-surface p-5">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-semibold">{kk.template.priceTitle}</h2>
            {price !== null && <p className="font-display text-2xl font-bold">{formatKzt(price)}</p>}
          </div>
          <p className="mt-2 text-sm text-muted">{kk.create.loginText}</p>
          <div className="mt-4 hidden gap-3 sm:flex">
            <ButtonLink href={`/login?next=${next}`} size="lg">{kk.auth.login}</ButtonLink>
            <ButtonLink href={`/signup?next=${next}`} size="lg" variant="secondary">{kk.auth.signup}</ButtonLink>
          </div>
        </div>
        {/* Phones: one big action always in reach, above the bottom tab bar. */}
        <div className="fixed inset-x-3 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-30 rounded-[1.5rem] border border-black/5 px-3 py-3 shadow-[0_14px_36px_-14px_rgba(0,0,0,0.25)] glass sm:hidden">
          <ButtonLink href={`/signup?next=${next}`} size="lg" className="w-full">
            {kk.create.loginCta}{price !== null ? ` · ${formatKzt(price)}` : ""}
          </ButtonLink>
          <p className="mt-1.5 text-center text-xs text-muted">
            {kk.create.haveAccount} <a href={`/login?next=${next}`} className="font-semibold text-brand">{kk.auth.login}</a>
          </p>
        </div>
        <div className="h-28 sm:hidden" aria-hidden />
      </>
    );
  }
  if (!t.priced) {
    return <p className="rounded-card border border-line bg-surface p-5 text-sm text-muted">{kk.template.pricePending}</p>;
  }
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
      freeOrders={await isFreeOrderUser(user.id)}
      framing={t.photoFraming}
      allowWish={t.allowWish}
      media={t.media}
    />
  );
}
