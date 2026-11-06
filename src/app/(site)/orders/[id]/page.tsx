import { ChevronDown, LifeBuoy, RotateCcw } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Alert, Skeleton } from "@/components/ui/states";
import { Suspense } from "react";
import { DownloadVideo, SendComboToChat } from "@/components/download-video";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { kk } from "@/lib/i18n/kk";
import { requireUser } from "@/lib/auth/session";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { formatKzt, type PriceBreakdown } from "@/lib/pricing";
import { autoFaceLabel } from "@/lib/templates/schema";
import { env } from "@/lib/env";
import { isTestPaymentProvider } from "@/lib/payments/types";
import { PayButton } from "@/components/pay-button";
import { GenerationStatus } from "@/components/generation-status";
import { ConfirmSubmit } from "@/components/account-forms";
import { deleteVideo, deleteOrderPhotos } from "@/lib/account/actions";
import { keepOrderPhotos } from "@/lib/orders/actions";
import { listTemplates } from "@/lib/templates/queries";
import { TrackPurchase } from "@/components/pixel-events";
import { TelegramBotLogin } from "@/components/telegram-bot-login";
import { TelegramNudge } from "@/components/telegram-nudge";
import { isGuestEmail } from "@/lib/telegram/session";
import { orderAccessLink } from "@/lib/orders/access";
import { CopyLink } from "@/app/admin/templates/copy-link";

export const metadata = { title: kk.order.title };

type SP = { deleted?: string; error?: string; pay_error?: string };
export default function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  return (
    <main className="mx-auto max-w-3xl px-4 pb-8 pt-6 sm:px-6 sm:pt-12">
      <Suspense fallback={<div className="grid gap-4"><Skeleton className="h-10 w-56 rounded-full" /><Skeleton className="h-[60svh] rounded-card" /></div>}>
        <OrderView params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function OrderView({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser(`/orders/${id}`);
  const guest = isGuestEmail(user.email);
  if (!z.string().uuid().safeParse(id).success) notFound();

  // RLS: the user's own client can only read their own orders.
  const sb = await supabaseServer();
  const { data: o } = await sb.from("orders")
    .select("id,public_order_number,created_at,completed_at,quality,face_count,amount_kzt,payment_status,generation_status,pricing_breakdown_json,template_snapshot_json,template_id,photos_deleted_at")
    .eq("id", id).maybeSingle();
  if (!o) notFound();
  // Only after ownership is proven (RLS read above): the private link to this order.
  const accessLink = guest ? await orderAccessLink(o.id).catch(() => null) : null;

  // Photos: ownership already proven above; short-lived signed URLs for thumbnails.
  const db = supabaseAdmin();
  const { data: assets } = await db.from("order_assets")
    .select("face_slot_key,private_storage_path,saved_at").eq("order_id", o.id).eq("user_id", user.id);
  const [{ data: job }, { data: video }] = await Promise.all([
    db.from("generation_jobs").select("status,progress,safe_error_message")
      .eq("order_id", o.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("generated_videos").select("expires_at,private_storage_path").eq("order_id", o.id).maybeSingle(),
  ]);
  const isPhoto = /\.(jpe?g|png|webp)$/i.test(video?.private_storage_path ?? "");
  const paths = (assets ?? []).map((a) => a.private_storage_path);
  const { data: signed } = paths.length
    ? await db.storage.from("user-uploads").createSignedUrls(paths, 300)
    : { data: [] as { signedUrl: string | null }[] };
  const order = (k: string) => Number(k.replace(/\D/g, "")) || 0;
  const photos = (assets ?? [])
    .map((a, i) => ({ key: a.face_slot_key, url: signed?.[i]?.signedUrl ?? null }))
    .sort((a, b) => order(a.key) - order(b.key));

  const snap = o.template_snapshot_json as { title_kk?: string; quality?: { labelKk?: string }; provider_key?: string };
  // Photo combo: its photos are separate child orders (made after payment).
  const isCombo = snap.provider_key === "combo";
  const { data: kids } = isCombo
    ? await db.from("orders").select("id,generation_status").eq("parent_order_id", o.id).eq("user_id", user.id).order("created_at")
    : { data: [] as { id: string; generation_status: string }[] };
  const price = o.pricing_breakdown_json as PriceBreakdown;
  const fmt = new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Almaty" });
  const dateFmt = new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeZone: "Asia/Almaty" });
  const payLabel = kk.order.payment[o.payment_status as keyof typeof kk.order.payment];
  const genLabel = kk.order.generation[o.generation_status as keyof typeof kk.order.generation];

  const awaitingPayment = ["pending", "failed", "cancelled"].includes(o.payment_status) && o.generation_status === "awaiting_payment";
  const priceBox = (
      <section className="rounded-card bg-night p-5 text-white sm:p-6">
        <dl className="space-y-2 text-sm">
          <Line label={kk.pricing.videoPrice} value={formatKzt(price.basePriceKzt)} />
          {price.qualitySurchargeKzt > 0 && <Line label={kk.pricing.quality} value={`+${formatKzt(price.qualitySurchargeKzt)}`} />}
          {price.extraFacesKzt > 0 && <Line label={`${kk.pricing.extraFaces} (${price.extraFaces})`} value={`+${formatKzt(price.extraFacesKzt)}`} />}
          {price.platformFeeKzt > 0 && <Line label={kk.pricing.platformFee} value={`+${formatKzt(price.platformFeeKzt)}`} />}
          {price.discountKzt > 0 && <Line label={kk.pricing.discount} value={`−${formatKzt(price.discountKzt)}`} />}
          <div className="flex items-baseline justify-between border-t border-white/20 pt-3">
            <dt className="font-semibold">{kk.pricing.total}</dt>
            <dd className="font-display text-2xl font-bold">{formatKzt(o.amount_kzt)}</dd>
          </div>
        </dl>
        {["pending", "failed", "cancelled"].includes(o.payment_status) && o.generation_status === "awaiting_payment" && (
          <PayButton
            orderId={o.id}
            label={o.payment_status === "pending" ? `${kk.order.pay} ${formatKzt(o.amount_kzt)}` : kk.order.payAgain}
            sandbox={isTestPaymentProvider(env().PAYMENT_PROVIDER)}
            askPhone={env().PAYMENT_PROVIDER === "tole" || env().PAYMENT_PROVIDER === "tole_sandbox"}
          />
        )}
      </section>
  );

  const done = o.generation_status === "completed";
  const busy = ["queued", "processing", "postprocessing"].includes(o.generation_status);
  // Status colours from the design system (AAA text on soft backgrounds).
  const chip = o.payment_status === "refunded" ? { t: kk.order.payment.refunded, c: "bg-mist text-muted" }
    : o.payment_status !== "succeeded" ? { t: payLabel, c: "bg-info-soft text-info" }
    : done ? { t: genLabel, c: "bg-success-soft text-success" }
    : o.generation_status === "failed" ? { t: genLabel, c: "bg-danger-soft text-danger" }
    : { t: genLabel, c: "bg-warning-soft text-warning" };
  const regenHref = (o.template_snapshot_json as { user_video_path?: string } | null)?.user_video_path ? "/create" : `/templates/${o.template_id}`;

  return (
    <div className="space-y-4">
      <div>
        <Link href="/orders" className="tg-hide -my-2 inline-block py-2 text-sm font-medium text-muted hover:text-ink">← {kk.gallery.title}</Link>
        <h1 className="t-h1 mt-2">{snap.title_kk}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
          <span className={`t-micro rounded-full px-2.5 py-1 ${chip.c}`}>{chip.t}</span>
          <span>{o.public_order_number} · {fmt.format(new Date(o.created_at))}</span>
        </div>
      </div>

      {sp.deleted === "video" && <Alert tone="success">{kk.result.videoDeleted}</Alert>}
      {sp.deleted === "photos" && <Alert tone="success">{kk.result.photosDeleted}</Alert>}
      {sp.error === "busy" && <Alert tone="warning">{kk.result.busy}</Alert>}
      {sp.pay_error && sp.pay_error in kk.order.payErrors && (
        <Alert tone="danger">{kk.order.payErrors[sp.pay_error as keyof typeof kk.order.payErrors]}</Alert>
      )}
      {o.payment_status === "failed" && (
        <Alert tone="danger">{kk.order.failedMsg}</Alert>
      )}

      {/* Awaiting payment: the pay step comes first. */}
      {awaitingPayment && priceBox}

      {o.payment_status === "succeeded" && busy && (
        <GenerationStatus
          orderId={o.id}
          initial={{ generationStatus: o.generation_status, progress: job?.progress ?? null, error: job?.safe_error_message ?? null }}
        />
      )}
      {o.generation_status === "failed" && (
        <section role="alert" className="rounded-card bg-danger-soft p-6 text-sm">
          <p className="text-base font-bold text-danger">{kk.order.generation.failed}</p>
          <p className="mt-1 text-ink">{job?.safe_error_message ?? kk.generation.errors.generic}</p>
          <ButtonLink href="/support" className="mt-4">{kk.result.contactSupport}</ButtonLink>
        </section>
      )}

      {isCombo && (kids ?? []).length > 0 && (
        <section className="rounded-card border border-line/80 bg-surface p-4 sm:p-6">
          <p className="text-[15px] font-extrabold">
            {kk.combo.ready((kids ?? []).filter((k) => k.generation_status === "completed").length, (kids ?? []).length)}
          </p>
          <ul className="mt-3 grid grid-cols-3 gap-2">
            {(kids ?? []).map((k, i) => (
              <li key={k.id}>
                <Link href={`/orders/${k.id}`} className="relative block aspect-[3/4] overflow-hidden rounded-[16px] bg-paper ring-1 ring-line">
                  {k.generation_status === "completed"
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={`/api/orders/${k.id}/video`} alt="" loading={i < 6 ? "eager" : "lazy"} className="h-full w-full object-cover" />
                    : k.generation_status === "failed"
                      ? <span className="flex h-full items-center justify-center bg-rose text-xl" aria-label={kk.order.generation.failed}>⚠️</span>
                      : <span className="flex h-full items-center justify-center bg-peach"><span className="h-6 w-6 animate-spin rounded-full border-2 border-black/15 border-t-black" aria-label={kk.myVideos.progress} /></span>}
                  <span className="absolute left-1.5 top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-white/90 px-1 text-[10px] font-extrabold text-night">{i + 1}</span>
                </Link>
              </li>
            ))}
          </ul>
          {done && <div className="mt-4"><SendComboToChat orderId={o.id} /></div>}
        </section>
      )}

      {done && !isCombo && (
        <section className="rounded-card border border-line/80 bg-surface p-4 sm:p-6">
          {video && notExpired(video.expires_at) ? (
            <>
              {isPhoto ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/orders/${o.id}/video`} alt={kk.photos.watch} className="mx-auto max-h-[56svh] w-auto max-w-full rounded-[1.25rem] bg-night object-contain elev-md sm:max-h-none sm:max-w-sm" />
              ) : (
                <video src={`/api/orders/${o.id}/video`} controls playsInline preload="metadata" aria-label={kk.result.watch}
                  className="mx-auto aspect-[9/16] w-full max-w-[min(100%,calc(56svh*9/16))] rounded-[1.25rem] bg-night elev-md sm:max-w-sm" />
              )}
              <div className="mx-auto mt-4 max-w-sm">
                <DownloadVideo orderId={o.id} photo={isPhoto} />
                <p className="mt-3 text-center text-xs text-muted">{kk.result.keptUntil(dateFmt.format(new Date(video.expires_at)))}</p>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">{video ? kk.result.expired : kk.result.videoDeleted}</p>
          )}
          <div className="mx-auto mt-4 grid max-w-sm grid-cols-2 gap-2">
            <ButtonLink href={regenHref} icon={<RotateCcw size={16} aria-hidden />}>{kk.result.regenerate}</ButtonLink>
            <ButtonLink href="/support" variant="secondary" icon={<LifeBuoy size={16} aria-hidden />}>{kk.nav.support}</ButtonLink>
          </div>
        </section>
      )}

      {/* Guests (paid without signing in): one tap links Telegram — the video is sent there and the order is never lost. */}
      {guest && (
        <section className="relative overflow-hidden rounded-card bg-[#2AABEE]/10 p-4 ring-1 ring-[#2AABEE]/30 sm:p-6">
          <span className="absolute right-3 top-3 rounded-full bg-brand px-2.5 py-1 text-xs font-extrabold text-night">🎁 −20%</span>
          <p className="pr-16 text-[16px] font-extrabold">{kk.order.tgTitle}</p>
          <ul className="mb-3 mt-2 space-y-1 text-sm">
            {kk.order.tgPoints.map((t) => <li key={t} className="flex gap-2"><span className="text-[#229ED9]" aria-hidden>✓</span>{t}</li>)}
          </ul>
          <TelegramBotLogin next={`/orders/${o.id}`} compact />
          {accessLink && (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-white/70 px-3 py-2.5 text-xs">
              <span className="min-w-0 text-muted">{kk.order.linkNote}</span>
              <CopyLink url={accessLink} label={kk.order.copyLink} />
            </div>
          )}
        </section>
      )}

      {guest && (busy || done) && <TelegramNudge orderId={o.id} ready={done} />}

      {/* Ad pixels: Purchase once, right after paying (the server reports it too, same event id). */}
      {o.payment_status === "succeeded" && o.amount_kzt > 0 && Date.parse(o.created_at) > nowMinus2d() && (
        <TrackPurchase orderId={o.id} value={o.amount_kzt} item={{ id: o.template_id ?? "custom", name: snap.title_kk ?? "TrendMe", price: o.amount_kzt }} />
      )}

      {/* Next video with the same photo: fresh trends + keep the photo for 30 days. */}
      {done && !isPhoto && photos.length > 0 && (
        <Suspense fallback={null}>
          <NextVideo orderId={o.id} templateId={o.template_id} saved={(assets ?? []).some((a) => a.saved_at)} />
        </Suspense>
      )}

      {/* Details: price, photos and housekeeping — tucked away once the work is done. */}
      <details className="group rounded-card border border-line/80 bg-surface" open={!done && !awaitingPayment}>
        <summary className="flex cursor-pointer list-none items-center justify-between rounded-card px-4 py-4 text-[15px] font-semibold transition-colors hover:bg-mist/60 sm:px-6">
          {kk.order.details}
          <ChevronDown size={18} className="text-muted transition-transform duration-200 group-open:rotate-180" aria-hidden />
        </summary>
        <div className="space-y-4 border-t border-line px-4 pb-4 pt-4 text-sm sm:px-6">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1.5 [&>dd]:break-words">
            <dt className="text-muted">{kk.result.orderNumber}</dt><dd>{o.public_order_number}</dd>
            <dt className="text-muted">{kk.order.created}</dt><dd>{fmt.format(new Date(o.created_at))}</dd>
            <dt className="text-muted">{kk.pricing.quality}</dt><dd>{snap.quality?.labelKk ?? o.quality}</dd>
            {!awaitingPayment && <><dt className="text-muted">{kk.pricing.total}</dt><dd className="font-bold">{formatKzt(o.amount_kzt)}</dd></>}
          </dl>
          {photos.length > 0 && (
            <div>
              <p className="mb-2 font-semibold">{kk.order.photos}</p>
              <ol className="flex gap-2">
                {photos.map((p, i) => (
                  <li key={p.key} className="w-20">
                    <div className="aspect-[3/4] overflow-hidden rounded-xl bg-line">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {p.url && <img src={p.url} alt={autoFaceLabel(i, photos.length)} className="h-full w-full object-cover" />}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {o.photos_deleted_at && photos.length === 0 && <p className="text-muted">{kk.result.photosDeleted}</p>}
          <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-line pt-3">
            {photos.length > 0 && !busy && (
              <form action={deleteOrderPhotos}>
                <input type="hidden" name="orderId" value={o.id} />
                <ConfirmSubmit message={kk.result.deletePhotosConfirm} className="font-medium text-muted hover:text-danger">{kk.result.deletePhotos}</ConfirmSubmit>
              </form>
            )}
            {done && video && notExpired(video.expires_at) && (
              <form action={deleteVideo}>
                <input type="hidden" name="orderId" value={o.id} />
                <ConfirmSubmit message={kk.result.deleteVideoConfirm} className="font-medium text-muted hover:text-danger">{isPhoto ? kk.result.deletePhoto : kk.result.deleteVideo}</ConfirmSubmit>
              </form>
            )}
          </div>
        </div>
      </details>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-white/75">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** Server-side expiry check (request time). */
function notExpired(iso: string) {
  return new Date(iso).getTime() > Date.now();
}

async function NextVideo({ orderId, templateId, saved }: { orderId: string; templateId: string | null; saved: boolean }) {
  const { items } = await listTemplates({ page: 1, sort: "trending", media: "video" });
  const picks = items.filter((t) => t.id !== templateId).slice(0, 4);
  if (!picks.length) return null;
  const N = kk.nextVideo;
  return (
    <section className="rounded-[24px] bg-surface p-4 ring-1 ring-line sm:p-6">
      <h2 className="text-[17px] font-extrabold tracking-tight">{N.title}</h2>
      <p className="mt-0.5 text-sm text-muted">{N.text}</p>
      <ul className="mt-3 grid grid-cols-2 gap-2.5">
        {picks.map((t) => (
          <li key={t.id}>
            <Link href={`/templates/${t.id}`} className="relative block aspect-[3/4] overflow-hidden rounded-[16px] bg-night ring-1 ring-black/5">
              {(t.coverThumbUrl ?? t.coverUrl) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={t.coverThumbUrl ?? t.coverUrl ?? ""} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
              )}
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2.5 pt-8 text-white">
                <span className="line-clamp-2 block text-[13px] font-bold leading-tight">{t.title}</span>
                {t.startingPriceKzt !== null && <span className="mt-0.5 block text-[12px] font-extrabold text-brand">{formatKzt(t.startingPriceKzt)}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {saved ? (
        <p className="mt-3 text-center text-xs text-muted">✓ {N.saved}</p>
      ) : (
        <form action={keepOrderPhotos} className="mt-3">
          <input type="hidden" name="orderId" value={orderId} />
          <button className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-paper text-sm font-bold ring-1 ring-line hover:ring-ink">📌 {N.keep}</button>
          <p className="mt-1.5 text-center text-[11px] text-muted">{N.keepHint}</p>
        </form>
      )}
    </section>
  );
}

// Request time (this page is dynamic); kept out of render helpers for the purity lint.
function nowMinus2d() { return Date.now() - 2 * 86400_000; }
