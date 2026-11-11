"use client";
import { useState, useTransition } from "react";
import { setCharacterSheet } from "./actions";

/** Before the video: a Character Sheet of each person (Kling image), sent to the video with the photo. */
export function CharacterSheetToggle({ on: initial }: { on: boolean }) {
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending}
      title="Вкл: перед видео Kling рисует Character Sheet каждого человека по его фото (несколько ракурсов) и отправляет его в видео вместе с фото — лицо держится с любого ракурса. Лист виден в заказе. Выкл: в видео идёт только фото."
      onClick={() => start(async () => { const r = await setCharacterSheet(!on); if (r.ok) setOn(!on); })}
      className={`rounded-full border px-4 py-2 text-sm font-semibold disabled:opacity-60 ${on ? "border-[#9cbf12] bg-brand/40" : "border-line bg-white hover:border-ink"}`}>
      🧑‍🎨 Character Sheet: {on ? "вкл" : "выкл"}
    </button>
  );
}
