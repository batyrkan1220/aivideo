"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { kk } from "@/lib/i18n/kk";

const items = [
  { href: "/", label: kk.nav.tabHome, icon: "M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z", match: (p: string) => p === "/" || p.startsWith("/templates") },
  { href: "/create", label: kk.nav.tabCreate, icon: "", match: (p: string) => p.startsWith("/create"), primary: true },
  { href: "/account", label: kk.nav.tabAccount, icon: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 9a8 8 0 0 1 16 0", match: (p: string) => p.startsWith("/account") || p.startsWith("/orders") },
];

/** App-style bottom tab bar on phones; the centre tab is the "own video" creator. Hidden from sm up. */
export function MobileNav() {
  const path = usePathname();
  return (
    <nav
      aria-label={kk.nav.home}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
    >
      <ul className="grid grid-cols-3">
        {items.map((it) => {
          const on = it.match(path);
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                aria-current={on ? "page" : undefined}
                className={`flex flex-col items-center gap-1 py-2 text-[11px] font-medium leading-none ${on ? "text-brand" : "text-muted"}`}
              >
                {it.primary ? (
                  <span className={`-mt-5 flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-lg shadow-brand/30 ring-4 ring-white ${on ? "bg-brand-dark" : "bg-brand"}`}>
                    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden>
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </span>
                ) : (
                  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={on ? 2.2 : 1.7} strokeLinejoin="round" strokeLinecap="round" aria-hidden>
                    <path d={it.icon} />
                  </svg>
                )}
                <span className={`max-w-full px-1 text-center leading-tight ${it.primary ? "font-semibold text-ink" : ""}`}>{it.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
