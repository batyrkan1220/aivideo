"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clapperboard, Image as ImageIcon, LayoutGrid, Plus, UserRound } from "lucide-react";
import { kk } from "@/lib/i18n/kk";
import { PHOTOS_SOON } from "@/lib/features";

type Item = { href: string; label: string; icon: React.ReactNode; match: (p: string) => boolean; soon?: boolean; primary?: boolean };

const I = { size: 22, strokeWidth: 1.8, "aria-hidden": true } as const;
const items: Item[] = [
  { href: "/", label: kk.nav.tabHome, match: (p) => p === "/" || p.startsWith("/templates"), icon: <Clapperboard {...I} /> },
  { href: "/photos", label: kk.nav.tabPhoto, match: (p) => p.startsWith("/photos"), soon: PHOTOS_SOON, icon: <ImageIcon {...I} /> },
  { href: "/create", label: kk.nav.tabCreate, match: (p) => p.startsWith("/create"), primary: true, icon: <Plus {...I} strokeWidth={2.4} /> },
  { href: "/orders", label: kk.nav.tabGallery, match: (p) => p.startsWith("/orders"), icon: <LayoutGrid {...I} /> },
  { href: "/account", label: kk.nav.tabAccount, match: (p) => p.startsWith("/account"), icon: <UserRound {...I} /> },
];

/**
 * Floating "liquid glass" dock on phones: see-through, the content behind shows blurred. The active tab gets an obsidian capsule; "Создать" is always
 * a chartreuse button in the middle. Sections not open yet are not shown. Hidden from sm up.
 */
export function MobileNav() {
  const path = usePathname();
  const shown = items.filter((i) => !i.soon);
  return (
    <nav
      aria-label={kk.nav.home}
      className="tg-dock glass-dock fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+0.5rem)] z-40 rounded-[2rem] sm:hidden"
    >
      <ul className="grid h-[4.5rem] items-center px-1" style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }}>
        {shown.map((it) => {
          const on = it.match(path);
          return (
            <li key={it.href} className="flex justify-center">
              <Link
                href={it.href}
                aria-current={on ? "page" : undefined}
                className={`group flex min-w-0 flex-col items-center gap-1 text-[11px] font-semibold leading-none transition-colors duration-200 ${on ? "text-ink" : "text-ink/70"}`}
              >
                <span className={`flex h-10 w-14 items-center justify-center rounded-full transition-all duration-300 ease-[var(--ease-out)] group-active:scale-95 ${
                  it.primary ? "bg-brand text-night shadow-[0_10px_22px_-10px_rgba(140,170,10,0.9)]" : on ? "bg-night text-white shadow-[0_8px_18px_-8px_rgba(22,22,22,0.6)]" : "text-ink/80 group-hover:bg-white/40"
                }`}>
                  {it.icon}
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
