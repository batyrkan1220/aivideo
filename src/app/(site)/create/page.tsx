import { LoginToCreate } from "@/components/login-to-create";
import { Suspense } from "react";
import { connection } from "next/server";
import { kk } from "@/lib/i18n/kk";
import { env } from "@/lib/env";
import { getSessionUser } from "@/lib/auth/session";
import { isGuestEmail } from "@/lib/telegram/session";
import { customFlowTemplate, customVideoSettings } from "@/lib/custom-video/settings";
import { CreateFlow } from "@/components/create-flow";
import { CreateTabs, TabsView } from "@/components/create-tabs";
import { isFreeOrderUser } from "@/lib/orders/free";
import { activeDiscount } from "@/lib/engage/discount";
import { adOffer } from "@/lib/engage/offer";
import { reusablePhotos } from "@/lib/orders/reusable";
import { ButtonLink } from "@/components/ui/button";
import { seedancePricingSettings } from "@/lib/pricing-seedance/settings";
import { PHOTOS_SOON } from "@/lib/features";

export const metadata = { title: kk.createHub.title };

type SP = { type?: string };
const H = kk.createHub;

/** Create: your own video (your video + your photo) or an AI photo from your own description.
    Title and tabs paint instantly; only the flow below waits for data (all fetched in parallel, cached). */
export default function CreatePage({ searchParams }: { searchParams: Promise<SP> }) {
  return (
    <main data-dark="" className="mx-auto w-full max-w-xl px-4 pb-4 pt-4 md:pt-10">
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
  const type = !PHOTOS_SOON && (await searchParams).type === "photo" ? "photo" : "video";
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
  if (!user || isGuestEmail(user.email)) return <LoginToCreate next="/create?type=video" />;
  const c = common();
  return (
    <CreateFlow
      templateId={t.id} slots={t.faceSlots} qualities={t.qualities} pricing={t.pricing}
      seedancePricing={ap} allowWish={t.allowWish} seedanceMode={t.seedanceMode}
      maxUploadBytes={Math.min(t.maxUploadBytes, c.uploadMax)} minDimension={c.minDimension} maxDimension={c.maxDimension}
      supabaseUrl={c.supabaseUrl} anonKey={c.anonKey} askPhone={c.askPhone}
      freeOrders={user ? await isFreeOrderUser(user.id) : false}
      discount={(user ? await activeDiscount(user.id) : null) ?? (await adOffer(user?.id ?? null))}
      savedPhotos={user ? await reusablePhotos(user.id) : []}
      signedIn={!!user} needTelegram={!user || isGuestEmail(user.email)}
      customVideo={{ maxSeconds: s.maxSeconds, maxMb: s.maxMb }}
    />
  );
}

async function PhotoFlow() {
  const [user, s, t] = await Promise.all([getSessionUser(), customVideoSettings(), customFlowTemplate("custom_photo")]);
  if (!t) return <Disabled />;
  if (!user || isGuestEmail(user.email)) return <LoginToCreate next="/create?type=photo" />;
  const c = common();
  return (
    <CreateFlow
      templateId={t.id} slots={t.faceSlots} qualities={t.qualities} pricing={{ ...t.pricing, basePriceKzt: s.photoPriceKzt }}
      allowWish media="photo"
      maxUploadBytes={Math.min(t.maxUploadBytes, c.uploadMax)} minDimension={c.minDimension} maxDimension={c.maxDimension}
      supabaseUrl={c.supabaseUrl} anonKey={c.anonKey} askPhone={c.askPhone}
      freeOrders={user ? await isFreeOrderUser(user.id) : false}
      discount={(user ? await activeDiscount(user.id) : null) ?? (await adOffer(user?.id ?? null))}
      savedPhotos={user ? await reusablePhotos(user.id) : []}
      signedIn={!!user} needTelegram={!user || isGuestEmail(user.email)}
    />
  );
}
