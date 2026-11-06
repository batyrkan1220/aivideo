import { Skeleton } from "@/components/ui/states";
import { Suspense } from "react";
import { kk } from "@/lib/i18n/kk";
import { requireUser } from "@/lib/auth/session";
import { OrderList } from "@/components/order-list";

export const metadata = { title: kk.gallery.title };

/** Gallery: every video and photo the customer has made (and orders still in progress). */
export default function GalleryPage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  return (
    <main className="mx-auto max-w-2xl px-4 pb-8 pt-6 sm:px-6 md:pt-12">
      <h1 className="t-h1 mb-6">{kk.gallery.title}</h1>
      <Suspense fallback={<ul className="grid gap-3">{Array.from({ length: 5 }, (_, i) => <li key={i}><Skeleton className="h-24 rounded-card" /></li>)}</ul>}>
        <List searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function List({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  await requireUser("/orders");
  const { day } = await searchParams;
  return <OrderList limit={100} day={day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined} />;
}
