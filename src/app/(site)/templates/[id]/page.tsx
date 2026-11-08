import { LoginToCreate } from "@/components/login-to-create";
import { TemplateUnavailable } from "@/components/template-unavailable";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { kk } from "@/lib/i18n/kk";
import { getTemplate } from "@/lib/templates/queries";
import { TemplateDetailView } from "@/components/template-detail";
import { comboItems } from "@/lib/combos/catalog";
import { track } from "@/lib/analytics";
import { CreateFlow } from "@/components/create-flow";
import { TrackView } from "@/components/pixel-events";
import { TgMainButton } from "@/components/tg-main-button";
import { isFreeOrderUser } from "@/lib/orders/free";
import { activeDiscount } from "@/lib/engage/discount";
import { adOffer } from "@/lib/engage/offer";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { klingUnitLabel } from "@/lib/pricing-seedance";
import { seedancePricingSettings } from "@/lib/pricing-seedance/settings";
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
  const user = await getSessionUser();
  const staffUnits = !photo && t.durationSec && user && can(user.role, "templates.manage")
    ? await staffUnitLabel(t.durationSec)
    : null;
  return (
    <>
    <TrackView item={{ id: t.id, name: t.title, price: t.startingPriceKzt ?? 0 }} />
    {t.available && <TgMainButton text={photo ? kk.template.tgCreatePhoto : kk.template.tgCreate} targetId="create-section" />}
    <Link href={photo ? "/photos" : "/"} className="tg-hide -my-2 inline-block py-2 text-sm font-medium text-muted hover:text-ink">← {photo ? kk.template.backPhotos : kk.template.back}</Link>
    <TemplateDetailView
      t={t}
      combo={combo}
      staffUnits={staffUnits}
      cta={t.available ? (
        <Suspense fallback={<div className="h-64 animate-pulse rounded-card bg-line" />}>
          <CreateSection t={t} />
        </Suspense>
      ) : <TemplateUnavailable />}
    />
    </>
  );
}

async function staffUnitLabel(durationSec: number): Promise<string> {
  return klingUnitLabel(durationSec, await seedancePricingSettings());
}

async function CreateSection({ t }: { t: TemplateDetail }) {
  const user = await getSessionUser();
  if (!t.priced) {
    return <p className="rounded-card border border-line bg-surface p-5 text-sm text-muted">{kk.template.pricePending}</p>;
  }
  // On the site a video is made only after a Telegram sign-in (guests come only through the ad landing).
  if (!user || isGuestEmail(user.email)) return <LoginToCreate next={`/templates/${t.id}`} />;
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
      discount={(user ? await activeDiscount(user.id) : null) ?? (await adOffer(user?.id ?? null))}
      signedIn={!!user}
      needTelegram={!user || isGuestEmail(user.email)}
      framing={t.photoFraming}
      allowWish={t.allowWish}
      outfit={t.outfit}
      media={t.media}
      item={{ id: t.id, name: t.title, price: t.startingPriceKzt ?? 0 }}
    />
  );
}
