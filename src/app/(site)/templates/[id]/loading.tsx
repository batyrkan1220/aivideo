export default function Loading() {
  return (
    <main className="mx-auto max-w-6xl px-4 pt-4" aria-busy="true">
      <div className="mx-auto aspect-[9/16] w-full max-w-[min(100%,calc(60svh*9/16))] animate-pulse rounded-[1.75rem] bg-surface" />
      <div className="mt-4 h-8 w-48 animate-pulse rounded-full bg-surface" />
      <div className="mt-3 h-6 w-64 animate-pulse rounded-full bg-surface" />
    </main>
  );
}
