"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3, Bot, Clapperboard, MessageCircle, CreditCard, FolderTree, Handshake, Home, Images, LineChart, Receipt, ScanFace, ScrollText, Sparkles, Target, Users,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { href: string; label: string; icon: string; badge?: number };
export type NavGroup = { title: string; items: NavItem[] };

const ICONS: Record<string, LucideIcon> = {
  overview: BarChart3, orders: Receipt, support: MessageCircle, funnel: Target, payments: CreditCard, templates: Clapperboard, categories: FolderTree,
  combos: Images, home: Home, ai: Sparkles, users: Users, partners: Handshake, bot: Bot, pixels: LineChart, audit: ScrollText, sheet: ScanFace,
};

const active = (path: string, href: string) => (href === "/admin" ? path === "/admin" : path === href || path.startsWith(`${href}/`));

function Icon({ name, className = "" }: { name: string; className?: string }) {
  const C = ICONS[name];
  return C ? <C size={18} strokeWidth={1.9} className={className} aria-hidden /> : null;
}

/** Desktop: sticky sidebar grouped by area, the active item in an obsidian pill. Phones: one scrollable row. */
export function AdminNav({ groups }: { groups: NavGroup[] }) {
  const path = usePathname();
  const all = groups.flatMap((g) => g.items);
  return (
    <>
      <nav className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-3 text-sm sm:-mx-6 sm:px-6 lg:hidden">
        {all.map((it) => {
          const on = active(path, it.href);
          return (
            <Link key={it.href} href={it.href} aria-current={on ? "page" : undefined}
              className={`flex h-10 shrink-0 items-center gap-2 rounded-full border px-4 font-semibold transition-colors ${on ? "border-night bg-night text-white elev-sm" : "border-line bg-surface text-ink hover:border-line-strong"}`}>
              <Icon name={it.icon} />{it.label}
              {!!it.badge && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#22c55e] px-1.5 text-[11px] font-semibold text-white">{it.badge}</span>}
            </Link>
          );
        })}
      </nav>
      <nav className="sticky top-24 hidden space-y-6 text-sm lg:block">
        {groups.map((g) => (
          <div key={g.title}>
            <p className="t-eyebrow mb-2 px-3 text-muted">{g.title}</p>
            <ul className="space-y-1">
              {g.items.map((it) => {
                const on = active(path, it.href);
                return (
                  <li key={it.href}>
                    <Link href={it.href} aria-current={on ? "page" : undefined}
                      className={`group flex h-10 items-center gap-3 rounded-xl px-3 font-semibold transition-colors duration-200 ${on ? "bg-night text-white elev-sm" : "text-ink/80 hover:bg-surface hover:text-ink"}`}>
                      <Icon name={it.icon} className={on ? "text-white" : "text-muted group-hover:text-ink"} />{it.label}
                      {!!it.badge && <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-[#22c55e] px-1.5 text-[11px] font-semibold text-white">{it.badge}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </>
  );
}
