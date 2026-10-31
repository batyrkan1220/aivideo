/** Shown instantly on navigation while the next page loads (taps feel immediate). */
export default function Loading() {
  return (
    <main className="mx-auto max-w-6xl px-4 pt-4" aria-busy="true">
      <div className="h-8 w-40 animate-pulse rounded-full bg-surface" />
      <div className="mt-4 h-48 animate-pulse rounded-[24px] bg-surface" />
      <ul className="mt-4 grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => <li key={i} className="aspect-[9/16] animate-pulse rounded-[14px] bg-surface" />)}
      </ul>
    </main>
  );
}
