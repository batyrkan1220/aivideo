import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { kk } from "@/lib/i18n/kk";
import { getTemplate } from "@/lib/templates/queries";
import { TemplateDetailView, QualityPriceList } from "@/components/template-detail";
import { track } from "@/lib/analytics";
import { CreateFlow } from "@/components/create-flow";
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
    return (
      <div className="space-y-6">
      <QualityPriceList t={t} />
      <div className="rounded-card bg-brand-soft p-6">
        <h2 className="font-display text-lg font-bold">{kk.create.loginTitle}</h2>
        <p className="mt-1 text-sm text-muted">{kk.create.loginText}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <ButtonLink href={`/login?next=/templates/${t.id}`} size="lg">{kk.auth.login}</ButtonLink>
          <ButtonLink href={`/signup?next=/templates/${t.id}`} size="lg" variant="secondary">{kk.auth.signup}</ButtonLink>
        </div>
      </div>
      </div>
    );
  }
  if (!t.priced) {
    return <p className="rounded-card border border-line bg-white p-5 text-sm text-muted">{kk.template.pricePending}</p>;
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
      framing={t.photoFraming}
      allowWish={t.allowWish}
    />
  );
}
