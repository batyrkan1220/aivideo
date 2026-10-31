import { Suspense } from "react";
import { DownloadVideo } from "@/components/download-video";
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

export const metadata = { title: kk.order.title };

type SP = { deleted?: string; error?: string; pay_error?: string };
export default function OrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  return (
    <main className="mx-auto max-w-3xl px-4 pb-6 pt-4 sm:pt-10">
      <Suspense fallback={<p className="text-muted">{kk.common.loading}</p>}>
        <OrderView params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function OrderView({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser(`/orders/${id}`);
  if (!z.string().uuid().safeParse(id).success) notFound();

  // RLS: the user's own client can only read their own orders.
  const sb = await supabaseServer();
  const { data: o } = await sb.from("orders")
    .select("id,public_order_number,created_at,completed_at,quality,face_count,amount_kzt,payment_status,generation_status,pricing_breakdown_json,template_snapshot_json,template_id,photos_deleted_at")
    .eq("id", id).maybeSingle();
  if (!o) notFound();

  // Photos: ownership already proven above; short-lived signed URLs for thumbnails.
  const db = supabaseAdmin();
  const { data: assets } = await db.from("order_assets")
    .select("face_slot_key,private_storage_path").eq("order_id", o.id).eq("user_id", user.id);
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

  const snap = o.template_snapshot_json as { title_kk?: string; quality?: { labelKk?: string } };
  const price = o.pricing_breakdown_json as PriceBreakdown;
  const fmt = new Intl.DateTimeFormat("kk-KZ", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Almaty" });
  const dateFmt = new Intl.DateTimeFormat("kk-KZ", { dateStyle: "long", timeZone: "Asia/Almaty" });
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
  const chip = o.payment_status === "refunded" ? { t: kk.order.payment.refunded, c: "bg-line text-ink" }
    : o.payment_status !== "succeeded" ? { t: payLabel, c: "bg-[#ff453a] text-white" }
    : done ? { t: genLabel, c: "bg-brand text-night" }
    : o.generation_status === "failed" ? { t: genLabel, c: "bg-[#ff453a] text-white" }
    : { t: genLabel, c: "bg-ink text-paper" };
  const regenHref = (o.template_snapshot_json as { user_video_path?: string } | null)?.user_video_path ? "/create" : `/templates/${o.template_id}`;

  return (
    <div className="space-y-4">
      <div>
        <Link href="/orders" className="-my-2 inline-block py-2 text-sm font-medium text-muted hover:text-ink">← {kk.gallery.title}</Link>
        <h1 className="mt-2 text-[26px] font-extrabold leading-tight tracking-tight sm:text-3xl">{snap.title_kk}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${chip.c}`}>{chip.t}</span>
          <span>{o.public_order_number} · {fmt.format(new Date(o.created_at))}</span>
        </div>
      </div>

      {sp.deleted === "video" && <p role="status" className="rounded-[20px] bg-surface p-4 text-sm ring-1 ring-line">{kk.result.videoDeleted}</p>}
      {sp.deleted === "photos" && <p role="status" className="rounded-[20px] bg-surface p-4 text-sm ring-1 ring-line">{kk.result.photosDeleted}</p>}
      {sp.error === "busy" && <p role="alert" className="rounded-[20px] bg-danger/10 p-4 text-sm text-danger">{kk.result.busy}</p>}
      {sp.pay_error && sp.pay_error in kk.order.payErrors && (
        <p role="alert" className="rounded-[20px] bg-danger/10 p-4 text-sm text-danger">{kk.order.payErrors[sp.pay_error as keyof typeof kk.order.payErrors]}</p>
      )}
      {o.payment_status === "failed" && (
        <p role="alert" className="rounded-[20px] bg-danger/10 p-4 text-sm font-medium text-danger">{kk.order.failedMsg}</p>
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
        <section role="alert" className="rounded-[20px] bg-danger/10 p-5 text-sm">
          <p className="text-base font-bold text-danger">{kk.order.generation.failed}</p>
          <p className="mt-1 text-ink">{job?.safe_error_message ?? kk.generation.errors.generic}</p>
          <Link href="/support" className="btn-glow mt-4 inline-flex h-10 items-center rounded-full px-5 text-sm font-bold">{kk.result.contactSupport}</Link>
        </section>
      )}

      {done && (
        <section className="rounded-[24px] bg-surface p-4 ring-1 ring-line sm:p-6">
          {video && notExpired(video.expires_at) ? (
            <>
              {isPhoto ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/orders/${o.id}/video`} alt={kk.photos.watch} className="mx-auto max-h-[56svh] w-auto max-w-full rounded-[20px] bg-night object-contain sm:max-h-none sm:max-w-sm" />
              ) : (
                <video src={`/api/orders/${o.id}/video`} controls playsInline preload="metadata" aria-label={kk.result.watch}
                  className="mx-auto aspect-[9/16] w-full max-w-[min(100%,calc(56svh*9/16))] rounded-[20px] bg-night sm:max-w-sm" />
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
            <Link href={regenHref} className="flex h-11 items-center justify-center rounded-full bg-ink text-sm font-bold text-paper">↻ {kk.result.regenerate}</Link>
            <Link href="/support" className="flex h-11 items-center justify-center rounded-full bg-paper text-sm font-bold ring-1 ring-line">{kk.nav.support}</Link>
          </div>
        </section>
      )}

      {/* Details: price, photos and housekeeping — tucked away once the work is done. */}
      <details className="group rounded-[20px] bg-surface ring-1 ring-line" open={!done && !awaitingPayment}>
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3.5 text-[15px] font-semibold">
          {kk.order.details}
          <span className="text-muted transition-transform group-open:rotate-45" aria-hidden>＋</span>
        </summary>
        <div className="space-y-4 border-t border-line px-4 pb-4 pt-3 text-sm">
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
