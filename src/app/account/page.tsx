import { Suspense } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { logoutAction } from "@/app/(auth)/actions";
import { kk } from "@/lib/i18n/kk";

export const metadata = { title: kk.account.title };

export default function AccountPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <div className="mb-8 flex items-center justify-between">
        <Link href="/" className="text-xl font-bold tracking-tight">{kk.brand.name}</Link>
        <form action={logoutAction}>
          <button className="rounded-xl border border-neutral-300 px-4 py-2 text-sm font-medium hover:border-neutral-900">
            {kk.nav.logout}
          </button>
        </form>
      </div>
      <h1 className="mb-6 text-2xl font-semibold">{kk.account.title}</h1>
      <Suspense fallback={<p className="text-neutral-500">{kk.common.loading}</p>}>
        <AccountDetails />
      </Suspense>
    </main>
  );
}

async function AccountDetails() {
  const user = await requireUser("/account");
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-neutral-200 bg-white p-6">
        <h2 className="mb-4 font-semibold">{kk.account.profile}</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-neutral-500">{kk.auth.displayName}</dt>
          <dd>{user.displayName ?? "—"}</dd>
          <dt className="text-neutral-500">{kk.auth.email}</dt>
          <dd>{user.email}</dd>
          <dt className="text-neutral-500">{kk.account.role}</dt>
          <dd>{kk.account.roles[user.role]}</dd>
        </dl>
      </section>
      <section className="rounded-2xl border border-neutral-200 bg-white p-6">
        <h2 className="mb-2 font-semibold">{kk.nav.myOrders}</h2>
        <p className="text-sm text-neutral-500">{kk.account.ordersEmpty}</p>
      </section>
    </div>
  );
}
