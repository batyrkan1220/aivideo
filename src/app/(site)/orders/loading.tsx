import { Skeleton } from "@/components/ui/states";

export default function Loading() {
  return (
    <main className="mx-auto max-w-3xl px-4 pt-6 sm:px-6" aria-busy="true">
      <Skeleton className="h-8 w-36 rounded-full" />
      <ul className="mt-6 grid gap-3">
        {Array.from({ length: 5 }, (_, i) => <li key={i}><Skeleton className="h-24 rounded-card" /></li>)}
      </ul>
    </main>
  );
}
