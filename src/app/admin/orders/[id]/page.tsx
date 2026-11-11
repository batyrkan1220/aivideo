import { Suspense } from "react";
import { ShotsButton } from "@/app/admin/templates/shots-button";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { ru } from "@/lib/i18n/ru";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { formatKzt, type PriceBreakdown } from "@/lib/pricing";
import { ActionForm } from "../action-form";
import { KlingTasks } from "../kling-tasks";
import { retryGeneration, cancelGeneration, refundPayment, remakeOrder } from "../actions";
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
  // Result preview for support (10-minute signed link).
  const live = video && new Date(video.expires_at).getTime() > nowMs();
  const preview = live ? (await db.storage.from("generated-videos").createSignedUrl(video.private_storage_path, 600)).data?.signedUrl ?? null : null;
  const isPhoto = !!video && /\.(jpe?g|png|webp)$/i.test(video.private_storage_path);
  // The customer's uploaded photos, for support (10-minute signed links, private bucket). Gone after the
  // photo retention period. Viewing is written to the order's log.
  const { data: assets } = await db.from("order_assets").select("face_slot_key,private_storage_path,width,height").eq("order_id", id);
  const slotNames = new Map(((o.template_snapshot_json as { face_slots_json?: { key: string; labelKk?: string }[] })?.face_slots_json ?? []).map((f) => [f.key, f.labelKk ?? f.key]));
  const photos = o.photos_deleted_at ? [] : (await Promise.all((assets ?? []).sort((a, b) => a.face_slot_key.localeCompare(b.face_slot_key)).map(async (a) => {
    const { data } = await db.storage.from("user-uploads").createSignedUrl(a.private_storage_path, 600);
    return data ? { url: data.signedUrl, label: slotNames.get(a.face_slot_key) ?? a.face_slot_key, size: a.width && a.height ? `${a.width}×${a.height}` : "" } : null;
  }))).filter((x): x is { url: string; label: string; size: string } => !!x);
  // Character Sheets made before the video (log entries with their files), newest run first.
  const sheetLogs = (logs ?? []).filter((l) => l.action === "generation.character_sheet")
    .map((l) => ({ at: l.created_at as string, ...(l.metadata_json as { person?: number; path?: string | null; result?: string; task?: string } | null ?? {}) }));
  const sheets = await Promise.all(sheetLogs.map(async (m) => {
    const url = m.path && !o.photos_deleted_at ? (await db.storage.from("user-uploads").createSignedUrl(m.path, 600)).data?.signedUrl ?? null : null;
    return { at: m.at, person: Number(m.person) || 1, url, result: String(m.result ?? ""), task: String(m.task ?? "") };
  }));
  if (photos.length) await db.from("audit_logs").insert({ actor_id: u.id, action: "order.photos_viewed", resource_type: "order", resource_id: id, metadata_json: { count: photos.length } });
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
          <h2 className="mb-3 font-semibold">Фото клиента</h2>
          {photos.length ? (
            <div className="flex flex-wrap gap-3">
              {photos.map((p) => (
                <a key={p.url} href={p.url} target="_blank" rel="noreferrer" className="block w-32">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={p.label} className="aspect-[3/4] w-32 rounded-xl bg-mist object-cover ring-1 ring-line" />
                  <span className="mt-1 block text-xs font-semibold">{p.label}</span>
                  {p.size && <span className="block text-[11px] text-muted">{p.size}</span>}
                </a>
              ))}
            </div>
          ) : <p className="text-sm text-muted">{o.photos_deleted_at ? "Фото удалены по сроку хранения" : "Нет фото"}</p>}
          {sheets.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <h3 className="mb-2 text-sm font-semibold">Character Sheet</h3>
              <div className="flex flex-wrap gap-3">
                {sheets.map((sh, i) => (
                  <div key={i} className="w-56">
                    {sh.url ? (
                      <a href={sh.url} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={sh.url} alt={`Character Sheet, человек ${sh.person}`} className="aspect-video w-56 rounded-xl bg-mist object-cover ring-1 ring-line" />
                      </a>
                    ) : (
                      <div className="flex aspect-video w-56 items-center justify-center rounded-xl bg-mist px-3 text-center text-xs text-muted ring-1 ring-line">
                        {o.photos_deleted_at && sh.result === "ok" ? "Удалён вместе с фото" : SHEET_RESULT[sh.result] ?? `Не получился (${sh.result || "ошибка"})`}
                      </div>
                    )}
                    <span className="mt-1 block text-xs font-semibold">Человек {sh.person}</span>
                    <span className="block text-[11px] text-muted">{fmt.format(new Date(sh.at))}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
        <section className={card}>
          <h2 className="mb-3 font-semibold">Результат</h2>
          {preview ? (isPhoto
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={preview} alt="" className="max-h-80 rounded-xl" />
            : <div className="space-y-2"><video src={preview} controls playsInline className="max-h-80 rounded-xl bg-black" /><ShotsButton id={id} order /></div>)
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
        {can(u.role, "orders.retry") && o.payment_status === "succeeded" && o.generation_status === "completed" && !o.photos_deleted_at && !(kids ?? []).length && (
          <ActionForm action={remakeOrder} fields={{ orderId: o.id }} label="↻ Пересоздать бесплатно"
            confirm={`Создать видео ${o.public_order_number} заново бесплатно? Новое видео заменит старое и придёт клиенту в Telegram.`} />
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
        <h2 className="mb-1 font-semibold">Задачи Kling</h2>
        <p className="mb-3 text-sm text-muted">Что вернула каждая генерация: проход каждого человека, каждая сцена. Kling хранит видео около 30 дней.</p>
        <KlingTasks tasks={(logs ?? []).filter((l) => l.action === "generation.kling_task").reverse()
          .map((l) => { const m = l.metadata_json as { task?: string; step?: string } | null; return { task: String(m?.task ?? ""), step: String(m?.step ?? "задача") }; })
          .filter((t) => t.task || t.step)} />
      </section>

      <section className={card}>
        <h2 className="mb-3 font-semibold">{A.log}</h2>
        {!logs?.length ? <p className="text-sm text-muted">{A.none}</p> : (
          <ul className="space-y-1 text-sm">{logs.map((l, i) => (
            <li key={i}><span className="text-muted">{fmt.format(new Date(l.created_at))}</span> <span className="font-mono text-xs">{l.action}</span>
              {l.action === "generation.character_sheet" && (() => { const m = l.metadata_json as { person?: number; result?: string } | null; return <span className="text-xs text-muted"> · Character Sheet, человек {m?.person ?? 1}: {m?.result === "ok" ? "готов" : SHEET_RESULT[m?.result ?? ""] ?? m?.result ?? "—"}</span>; })()}</li>
          ))}</ul>
        )}
      </section>
    </div>
  );
}

const SHEET_RESULT: Record<string, string> = {
  timeout: "Kling не успел — видео сделано по фото",
  not_saved: "Не сохранился — видео сделано по фото",
  provider_content_rejected: "Kling отклонил фото — видео сделано по фото",
  provider_failed: "Kling не сделал — видео сделано по фото",
};
