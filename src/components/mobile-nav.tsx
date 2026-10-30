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
      className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+0.5rem)] z-40 rounded-[1.75rem] border border-white/10 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.7)] glass sm:hidden"
    >
      <ul className="grid h-16 grid-cols-3 items-center">
        {items.map((it) => {
          const on = it.match(path);
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                aria-current={on ? "page" : undefined}
                aria-label={it.primary ? it.label : undefined}
                className={`flex flex-col items-center gap-1 py-2 text-[11px] font-medium leading-none transition-colors ${it.primary ? "justify-center" : ""} ${on ? "text-ink" : "text-muted"}`}
              >
                {it.primary ? (
                  // Centre action: big raised icon button, no text (label kept for screen readers).
                  <>
                    <span
                      className={`btn-glow relative -mt-7 flex h-14 w-14 items-center justify-center rounded-[1.25rem] text-white ring-4 ring-paper transition-transform active:scale-95 ${on ? "scale-105" : ""}`}
                    >
                      <svg viewBox="0 0 32 32" className="h-7 w-7" fill="none" aria-hidden>
                        <rect x="4" y="8" width="18" height="17" rx="4.5" stroke="currentColor" strokeWidth="2.4" />
                        <path d="M22 14.2 27.2 11v11l-5.2-3.2" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
                        <path d="M11.5 13.2v6.6l5.4-3.3z" fill="currentColor" />
                      </svg>
                      <svg viewBox="0 0 24 24" className="absolute -right-1 -top-1 h-4 w-4 drop-shadow" aria-hidden>
                        <path d="M12 1.5c.9 5.6 3.4 8.1 9 9-5.6.9-8.1 3.4-9 9-.9-5.6-3.4-8.1-9-9 5.6-.9 8.1-3.4 9-9z" fill="#ffc93c" stroke="currentColor" strokeWidth="0" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <span className="sr-only">{it.label}</span>
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={on ? 2.2 : 1.7} strokeLinejoin="round" strokeLinecap="round" aria-hidden>
                      <path d={it.icon} />
                    </svg>
                    <span className="max-w-full px-1 text-center leading-tight">{it.label}</span>
                    <span className={`h-1 w-1 rounded-full transition-opacity ${on ? "bg-brand opacity-100 shadow-[0_0_8px_2px_rgba(139,108,255,0.8)]" : "opacity-0"}`} aria-hidden />
                  </>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
