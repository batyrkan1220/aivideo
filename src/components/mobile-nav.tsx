"use client";
import { haptic } from "@/lib/telegram/client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
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
 * the primary button in the middle. A section not open yet ("Фото") stays in its place with a "Скоро" tag
 * and opens its "coming soon" page. Hidden from sm up.
 */
export function MobileNav() {
  const path = usePathname();
  // The tapped tab turns active at once (the page may still be loading); the real path takes over after.
  const [tapped, setTapped] = useState<{ href: string; from: string } | null>(null);
  const pending = tapped && tapped.from === path ? tapped.href : null;
  const shown = items;
  return (
    <nav
      aria-label={kk.nav.home}
      className="tg-dock glass-dock fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+0.5rem)] z-40 rounded-[2rem] sm:hidden"
    >
      <ul className="grid h-[4.5rem] items-center px-1" style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }}>
        {shown.map((it) => {
          const on = pending ? it.href === pending : it.match(path);
          return (
            <li key={it.href} className="flex justify-center">
              <Link
                href={it.href}
                aria-current={on ? "page" : undefined}
                onClick={() => { if (!it.match(path)) { haptic("select"); setTapped({ href: it.href, from: path }); } }}
                className={`group flex min-w-0 flex-col items-center gap-1 text-[11px] font-semibold leading-none transition-colors duration-200 ${on ? "text-ink" : it.soon ? "text-faint" : "text-[#3d3935]"}`}
              >
                <span className={`relative flex h-10 w-14 items-center justify-center rounded-full transition-[background-color,color,box-shadow,transform] duration-200 ease-[var(--ease-out)] group-active:scale-95 ${
                  it.primary ? "bg-brand text-night shadow-[0_10px_22px_-10px_rgba(140,170,10,0.9)]" : on ? "bg-night text-white shadow-[0_8px_18px_-8px_rgba(22,22,22,0.6)]" : "text-ink group-hover:bg-white/50"
                }`}>
                  {it.icon}
                  {it.soon && (
                    <span className="absolute -right-1 -top-1.5 rounded-full bg-ink px-1.5 py-[3px] text-[8px] font-bold uppercase leading-none tracking-wide text-paper">{kk.nav.soon}</span>
                  )}
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
