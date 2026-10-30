export default function Loading() {
  return (
    <main className="mx-auto max-w-6xl px-4 pt-4" aria-busy="true">
      <div className="h-8 w-32 animate-pulse rounded-full bg-surface" />
      <ul className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {Array.from({ length: 4 }, (_, i) => <li key={i} className="aspect-[3/4] animate-pulse rounded-[20px] bg-surface" />)}
      </ul>
    </main>
  );
}
