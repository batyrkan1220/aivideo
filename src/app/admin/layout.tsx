import { ArrowUpRight } from "lucide-react";
import { Suspense } from "react";
import Link from "next/link";
import { ru } from "@/lib/i18n/ru";
import { getSessionUser } from "@/lib/auth/session";
import { isStaff, can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { AdminNav, type NavGroup } from "./nav";
import { supabaseAdmin } from "@/lib/supabase/server";

export const metadata = { title: ru.admin.title };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div lang="ru" className="theme-app theme-mono min-h-dvh bg-paper text-ink">
      <header className="glass sticky top-0 z-30 border-b border-line/60">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 pt-[env(safe-area-inset-top)] sm:px-6">
          <Link href="/admin" className="flex items-center gap-2.5"><Logo className="text-base" compact /><span className="font-extrabold">{ru.admin.title}</span></Link>
          <Link href="/" className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-4 text-sm font-semibold text-ink/80 elev-xs hover:border-line-strong hover:text-ink">{ru.admin.toSite}<ArrowUpRight size={15} aria-hidden /></Link>
        </div>
      </header>
      <Suspense fallback={<div className="mx-auto grid max-w-7xl gap-4 px-4 py-8 sm:px-6"><div className="skeleton h-9 w-64 rounded-full" /><div className="skeleton h-40 rounded-card" /></div>}>
        <Gate>{children}</Gate>
      </Suspense>
    </div>
  );
}

/** Coarse gate for the whole section; every page and action re-checks its specific permission. */
async function Gate({ children }: { children: React.ReactNode }) {
  const u = await getSessionUser();
  if (!u) redirect("/login?next=/admin");
  if (!isStaff(u.role)) {
    return <p className="mx-auto max-w-5xl px-4 py-16 text-center text-muted">{ru.admin.forbidden}</p>;
  }
  const r = u.role;
  // Conversations waiting for an answer (badge on «Поддержка»).
  const { count: waiting } = can(r, "orders.view")
    ? await supabaseAdmin().from("support_threads").select("id", { count: "exact", head: true }).gt("unread", 0)
    : { count: 0 };
  const groups: NavGroup[] = [
    { title: "Продажи", items: [
      ...(can(r, "dashboard.view") ? [{ href: "/admin", label: "Обзор", icon: "overview" }] : []),
      ...(can(r, "orders.view") ? [{ href: "/admin/orders", label: "Заказы", icon: "orders" }] : []),
      ...(can(r, "orders.view") ? [{ href: "/admin/support", label: "Поддержка", icon: "support", badge: waiting ?? 0 }] : []),
      ...(can(r, "dashboard.view") ? [{ href: "/admin/funnel", label: "Воронка по рекламе", icon: "funnel" }] : []),
      ...(can(r, "users.manage") ? [{ href: "/admin/payments", label: "Платежи · Tolepay", icon: "payments" }] : []),
    ] },
    { title: "Каталог", items: can(r, "templates.manage") ? [
      { href: "/admin/templates", label: "Шаблоны", icon: "templates" },
      { href: "/admin/categories", label: "Категории", icon: "categories" },
      { href: "/admin/combos", label: "Фото-комбо", icon: "combos" },
      { href: "/admin/home", label: "Главная страница", icon: "home" },
    ] : [] },
    { title: "Сервисы", items: can(r, "templates.manage") ? [
      { href: "/admin/services", label: "ИИ и расходы", icon: "ai" },
      { href: "/admin/character-sheet", label: "Character Sheet", icon: "sheet" },
    ] : [] },
    { title: "Люди", items: can(r, "users.manage") ? [
      { href: "/admin/users", label: "Пользователи", icon: "users" },
      { href: "/admin/partners", label: "Партнёры", icon: "partners" },
      { href: "/admin/bot", label: "Telegram-бот", icon: "bot" },
      { href: "/admin/pixels", label: "Пиксели и аналитика", icon: "pixels" },
    ] : [] },
    { title: "Система", items: can(r, "audit.view") ? [{ href: "/admin/audit", label: "Журнал", icon: "audit" }] : [] },
  ].filter((g) => g.items.length);

  return (
    <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10 lg:py-10">
      <aside><AdminNav groups={groups} /></aside>
      <main className="min-w-0 pt-2 lg:pt-0">{children}</main>
    </div>
  );
}
