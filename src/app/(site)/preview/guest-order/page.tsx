import { Suspense } from "react";
import { connection } from "next/server";
import { kk } from "@/lib/i18n/kk";
import { getSessionUser } from "@/lib/auth/session";
import { isStaff } from "@/lib/auth/permissions";
import { listTemplates } from "@/lib/templates/queries";
import { TelegramIcon } from "@/components/telegram-icon";
import { NudgePreview } from "./nudge";

export const metadata = { title: "Предпросмотр: заказ гостя", robots: { index: false } };

/** Staff-only mock of a paid guest's order page (no real order, buttons do nothing). */
export default function GuestOrderPreview({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  return (
    <main className="mx-auto max-w-xl px-4 pt-4">
      <Suspense fallback={null}><Body searchParams={searchParams} /></Suspense>
    </main>
  );
}

async function Body({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  await connection();
  const u = await getSessionUser();
  if (!u || !isStaff(u.role)) return <p className="py-16 text-center text-muted">Только для сотрудников.</p>;
  const ready = (await searchParams).state !== "wait";
  const { items } = await listTemplates({ page: 1, sort: "trending", media: "video" });
  const t = items[0];
  const O = kk.order;
  const tgButton = (
    <span className="flex h-13 w-full items-center justify-center gap-2.5 rounded-full bg-[#2AABEE] px-5 py-3.5 text-[16px] font-bold text-white shadow-[0_12px_28px_-12px_rgba(42,171,238,0.9)]">
      <TelegramIcon />{kk.auth.telegram}
    </span>
  );
  return (
    <div className="space-y-4">
      <p className="rounded-2xl bg-night px-4 py-2.5 text-center text-xs font-semibold text-white">
        Предпросмотр · {ready ? "видео готово" : "видео делается"} · <a className="underline" href={`?state=${ready ? "wait" : "ready"}`}>показать «{ready ? "делается" : "готово"}»</a>
      </p>
      <div>
        <p className="py-2 text-sm font-medium text-muted">← {kk.gallery.title}</p>
        <h1 className="mt-2 text-[26px] font-extrabold leading-tight tracking-tight">{t?.title ?? "Шаблон"}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${ready ? "bg-brand text-night" : "bg-peach text-night"}`}>{ready ? kk.order.generation.completed : kk.order.generation.processing}</span>
          <span>TM-100123 · сегодня</span>
        </div>
      </div>

      <section className="rounded-[24px] bg-surface p-4 ring-1 ring-line">
        <div className="relative mx-auto aspect-[9/16] w-full max-w-[min(100%,calc(56svh*9/16))] overflow-hidden rounded-[20px] bg-night">
          {ready && t?.previewUrl
            ? <video src={t.previewUrl} controls playsInline muted autoPlay loop className="h-full w-full object-cover" />
            : <span className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white"><span className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white" /><span className="text-sm">ИИ делает видео… 3–5 минут</span></span>}
        </div>
        {ready && <span className="mx-auto mt-4 flex h-12 max-w-sm items-center justify-center rounded-full bg-ink text-sm font-bold text-paper">⬇ {kk.result.download}</span>}
      </section>

      <section className="relative overflow-hidden rounded-[24px] bg-[#2AABEE]/10 p-4 ring-1 ring-[#2AABEE]/30">
        <span className="absolute right-3 top-3 rounded-full bg-brand px-2.5 py-1 text-xs font-extrabold text-night">🎁 −20%</span>
        <p className="pr-16 text-[16px] font-extrabold">{O.tgTitle}</p>
        <ul className="mb-3 mt-2 space-y-1 text-sm">
          {O.tgPoints.map((p) => <li key={p} className="flex gap-2"><span className="text-[#229ED9]" aria-hidden>✓</span>{p}</li>)}
        </ul>
        {tgButton}
        <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-white/70 px-3 py-2.5 text-xs">
          <span className="min-w-0 text-muted">{O.linkNote}</span>
          <span className="shrink-0 rounded-full border border-line px-3 py-1.5 text-xs font-semibold">{O.copyLink}</span>
        </div>
      </section>

      <NudgePreview ready={ready} title={ready ? O.nudgeTitleReady : O.nudgeTitleWait} text={O.nudgeText} later={O.nudgeLater}>{tgButton}</NudgePreview>
    </div>
  );
}
