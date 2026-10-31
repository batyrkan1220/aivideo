import { Suspense } from "react";
import { kk } from "@/lib/i18n/kk";
import { requireUser } from "@/lib/auth/session";
import { OrderList } from "@/components/order-list";

export const metadata = { title: kk.gallery.title };

/** Gallery: every video and photo the customer has made (and orders still in progress). */
export default function GalleryPage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  return (
    <main className="mx-auto max-w-6xl px-4 pb-6 pt-4 md:pt-10">
      <h1 className="mb-4 text-[28px] font-extrabold leading-none tracking-tight">{kk.gallery.title}</h1>
      <Suspense fallback={<ul className="space-y-3">{Array.from({ length: 4 }, (_, i) => <li key={i} className="h-24 animate-pulse rounded-[24px] bg-surface" />)}</ul>}>
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
