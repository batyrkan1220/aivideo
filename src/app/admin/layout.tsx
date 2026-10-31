import { Suspense } from "react";
import Link from "next/link";
import { ru } from "@/lib/i18n/ru";
import { getSessionUser } from "@/lib/auth/session";
import { isStaff, can } from "@/lib/auth/permissions";
import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { AdminNav, type NavGroup } from "./nav";

export const metadata = { title: ru.admin.title };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div lang="ru" className="min-h-dvh bg-paper">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 pt-[env(safe-area-inset-top)]">
          <Link href="/admin" className="flex items-center gap-2"><Logo className="text-base" compact /><span className="font-extrabold">{ru.admin.title}</span></Link>
          <Link href="/" className="ml-auto rounded-full border border-line px-3 py-1.5 text-sm font-semibold text-muted hover:border-ink hover:text-ink">{ru.admin.toSite} ↗</Link>
        </div>
      </header>
      <Suspense fallback={<p className="p-8 text-muted">{ru.common.loading}</p>}>
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
  const groups: NavGroup[] = [
    { title: "Продажи", items: [
      ...(can(r, "dashboard.view") ? [{ href: "/admin", label: "Обзор", icon: "📊" }] : []),
      ...(can(r, "orders.view") ? [{ href: "/admin/orders", label: "Заказы", icon: "🧾" }] : []),
      ...(can(r, "users.manage") ? [{ href: "/admin/payments", label: "Платежи · Tolepay", icon: "💳" }] : []),
    ] },
    { title: "Каталог", items: can(r, "templates.manage") ? [
      { href: "/admin/templates", label: "Шаблоны", icon: "🎬" },
      { href: "/admin/categories", label: "Категории", icon: "🗂" },
      { href: "/admin/combos", label: "Фото-комбо", icon: "📸" },
      { href: "/admin/home", label: "Главная страница", icon: "🏠" },
    ] : [] },
    { title: "Сервисы", items: can(r, "templates.manage") ? [
      { href: "/admin/services", label: "AI и расходы", icon: "🤖" },
    ] : [] },
    { title: "Люди", items: can(r, "users.manage") ? [
      { href: "/admin/users", label: "Пользователи", icon: "👤" },
      { href: "/admin/partners", label: "Партнёры", icon: "🤝" },
      { href: "/admin/bot", label: "Telegram-бот", icon: "✈️" },
    ] : [] },
    { title: "Система", items: can(r, "audit.view") ? [{ href: "/admin/audit", label: "Журнал", icon: "📜" }] : [] },
  ].filter((g) => g.items.length);

  return (
    <div className="mx-auto max-w-7xl px-4 py-4 lg:grid lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:gap-8 lg:py-8">
      <aside><AdminNav groups={groups} /></aside>
      <main className="min-w-0 pt-2 lg:pt-0">{children}</main>
    </div>
  );
}
