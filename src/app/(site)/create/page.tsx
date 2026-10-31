import { Suspense } from "react";
import { connection } from "next/server";
import { kk } from "@/lib/i18n/kk";
import { env } from "@/lib/env";
import { getSessionUser } from "@/lib/auth/session";
import { customFlowTemplate, customVideoSettings } from "@/lib/custom-video/settings";
import { CreateFlow } from "@/components/create-flow";
import { CreateTabs, TabsView } from "@/components/create-tabs";
import { isFreeOrderUser } from "@/lib/orders/free";
import { ButtonLink } from "@/components/ui/button";
import { formatKzt } from "@/lib/pricing";
import { seedancePricingSettings } from "@/lib/pricing-seedance/settings";
import { seedanceAutoPriceKzt } from "@/lib/pricing-seedance";
import { SEEDANCE_MIN_SEC } from "@/lib/templates/seedance-config";

export const metadata = { title: kk.createHub.title };

type SP = { type?: string };
const H = kk.createHub;

/** Create: your own video (your video + your photo) or an AI photo from your own description.
    Title and tabs paint instantly; only the flow below waits for data (all fetched in parallel, cached). */
export default function CreatePage({ searchParams }: { searchParams: Promise<SP> }) {
  return (
    <main className="mx-auto w-full max-w-xl px-4 pb-4 pt-4 md:pt-10">
      <h1 className="text-[28px] font-extrabold leading-none tracking-tight">{H.title}</h1>
      <div className="mt-4">
        <Suspense fallback={<TabsView type="video" />}>
          <CreateTabs />
        </Suspense>
      </div>
      <Suspense fallback={<FlowSkeleton />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

function FlowSkeleton() {
  return (
    <div className="mt-4 space-y-3" aria-hidden>
      <div className="h-16 animate-pulse rounded-[24px] bg-surface" />
      <div className="h-44 animate-pulse rounded-[24px] bg-surface" />
      <div className="h-24 animate-pulse rounded-[24px] bg-surface" />
    </div>
  );
}

async function Body({ searchParams }: { searchParams: Promise<SP> }) {
  await connection(); // request-time only: reads settings and the session
  const type = (await searchParams).type === "photo" ? "photo" : "video";
  const head = type === "photo" ? H.photo : H.video;
  return (
    <>
      {/* Short intro: what you get + 3 tiny steps */}
      <div className="mt-4 flex items-center gap-3 rounded-[24px] bg-surface p-3.5 ring-1 ring-line">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-lg" aria-hidden>{type === "photo" ? "✨" : "🎬"}</span>
        <div className="min-w-0">
          <p className="text-[15px] font-extrabold leading-tight">{head.title}</p>
          <p className="mt-0.5 truncate text-[12px] text-muted">{head.steps.join(" → ")}</p>
        </div>
      </div>
      <div className="mt-4">{type === "photo" ? <PhotoFlow /> : <VideoFlow />}</div>
    </>
  );
}

function Disabled() {
  const cv = kk.customVideo;
  return (
    <div className="rounded-[24px] border border-dashed border-line bg-surface px-6 py-12 text-center">
      <h2 className="text-lg font-bold">{cv.disabledTitle}</h2>
      <p className="mt-1 text-sm text-muted">{cv.disabledText}</p>
      <ButtonLink href="/" className="mt-5">{cv.browse}</ButtonLink>
    </div>
  );
}

function Login({ next, price }: { next: string; price: string }) {
  return (
    <div className="rounded-[24px] bg-surface p-5 ring-1 ring-line">
      <h2 className="text-lg font-bold">{kk.create.loginTitle}</h2>
      <p className="mt-1 text-sm text-muted">{kk.create.loginText}</p>
      <p className="mt-3 inline-flex rounded-full bg-lavender px-3 py-1 text-sm font-semibold">{price}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <ButtonLink href={`/login?next=${encodeURIComponent(next)}`} size="lg">{kk.auth.login}</ButtonLink>
        <ButtonLink href={`/signup?next=${encodeURIComponent(next)}`} size="lg" variant="secondary">{kk.auth.signup}</ButtonLink>
      </div>
    </div>
  );
}

function common() {
  const e = env();
  return {
    minDimension: e.UPLOAD_MIN_DIMENSION,
    maxDimension: e.UPLOAD_MAX_DIMENSION,
    supabaseUrl: e.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: e.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    askPhone: e.PAYMENT_PROVIDER === "tole" || e.PAYMENT_PROVIDER === "tole_sandbox",
    uploadMax: e.UPLOAD_MAX_BYTES,
  };
}

async function VideoFlow() {
  const [user, s, t, ap] = await Promise.all([getSessionUser(), customVideoSettings(), customFlowTemplate("custom"), seedancePricingSettings()]);
  if (!s.enabled || !t) return <Disabled />;
  if (!user) return <Login next="/create" price={kk.customVideo.priceFrom(formatKzt(seedanceAutoPriceKzt(SEEDANCE_MIN_SEC, ap)))} />;
  const c = common();
  return (
    <CreateFlow
      templateId={t.id} slots={t.faceSlots} qualities={t.qualities} pricing={t.pricing}
      seedancePricing={ap} allowWish={t.allowWish} seedanceMode={t.seedanceMode}
      maxUploadBytes={Math.min(t.maxUploadBytes, c.uploadMax)} minDimension={c.minDimension} maxDimension={c.maxDimension}
      supabaseUrl={c.supabaseUrl} anonKey={c.anonKey} askPhone={c.askPhone}
      freeOrders={await isFreeOrderUser(user.id)}
      customVideo={{ maxSeconds: s.maxSeconds, maxMb: s.maxMb }}
    />
  );
}

async function PhotoFlow() {
  const [user, s, t] = await Promise.all([getSessionUser(), customVideoSettings(), customFlowTemplate("custom_photo")]);
  if (!t) return <Disabled />;
  const price = formatKzt(s.photoPriceKzt);
  if (!user) return <Login next="/create?type=photo" price={H.photo.price(price)} />;
  const c = common();
  return (
    <CreateFlow
      templateId={t.id} slots={t.faceSlots} qualities={t.qualities} pricing={{ ...t.pricing, basePriceKzt: s.photoPriceKzt }}
      allowWish wishRequired media="photo"
      maxUploadBytes={Math.min(t.maxUploadBytes, c.uploadMax)} minDimension={c.minDimension} maxDimension={c.maxDimension}
      supabaseUrl={c.supabaseUrl} anonKey={c.anonKey} askPhone={c.askPhone}
      freeOrders={await isFreeOrderUser(user.id)}
    />
  );
}
