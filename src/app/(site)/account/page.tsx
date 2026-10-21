import { Suspense } from "react";
import { requireUser } from "@/lib/auth/session";
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
        <h2 className="mb-2 font-semibold">{kk.nav.myOrders}</h2>
        <p className="text-sm text-muted">{kk.account.ordersEmpty}</p>
      </section>
    </div>
  );
}
