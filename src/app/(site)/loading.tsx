/** Shown instantly on navigation while the next page loads (taps feel immediate). */
export default function Loading() {
  return (
    <main className="mx-auto max-w-6xl px-4 pt-4" aria-busy="true">
      <div className="h-8 w-40 animate-pulse rounded-full bg-surface" />
      <div className="mt-4 h-48 animate-pulse rounded-[24px] bg-surface" />
      <ul className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <li key={i} className="aspect-[9/16] animate-pulse rounded-[20px] bg-surface" />)}
      </ul>
    </main>
  );
}
