import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { kk } from "@/lib/i18n/kk";
import { env } from "@/lib/env";
import { getSessionUser } from "@/lib/auth/session";
import { getTemplateForAdmin } from "@/lib/templates/queries";
import { customPhotoTemplateId, customTemplateId, customVideoSettings } from "@/lib/custom-video/settings";
import { CreateFlow } from "@/components/create-flow";
import { isFreeOrderUser } from "@/lib/orders/free";
import { ButtonLink } from "@/components/ui/button";
import { formatKzt } from "@/lib/pricing";
import { seedancePricingSettings } from "@/lib/pricing-seedance/settings";
import { seedanceAutoPriceKzt } from "@/lib/pricing-seedance";
import { SEEDANCE_MIN_SEC } from "@/lib/templates/seedance-config";

export const metadata = { title: kk.createHub.title };

type SP = { type?: string };

/** Create: your own video (your video + your photo) or an AI photo from your own description. */
export default function CreatePage({ searchParams }: { searchParams: Promise<SP> }) {
  return (
    <main className="mx-auto w-full max-w-xl px-4 pb-4 pt-4 md:pt-10">
      <Suspense fallback={<div className="h-96 animate-pulse rounded-[24px] bg-surface" />}>
        <Body searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Body({ searchParams }: { searchParams: Promise<SP> }) {
  await connection(); // request-time only: reads settings and the session
  const type = (await searchParams).type === "photo" ? "photo" : "video";
  const H = kk.createHub;
  const head = type === "photo" ? H.photo : H.video;
  return (
    <>
      <div className="grid grid-cols-2 gap-1 rounded-full bg-surface p-1 ring-1 ring-line" role="tablist" aria-label={H.title}>
        {(["video", "photo"] as const).map((k) => (
          <Link key={k} href={k === "photo" ? "/create?type=photo" : "/create"} role="tab" aria-selected={type === k} replace scroll={false}
            className={`flex h-11 items-center justify-center gap-2 rounded-full text-sm font-bold transition-colors ${type === k ? "bg-ink text-paper" : "text-muted hover:text-ink"}`}>
            {k === "video" ? "🎬" : "📸"} {H.tabs[k]}
          </Link>
        ))}
      </div>

      <section className="mt-4 rounded-[24px] bg-night px-5 py-4 text-white">
        <span className="section-title text-lime">{head.eyebrow}</span>
        <h1 className="mt-1 text-[24px] font-extrabold leading-tight tracking-tight">{head.title}</h1>
        <p className="mt-1.5 text-sm text-white/70">{head.lead}</p>
      </section>

      <div className="mt-4">{type === "photo" ? <PhotoFlow /> : <VideoFlow />}</div>
    </>
  );
}

function Disabled() {
  const cv = kk.customVideo;
  return (
    <div className="rounded-[20px] border border-dashed border-line bg-surface px-6 py-12 text-center">
      <h2 className="text-lg font-bold">{cv.disabledTitle}</h2>
      <p className="mt-1 text-sm text-muted">{cv.disabledText}</p>
      <ButtonLink href="/" className="mt-5">{cv.browse}</ButtonLink>
    </div>
  );
}

function Login({ next, price }: { next: string; price: string }) {
  return (
    <div className="rounded-[20px] bg-surface p-5 ring-1 ring-line">
      <h2 className="text-lg font-bold">{kk.create.loginTitle}</h2>
      <p className="mt-1 text-sm text-muted">{kk.create.loginText}</p>
      <p className="mt-3 text-sm font-semibold">{price}</p>
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
  const [user, s, id, ap] = await Promise.all([getSessionUser(), customVideoSettings(), customTemplateId(), seedancePricingSettings()]);
  const t = s.enabled && id ? await getTemplateForAdmin(id) : null;
  if (!t) return <Disabled />;
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
  const [user, s, id] = await Promise.all([getSessionUser(), customVideoSettings(), customPhotoTemplateId()]);
  const t = id ? await getTemplateForAdmin(id) : null;
  if (!t) return <Disabled />;
  const price = formatKzt(s.photoPriceKzt);
  if (!user) return <Login next="/create?type=photo" price={kk.createHub.photo.price(price)} />;
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
