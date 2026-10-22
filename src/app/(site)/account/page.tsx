import { Suspense } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { isStaff } from "@/lib/auth/permissions";
import { logoutAction } from "@/app/(auth)/actions";
import { kk } from "@/lib/i18n/kk";
import { isTelegramEmail } from "@/lib/telegram/session";
import { OrderList } from "@/components/order-list";
import { DisplayNameForm, DeleteAllPhotosForm, DeleteAccountForm, LogoutButton, TelegramDeleteNote } from "@/components/account-forms";

export const metadata = { title: kk.account.title };

export default function AccountPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6 sm:py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">{kk.account.title}</h1>
        <LogoutButton action={logoutAction} />
      </div>
      <Suspense fallback={<p className="text-muted">{kk.common.loading}</p>}>
        <AccountDetails />
      </Suspense>
    </main>
  );
}

async function AccountDetails() {
  const user = await requireUser("/account");
  const card = "rounded-card border border-line bg-white p-6";
  return (
    <div className="space-y-6">
      <section className={card}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">{kk.nav.myOrders}</h2>
          <Link href="/orders" className="text-sm font-semibold text-brand hover:underline">{kk.home.seeAll}</Link>
        </div>
        <OrderList limit={10} />
      </section>

      <section className={card}>
        <h2 className="mb-4 font-semibold">{kk.account.profile}</h2>
        <dl className="mb-5 grid grid-cols-[auto_minmax(0,1fr)] [&>dd]:break-words gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted">{isTelegramEmail(user.email) ? "Telegram" : kk.auth.email}</dt>
          <dd>{isTelegramEmail(user.email) ? kk.account.viaTelegram : user.email}</dd>
          <dt className="text-muted">{kk.account.role}</dt>
          <dd>
            {kk.account.roles[user.role]}
            {isStaff(user.role) && <Link href="/admin" className="ml-3 font-semibold text-brand hover:underline">{kk.nav.admin}</Link>}
          </dd>
        </dl>
        <DisplayNameForm current={user.displayName ?? ""} />
      </section>


      <section className={card}>
        <h2 className="mb-2 font-semibold">{kk.account.privacyTitle}</h2>
        <p className="mb-4 text-sm text-muted">{kk.account.privacyText}</p>
        <DeleteAllPhotosForm />
      </section>

      <section className="rounded-card border border-danger/30 bg-white p-6">
        <h2 className="mb-2 font-semibold text-danger">{kk.account.deleteAccount}</h2>
        <TelegramDeleteNote />
        <DeleteAccountForm />
      </section>
    </div>
  );
}
