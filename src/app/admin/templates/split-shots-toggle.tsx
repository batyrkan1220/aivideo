"use client";
import { useState, useTransition } from "react";
import { setSplitShots } from "./actions";

/** Templates with cuts: edited shot by shot, or the whole video goes to Kling at once. */
export function SplitShotsToggle({ on: initial }: { on: boolean }) {
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending}
      title="Вкл: видео с монтажными склейками делится на сцены, каждая генерируется отдельно (лицо держится после склейки, но сцены могут отличаться). Выкл: всё видео целиком одной генерацией."
      onClick={() => start(async () => { const r = await setSplitShots(!on); if (r.ok) setOn(!on); })}
      className={`rounded-full border px-4 py-2 text-sm font-semibold disabled:opacity-60 ${on ? "border-[#9cbf12] bg-brand/40" : "border-line bg-white hover:border-ink"}`}>
      🎬 По сценам: {on ? "вкл" : "выкл"}
    </button>
  );
}
