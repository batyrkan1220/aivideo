import { CardGridSkeleton, Skeleton } from "@/components/ui/states";

/** Shown instantly on navigation while the next page loads (taps feel immediate). */
export default function Loading() {
  return (
    <main className="mx-auto max-w-6xl px-4 pt-6 sm:px-6" aria-busy="true">
      <Skeleton className="h-8 w-48 rounded-full" />
      <Skeleton className="mt-4 h-48 rounded-card" />
      <div className="mt-6"><CardGridSkeleton count={8} /></div>
    </main>
  );
}
