import { Suspense } from "react";
import Link from "next/link";
import { kk } from "@/lib/i18n/kk";
import { getSessionUser } from "@/lib/auth/session";
import { isStaff, can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";

export const metadata = { title: kk.admin.title };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4">
          <Link href="/admin" className="font-display font-bold">{kk.admin.title}</Link>
          <Suspense fallback={null}>
            <AdminNav />
          </Suspense>
          <Link href="/" className="ml-auto text-sm text-muted hover:text-ink">{kk.admin.toSite}</Link>
        </div>
      </header>
      <Suspense fallback={<p className="p-8 text-muted">{kk.common.loading}</p>}>
        <Gate>{children}</Gate>
      </Suspense>
    </div>
  );
}

async function AdminNav() {
  const u = await getSessionUser();
  if (!u || !isStaff(u.role)) return null;
  return (
    <nav className="no-scrollbar flex gap-1 overflow-x-auto text-sm">
      {can(u.role, "dashboard.view") && <Link href="/admin" className="rounded-full px-3 py-1.5 hover:bg-brand-soft">{kk.admin.nav.overview}</Link>}
      {can(u.role, "templates.manage") && <Link href="/admin/templates" className="rounded-full px-3 py-1.5 hover:bg-brand-soft">{kk.admin.nav.templates}</Link>}
      {can(u.role, "orders.view") && <Link href="/admin/orders" className="rounded-full px-3 py-1.5 hover:bg-brand-soft">{kk.admin.nav.orders}</Link>}
      {can(u.role, "users.manage") && <Link href="/admin/users" className="rounded-full px-3 py-1.5 hover:bg-brand-soft">{kk.admin.nav.users}</Link>}
      {can(u.role, "audit.view") && <Link href="/admin/audit" className="rounded-full px-3 py-1.5 hover:bg-brand-soft">{kk.admin.nav.audit}</Link>}
    </nav>
  );
}

/** Coarse gate for the whole section; every page and action re-checks its specific permission. */
async function Gate({ children }: { children: React.ReactNode }) {
  const u = await getSessionUser();
  if (!u) redirect("/login?next=/admin");
  if (!isStaff(u.role)) {
    return <p className="mx-auto max-w-5xl px-4 py-16 text-center text-muted">{kk.admin.forbidden}</p>;
  }
  return <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>;
}
