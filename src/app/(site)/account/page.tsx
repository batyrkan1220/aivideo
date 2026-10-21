import { Suspense } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { supabaseServer } from "@/lib/supabase/server";
import { formatKzt } from "@/lib/pricing";
import { logoutAction } from "@/app/(auth)/actions";
import { kk } from "@/lib/i18n/kk";

export const metadata = { title: kk.account.title };

export default function AccountPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">{kk.account.title}</h1>
        <form action={logoutAction}>
          <button className="rounded-full border border-line bg-white px-4 py-2 text-sm font-medium hover:border-ink">
            {kk.nav.logout}
          </button>
        </form>
      </div>
      <Suspense fallback={<p className="text-muted">{kk.common.loading}</p>}>
        <AccountDetails />
      </Suspense>
    </main>
  );
}

async function AccountDetails() {
  const user = await requireUser("/account");
  return (
    <div className="space-y-6">
      <section className="rounded-card border border-line bg-white p-6">
        <h2 className="mb-4 font-semibold">{kk.account.profile}</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted">{kk.auth.displayName}</dt>
          <dd>{user.displayName ?? "—"}</dd>
          <dt className="text-muted">{kk.auth.email}</dt>
          <dd>{user.email}</dd>
          <dt className="text-muted">{kk.account.role}</dt>
          <dd>{kk.account.roles[user.role]}</dd>
        </dl>
      </section>
      <section className="rounded-card border border-line bg-white p-6">
        <h2 className="mb-3 font-semibold">{kk.nav.myOrders}</h2>
        <OrdersList />
      </section>
    </div>
  );
}

async function OrdersList() {
  // RLS limits this to the signed-in user's own orders.
  const sb = await supabaseServer();
  const { data: orders } = await sb.from("orders")
    .select("id,public_order_number,created_at,amount_kzt,payment_status,template_snapshot_json")
    .order("created_at", { ascending: false }).limit(50);
  if (!orders?.length) return <p className="text-sm text-muted">{kk.account.ordersEmpty}</p>;
  const fmt = new Intl.DateTimeFormat("kk-KZ", { dateStyle: "medium", timeZone: "Asia/Almaty" });
  return (
    <ul className="divide-y divide-line">
      {orders.map((o) => (
        <li key={o.id}>
          <Link href={`/orders/${o.id}`} className="flex items-center justify-between gap-4 py-3 hover:text-brand">
            <span className="min-w-0">
              <span className="block truncate font-medium">{(o.template_snapshot_json as { title_kk?: string }).title_kk}</span>
              <span className="block text-xs text-muted">{o.public_order_number}, {fmt.format(new Date(o.created_at))}</span>
            </span>
            <span className="shrink-0 text-right text-sm">
              <span className="block font-semibold">{formatKzt(o.amount_kzt)}</span>
              <span className="block text-xs text-muted">{kk.order.payment[o.payment_status as keyof typeof kk.order.payment]}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
