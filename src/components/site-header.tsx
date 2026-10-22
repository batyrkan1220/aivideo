import { Suspense } from "react";
import Link from "next/link";
import { kk } from "@/lib/i18n/kk";
import { getSessionUser } from "@/lib/auth/session";
import { isStaff } from "@/lib/auth/permissions";
import { ButtonLink } from "./ui/button";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/90 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
        <Link href="/" className="flex h-11 items-center font-display text-lg font-bold tracking-tight">
          {kk.brand.name}
        </Link>
        <div className="ml-auto flex items-center gap-2">
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
        <ButtonLink href="/signup" className="hidden sm:inline-flex">{kk.auth.signup}</ButtonLink>
      </>
    );
  }
  return (
    <>
      {isStaff(user.role) && (
        <Link href="/admin" className="hidden rounded-full px-3 py-2 text-sm font-medium hover:bg-brand-soft sm:inline-block">{kk.nav.admin}</Link>
      )}
      <Link href="/orders" className="hidden rounded-full px-3 py-2 text-sm font-medium hover:bg-brand-soft sm:inline-block">{kk.nav.myOrders}</Link>
      <span className="hidden sm:block"><ButtonLink href="/account" variant="secondary">{kk.nav.account}</ButtonLink></span>
    </>
  );
}
