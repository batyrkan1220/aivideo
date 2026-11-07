"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** Desktop header link with an active state: the current section gets a soft pill and aria-current. */
export function HeaderLink({ href, children }: { href: string; children: ReactNode }) {
  const path = usePathname();
  const on = path === href || path.startsWith(`${href}/`);
  return (
    <Link href={href} aria-current={on ? "page" : undefined}
      className={`hidden h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-[background-color,color,box-shadow] duration-200 sm:inline-flex ${
        on ? "bg-surface text-ink elev-sm ring-1 ring-line" : "text-ink/70 hover:bg-ink/[0.05] hover:text-ink"}`}>
      {children}
    </Link>
  );
}
