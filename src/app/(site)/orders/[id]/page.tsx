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
    <main className="mx-auto max-w-3xl px-4 pt-10">
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
    db.from("generated_videos").select("expires_at").eq("order_id", o.id).maybeSingle(),
  ]);
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
      <section className="rounded-card bg-ink p-5 text-white sm:p-6">
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

  return (
    <div className="space-y-6">
      <div>
        <Link href="/orders" className="-my-2 inline-block py-2 text-sm font-medium text-muted hover:text-ink">← {kk.order.list}</Link>
        <h1 className="mt-3 font-display text-2xl font-bold sm:text-3xl">{snap.title_kk}</h1>
        <p className="mt-1 text-sm text-muted">
          {kk.order.number}: <span className="font-semibold text-ink">{o.public_order_number}</span>
        </p>
      </div>

      {sp.deleted === "video" && <p role="status" className="rounded-card bg-paper p-4 text-sm">{kk.result.videoDeleted}</p>}
      {sp.deleted === "photos" && <p role="status" className="rounded-card bg-paper p-4 text-sm">{kk.result.photosDeleted}</p>}
      {sp.error === "busy" && <p role="alert" className="rounded-card bg-red-50 p-4 text-sm text-danger">{kk.result.busy}</p>}
      {sp.pay_error && sp.pay_error in kk.order.payErrors && (
        <p role="alert" className="rounded-card bg-red-50 p-4 text-sm text-danger">{kk.order.payErrors[sp.pay_error as keyof typeof kk.order.payErrors]}</p>
      )}
      {o.payment_status === "succeeded" && ["queued", "processing", "postprocessing"].includes(o.generation_status) && (
        <p role="status" className="rounded-card bg-emerald-50 p-4 text-sm font-medium text-success">{kk.order.paidMsg}</p>
      )}
      {o.payment_status === "failed" && (
        <p role="alert" className="rounded-card bg-red-50 p-4 text-sm font-medium text-danger">{kk.order.failedMsg}</p>
      )}

      {/* Awaiting payment: the pay step comes first. */}
      {awaitingPayment && priceBox}

      <section className="rounded-card border border-line bg-white p-5 sm:p-6">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] [&>dd]:break-words gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted">{kk.order.created}</dt><dd>{fmt.format(new Date(o.created_at))}</dd>
          <dt className="text-muted">{kk.pricing.quality}</dt><dd>{snap.quality?.labelKk ?? o.quality}</dd>
          <dt className="text-muted">{kk.order.status}</dt>
          <dd className="flex flex-wrap gap-2">
            <span className={`rounded-full px-2.5 py-0.5 font-semibold ${o.payment_status === "succeeded" ? "bg-emerald-100 text-success" : o.payment_status === "failed" ? "bg-red-50 text-danger" : "bg-flash/30"}`}>{payLabel}</span>
            {o.payment_status === "succeeded" && (
              <span className="rounded-full bg-brand-soft px-2.5 py-0.5 font-semibold text-brand">{genLabel}</span>
            )}
          </dd>
        </dl>
      </section>

      {o.payment_status === "succeeded" && (
        <GenerationStatus
          orderId={o.id}
          initial={{ generationStatus: o.generation_status, progress: job?.progress ?? null, error: job?.safe_error_message ?? null }}
        />
      )}
      {o.generation_status === "failed" && (
        <section role="alert" className="rounded-card border border-danger/30 bg-red-50 p-5 text-sm">
          <p className="font-semibold text-danger">{kk.order.generation.failed}</p>
          <p className="mt-1 text-ink">{job?.safe_error_message ?? kk.generation.errors.generic}</p>
          <Link href="/support" className="mt-3 inline-block font-semibold text-brand hover:underline">{kk.result.contactSupport}</Link>
        </section>
      )}
      {o.generation_status === "completed" && (
        <section className="rounded-card border border-line bg-white p-5 sm:p-6">
          <h2 className="font-display text-xl font-bold">{kk.result.ready}</h2>
          {video && notExpired(video.expires_at) ? (
            <>
              <video
                src={`/api/orders/${o.id}/video`}
                controls
                playsInline
                preload="metadata"
                aria-label={kk.result.watch}
                className="mt-4 aspect-[9/16] w-full max-w-sm rounded-card bg-ink"
              />
              <p className="mt-3 text-sm text-muted">{kk.result.keptUntil(dateFmt.format(new Date(video.expires_at)))}</p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <DownloadVideo orderId={o.id} />
                <form action={deleteVideo}>
                  <input type="hidden" name="orderId" value={o.id} />
                  <ConfirmSubmit message={kk.result.deleteVideoConfirm} className="h-12 rounded-full px-4 text-sm font-medium text-muted hover:text-danger">
                    {kk.result.deleteVideo}
                  </ConfirmSubmit>
                </form>
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted">{video ? kk.result.expired : kk.result.videoDeleted}</p>
          )}
          <dl className="mt-5 grid grid-cols-[auto_minmax(0,1fr)] [&>dd]:break-words gap-x-6 gap-y-1 border-t border-line pt-4 text-sm">
            <dt className="text-muted">{kk.result.orderNumber}</dt><dd>{o.public_order_number}</dd>
            {o.completed_at && (<><dt className="text-muted">{kk.order.created}</dt><dd>{fmt.format(new Date(o.created_at))}</dd></>)}
            <dt className="text-muted">{kk.pricing.quality}</dt><dd>{snap.quality?.labelKk ?? o.quality}</dd>
          </dl>
          <div className="mt-5 rounded-xl bg-brand-soft p-4 text-sm">
            <p className="text-muted">{kk.result.regenerateNote}</p>
            <div className="mt-3 flex flex-wrap gap-4">
              <Link href={(o.template_snapshot_json as { user_video_path?: string } | null)?.user_video_path ? "/create" : `/templates/${o.template_id}`} className="font-semibold text-brand hover:underline">{kk.result.regenerate}</Link>
              <Link href="/support" className="font-semibold text-brand hover:underline">{kk.result.contactSupport}</Link>
            </div>
          </div>
        </section>
      )}

      <section className="rounded-card border border-line bg-white p-5 sm:p-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-semibold">{kk.order.photos}</h2>
          {photos.length > 0 && !["queued", "processing", "postprocessing"].includes(o.generation_status) && (
            <form action={deleteOrderPhotos}>
              <input type="hidden" name="orderId" value={o.id} />
              <ConfirmSubmit message={kk.result.deletePhotosConfirm} className="text-sm font-medium text-muted hover:text-danger">
                {kk.result.deletePhotos}
              </ConfirmSubmit>
            </form>
          )}
        </div>
        {o.photos_deleted_at && photos.length === 0 && <p className="text-sm text-muted">{kk.result.photosDeleted}</p>}
        <ol className={`grid gap-3 ${photos.length === 1 ? "max-w-[160px] grid-cols-1" : photos.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
          {photos.map((p, i) => (
            <li key={p.key}>
              <div className="aspect-[3/4] overflow-hidden rounded-xl bg-line">
                {p.url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.url} alt="" className="h-full w-full object-cover" />
                )}
              </div>
              <p className="mt-1 text-xs text-muted">{autoFaceLabel(i, photos.length)}</p>
            </li>
          ))}
        </ol>
      </section>

      {!awaitingPayment && priceBox}
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
