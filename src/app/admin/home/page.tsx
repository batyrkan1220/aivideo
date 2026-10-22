import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ru } from "@/lib/i18n/ru";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { readShowcaseSetting } from "@/lib/templates/showcase";
import { ShowcaseForm } from "./form";

export default function AdminHomePage() {
  return (
    <div>
      <h1 className="font-display text-2xl font-bold">{ru.admin.home.title}</h1>
      <p className="mb-6 mt-2 max-w-2xl text-sm text-muted">{ru.admin.home.hint}</p>
      <Suspense fallback={<p className="text-muted">{ru.common.loading}</p>}>
        <Editor />
      </Suspense>
    </div>
  );
}

async function Editor() {
  const u = await getSessionUser();
  if (!u) redirect("/login?next=/admin/home");
  if (!can(u.role, "templates.manage")) return <p className="text-muted">{ru.admin.forbidden}</p>;
  const [{ data }, current] = await Promise.all([
    supabaseAdmin().from("templates").select("id,title_kk,cover_asset_path,preview_video_path")
      .eq("status", "published").eq("kind", "catalog").order("title_kk"),
    readShowcaseSetting(),
  ]);
  const options = (data ?? []).map((t) => ({ id: t.id, title: t.title_kk, cover: t.cover_asset_path ?? t.preview_video_path }));
  // Drop selections that are no longer published so the form shows them as "Автоматты".
  const valid = current.map((id) => (id && options.some((o) => o.id === id) ? id : null));
  return <ShowcaseForm options={options} current={valid} />;
}
