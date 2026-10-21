import { kk } from "@/lib/i18n/kk";

export function LegalPage({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl px-4 pt-12">
      <h1 className="font-display text-3xl font-bold tracking-tight">{title}</h1>
      <div className="mt-6 space-y-4 text-muted">{children ?? <p>{kk.legal.draft}</p>}</div>
    </main>
  );
}
