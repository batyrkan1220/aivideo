import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ru } from "@/lib/i18n/ru";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { CartoonTool } from "./tool";
import type { CartoonRun } from "./actions";

export default function CartoonPage() {
  return (
    <Suspense fallback={<div className="skeleton h-96 rounded-card" />}>
      <Body />
    </Suspense>
  );
}

async function Body() {
  const u = await getSessionUser();
  if (!u) redirect("/login?next=/admin/cartoon");
  if (!can(u.role, "templates.manage")) return <p className="text-muted">{ru.admin.forbidden}</p>;
  // Earlier runs (results stay on Kling's link), so a refresh does not lose them.
  const { data } = await supabaseAdmin().from("audit_logs").select("metadata_json")
    .eq("action", "cartoon.run").order("created_at", { ascending: false }).limit(12);
  const runs = (data ?? []).map((r) => r.metadata_json as CartoonRun).filter((r) => typeof r?.task === "string");
  const e = env();
  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-2xl">Мультфильм</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Загрузите видео — Kling 4.0 перерисует его в мультфильм. Это редактирование самого видео: движения, лица, фигуры, кадр и длительность остаются как в оригинале, меняется только стиль.
        </p>
      </header>
      <CartoonTool initialRuns={runs} anonKey={e.NEXT_PUBLIC_SUPABASE_ANON_KEY} />
    </div>
  );
}
