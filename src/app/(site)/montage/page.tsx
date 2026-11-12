import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { env } from "@/lib/env";
import { getSessionUser } from "@/lib/auth/session";
import { isGuestEmail } from "@/lib/telegram/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { LoginToCreate } from "@/components/login-to-create";
import { MontageMaker } from "@/components/montage-maker";
import { Logo } from "@/components/logo";

export const metadata = { title: "Автомонтаж" };

/** Автомонтаж: the customer's own clips → one 9:16 video of the best moments (free test). */
export default function MontagePage() {
  return (
    <main className="mx-auto max-w-3xl px-4 pb-28 pt-3 md:pt-10">
      <div className="tg-only mb-3 flex items-center"><Logo className="text-base" /></div>
      <header className="mb-5">
        <span className="inline-flex rounded-full bg-brand px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-night">Новое · бесплатно</span>
        <h1 className="t-h1 mt-3">Автомонтаж</h1>
        <p className="mt-2 text-muted">Загрузите свои видео — соберём ролик 9:16 из лучших моментов: склейки, цвет, музыка и титр. Готово за пару минут.</p>
      </header>
      <Suspense fallback={<div className="skeleton h-96 rounded-card" />}>
        <Body />
      </Suspense>
    </main>
  );
}

async function Body() {
  await connection();
  const user = await getSessionUser();
  if (!user || isGuestEmail(user.email)) return <LoginToCreate next="/montage" />;
  const e = env();
  const { data: mine } = await supabaseAdmin().from("montages").select("id,status,created_at,output_duration_sec")
    .eq("user_id", user.id).neq("status", "draft").order("created_at", { ascending: false }).limit(6);
  const fmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Almaty" });
  const label = (s: string) => (s === "completed" ? "Готово" : s === "failed" ? "Ошибка" : "Собирается…");
  return (
    <>
      <MontageMaker supabaseUrl={e.NEXT_PUBLIC_SUPABASE_URL} anonKey={e.NEXT_PUBLIC_SUPABASE_ANON_KEY} />
      {(mine ?? []).length > 0 && (
        <section className="mt-8">
          <h2 className="section-title mb-3 text-muted">Мои монтажи</h2>
          <ul className="divide-y divide-line rounded-card bg-surface ring-1 ring-line">
            {(mine ?? []).map((m) => (
              <li key={m.id}>
                <Link href={`/montage/${m.id}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-mist">
                  <span>{fmt.format(new Date(m.created_at))}{m.output_duration_sec ? ` · ${Math.round(Number(m.output_duration_sec))} сек` : ""}</span>
                  <span className={m.status === "completed" ? "font-semibold text-success" : m.status === "failed" ? "text-danger" : "text-muted"}>{label(m.status)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
