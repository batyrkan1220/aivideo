"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string; icon: string };
export type NavGroup = { title: string; items: NavItem[] };

const active = (path: string, href: string) => (href === "/admin" ? path === "/admin" : path === href || path.startsWith(`${href}/`));

/** Desktop: sticky sidebar grouped by area. Phones: one scrollable row of all sections. */
export function AdminNav({ groups }: { groups: NavGroup[] }) {
  const path = usePathname();
  const all = groups.flatMap((g) => g.items);
  return (
    <>
      <nav className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 pb-2 text-sm lg:hidden">
        {all.map((it) => (
          <Link key={it.href} href={it.href}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 font-semibold ${active(path, it.href) ? "bg-night text-white" : "bg-white text-ink ring-1 ring-line"}`}>
            <span aria-hidden>{it.icon}</span>{it.label}
          </Link>
        ))}
      </nav>
      <nav className="sticky top-4 hidden space-y-5 text-sm lg:block">
        {groups.map((g) => (
          <div key={g.title}>
            <p className="mb-1 px-3 text-[11px] font-bold uppercase tracking-wider text-muted">{g.title}</p>
            <ul className="space-y-0.5">
              {g.items.map((it) => (
                <li key={it.href}>
                  <Link href={it.href}
                    className={`flex items-center gap-2.5 rounded-xl px-3 py-2 font-semibold transition-colors ${active(path, it.href) ? "bg-night text-white" : "text-ink hover:bg-white"}`}>
                    <span aria-hidden className="w-5 text-center">{it.icon}</span>{it.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </>
  );
}
