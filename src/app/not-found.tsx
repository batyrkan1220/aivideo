import Link from "next/link";
import { SearchX } from "lucide-react";
import { Logo } from "@/components/logo";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { kk } from "@/lib/i18n/kk";

/** Any unknown address: the site's own look, not the framework default. */
export default function NotFound() {
  return (
    <main className="theme-app theme-mono min-h-dvh bg-paper px-4 text-ink sm:px-6">
      <div className="mx-auto flex h-16 max-w-6xl items-center"><Link href="/" aria-label={kk.brand.name}><Logo className="text-lg" /></Link></div>
      <div className="mx-auto max-w-xl py-16">
        <EmptyState icon={<SearchX size={26} strokeWidth={1.8} aria-hidden />} title={kk.states.notFoundTitle} text={kk.states.notFoundText}
          action={<ButtonLink href="/">{kk.states.toTrends}</ButtonLink>} />
      </div>
    </main>
  );
}
