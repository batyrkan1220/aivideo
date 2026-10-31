import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ru } from "@/lib/i18n/ru";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { formatKzt } from "@/lib/pricing";
import { klingStatus } from "@/lib/generation/kling";
import { seedancePricingSettings } from "@/lib/pricing-seedance/settings";
import { customVideoSettings } from "@/lib/custom-video/settings";
import { SeedancePricingForm } from "../seedance-pricing/form";
import { CustomVideoForm } from "../custom-video/form";
import { Badge, Card, PageHead, Stat, fmtDate, usd, nowMs } from "../ui";

export const metadata = { title: "AI и расходы" };

export default function ServicesPage() {
  return (
    <div>
      <PageHead title="AI-сервисы и расходы" lead="Баланс Kling, сколько уходит на генерацию, цены и себестоимость." />
      <Suspense fallback={<p className="text-muted">{ru.common.loading}</p>}>
        <Body />
      </Suspense>
    </div>
  );
}

const JOB: Record<string, { label: string; color: "green" | "red" | "blue" | "gray" | "amber" }> = {
  completed: { label: "готово", color: "green" }, failed: { label: "ошибка", color: "red" },
  queued: { label: "в очереди", color: "amber" }, processing: { label: "в работе", color: "blue" },
  postprocessing: { label: "обработка", color: "blue" }, cancelled: { label: "остановлено", color: "gray" },
};

async function Body() {
  await connection();
  const u = await getSessionUser();
  if (!u || !can(u.role, "templates.manage")) return <p className="text-muted">{ru.admin.forbidden}</p>;
  const db = supabaseAdmin();
  const now = nowMs();
  const d30 = new Date(now - 30 * 86400_000).toISOString();
  const d7 = new Date(now - 7 * 86400_000).toISOString();
  const today = new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty" }).format(new Date())}T00:00:00+05:00`).toISOString();

  const [kling, ap, cv, { data: jobs30 }, { data: recent }] = await Promise.all([
    klingStatus(), seedancePricingSettings(), customVideoSettings(),
    db.from("generation_jobs").select("provider,status,provider_cost,created_at").gte("created_at", d30).neq("provider", "combo"),
    db.from("generation_jobs").select("id,order_id,provider,status,provider_cost,error_code,created_at,completed_at,started_at,orders(public_order_number,amount_kzt,template_snapshot_json)")
      .neq("provider", "combo").order("created_at", { ascending: false }).limit(25),
  ]);
  const rate = ap.tengePerUsd;
  const j = jobs30 ?? [];
  const sumUsd = (xs: typeof j) => xs.reduce((n, x) => n + (Number(x.provider_cost) || 0), 0);
  const cToday = sumUsd(j.filter((x) => x.created_at >= today));
  const c7 = sumUsd(j.filter((x) => x.created_at >= d7));
  const c30 = sumUsd(j);
  const done = j.filter((x) => x.status === "completed");
  const failed = j.filter((x) => x.status === "failed");
  const wasted = sumUsd(failed);
  const perVideo = done.length ? sumUsd(done) / done.length : 0;
  const video = j.filter((x) => x.provider !== "kling_photo"), photo = j.filter((x) => x.provider === "kling_photo");
  const kz = (n: number) => formatKzt(Math.round(n * rate));

  return (
    <div className="space-y-6">
      <Card title={<>Kling AI {kling.state === "ok" ? <Badge color="green">подключено</Badge> : kling.state === "none" ? <Badge color="red">нет ключа</Badge> : <Badge color="red">{kling.state === "auth" ? "ключ отклонён" : "нет связи"}</Badge>}</>}
>
        {kling.state === "none" && <p className="text-sm text-muted">Добавьте KLING_API_KEY в Render → Environment.</p>}
        {kling.state === "auth" && <p className="text-sm text-red-700">Ключ отклонён. Проверьте KLING_API_KEY в Render.</p>}
        {kling.state === "error" && <p className="text-sm text-muted">Kling не ответил. Обновите страницу позже.</p>}
        {kling.state === "ok" && (
          (kling.packs ?? []).length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {kling.packs!.map((p) => {
                const share = p.remaining / Math.max(1, p.total);
                return (
                  <div key={p.name} className="rounded-xl bg-paper p-3 ring-1 ring-line">
                    <div className="flex items-start justify-between gap-2 text-sm">
                      <span className="font-semibold">{p.name}{p.for40 && <span className="ml-1.5"><Badge color="lime">Kling 4.0</Badge></span>}</span>
                      <span className="shrink-0 font-extrabold">{p.remaining.toLocaleString("ru-RU")} <span className="font-normal text-muted">/ {p.total.toLocaleString("ru-RU")}</span></span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-line"><div className={`h-full rounded-full ${share < 0.15 ? "bg-red-400" : share < 0.4 ? "bg-amber-400" : "bg-[#b5d420]"}`} style={{ width: `${Math.min(100, share * 100)}%` }} /></div>
                    <p className="mt-1 text-xs text-muted">осталось {Math.round(share * 100)}%{share < 0.15 ? " — пора пополнить" : ""}</p>
                  </div>
                );
              })}
            </div>
          ) : <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">Нет активных пакетов — генерация видео и фото не пойдёт. Купите пакет в кабинете Kling.</p>
        )}
        {kling.state === "ok" && !(kling.packs ?? []).some((p) => p.for40 && p.remaining > 0) && (kling.packs ?? []).length > 0 && (
          <p className="mt-3 text-sm text-amber-800">Для видео (Kling 4.0) нужен Flagship-пакет.</p>
        )}
        <p className="mt-3 text-xs text-muted">Kling обновляет остаток с задержкой до 12 часов.</p>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat tone="dark" label="Расход сегодня" value={kz(cToday)} sub={usd(cToday)} />
        <Stat label="За 7 дней" value={kz(c7)} sub={usd(c7)} />
        <Stat label="За 30 дней" value={kz(c30)} sub={`${usd(c30)} · видео ${usd(sumUsd(video))} · фото ${usd(sumUsd(photo))}`} />
        <Stat tone={wasted > 0 ? "warn" : "default"} label="Одно готовое видео" value={done.length ? kz(perVideo) : "—"} sub={`${done.length} готово · ${failed.length} ошибок${wasted > 0 ? ` (потеряно ${usd(wasted)})` : ""}`} />
      </div>

      <Card title="Последние генерации" action={<Link href="/admin/orders" className="text-sm font-semibold text-muted hover:text-ink">Заказы →</Link>}>
        {!recent?.length ? <p className="text-sm text-muted">Пока нет</p> : (
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[38rem] text-sm">
              <thead className="text-left text-xs text-muted"><tr>
                <th className="py-1.5 font-medium">Заказ</th><th className="py-1.5 font-medium">Тип</th><th className="py-1.5 font-medium">Статус</th>
                <th className="py-1.5 font-medium">Время</th><th className="py-1.5 text-right font-medium">Расход</th><th className="py-1.5 text-right font-medium">Цена</th>
              </tr></thead>
              <tbody className="divide-y divide-line">
                {recent.map((r) => {
                  const o = (Array.isArray(r.orders) ? r.orders[0] : r.orders) as { public_order_number?: string; amount_kzt?: number; template_snapshot_json?: { title_kk?: string } } | null;
                  const st = JOB[r.status] ?? { label: r.status, color: "gray" as const };
                  const mins = r.started_at && r.completed_at ? Math.round((Date.parse(r.completed_at) - Date.parse(r.started_at)) / 6000) / 10 : null;
                  return (
                    <tr key={r.id}>
                      <td className="py-2 pr-2"><Link href={`/admin/orders/${r.order_id}`} className="font-semibold hover:underline">{o?.public_order_number}</Link><span className="block max-w-[11rem] truncate text-xs text-muted">{o?.template_snapshot_json?.title_kk}</span></td>
                      <td className="py-2">{r.provider === "kling_photo" ? "📸 фото" : "🎬 видео"}</td>
                      <td className="py-2"><Badge color={st.color}>{st.label}</Badge>{r.error_code && <span className="block font-mono text-[11px] text-red-700">{r.error_code}</span>}</td>
                      <td className="py-2 text-xs text-muted">{fmtDate.format(new Date(r.created_at))}{mins !== null ? ` · ${mins} мин` : ""}</td>
                      <td className="py-2 text-right">{r.provider_cost ? <>{kz(Number(r.provider_cost))}<span className="block text-xs text-muted">{usd(Number(r.provider_cost))}</span></> : "—"}</td>
                      <td className="py-2 text-right text-muted">{o?.amount_kzt ? formatKzt(o.amount_kzt) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <SeedancePricingForm value={ap} />
      <CustomVideoForm value={cv} />
    </div>
  );
}
