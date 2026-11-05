import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { ru } from "@/lib/i18n/ru";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { formatKzt, type PriceBreakdown } from "@/lib/pricing";
import { ActionForm } from "../action-form";
import { retryGeneration, cancelGeneration, refundPayment } from "../actions";
import { unitsFromUsd } from "@/lib/pricing-seedance";
import { seedancePricingSettings } from "@/lib/pricing-seedance/settings";
import { Badge, Stat, orderState, usd, nowMs } from "../../ui";

const A = ru.admin.orders;

export default function AdminOrderPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="text-muted">{ru.common.loading}</p>}>
      <Detail params={params} />
    </Suspense>
  );
}

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const u = await getSessionUser();
  if (!u) redirect("/login?next=/admin/orders");
  if (!can(u.role, "orders.view")) return <p className="text-muted">{ru.admin.forbidden}</p>;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const db = supabaseAdmin();
  const { data: o } = await db.from("orders").select("*, profiles(email,display_name,telegram_username,telegram_id,phone)").eq("id", id).maybeSingle();
  if (!o) notFound();
  const [{ data: payments }, { data: jobs }, { data: logs }, { data: kids }, { data: video }, ap] = await Promise.all([
    db.from("payments").select("*").eq("order_id", id).order("created_at"),
    db.from("generation_jobs").select("*").eq("order_id", id).order("created_at"),
    db.from("audit_logs").select("action,created_at,actor_id,metadata_json").eq("resource_id", id).order("created_at", { ascending: false }).limit(50),
    db.from("orders").select("id,public_order_number,generation_status,template_snapshot_json,generation_jobs(provider_cost)").eq("parent_order_id", id).order("created_at"),
    db.from("generated_videos").select("private_storage_path,expires_at").eq("order_id", id).maybeSingle(),
    seedancePricingSettings(),
  ]);
  const prof = (Array.isArray(o.profiles) ? o.profiles[0] : o.profiles) as { email?: string; display_name?: string; telegram_username?: string | null; telegram_id?: number | null; phone?: string | null } | null;
  // Result preview for support (10-minute signed link; the customer's photos stay private).
  const live = video && new Date(video.expires_at).getTime() > nowMs();
  const preview = live ? (await db.storage.from("generated-videos").createSignedUrl(video.private_storage_path, 600)).data?.signedUrl ?? null : null;
  const isPhoto = !!video && /\.(jpe?g|png|webp)$/i.test(video.private_storage_path);
  const kidCost = (kids ?? []).reduce((n, k) => n + ((Array.isArray(k.generation_jobs) ? k.generation_jobs : []) as { provider_cost: number | null }[]).reduce((m, j) => m + (Number(j.provider_cost) || 0), 0), 0);
  const costUsd = (jobs ?? []).filter((j) => j.provider !== "combo").reduce((n, j) => n + (Number(j.provider_cost) || 0), 0) + kidCost;
  const units = unitsFromUsd((jobs ?? []).filter((j) => j.provider === "seedance").reduce((n, j) => n + (Number(j.provider_cost) || 0), 0), ap);
  const costKzt = Math.round(costUsd * ap.tengePerUsd);
  const providers = (payments ?? []).filter((p) => p.status === "succeeded").map((p) => p.provider as string);
  const real = providers.some((p) => !["free", "sandbox", "tole_sandbox"].includes(p));
  const st = orderState(o.payment_status, o.generation_status, o.amount_kzt, providers);
  const snap = o.template_snapshot_json as { title_kk?: string; quality?: { labelKk?: string } };
  const price = o.pricing_breakdown_json as PriceBreakdown;
  const fmt = new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Almaty" });
  const activeJob = jobs?.some((j) => ["queued", "processing", "postprocessing"].includes(j.status));
  const card = "rounded-2xl border border-line bg-white p-5";
  const th = "px-3 py-2 font-medium";
  const td = "px-3 py-2";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/orders" className="-my-2 inline-block py-2 text-sm text-muted hover:text-ink">← {ru.admin.nav.orders}</Link>
        <h1 className="mt-2 flex flex-wrap items-center gap-2 text-2xl font-extrabold tracking-tight">{o.public_order_number} <Badge color={st.color}>{st.label}</Badge>{units !== null && <span className="text-base font-semibold text-muted">{units.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} юн.</span>}</h1>
        <p className="text-sm text-muted">{snap.title_kk}, {snap.quality?.labelKk ?? o.quality}, {fmt.format(new Date(o.created_at))}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat tone="dark" label="Сумма" value={formatKzt(o.amount_kzt)} sub={providers.includes("free") ? "бесплатный заказ" : real ? "оплачено" : providers.length ? "тест" : "не оплачено"} />
        <Stat label="Расход ИИ" value={costUsd ? formatKzt(costKzt) : "—"} sub={costUsd ? usd(costUsd) : undefined} />
        <Stat tone={!real ? "default" : o.amount_kzt - costKzt >= 0 ? "good" : "bad"} label="Прибыль" value={real ? formatKzt(o.amount_kzt - costKzt) : "—"} />
        <Stat label="Время генерации" value={(() => { const j = (jobs ?? []).find((x) => x.started_at && x.completed_at); return j ? `${Math.round((Date.parse(j.completed_at) - Date.parse(j.started_at)) / 6000) / 10} мин` : "—"; })()} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className={card}>
          <h2 className="mb-3 font-semibold">Клиент</h2>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1.5 text-sm [&>dd]:break-words">
            <dt className="text-muted">Имя</dt><dd>{prof?.display_name ?? "—"}</dd>
            <dt className="text-muted">Telegram</dt><dd>{prof?.telegram_username ? <a href={`https://t.me/${prof.telegram_username}`} target="_blank" rel="noreferrer" className="font-semibold text-blue-700 hover:underline">@{prof.telegram_username}</a> : prof?.telegram_id ? "есть (без username)" : "—"}</dd>
            <dt className="text-muted">Телефон</dt><dd>{prof?.phone ?? "—"}</dd>
            <dt className="text-muted">E-mail</dt><dd>{prof?.email ?? "—"}</dd>
          </dl>
        </section>
        <section className={card}>
          <h2 className="mb-3 font-semibold">Результат</h2>
          {preview ? (isPhoto
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={preview} alt="" className="max-h-80 rounded-xl" />
            : <video src={preview} controls playsInline className="max-h-80 rounded-xl bg-black" />)
            : <p className="text-sm text-muted">{video && !live ? "Файл удалён по сроку хранения" : (kids ?? []).length ? "Фото — в списке комбо ниже" : "Пока нет"}</p>}
        </section>
      </div>

      {(kids ?? []).length > 0 && (
        <section className={card}>
          <h2 className="mb-3 font-semibold">Комбо: фото ({(kids ?? []).filter((k) => k.generation_status === "completed").length} / {(kids ?? []).length})</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {(kids ?? []).map((k) => (
              <li key={k.id}><Link href={`/admin/orders/${k.id}`} className="flex items-center justify-between gap-2 rounded-xl bg-paper px-3 py-2 text-sm ring-1 ring-line hover:ring-ink">
                <span className="truncate">{k.public_order_number} · {(k.template_snapshot_json as { title_kk?: string }).title_kk}</span>
                <Badge color={k.generation_status === "completed" ? "green" : k.generation_status === "failed" ? "red" : "blue"}>{ru.order.generation[k.generation_status as keyof typeof ru.order.generation] ?? k.generation_status}</Badge>
              </Link></li>
            ))}
          </ul>
        </section>
      )}

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
          <a href={`mailto:${prof.email}?subject=${encodeURIComponent(`TrendMe ${o.public_order_number}`)}`} className="rounded-full border border-line px-4 py-2 text-sm font-semibold hover:border-ink">
            {A.contact}
          </a>
        )}
      </section>

      <section className={card}>
        <h2 className="mb-3 font-semibold">{A.details}</h2>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] [&>dd]:break-words gap-x-6 gap-y-1.5 text-sm">
          <dt className="text-muted">{A.colUser}</dt><dd>{prof?.email ?? A.deletedUser}{prof?.display_name ? ` (${prof.display_name})` : ""}</dd>
          <dt className="text-muted">{ru.order.status}</dt>
          <dd>{ru.order.payment[o.payment_status as keyof typeof ru.order.payment]} / {ru.order.generation[o.generation_status as keyof typeof ru.order.generation]}</dd>
          <dt className="text-muted">{ru.pricing.total}</dt>
          <dd>{formatKzt(o.amount_kzt)} ({ru.pricing.videoPrice} {formatKzt(price.basePriceKzt)}, {ru.pricing.quality} +{formatKzt(price.qualitySurchargeKzt)}, {ru.pricing.extraFaces} +{formatKzt(price.extraFacesKzt)}, {ru.pricing.discount} −{formatKzt(price.discountKzt)})</dd>
          <dt className="text-muted">{ru.order.photos}</dt><dd>{o.face_count}{o.photos_deleted_at ? `, ${ru.result.photosDeleted}` : ""}</dd>
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
                  {ru.order.payment[p.status as keyof typeof ru.order.payment]}
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
            <tbody className="divide-y divide-line">{jobs.map((j) => {
              const jobUnits = j.provider === "seedance" ? unitsFromUsd(Number(j.provider_cost) || 0, ap) : null;
              return (
              <tr key={j.id}>
                <td className={td}>{j.provider}</td>
                <td className={`${td} font-mono text-xs`}>{j.provider_job_id ?? "—"}</td>
                <td className={td}>{ru.order.generation[j.status as keyof typeof ru.order.generation] ?? j.status}{j.progress !== null ? ` (${j.progress}%)` : ""}</td>
                <td className={td}>{j.attempt_count}</td>
                <td className={`${td} text-xs`}>{j.error_code ? <><span className="font-mono">{j.error_code}</span><span className="block text-muted">{j.safe_error_message}</span></> : "—"}</td>
                <td className={td}>{j.provider_cost ? <>{jobUnits !== null && <span className="font-semibold">{jobUnits.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} юн. · </span>}{formatKzt(Math.round(Number(j.provider_cost) * ap.tengePerUsd))} <span className="text-xs text-muted">{usd(Number(j.provider_cost))}</span></> : "—"}</td>
              </tr>
              );
            })}</tbody>
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
