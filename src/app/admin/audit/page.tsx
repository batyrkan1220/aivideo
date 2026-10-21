import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { kk } from "@/lib/i18n/kk";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";

const L = kk.admin.audit;

export default function AuditPage() {
  return (
    <div>
      <h1 className="mb-6 font-display text-2xl font-bold">{kk.admin.nav.audit}</h1>
      <Suspense fallback={<p className="text-muted">{kk.common.loading}</p>}>
        <List />
      </Suspense>
    </div>
  );
}

async function List() {
  const u = await getSessionUser();
  if (!u) redirect("/login?next=/admin/audit");
  if (!can(u.role, "audit.view")) return <p className="text-muted">{kk.admin.forbidden}</p>;
  const { data } = await supabaseAdmin().from("audit_logs")
    .select("id,action,resource_type,resource_id,created_at,profiles(email)")
    .order("created_at", { ascending: false }).limit(300);
  const fmt = new Intl.DateTimeFormat("kk-KZ", { dateStyle: "short", timeStyle: "medium", timeZone: "Asia/Almaty" });
  return (
    <div className="overflow-x-auto rounded-card border border-line bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-line text-muted">
          <tr>{[L.colWhen, L.colActor, L.colAction, L.colResource].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line">
          {(data ?? []).map((r) => {
            const actor = (Array.isArray(r.profiles) ? r.profiles[0] : r.profiles) as { email?: string } | null;
            return (
              <tr key={r.id}>
                <td className="whitespace-nowrap px-4 py-2 text-muted">{fmt.format(new Date(r.created_at))}</td>
                <td className="px-4 py-2">{actor?.email ?? L.system}</td>
                <td className="px-4 py-2 font-mono text-xs">{r.action}</td>
                <td className="px-4 py-2 text-xs">
                  {r.resource_type === "order" && r.resource_id
                    ? <Link href={`/admin/orders/${r.resource_id}`} className="text-brand hover:underline">{r.resource_type}</Link>
                    : r.resource_type === "template" && r.resource_id
                      ? <Link href={`/admin/templates/${r.resource_id}`} className="text-brand hover:underline">{r.resource_type}</Link>
                      : r.resource_type}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
