import { Suspense } from "react";
import Link from "next/link";
import { LayoutGrid, Plus, Shield, UserRound } from "lucide-react";
import { Logo } from "@/components/logo";
import { kk } from "@/lib/i18n/kk";
import { getSessionUser } from "@/lib/auth/session";
import { isStaff } from "@/lib/auth/permissions";
import { ButtonLink } from "./ui/button";
import { HeaderLink } from "./header-link";

/** Frosted sticky top bar: logo left; on desktop the main sections, on phones only sign-in (the dock has the rest). */
export function SiteHeader() {
  return (
    <header className="tg-hide glass sticky top-0 z-30 border-b border-line/60 pt-[env(safe-area-inset-top)] shadow-[0_1px_0_rgb(255_255_255/0.6)_inset]">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" aria-label={kk.brand.name} className="flex h-11 items-center rounded-xl">
          <Logo className="text-lg" />
        </Link>
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <Suspense fallback={<div className="h-10 w-24" />}>
            <AccountNav />
          </Suspense>
        </div>
      </div>
    </header>
  );
}

const I = { size: 18, strokeWidth: 1.9, "aria-hidden": true } as const;

async function AccountNav() {
  const user = await getSessionUser();
  if (!user) {
    return <ButtonLink href="/login" variant="primary" size="md">{kk.nav.login}</ButtonLink>;
  }
  return (
    <>
      {isStaff(user.role) && <HeaderLink href="/admin"><Shield {...I} />{kk.nav.admin}</HeaderLink>}
      <HeaderLink href="/orders"><LayoutGrid {...I} />{kk.nav.myOrders}</HeaderLink>
      <HeaderLink href="/account"><UserRound {...I} />{kk.nav.account}</HeaderLink>
      <span className="hidden sm:block"><ButtonLink href="/create" variant="lime" icon={<Plus {...I} strokeWidth={2.4} />}>{kk.nav.createOwn}</ButtonLink></span>
    </>
  );
}
