import { Suspense } from "react";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { kk } from "@/lib/i18n/kk";
import { getSessionUser } from "@/lib/auth/session";
import { isStaff } from "@/lib/auth/permissions";
import { ButtonLink } from "./ui/button";

export function SiteHeader() {
  return (
    <header className="tg-hide sticky top-0 z-30 border-b border-black/5 pt-[env(safe-area-inset-top)] glass">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
        <Link href="/" aria-label={kk.brand.name} className="flex h-11 items-center">
          <Logo className="text-lg" />
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/create" className="btn-promo inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-bold sm:hidden">🔥 {kk.home.promo}</Link>
          <Suspense fallback={<div className="h-10 w-20" />}>
            <AccountNav />
          </Suspense>
        </div>
      </div>
    </header>
  );
}

async function AccountNav() {
  const user = await getSessionUser();
  if (!user) {
    return (
      <>
        <Link href="/login" className="rounded-full px-3 py-2 text-sm font-medium hover:bg-brand-soft">{kk.nav.login}</Link>
        <span className="hidden sm:block"><ButtonLink href="/signup">{kk.auth.signup}</ButtonLink></span>
      </>
    );
  }
  return (
    <>
      {isStaff(user.role) && (
        <Link href="/admin" className="hidden rounded-full px-3 py-2 text-sm font-medium hover:bg-brand-soft sm:inline-block">{kk.nav.admin}</Link>
      )}
      <Link href="/create" className="hidden rounded-full px-3 py-2 text-sm font-semibold text-brand hover:bg-brand-soft sm:inline-block">+ {kk.nav.createOwn}</Link>
      <Link href="/orders" className="hidden rounded-full px-3 py-2 text-sm font-medium hover:bg-brand-soft sm:inline-block">{kk.nav.myOrders}</Link>
      <span className="hidden sm:block"><ButtonLink href="/account" variant="secondary">{kk.nav.account}</ButtonLink></span>
    </>
  );
}
