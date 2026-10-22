import { Suspense } from "react";
import { kk } from "@/lib/i18n/kk";
import { requireUser } from "@/lib/auth/session";
import { OrderList } from "@/components/order-list";

export const metadata = { title: kk.nav.myOrders };

export default function OrdersPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="font-display text-2xl font-bold">{kk.myVideos.title}</h1>
      <p className="mb-6 mt-1 text-sm text-muted">{kk.myVideos.lead}</p>
      <Suspense fallback={<p className="py-3 text-muted">{kk.common.loading}</p>}>
        <List />
      </Suspense>
    </main>
  );
}

async function List() {
  await requireUser("/orders");
  return <OrderList limit={100} />;
}
