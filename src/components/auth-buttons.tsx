import Link from "next/link";
import { getSessionUser } from "@/lib/auth/session";
import { kk } from "@/lib/i18n/kk";

/** Shows login/signup for guests, or a greeting + account link for signed-in users. */
export async function AuthButtons() {
  const user = await getSessionUser();
  if (user) {
    const name = user.displayName || user.email || "";
    return (
      <div className="flex flex-col items-center gap-3">
        <p className="text-neutral-700">{kk.account.greeting(name)}</p>
        <Link href="/account" className="rounded-xl bg-neutral-900 px-6 py-3 font-semibold text-white hover:bg-neutral-700">
          {kk.account.myAccount}
        </Link>
      </div>
    );
  }
  return <GuestButtons />;
}

export function GuestButtons() {
  return (
    <div className="flex gap-3">
      <Link href="/signup" className="rounded-xl bg-neutral-900 px-6 py-3 font-semibold text-white hover:bg-neutral-700">
        {kk.auth.signup}
      </Link>
      <Link href="/login" className="rounded-xl border border-neutral-300 bg-white px-6 py-3 font-semibold hover:border-neutral-900">
        {kk.auth.login}
      </Link>
    </div>
  );
}
