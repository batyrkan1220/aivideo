import { Suspense } from "react";
import { kk } from "@/lib/i18n/kk";
import { AuthButtons } from "@/components/auth-buttons";

// Temporary homepage until the catalog (part 3) lands.
export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-neutral-50 px-6 text-center">
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{kk.brand.name}</h1>
      <p className="mt-4 max-w-md text-lg text-neutral-600">{kk.brand.tagline}</p>
      <p className="mt-2 text-sm text-neutral-500">{kk.account.comingSoon}</p>
      <div className="mt-8 min-h-14">
        <Suspense fallback={null}>
          <AuthButtons />
        </Suspense>
      </div>
    </main>
  );
}
