import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { kk } from "@/lib/i18n/kk";
import { getTemplate } from "@/lib/templates/queries";
import { TemplateDetailView } from "@/components/template-detail";
import { comboItems } from "@/lib/combos/catalog";
import { track } from "@/lib/analytics";
import { CreateFlow } from "@/components/create-flow";
import { isFreeOrderUser } from "@/lib/orders/free";
import { activeDiscount } from "@/lib/engage/discount";
import { reusablePhotos } from "@/lib/orders/reusable";
import { getSessionUser } from "@/lib/auth/session";
import { isGuestEmail } from "@/lib/telegram/session";
import { env } from "@/lib/env";
import type { TemplateDetail } from "@/lib/templates/queries";

export default function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="mx-auto max-w-6xl px-4 pt-3 md:pt-8">
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
  const photo = t.media === "photo";
  const combo = t.comboIds ? await comboItems(t.comboIds) : undefined;
  return (
    <>
    <Link href={photo ? "/photos" : "/"} className="tg-hide -my-2 inline-block py-2 text-sm font-medium text-muted hover:text-ink">← {photo ? kk.template.backPhotos : kk.template.back}</Link>
    <TemplateDetailView
      t={t}
      combo={combo}
      cta={
        <Suspense fallback={<div className="h-64 animate-pulse rounded-card bg-line" />}>
          <CreateSection t={t} />
        </Suspense>
      }
    />
    </>
  );
}

async function CreateSection({ t }: { t: TemplateDetail }) {
  const user = await getSessionUser();
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
      freeOrders={user ? await isFreeOrderUser(user.id) : false}
      discount={user ? await activeDiscount(user.id) : null}
      savedPhotos={user ? await reusablePhotos(user.id) : []}
      signedIn={!!user}
      needTelegram={!user || isGuestEmail(user.email)}
      framing={t.photoFraming}
      allowWish={t.allowWish}
      outfit={t.outfit}
      media={t.media}
    />
  );
}
