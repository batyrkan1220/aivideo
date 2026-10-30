import { Suspense } from "react";
import { connection } from "next/server";
import { kk } from "@/lib/i18n/kk";
import { env } from "@/lib/env";
import { getSessionUser } from "@/lib/auth/session";
import { getTemplateForAdmin } from "@/lib/templates/queries";
import { customTemplateId, customVideoSettings } from "@/lib/custom-video/settings";
import { CreateFlow } from "@/components/create-flow";
import { isFreeOrderUser } from "@/lib/orders/free";
import { ButtonLink } from "@/components/ui/button";
import { formatKzt } from "@/lib/pricing";
import { seedancePricingSettings } from "@/lib/pricing-seedance/settings";

export const metadata = { title: kk.customVideo.title };

/** "Өз видеом": the customer's own video + their face photo. */
export default function CreateOwnPage() {
  const cv = kk.customVideo;
  return (
    <main className="mx-auto w-full max-w-xl px-4 pb-4 pt-5 md:pt-10">
      <h1 className="font-display text-2xl font-bold tracking-tight md:text-3xl">{cv.title}</h1>
      <p className="mt-1 text-muted">{cv.lead}</p>
      <ol className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 text-xs">
        {cv.steps.map((s, i) => (
          <li key={s} className="flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full bg-surface py-1.5 pl-1.5 pr-3 ring-1 ring-line">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand text-[10px] font-bold text-white">{i + 1}</span>
            <span className="font-medium">{s}</span>
          </li>
        ))}
      </ol>
      <div className="mt-5">
        <Suspense fallback={<div className="h-72 animate-pulse rounded-card bg-line" />}>
          <Flow />
        </Suspense>
      </div>
    </main>
  );
}

async function Flow() {
  await connection(); // request-time only: reads settings and the session, never at build time
  const cv = kk.customVideo;
  const [user, s, id, ap] = await Promise.all([getSessionUser(), customVideoSettings(), customTemplateId(), seedancePricingSettings()]);
  const t = s.enabled && id ? await getTemplateForAdmin(id) : null;
  if (!t) {
    return (
      <div className="rounded-card border border-dashed border-line bg-surface px-6 py-12 text-center">
        <h2 className="font-display text-lg font-bold">{cv.disabledTitle}</h2>
        <p className="mt-1 text-sm text-muted">{cv.disabledText}</p>
        <ButtonLink href="/" className="mt-5">{cv.browse}</ButtonLink>
      </div>
    );
  }
  if (!user) {
    return (
      <div className="rounded-card bg-brand-soft p-6">
        <h2 className="font-display text-lg font-bold">{kk.create.loginTitle}</h2>
        <p className="mt-1 text-sm text-muted">{kk.create.loginText}</p>
        <p className="mt-3 text-sm text-muted">{cv.priceFrom(formatKzt(ap.minPriceKzt))}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <ButtonLink href="/login?next=/create" size="lg">{kk.auth.login}</ButtonLink>
          <ButtonLink href="/signup?next=/create" size="lg" variant="secondary">{kk.auth.signup}</ButtonLink>
        </div>
      </div>
    );
  }
  const e = env();
  return (
    <CreateFlow
      templateId={t.id}
      slots={t.faceSlots}
      qualities={t.qualities}
      pricing={t.pricing}
      seedancePricing={ap}
      allowWish={t.allowWish}
      seedanceMode={t.seedanceMode}
      maxUploadBytes={Math.min(t.maxUploadBytes, e.UPLOAD_MAX_BYTES)}
      minDimension={e.UPLOAD_MIN_DIMENSION}
      maxDimension={e.UPLOAD_MAX_DIMENSION}
      supabaseUrl={e.NEXT_PUBLIC_SUPABASE_URL}
      anonKey={e.NEXT_PUBLIC_SUPABASE_ANON_KEY}
      askPhone={e.PAYMENT_PROVIDER === "tole" || e.PAYMENT_PROVIDER === "tole_sandbox"}
      freeOrders={await isFreeOrderUser(user.id)}
      customVideo={{ maxSeconds: s.maxSeconds, maxMb: s.maxMb }}
    />
  );
}
