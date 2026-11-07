"use client";
import { useState } from "react";
import { orderShots, saveShotMap, templateShots } from "./actions";

type Base = NonNullable<Awaited<ReturnType<typeof orderShots>>>;
type R = Base & { people?: string[]; marks?: number[][] | null };
const sec = (n: number) => `${n.toFixed(1)} с`;

/**
 * Admin: how an order of this template is cut into shots for Kling, with a frame of every scene.
 * For a template the admin also marks who is in each shot: a shot with nobody is kept exactly as in
 * the template (no Kling), and a shot is made only for the people marked in it.
 */
export function ShotsButton({ id, order = false }: { id: string; order?: boolean }) {
  const [state, setState] = useState<"idle" | "busy" | "err">("idle");
  const [r, setR] = useState<R | null>(null);
  const [marks, setMarks] = useState<number[][]>([]);
  const [save, setSave] = useState<"idle" | "busy" | "ok" | "err">("idle");
  const load = async () => {
    setState("busy");
    const res: R | null = await (order ? orderShots(id) : templateShots(id));
    if (!res) { setState("err"); return; }
    setR(res);
    const n = res.people?.length ?? 0;
    // Saved marks for these same shots, else everybody in every shot (what orders do without marks).
    setMarks(res.marks ?? res.parts.map(() => Array.from({ length: n }, (_, i) => i)));
    setSave("idle");
    setState("idle");
  };
  const toggle = (shot: number, person: number) => {
    setSave("idle");
    setMarks((m) => m.map((p, i) => (i !== shot ? p : p.includes(person) ? p.filter((x) => x !== person) : [...p, person].sort())));
  };
  const store = async () => {
    if (!r) return;
    setSave("busy");
    const res = await saveShotMap(id, r.parts.map((p) => p.start), marks);
    setSave(res.ok ? "ok" : "err");
  };
  const people = r?.people ?? [];
  const marking = !order && people.length > 0 && (r?.parts.length ?? 0) > 1;
  return (
    <>
      <button type="button" disabled={state === "busy"} onClick={() => void load()}
        className="rounded-full border border-line px-2.5 py-1 text-xs font-semibold hover:border-ink disabled:opacity-60">
        {state === "busy" ? "Считаю…" : state === "err" ? "Ошибка" : "🎬 Кадры"}
      </button>
      {r && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => setR(null)}>
          <div className="max-h-[88dvh] w-full max-w-4xl overflow-auto rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-lg font-bold">Сцен: {r.scenes.length}{order ? "" : ` · частей для Kling: ${r.parts.length}`}</p>
                <p className="text-sm text-muted">
                  Видео {sec(r.total)}. {order ? "Готовое видео заказа: сравните сцены с шаблоном."
                    : marking ? "Отметьте, кто виден в каждой части. Часть без людей останется как в шаблоне, без Kling. Работает при «🎬 По сценам: вкл»."
                    : "Монтажных склеек нет: видео идёт в Kling целиком."}
                </p>
              </div>
              <button type="button" onClick={() => setR(null)} className="rounded-full border border-line px-3 py-1 text-sm">✕</button>
            </div>
            <div className="mt-4 space-y-3">
              {r.parts.map((p, k) => {
                const scenes = r.scenes.filter((s) => s.start + 0.01 >= p.start && s.start < p.start + p.len - 0.01);
                return (
                  <section key={k} className="rounded-xl p-3 ring-1 ring-line">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-bold">Часть {k + 1} · {sec(p.start)}–{sec(p.start + p.len)}</p>
                      {marking && (
                        <div className="flex flex-wrap gap-2">
                          {people.map((name, i) => {
                            const on = marks[k]?.includes(i) ?? false;
                            return (
                              <button key={i} type="button" onClick={() => toggle(k, i)}
                                className={`rounded-full border px-3 py-1 text-xs font-semibold ${on ? "border-ink bg-ink text-white" : "border-line bg-white text-muted"}`}>
                                {on ? "✓ " : ""}{name.length > 28 ? `${name.slice(0, 28)}…` : name}
                              </button>
                            );
                          })}
                          {!(marks[k]?.length) && <span className="rounded-full bg-mist px-3 py-1 text-xs font-semibold">без людей · как в шаблоне</span>}
                        </div>
                      )}
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
                      {scenes.map((s, i) => (
                        <figure key={i} className="overflow-hidden rounded-lg ring-1 ring-line">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={s.jpg} alt={`Сцена ${sec(s.start)}`} className="aspect-[9/16] w-full bg-mist object-cover" />
                          <figcaption className="p-1.5 text-[11px]">{sec(s.start)}–{sec(s.start + s.len)}</figcaption>
                        </figure>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
            {marking && (
              <div className="mt-4 flex items-center justify-end gap-3">
                <span className={`text-sm ${save === "ok" ? "text-success" : save === "err" ? "text-danger" : "text-muted"}`} aria-live="polite">
                  {save === "ok" ? "Сохранено" : save === "err" ? "Не сохранилось" : r.marks ? "Отметки сохранены ранее" : "Отметок ещё нет"}
                </span>
                <button type="button" onClick={() => void store()} disabled={save === "busy"}
                  className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-white disabled:opacity-60">
                  {save === "busy" ? "Сохраняю…" : "Сохранить отметки"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
