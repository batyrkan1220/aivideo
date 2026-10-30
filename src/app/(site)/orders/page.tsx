import { Suspense } from "react";
import Link from "next/link";
import { kk } from "@/lib/i18n/kk";
import { requireUser } from "@/lib/auth/session";
import { OrderList } from "@/components/order-list";

export const metadata = { title: kk.gallery.title };

/** Gallery: every video and photo the customer has made (and orders still in progress). */
export default function GalleryPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 pb-6 pt-4 md:pt-10">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[28px] font-extrabold leading-none tracking-tight">{kk.gallery.title}</h1>
          <p className="mt-1.5 text-sm text-muted">{kk.gallery.lead}</p>
        </div>
        <Link href="/create" className="btn-glow inline-flex h-10 shrink-0 items-center gap-1 rounded-full px-4 text-sm font-bold">+ {kk.nav.tabCreate}</Link>
      </div>
      <Suspense fallback={<ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">{Array.from({ length: 4 }, (_, i) => <li key={i} className="aspect-[3/4] animate-pulse rounded-[20px] bg-surface" />)}</ul>}>
        <List />
      </Suspense>
    </main>
  );
}

async function List() {
  await requireUser("/orders");
  return <OrderList limit={100} />;
}
