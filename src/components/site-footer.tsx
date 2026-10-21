import Link from "next/link";
import { kk } from "@/lib/i18n/kk";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
        <p className="font-display font-semibold text-ink">{kk.brand.name}</p>
        <nav className="flex flex-wrap gap-x-6 gap-y-2" aria-label={kk.nav.support}>
          <Link href="/support" className="hover:text-ink">{kk.nav.support}</Link>
          <Link href="/privacy" className="hover:text-ink">{kk.footer.privacy}</Link>
          <Link href="/terms" className="hover:text-ink">{kk.footer.terms}</Link>
          <Link href="/refund" className="hover:text-ink">{kk.footer.refund}</Link>
        </nav>
      </div>
    </footer>
  );
}
