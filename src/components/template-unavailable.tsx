import Link from "next/link";
import { kk } from "@/lib/i18n/kk";

/** A catalog video template that has not been prepared (AI analysis) yet: visible, but not orderable. */
export function TemplateUnavailable() {
  return (
    <div className="rounded-card border border-line bg-surface p-5 text-center">
      <p className="text-lg font-extrabold">{kk.template.unavailableTitle}</p>
      <p className="mt-1 text-sm text-muted">{kk.template.unavailableText}</p>
      <Link href="/" className="mt-4 inline-block rounded-full bg-night px-5 py-2.5 text-sm font-semibold text-white">{kk.template.unavailableCta}</Link>
    </div>
  );
}
