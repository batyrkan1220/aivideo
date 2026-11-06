import { SearchX } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { kk } from "@/lib/i18n/kk";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-4 py-16 sm:px-6">
      <EmptyState icon={<SearchX size={26} strokeWidth={1.8} aria-hidden />} title={kk.states.notFoundTitle} text={kk.states.notFoundText}
        action={<ButtonLink href="/">{kk.states.toTrends}</ButtonLink>} />
    </main>
  );
}
