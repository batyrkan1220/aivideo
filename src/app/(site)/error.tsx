"use client";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { kk } from "@/lib/i18n/kk";

/** Any page error: a calm message, retry and the way home (no technical details). */
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto max-w-xl px-4 py-16 sm:px-6">
      <EmptyState
        icon={<TriangleAlert size={26} strokeWidth={1.8} aria-hidden />}
        title={kk.states.errorTitle}
        text={kk.states.errorText}
        action={<div className="flex flex-wrap justify-center gap-3"><Button onClick={reset} icon={<RotateCcw size={16} aria-hidden />}>{kk.states.retry}</Button><ButtonLink href="/" variant="secondary">{kk.states.home}</ButtonLink></div>}
      />
    </main>
  );
}
