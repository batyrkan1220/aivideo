import { slotPreviewSrc, type FaceSlot } from "@/lib/templates/schema";
import { kk } from "@/lib/i18n/kk";

/**
 * Which photo goes to which person.
 *  - templates whose slots carry a preview of the person from the video: thumbnails, numbered.
 *  - Others: positions drawn left → right on a 16:9 stage.
 */
export function FaceMap({ slots, mediaBase }: { slots: FaceSlot[]; mediaBase?: string }) {
  const withPreview = slots.length > 0 && slots.every((s) => s.previewImagePath);
  if (withPreview) {
    return (
      <ol className="grid max-w-md grid-cols-3 gap-3 sm:grid-cols-5">
        {slots.map((s, i) => (
          <li key={s.key} className="text-center">
            <div className="relative aspect-[3/4] overflow-hidden rounded-xl border-2 border-brand bg-paper">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={slotPreviewSrc(s.previewImagePath, mediaBase)!} alt={kk.upload.personInVideo(i + 1)} className="h-full w-full object-cover" />
              <span className="absolute left-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">{i + 1}</span>
            </div>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <div className="space-y-3">
      <div className="relative aspect-[16/7] w-full max-w-md overflow-hidden rounded-card border border-line bg-surface" aria-hidden>
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
