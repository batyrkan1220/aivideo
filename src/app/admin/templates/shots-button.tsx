"use client";
import { useState } from "react";
import { templateShots } from "./actions";

type R = NonNullable<Awaited<ReturnType<typeof templateShots>>>;
const sec = (n: number) => `${n.toFixed(1)} с`;

/** Admin list: how an order of this template is cut into shots for Kling, with a frame of every scene. */
export function ShotsButton({ id }: { id: string }) {
  const [state, setState] = useState<"idle" | "busy" | "err">("idle");
  const [r, setR] = useState<R | null>(null);
  const load = async () => {
    setState("busy");
    const res = await templateShots(id);
    if (res) { setR(res); setState("idle"); } else setState("err");
  };
  return (
    <>
      <button type="button" disabled={state === "busy"} onClick={() => void load()}
        className="rounded-full border border-line px-2.5 py-1 text-xs font-semibold hover:border-ink disabled:opacity-60">
        {state === "busy" ? "Считаю…" : state === "err" ? "Ошибка" : "🎬 Кадры"}
      </button>
      {r && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => setR(null)}>
          <div className="max-h-[85dvh] w-full max-w-3xl overflow-auto rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-lg font-bold">Сцен: {r.scenes.length} · частей для Kling: {r.parts.length}</p>
                <p className="text-sm text-muted">Видео {sec(r.total)}. Сцены короче 3 с Kling получает вместе с соседней.</p>
              </div>
              <button type="button" onClick={() => setR(null)} className="rounded-full border border-line px-3 py-1 text-sm">✕</button>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
              {r.scenes.map((s, i) => {
                const part = r.parts.findIndex((p) => s.start + 0.01 >= p.start && s.start < p.start + p.len - 0.01);
                return (
                  <figure key={i} className="overflow-hidden rounded-xl ring-1 ring-line">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.jpg} alt={`Сцена ${i + 1}`} className="aspect-[9/16] w-full bg-mist object-cover" />
                    <figcaption className="p-2 text-xs">
                      <b>Сцена {i + 1}</b> · {sec(s.start)}–{sec(s.start + s.len)}<br />часть {part + 1}
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
