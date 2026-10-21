import type { FaceSlot } from "@/lib/templates/schema";

/**
 * Visual face-position diagram: each slot is drawn at its configured (x, y)
 * on a 16:9 stage, numbered in the same order the upload slots appear.
 */
export function FaceMap({ slots }: { slots: FaceSlot[] }) {
  return (
    <div className="space-y-3">
      <div className="relative aspect-video w-full max-w-md overflow-hidden rounded-card border border-line bg-white" aria-hidden>
        {slots.map((s, i) => (
          <div
            key={s.key}
            className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
            style={{ left: `${s.position.x * 100}%`, top: `${s.position.y * 100}%` }}
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-brand bg-brand-soft font-display text-sm font-bold text-brand">
              {i + 1}
            </span>
            <span className="mt-1 h-6 w-9 rounded-t-full bg-brand-soft" />
          </div>
        ))}
      </div>
      <ol className="space-y-1 text-sm">
        {slots.map((s, i) => (
          <li key={s.key} className="flex gap-2">
            <span className="font-semibold text-brand">{i + 1}.</span>
            <span>{s.labelKk}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
