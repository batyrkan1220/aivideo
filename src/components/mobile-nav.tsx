"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { kk } from "@/lib/i18n/kk";

type Item = { href: string; label: string; icon: React.ReactNode; match: (p: string) => boolean };

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const items: Item[] = [
  {
    href: "/", label: kk.nav.tabHome, match: (p) => p === "/" || p.startsWith("/templates"),
    icon: <svg viewBox="0 0 24 24" {...stroke}><rect x="4" y="3" width="16" height="18" rx="4" /><path d="m10 9 5 3-5 3z" fill="currentColor" /></svg>,
  },
  {
    href: "/photos", label: kk.nav.tabPhoto, match: (p) => p.startsWith("/photos"),
    icon: <svg viewBox="0 0 24 24" {...stroke}><rect x="3" y="4" width="18" height="16" rx="4" /><circle cx="9" cy="10" r="2" /><path d="m21 16-5-5-8 8" /></svg>,
  },
  {
    href: "/create", label: kk.nav.tabCreate, match: (p) => p.startsWith("/create"),
    icon: <svg viewBox="0 0 24 24" {...stroke} strokeWidth={2.2}><rect x="3" y="3" width="18" height="18" rx="6" /><path d="M12 8v8M8 12h8" /></svg>,
  },
  {
    href: "/orders", label: kk.nav.tabGallery, match: (p) => p.startsWith("/orders"),
    icon: <svg viewBox="0 0 24 24" {...stroke}><rect x="3" y="3" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="2" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" /></svg>,
  },
  {
    href: "/account", label: kk.nav.tabAccount, match: (p) => p.startsWith("/account"),
    icon: <svg viewBox="0 0 24 24" {...stroke}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>,
  },
];

/** Floating white dock on phones: 5 tabs, the active icon sits in a dark capsule. Hidden from sm up. */
export function MobileNav() {
  const path = usePathname();
  return (
    <nav
      aria-label={kk.nav.home}
      className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+0.5rem)] z-40 rounded-[2rem] border border-line bg-white shadow-[0_16px_40px_-18px_rgba(60,40,20,0.35)] sm:hidden"
    >
      <ul className="grid h-[4.25rem] grid-cols-5 items-center px-1">
        {items.map((it) => {
          const on = it.match(path);
          return (
            <li key={it.href} className="flex justify-center">
              <Link
                href={it.href}
                aria-current={on ? "page" : undefined}
                className={`flex min-w-0 flex-col items-center gap-1 text-[10px] font-semibold leading-none transition-colors ${on ? "text-ink" : "text-muted"}`}
              >
                <span className={`flex h-9 w-12 items-center justify-center rounded-full transition-all active:scale-95 ${on ? "bg-night text-white shadow-[0_8px_18px_-8px_rgba(22,22,22,0.6)]" : "text-ink/70"}`}>
                  <span className="h-[22px] w-[22px] [&>svg]:h-full [&>svg]:w-full" aria-hidden>{it.icon}</span>
                </span>
                <span className="max-w-full truncate px-0.5">{it.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
