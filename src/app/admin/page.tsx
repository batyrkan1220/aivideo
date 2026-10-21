import { Suspense } from "react";
import { redirect } from "next/navigation";
import { kk } from "@/lib/i18n/kk";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";

export default function AdminHome() {
  return (
    <Suspense fallback={<p className="text-muted">{kk.common.loading}</p>}>
      <Overview />
    </Suspense>
  );
}

async function Overview() {
  const u = await getSessionUser();
  if (!u) redirect("/login?next=/admin");
  if (!can(u.role, "dashboard.view")) redirect("/admin/templates");

  const db = supabaseAdmin();
  const [{ data: templates }, { count: users }] = await Promise.all([
    db.from("templates").select("status"),
    db.from("profiles").select("id", { count: "exact", head: true }),
  ]);
  const byStatus = { draft: 0, published: 0, disabled: 0, archived: 0 } as Record<string, number>;
  (templates ?? []).forEach((t) => { byStatus[t.status] = (byStatus[t.status] ?? 0) + 1; });

  return (
    <div className="space-y-8">
      <h1 className="font-display text-2xl font-bold">{kk.admin.nav.overview}</h1>
      <section>
        <h2 className="mb-3 font-semibold">{kk.admin.overview.templatesByStatus}</h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(Object.keys(kk.admin.status) as (keyof typeof kk.admin.status)[]).map((s) => (
            <div key={s} className="rounded-card border border-line bg-white p-4">
              <dt className="text-sm text-muted">{kk.admin.status[s]}</dt>
              <dd className="mt-1 font-display text-2xl font-bold">{byStatus[s]}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="rounded-card border border-line bg-white p-4">
        <p className="text-sm text-muted">{kk.admin.overview.users}</p>
        <p className="mt-1 font-display text-2xl font-bold">{users ?? 0}</p>
      </section>
      <p className="text-sm text-muted">{kk.admin.overview.ordersSoon}</p>
    </div>
  );
}
