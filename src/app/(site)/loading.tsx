/**
 * Shown for a moment while a page without its own loading state opens. Deliberately plain: a thin
 * progress line, no page-shaped skeleton (an old-style skeleton flashed before the new home page
 * and then the size jumped). Pages show their own skeletons inside.
 */
export default function Loading() {
  return (
    <main className="min-h-[70vh]" aria-busy="true">
      <div className="h-0.5 w-full overflow-hidden bg-ink/[0.06]">
        <div className="h-full w-1/3 animate-[tm-loading_1s_ease-in-out_infinite] bg-ink/40" />
      </div>
    </main>
  );
}
