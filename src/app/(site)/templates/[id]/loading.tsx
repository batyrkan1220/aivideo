import { Skeleton } from "@/components/ui/states";

export default function Loading() {
  return (
    <main className="mx-auto max-w-6xl px-4 pt-6 sm:px-6" aria-busy="true">
      <Skeleton className="mx-auto aspect-[9/16] w-full max-w-[min(100%,calc(58svh*9/16))] rounded-[1.75rem]" />
      <Skeleton className="mt-6 h-8 w-56 rounded-full" />
      <Skeleton className="mt-3 h-5 w-72 rounded-full" />
      <Skeleton className="mt-6 h-40 rounded-card" />
    </main>
  );
}
