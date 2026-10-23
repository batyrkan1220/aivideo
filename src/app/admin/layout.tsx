import { Suspense } from "react";
import Link from "next/link";
import { ru } from "@/lib/i18n/ru";
import { getSessionUser } from "@/lib/auth/session";
import { isStaff, can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export const metadata = { title: ru.admin.title };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div lang="ru" className="min-h-dvh">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 px-4 pt-[env(safe-area-inset-top)]">
          <Link href="/admin" className="flex h-12 items-center font-display font-bold">{ru.admin.title}</Link>
          <Link href="/" className="ml-auto flex h-12 items-center text-sm text-muted hover:text-ink sm:order-last">{ru.admin.toSite}</Link>
          <div className="-mx-4 w-[calc(100%+2rem)] border-t border-line px-4 py-1.5 sm:mx-0 sm:w-auto sm:flex-1 sm:border-0 sm:py-0">
            <Suspense fallback={null}>
              <AdminNav />
            </Suspense>
          </div>
        </div>
      </header>
      <Suspense fallback={<p className="p-8 text-muted">{ru.common.loading}</p>}>
        <Gate>{children}</Gate>
      </Suspense>
    </div>
  );
}

async function AdminNav() {
  const u = await getSessionUser();
  if (!u || !isStaff(u.role)) return null;
  return (
    <nav className="no-scrollbar flex gap-1 overflow-x-auto whitespace-nowrap text-sm">
      {can(u.role, "dashboard.view") && <Link href="/admin" className="rounded-full px-3 py-2 hover:bg-brand-soft">{ru.admin.nav.overview}</Link>}
      {can(u.role, "templates.manage") && <Link href="/admin/templates" className="rounded-full px-3 py-2 hover:bg-brand-soft">{ru.admin.nav.templates}</Link>}
      {can(u.role, "templates.manage") && <Link href="/admin/home" className="rounded-full px-3 py-2 hover:bg-brand-soft">{ru.admin.nav.home}</Link>}
      {can(u.role, "orders.view") && <Link href="/admin/orders" className="rounded-full px-3 py-2 hover:bg-brand-soft">{ru.admin.nav.orders}</Link>}
      {can(u.role, "users.manage") && <Link href="/admin/users" className="rounded-full px-3 py-2 hover:bg-brand-soft">{ru.admin.nav.users}</Link>}
      {can(u.role, "users.manage") && <Link href="/admin/partners" className="rounded-full px-3 py-2 hover:bg-brand-soft">{ru.admin.nav.partners}</Link>}
      {can(u.role, "users.manage") && <Link href="/admin/bot" className="rounded-full px-3 py-2 hover:bg-brand-soft">{ru.admin.nav.bot}</Link>}
      {can(u.role, "audit.view") && <Link href="/admin/audit" className="rounded-full px-3 py-2 hover:bg-brand-soft">{ru.admin.nav.audit}</Link>}
    </nav>
  );
}

/** Coarse gate for the whole section; every page and action re-checks its specific permission. */
async function Gate({ children }: { children: React.ReactNode }) {
  const u = await getSessionUser();
  if (!u) redirect("/login?next=/admin");
  if (!isStaff(u.role)) {
    return <p className="mx-auto max-w-5xl px-4 py-16 text-center text-muted">{ru.admin.forbidden}</p>;
  }
  return <main className="mx-auto max-w-5xl px-4 py-6 sm:py-8">{children}</main>;
}
