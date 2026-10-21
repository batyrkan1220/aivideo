import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { kk } from "@/lib/i18n/kk";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { formatKzt } from "@/lib/pricing";

type SP = { q?: string; status?: string; template?: string; from?: string; to?: string; page?: string };
const PAGE = 30;
const A = kk.admin.orders;

export default function AdminOrdersPage({ searchParams }: { searchParams: Promise<SP> }) {
  return (
    <div>
      <h1 className="mb-6 font-display text-2xl font-bold">{kk.admin.nav.orders}</h1>
      <Suspense fallback={<p className="text-muted">{kk.common.loading}</p>}>
        <List searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

// Status filter values: "pay:<payment_status>" or "gen:<generation_status>"
const STATUS_OPTIONS = [
  ...Object.entries(kk.order.payment).map(([k, v]) => ({ value: `pay:${k}`, label: v })),
  ...Object.entries(kk.order.generation).filter(([k]) => k !== "awaiting_payment").map(([k, v]) => ({ value: `gen:${k}`, label: v })),
];

async function List({ searchParams }: { searchParams: Promise<SP> }) {
  const u = await getSessionUser();
  if (!u) redirect("/login?next=/admin/orders");
  if (!can(u.role, "orders.view")) return <p className="text-muted">{kk.admin.forbidden}</p>;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const db = supabaseAdmin();

  let q = db.from("orders")
    .select("id,public_order_number,created_at,amount_kzt,payment_status,generation_status,template_snapshot_json,profiles(email)", { count: "exact" })
    .order("created_at", { ascending: false });

  const term = (sp.q ?? "").trim().slice(0, 80);
  if (term) {
    if (/^tv-?\d+$/i.test(term)) {
      q = q.ilike("public_order_number", term.toUpperCase().replace(/^TV-?/, "TV-"));
    } else {
      const { data: ps } = await db.from("profiles").select("id").ilike("email", `%${term.replace(/[%_,()]/g, "")}%`).limit(50);
      q = q.in("user_id", (ps ?? []).map((p) => p.id).concat("00000000-0000-0000-0000-000000000000"));
    }
  }
  if (sp.status?.startsWith("pay:")) q = q.eq("payment_status", sp.status.slice(4));
  if (sp.status?.startsWith("gen:")) q = q.eq("generation_status", sp.status.slice(4));
  if (sp.template) q = q.eq("template_id", sp.template);
  if (sp.from) q = q.gte("created_at", new Date(sp.from).toISOString());
  if (sp.to) q = q.lt("created_at", new Date(new Date(sp.to).getTime() + 86400_000).toISOString());

  const [{ data: orders, count }, { data: templates }] = await Promise.all([
    q.range((page - 1) * PAGE, page * PAGE - 1),
    db.from("templates").select("id,title_kk").order("title_kk"),
  ]);
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));
  const fmt = new Intl.DateTimeFormat("kk-KZ", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Almaty" });
  const input = "rounded-xl border border-line bg-white px-3 py-2 text-sm";
  const link = (p: number) => `/admin/orders?${new URLSearchParams({ ...Object.fromEntries(Object.entries(sp).filter(([, v]) => v)), page: String(p) })}`;

  return (
    <>
      <form className="mb-5 flex flex-wrap gap-2">
        <input name="q" defaultValue={sp.q} placeholder={A.search} className={`${input} min-w-56 flex-1`} />
        <select name="status" defaultValue={sp.status ?? ""} className={input}>
          <option value="">{A.allStatuses}</option>
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select name="template" defaultValue={sp.template ?? ""} className={input}>
          <option value="">{A.allTemplates}</option>
          {(templates ?? []).map((t) => <option key={t.id} value={t.id}>{t.title_kk}</option>)}
        </select>
        <input type="date" name="from" defaultValue={sp.from} aria-label={kk.admin.stats.from} className={input} />
        <input type="date" name="to" defaultValue={sp.to} aria-label={kk.admin.stats.to} className={input} />
        <button className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-white">{kk.nav.search}</button>
      </form>

      {!orders?.length ? (
        <p className="rounded-card border border-dashed border-line bg-white p-10 text-center text-muted">{A.empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-line bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-muted">
              <tr>
                {[A.colNumber, A.colDate, A.colUser, A.colTemplate, A.colAmount, A.colStatus].map((h) => (
                  <th key={h} className="px-4 py-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {orders.map((o) => {
                const prof = Array.isArray(o.profiles) ? o.profiles[0] : o.profiles;
                return (
                  <tr key={o.id} className="hover:bg-paper">
                    <td className="px-4 py-3 font-semibold"><Link href={`/admin/orders/${o.id}`} className="text-brand hover:underline">{o.public_order_number}</Link></td>
                    <td className="px-4 py-3 text-muted">{fmt.format(new Date(o.created_at))}</td>
                    <td className="px-4 py-3">{(prof as { email?: string } | null)?.email ?? <span className="text-muted">{A.deletedUser}</span>}</td>
                    <td className="px-4 py-3">{(o.template_snapshot_json as { title_kk?: string }).title_kk}</td>
                    <td className="px-4 py-3">{formatKzt(o.amount_kzt)}</td>
                    <td className="px-4 py-3 text-xs">
                      {kk.order.payment[o.payment_status as keyof typeof kk.order.payment]}
                      {o.payment_status === "succeeded" && <> / {kk.order.generation[o.generation_status as keyof typeof kk.order.generation]}</>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <nav className="mt-6 flex items-center justify-center gap-4 text-sm">
          {page > 1 && <Link href={link(page - 1)} className="rounded-full border border-line px-4 py-2">{kk.catalog2.prev}</Link>}
          <span className="text-muted">{kk.catalog2.pageOf(page, pages)}</span>
          {page < pages && <Link href={link(page + 1)} className="rounded-full border border-line px-4 py-2">{kk.catalog2.next}</Link>}
        </nav>
      )}
    </>
  );
}
