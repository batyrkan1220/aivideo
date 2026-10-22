import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ru } from "@/lib/i18n/ru";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { ButtonLink } from "@/components/ui/button";

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-line text-ink",
  published: "bg-emerald-100 text-success",
  disabled: "bg-amber-100 text-amber-800",
  archived: "bg-paper text-muted border border-line",
};

export default function TemplatesAdminPage() {
  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="font-display text-2xl font-bold">{ru.admin.nav.templates}</h1>
        <ButtonLink href="/admin/templates/new">+ {ru.admin.list.newTemplate}</ButtonLink>
      </div>
      <Suspense fallback={<p className="text-muted">{ru.common.loading}</p>}>
        <List />
      </Suspense>
    </div>
  );
}

async function List() {
  const u = await getSessionUser();
  if (!u) redirect("/login?next=/admin/templates");
  if (!can(u.role, "templates.manage")) return <p className="text-muted">{ru.admin.forbidden}</p>;

  const { data } = await supabaseAdmin().from("templates")
    .select("id,title_kk,status,required_face_count,updated_at,is_trending")
    .order("updated_at", { ascending: false });

  if (!data?.length) {
    return <p className="rounded-card border border-dashed border-line bg-white p-10 text-center text-muted">{ru.admin.list.empty}</p>;
  }
  const fmt = new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Almaty" });

  return (
    <div className="overflow-x-auto rounded-card border border-line bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-line text-muted">
          <tr>
            <th className="px-4 py-3 font-medium">{ru.admin.list.colTitle}</th>
            <th className="px-4 py-3 font-medium">{ru.admin.list.colStatus}</th>
            <th className="px-4 py-3 font-medium">{ru.admin.list.colFaces}</th>
            <th className="px-4 py-3 font-medium">{ru.admin.list.colUpdated}</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {data.map((t) => (
            <tr key={t.id}>
              <td className="px-4 py-3 font-medium">
                {t.title_kk}
                {t.is_trending && <span className="ml-2 rounded-full bg-flash px-2 py-0.5 text-xs font-bold">{ru.catalog2.trendBadge}</span>}
              </td>
              <td className="px-4 py-3">
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[t.status]}`}>
                  {ru.admin.status[t.status as keyof typeof ru.admin.status]}
                </span>
              </td>
              <td className="px-4 py-3">{t.required_face_count}</td>
              <td className="px-4 py-3 text-muted">{fmt.format(new Date(t.updated_at))}</td>
              <td className="px-4 py-3 text-right">
                <Link href={`/admin/templates/${t.id}`} className="font-semibold text-brand hover:underline">{ru.admin.list.edit}</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
