import Link from "next/link";
import { kk } from "@/lib/i18n/kk";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh md:grid-cols-[1fr_minmax(0,520px)]">
      {/* Brand panel (tablet/desktop only) */}
      <section className="relative hidden overflow-hidden bg-ink p-12 text-white md:flex md:flex-col md:justify-between">
        <Link href="/" className="font-display text-xl font-bold">{kk.brand.name}</Link>
        <div>
          <p className="max-w-md font-display text-5xl font-extrabold leading-[1.05] tracking-tight">{kk.home.title}</p>
          <ol className="mt-10 space-y-4 text-white/75">
            {kk.home.steps.map((s, i) => (
              <li key={s.t} className="flex gap-4">
                <span className="font-display text-xl font-bold text-flash">{i + 1}</span>
                <span><span className="block font-semibold text-white">{s.t}</span>{s.d}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand/40 blur-3xl" aria-hidden />
      </section>

      <section className="flex items-center justify-center bg-paper px-4 py-10">
        <div className="w-full max-w-sm">
          <Link href="/" className="mb-8 block text-center font-display text-2xl font-bold md:hidden">{kk.brand.name}</Link>
          <div className="rounded-card border border-line bg-white p-6 sm:p-8">{children}</div>
        </div>
      </section>
    </main>
  );
}
