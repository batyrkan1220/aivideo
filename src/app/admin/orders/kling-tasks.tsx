"use client";
import { useState } from "react";
import { klingElementInfo, klingTaskVideo } from "./actions";

type Task = { task: string; step: string };

/** Support: watch what every Kling task of this order returned (each person's run, each shot). */
export function KlingTasks({ tasks }: { tasks: Task[] }) {
  const [open, setOpen] = useState<Record<string, { url?: string; text?: string; error?: string; busy?: boolean }>>({});
  const [own, setOwn] = useState("");
  const show = async (task: string, step = "") => {
    setOpen((o) => ({ ...o, [task]: { busy: true } }));
    // An Element task has no video: it returns the Element (or why it failed).
    const r = step.startsWith("Элемент") ? await klingElementInfo(task) : await klingTaskVideo(task);
    setOpen((o) => ({ ...o, [task]: r }));
  };
  const list: Task[] = [...tasks, ...(own && !tasks.some((t) => t.task === own) && open[own] ? [{ task: own, step: "задача" }] : [])];
  return (
    <div className="space-y-3">
      {list.length === 0 && <p className="text-sm text-muted">Задачи Kling этого заказа пока не записаны. Номер задачи можно взять из лога и ввести ниже.</p>}
      {list.map((t, i) => {
        // A shot kept as in the template: nothing went to Kling.
        if (!t.task) return <p key={`i${i}`} className="rounded-xl bg-mist p-3 text-sm">{t.step}</p>;
        const r = open[t.task];
        return (
          <div key={`${t.task}-${i}`} className="rounded-xl p-3 ring-1 ring-line">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm"><b>{t.step}</b> · <span className="font-mono text-xs text-muted">{t.task}</span></p>
              <button type="button" onClick={() => void show(t.task, t.step)} disabled={r?.busy}
                className="rounded-full border border-line px-3 py-1 text-xs font-semibold hover:border-ink disabled:opacity-60">
                {r?.busy ? "Загружаю…" : "▶ Показать результат"}
              </button>
            </div>
            {r?.error && <p className="mt-2 text-sm text-danger">{r.error}</p>}
            {r?.text && <p className="mt-2 text-sm">{r.text}</p>}
            {r?.url && (
              <div className="mt-2 space-y-1">
                <video src={r.url} controls playsInline className="max-h-80 rounded-xl bg-black" />
                <a href={r.url} target="_blank" rel="noreferrer" className="text-xs font-semibold underline">Открыть / скачать</a>
              </div>
            )}
          </div>
        );
      })}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (own.trim()) void show(own.trim()); }}>
        <input value={own} onChange={(e) => setOwn(e.target.value.replace(/\D/g, ""))} placeholder="Номер задачи Kling"
          className="h-9 flex-1 rounded-full border border-line px-3 text-sm" inputMode="numeric" />
        <button type="submit" className="rounded-full bg-ink px-4 text-sm font-semibold text-white">Показать</button>
      </form>
    </div>
  );
}
