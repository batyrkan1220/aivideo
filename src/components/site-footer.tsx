import Link from "next/link";
import { Logo } from "@/components/logo";
import { kk } from "@/lib/i18n/kk";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
        <p className="text-ink"><Logo className="text-base" /></p>
        <nav className="flex flex-wrap gap-x-6" aria-label={kk.nav.support}>
          <Link href="/support" className="inline-block py-2 hover:text-ink">{kk.nav.support}</Link>
          <Link href="/privacy" className="inline-block py-2 hover:text-ink">{kk.footer.privacy}</Link>
          <Link href="/terms" className="inline-block py-2 hover:text-ink">{kk.footer.terms}</Link>
          <Link href="/refund" className="inline-block py-2 hover:text-ink">{kk.footer.refund}</Link>
        </nav>
      </div>
    </footer>
  );
}
