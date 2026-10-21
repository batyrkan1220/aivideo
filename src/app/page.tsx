import Link from "next/link";
import { kk } from "@/lib/i18n/kk";

// Temporary homepage until the catalog (part 3) lands.
export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-neutral-50 px-6 text-center">
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{kk.brand.name}</h1>
      <p className="mt-4 max-w-md text-lg text-neutral-600">{kk.brand.tagline}</p>
      <p className="mt-2 text-sm text-neutral-500">Платформа әзірленуде. Үлгілер каталогы жақында қосылады.</p>
      <div className="mt-8 flex gap-3">
        <Link href="/signup" className="rounded-xl bg-neutral-900 px-6 py-3 font-semibold text-white hover:bg-neutral-700">
          {kk.auth.signup}
        </Link>
        <Link href="/login" className="rounded-xl border border-neutral-300 bg-white px-6 py-3 font-semibold hover:border-neutral-900">
          {kk.auth.login}
        </Link>
      </div>
    </main>
  );
}
