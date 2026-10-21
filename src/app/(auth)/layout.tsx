import Link from "next/link";
import { kk } from "@/lib/i18n/kk";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 block text-center text-2xl font-bold tracking-tight">
          {kk.brand.name}
        </Link>
        <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">{children}</div>
      </div>
    </main>
  );
}
