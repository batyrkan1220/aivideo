"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { kk } from "@/lib/i18n/kk";

const items = [
  { href: "/", label: kk.nav.tabHome, icon: "M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" },
  { href: "/orders", label: kk.nav.tabOrders, icon: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6" },
  { href: "/account", label: kk.nav.tabAccount, icon: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 9a8 8 0 0 1 16 0" },
];

/** App-style bottom tab bar on phones; hidden from the sm breakpoint up. */
export function MobileNav() {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <nav
      aria-label={kk.nav.home}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
    >
      <ul className="grid grid-cols-3">
        {items.map((it) => (
          <li key={it.href}>
            <Link
              href={it.href}
              aria-current={active(it.href) ? "page" : undefined}
              className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium leading-none ${active(it.href) ? "text-brand" : "text-muted"}`}
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={active(it.href) ? 2.2 : 1.7} strokeLinejoin="round" strokeLinecap="round" aria-hidden>
                <path d={it.icon} />
              </svg>
              <span className="max-w-full px-1 text-center leading-tight">{it.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
