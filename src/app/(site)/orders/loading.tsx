export default function Loading() {
  return (
    <main className="mx-auto max-w-6xl px-4 pt-4" aria-busy="true">
      <div className="h-8 w-32 animate-pulse rounded-full bg-surface" />
      <ul className="mt-4 space-y-2">
        {Array.from({ length: 5 }, (_, i) => <li key={i} className="h-[84px] animate-pulse rounded-[20px] bg-surface" />)}
      </ul>
    </main>
  );
}
