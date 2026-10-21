import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { kk } from "@/lib/i18n/kk";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { formatKzt, type PriceBreakdown } from "@/lib/pricing";
import { ActionForm } from "../action-form";
import { retryGeneration, cancelGeneration, refundPayment } from "../actions";

const A = kk.admin.orders;

export default function AdminOrderPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="text-muted">{kk.common.loading}</p>}>
      <Detail params={params} />
    </Suspense>
  );
}

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const u = await getSessionUser();
  if (!u) redirect("/login?next=/admin/orders");
  if (!can(u.role, "orders.view")) return <p className="text-muted">{kk.admin.forbidden}</p>;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const db = supabaseAdmin();
  const { data: o } = await db.from("orders").select("*, profiles(email,display_name)").eq("id", id).maybeSingle();
  if (!o) notFound();
  const [{ data: payments }, { data: jobs }, { data: logs }] = await Promise.all([
    db.from("payments").select("*").eq("order_id", id).order("created_at"),
    db.from("generation_jobs").select("*").eq("order_id", id).order("created_at"),
    db.from("audit_logs").select("action,created_at,actor_id,metadata_json").eq("resource_id", id).order("created_at", { ascending: false }).limit(50),
  ]);
  const prof = (Array.isArray(o.profiles) ? o.profiles[0] : o.profiles) as { email?: string; display_name?: string } | null;
  const snap = o.template_snapshot_json as { title_kk?: string; quality?: { labelKk?: string } };
  const price = o.pricing_breakdown_json as PriceBreakdown;
  const fmt = new Intl.DateTimeFormat("kk-KZ", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Almaty" });
  const activeJob = jobs?.some((j) => ["queued", "processing", "postprocessing"].includes(j.status));
  const card = "rounded-card border border-line bg-white p-5";
  const th = "px-3 py-2 font-medium";
  const td = "px-3 py-2";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/orders" className="-my-2 inline-block py-2 text-sm text-muted hover:text-ink">← {kk.admin.nav.orders}</Link>
        <h1 className="mt-2 font-display text-2xl font-bold">{o.public_order_number}</h1>
        <p className="text-sm text-muted">{snap.title_kk}, {snap.quality?.labelKk ?? o.quality}, {fmt.format(new Date(o.created_at))}</p>
      </div>

      <section className={`${card} flex flex-wrap gap-3`}>
        {can(u.role, "orders.retry") && o.payment_status === "succeeded" && ["failed", "cancelled"].includes(o.generation_status) && (
          <ActionForm action={retryGeneration} fields={{ orderId: o.id }} label={A.retry} confirm={A.retryConfirm} />
        )}
        {can(u.role, "orders.cancel") && activeJob && (
          <ActionForm action={cancelGeneration} fields={{ orderId: o.id }} label={A.cancel} confirm={A.cancelConfirm} />
        )}
        {can(u.role, "orders.refund") && o.payment_status === "succeeded" && (
          <ActionForm action={refundPayment} fields={{ orderId: o.id }} label={A.refund} confirm={A.refundConfirm(formatKzt(o.amount_kzt))} tone="danger" />
        )}
        {prof?.email && (
          <a href={`mailto:${prof.email}?subject=${encodeURIComponent(`TrendVideo ${o.public_order_number}`)}`} className="rounded-full border border-line px-4 py-2 text-sm font-semibold hover:border-ink">
            {A.contact}
          </a>
        )}
      </section>

      <section className={card}>
        <h2 className="mb-3 font-semibold">{A.details}</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
          <dt className="text-muted">{A.colUser}</dt><dd>{prof?.email ?? A.deletedUser}{prof?.display_name ? ` (${prof.display_name})` : ""}</dd>
          <dt className="text-muted">{kk.order.status}</dt>
          <dd>{kk.order.payment[o.payment_status as keyof typeof kk.order.payment]} / {kk.order.generation[o.generation_status as keyof typeof kk.order.generation]}</dd>
          <dt className="text-muted">{kk.pricing.total}</dt>
          <dd>{formatKzt(o.amount_kzt)} ({kk.pricing.videoPrice} {formatKzt(price.basePriceKzt)}, {kk.pricing.quality} +{formatKzt(price.qualitySurchargeKzt)}, {kk.pricing.extraFaces} +{formatKzt(price.extraFacesKzt)}, {kk.pricing.discount} −{formatKzt(price.discountKzt)})</dd>
          <dt className="text-muted">{kk.order.photos}</dt><dd>{o.face_count}{o.photos_deleted_at ? `, ${kk.result.photosDeleted}` : ""}</dd>
        </dl>
      </section>

      <section className={card}>
        <h2 className="mb-3 font-semibold">{A.payments}</h2>
        {!payments?.length ? <p className="text-sm text-muted">{A.none}</p> : (
          <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <thead className="text-muted"><tr><th className={th}>{A.provider}</th><th className={th}>{A.providerRef}</th><th className={th}>{A.colStatus}</th><th className={th}>{A.colAmount}</th><th className={th}>{A.colDate}</th></tr></thead>
            <tbody className="divide-y divide-line">{payments.map((p) => (
              <tr key={p.id}>
                <td className={td}>{p.provider}</td>
                <td className={`${td} font-mono text-xs`}>{p.provider_payment_id ?? "—"}</td>
                <td className={td}>
                  {kk.order.payment[p.status as keyof typeof kk.order.payment]}
                  {p.failure_reason && <span className="block text-xs text-danger">{p.failure_reason}</span>}
                </td>
                <td className={td}>{formatKzt(p.amount_kzt)}</td>
                <td className={`${td} text-muted`}>{fmt.format(new Date(p.created_at))}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>

      <section className={card}>
        <h2 className="mb-3 font-semibold">{A.jobs}</h2>
        {!jobs?.length ? <p className="text-sm text-muted">{A.none}</p> : (
          <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <thead className="text-muted"><tr><th className={th}>{A.provider}</th><th className={th}>{A.providerRef}</th><th className={th}>{A.colStatus}</th><th className={th}>{A.attempts}</th><th className={th}>{A.error}</th><th className={th}>{A.cost}</th></tr></thead>
            <tbody className="divide-y divide-line">{jobs.map((j) => (
              <tr key={j.id}>
                <td className={td}>{j.provider}</td>
                <td className={`${td} font-mono text-xs`}>{j.provider_job_id ?? "—"}</td>
                <td className={td}>{kk.order.generation[j.status as keyof typeof kk.order.generation] ?? j.status}{j.progress !== null ? ` (${j.progress}%)` : ""}</td>
                <td className={td}>{j.attempt_count}</td>
                <td className={`${td} text-xs`}>{j.error_code ? <><span className="font-mono">{j.error_code}</span><span className="block text-muted">{j.safe_error_message}</span></> : "—"}</td>
                <td className={td}>{j.provider_cost ?? "—"}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>

      <section className={card}>
        <h2 className="mb-3 font-semibold">{A.log}</h2>
        {!logs?.length ? <p className="text-sm text-muted">{A.none}</p> : (
          <ul className="space-y-1 text-sm">{logs.map((l, i) => (
            <li key={i}><span className="text-muted">{fmt.format(new Date(l.created_at))}</span> <span className="font-mono text-xs">{l.action}</span></li>
          ))}</ul>
        )}
      </section>
    </div>
  );
}
