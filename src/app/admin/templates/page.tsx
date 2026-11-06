import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { ru } from "@/lib/i18n/ru";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { mediaUrl } from "@/lib/templates/queries";
import { formatKzt } from "@/lib/pricing";
import { klingUnits } from "@/lib/pricing-seedance";
import { seedancePricingSettings } from "@/lib/pricing-seedance/settings";
import { pricingConfigSchema } from "@/lib/templates/schema";
import { DeleteTemplateButton } from "./delete-button";
import { CopyLink } from "./copy-link";
import { botUsername } from "@/lib/partners";
import { env } from "@/lib/env";
import { Badge, Chips, PageHead, nowMs } from "../ui";
import { ReanalyzeButton } from "./reanalyze-button";

type SP = { s?: string; q?: string; sort?: string };
const STATUS: Record<string, { label: string; color: "green" | "gray" | "amber" }> = {
  published: { label: "Опубликован", color: "green" },
  draft: { label: "Черновик", color: "gray" },
  disabled: { label: "Скрыт", color: "amber" },
  archived: { label: "Архив", color: "gray" },
};
const SORTS = { updated: "Изменённые", paid: "Продажи", views: "Просмотры", conv: "Конверсия" } as const;

export default function TemplatesAdminPage({ searchParams }: { searchParams: Promise<SP> }) {
  return (
    <div>
      <PageHead title="Шаблоны" lead="Видео-шаблоны каталога. Статистика — за 30 дней.">
        <Link href="/admin/categories" className="rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold hover:border-ink">🗂 Категории</Link>
        <Link href="/admin/templates/new" className="rounded-full bg-night px-4 py-2 text-sm font-semibold text-white">+ Новый шаблон</Link>
      </PageHead>
      <Suspense fallback={<p className="text-muted">{ru.common.loading}</p>}>
        <List searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function List({ searchParams }: { searchParams: Promise<SP> }) {
  await connection();
  const u = await getSessionUser();
  if (!u) redirect("/login?next=/admin/templates");
  if (!can(u.role, "templates.manage")) return <p className="text-muted">{ru.admin.forbidden}</p>;
  const sp = await searchParams;
  const db = supabaseAdmin();

  const [{ data }, { data: stats }, { data: cats }, pricing] = await Promise.all([
    db.from("templates")
      .select("id,title_kk,status,required_face_count,updated_at,is_trending,provider_key,cover_asset_path,preview_video_path,preview_lite_path,preview_anim_path,pricing_config_json,category_id,video_duration_sec,analyzed_at:provider_config_json->>analyzedAt")
      .eq("kind", "catalog").is("deleted_at", null).order("updated_at", { ascending: false }),
    db.rpc("admin_template_stats", { p_from: new Date(nowMs() - 30 * 86400_000).toISOString() }),
    db.from("categories").select("id,title_kk"),
    seedancePricingSettings(),
  ]);
  const all = data ?? [];
  const bot = await botUsername().catch(() => null);
  const site = env().NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  const byId = new Map(((stats ?? []) as { template_id: string; views: number; orders: number; paid: number; revenue: number }[]).map((r) => [r.template_id, r]));
  const catName = new Map((cats ?? []).map((c) => [c.id, c.title_kk as string]));
  const status = sp.s && STATUS[sp.s] ? sp.s : "";
  const term = (sp.q ?? "").trim().toLowerCase();
  const sort = (sp.sort && sp.sort in SORTS ? sp.sort : "updated") as keyof typeof SORTS;

  const rows = all
    .filter((t) => (!status || t.status === status) && (!term || t.title_kk.toLowerCase().includes(term)))
    .map((t) => ({ t, s: byId.get(t.id) ?? { views: 0, orders: 0, paid: 0, revenue: 0 } }))
    .sort((a, b) =>
      sort === "paid" ? Number(b.s.revenue) - Number(a.s.revenue) || Number(b.s.orders) - Number(a.s.orders)
      : sort === "views" ? Number(b.s.views) - Number(a.s.views)
      : sort === "conv" ? (Number(b.s.orders) / Math.max(1, Number(b.s.views))) - (Number(a.s.orders) / Math.max(1, Number(a.s.views)))
      : 0);
  const count = (k: string) => all.filter((t) => !k || t.status === k).length;
  const href = (o: Partial<SP>) => `/admin/templates?${new URLSearchParams(Object.entries({ s: status, q: sp.q ?? "", sort: sort === "updated" ? "" : sort, ...o }).filter(([, v]) => v) as [string, string][])}`;

  return (
    <>
      <Chips active={status || "all"} items={[
        { key: "all", label: "Все", count: count(""), href: href({ s: "" }) },
        ...Object.entries(STATUS).map(([k, v]) => ({ key: k, label: v.label, count: count(k), href: href({ s: k }) })),
      ]} />
      <form className="mb-4 flex flex-wrap items-center gap-2">
        {status && <input type="hidden" name="s" value={status} />}
        <input name="q" defaultValue={sp.q} placeholder="Поиск по названию" className="h-10 w-full rounded-full border border-line bg-white px-4 text-base sm:w-64 sm:text-sm" />
        <select name="sort" defaultValue={sort} className="h-10 flex-1 rounded-full border border-line bg-white px-4 text-sm sm:flex-none">
          {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>Сортировка: {v}</option>)}
        </select>
        <button className="h-10 rounded-full bg-night px-5 text-sm font-semibold text-white">Показать</button>
      </form>

      {!rows.length ? <p className="rounded-2xl border border-dashed border-line bg-white p-10 text-center text-muted">Шаблонов нет</p> : (
        <ul className="grid gap-3">
          {rows.map(({ t, s }) => {
            const cover = mediaUrl(t.cover_asset_path);
            const price = pricingConfigSchema.safeParse(t.pricing_config_json).data?.basePriceKzt;
            const units = t.provider_key !== "kling_photo" && t.video_duration_sec ? klingUnits(Number(t.video_duration_sec), pricing) : null;
            const st = STATUS[t.status] ?? { label: t.status, color: "gray" as const };
            const conv = Number(s.views) ? Math.round((Number(s.orders) / Number(s.views)) * 1000) / 10 : null;
            return (
              <li key={t.id} className="rounded-2xl border border-line bg-white p-3 lg:flex lg:items-center lg:gap-4">
                {/* Cover + title + badges */}
                <div className="flex min-w-0 gap-3 lg:flex-1 lg:items-center">
                  <Link href={`/admin/templates/${t.id}`} className="relative h-24 w-16 shrink-0 overflow-hidden rounded-xl bg-paper ring-1 ring-line lg:h-20 lg:w-12 lg:rounded-lg">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {cover ? <img src={cover} alt="" className="h-full w-full object-cover" loading="lazy" /> : <span className="flex h-full items-center justify-center text-lg">🎬</span>}
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link href={`/admin/templates/${t.id}`} className="line-clamp-2 font-bold leading-snug hover:underline">{t.title_kk}</Link>
                    <p className="mt-0.5 text-xs text-muted">{t.required_face_count} чел.{t.video_duration_sec ? ` · ${Math.round(Number(t.video_duration_sec))} с` : ""}{units !== null ? ` · ${units.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} юн.` : ""}{price ? ` · ${formatKzt(price)}` : " · авто-цена"}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      <Badge color={st.color}>{st.label}</Badge>
                      {t.is_trending && <Badge color="lime">🔥 тренд</Badge>}
                      {t.category_id && catName.get(t.category_id) && <Badge>{catName.get(t.category_id)}</Badge>}
                      {!t.preview_video_path && <Badge color="red">нет видео</Badge>}
                      {t.preview_video_path && (!t.preview_lite_path || !t.preview_anim_path) && <Badge color="amber">превью сжимается</Badge>}
                      {t.provider_key === "seedance" && !t.analyzed_at && <Badge color="red">нужен ИИ-анализ · недоступен клиентам</Badge>}
                      {t.provider_key === "seedance" && t.preview_video_path && <ReanalyzeButton id={t.id} />}
                    </div>
                  </div>
                </div>
                {/* Stats: a tidy strip on phones */}
                <dl className="mt-3 grid grid-cols-4 gap-1 rounded-xl bg-paper px-1 py-2 text-center text-[11px] lg:mt-0 lg:w-[22rem] lg:shrink-0 lg:bg-transparent lg:p-0 lg:text-xs">
                  <div><dt className="text-muted">Просм.</dt><dd className="text-[15px] font-extrabold leading-tight lg:text-base">{s.views}</dd></div>
                  <div><dt className="text-muted">Заказы</dt><dd className="text-[15px] font-extrabold leading-tight lg:text-base">{s.orders}</dd></div>
                  <div><dt className="text-muted">Конв.</dt><dd className="text-[15px] font-extrabold leading-tight lg:text-base">{conv === null ? "—" : `${conv}%`}</dd></div>
                  <div><dt className="text-muted">Выручка</dt><dd className="truncate text-[15px] font-extrabold leading-tight lg:text-base">{Number(s.revenue) ? formatKzt(Number(s.revenue)) : "—"}</dd></div>
                </dl>
                {/* Actions: links in one row, then edit / orders / delete */}
                <div className="mt-3 space-y-2 text-sm lg:mt-0 lg:w-[19rem] lg:shrink-0">
                  <div className="grid grid-cols-3 gap-1.5 [&>button]:w-full [&>button]:px-1">
                    {bot ? <CopyLink url={`https://t.me/${bot}?startapp=t_${t.id}`} label="🔗 Mini App" /> : <span />}
                    <CopyLink url={`${site}/templates/${t.id}`} label="🔗 Сайт" />
                    <CopyLink url={`${site}/go/${t.id}`} label="🎯 Реклама" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Link href={`/admin/templates/${t.id}`} className="flex h-10 flex-1 items-center justify-center rounded-full bg-night font-semibold text-white">Изменить</Link>
                    <Link href={`/admin/orders?template=${t.id}`} className="flex h-10 items-center justify-center rounded-full border border-line px-4 font-semibold text-ink hover:border-ink">Заказы</Link>
                    {can(u.role, "templates.publish") && <span className="px-1"><DeleteTemplateButton id={t.id} title={t.title_kk} /></span>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
