"use client";
import { useState, useTransition } from "react";
import { ru } from "@/lib/i18n/ru";
import { createCategory, deleteCategory, moveCategory, updateCategory, type CatState } from "./actions";

const C = ru.admin.categories;
type Row = { id: string; title: string; slug: string; isActive: boolean; templates: number };

/** Categories: add, rename, show/hide, reorder (↑ ↓) and delete — all inline. */
export function CategoryManager({ rows }: { rows: Row[] }) {
  const [msg, setMsg] = useState<CatState | null>(null);
  const [pending, start] = useTransition();
  const [newTitle, setNewTitle] = useState("");
  const [edit, setEdit] = useState<{ id: string; title: string } | null>(null);
  const run = (fn: () => Promise<CatState>) => start(async () => { const r = await fn(); if (r.ok || r.error) setMsg(r); });

  return (
    <div className="max-w-2xl space-y-4">
      {msg && <p className={`rounded-xl px-4 py-3 text-sm ${msg.error ? "bg-danger/10 text-danger" : "bg-success/10 text-success"}`}>{msg.error ?? msg.ok}</p>}

      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!newTitle.trim()) return; run(async () => { const r = await createCategory({ title: newTitle }); if (r.ok) setNewTitle(""); return r; }); }}>
        <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} maxLength={60} placeholder={C.newPlaceholder}
          className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3" />
        <button disabled={pending || !newTitle.trim()} className="h-11 shrink-0 rounded-full bg-ink px-5 text-sm font-semibold text-paper disabled:opacity-50">+ {C.add}</button>
      </form>

      {rows.length === 0 ? <p className="text-muted">{C.empty}</p> : (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {rows.map((r, i) => (
            <li key={r.id} className={`flex flex-wrap items-center gap-2 px-3 py-3 ${r.isActive ? "" : "opacity-60"}`}>
              <div className="flex flex-col">
                <button type="button" aria-label={C.up} disabled={pending || i === 0} onClick={() => run(() => moveCategory(r.id, -1))} className="h-5 px-1.5 text-xs disabled:opacity-30">▲</button>
                <button type="button" aria-label={C.down} disabled={pending || i === rows.length - 1} onClick={() => run(() => moveCategory(r.id, 1))} className="h-5 px-1.5 text-xs disabled:opacity-30">▼</button>
              </div>
              <div className="min-w-0 flex-1">
                {edit?.id === r.id ? (
                  <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(async () => { const res = await updateCategory({ id: r.id, title: edit.title, isActive: r.isActive }); if (res.ok) setEdit(null); return res; }); }}>
                    <input autoFocus value={edit.title} onChange={(e) => setEdit({ id: r.id, title: e.target.value })} maxLength={60}
                      className="h-9 min-w-0 flex-1 rounded-lg border border-line px-2" />
                    <button disabled={pending || !edit.title.trim()} className="rounded-full bg-ink px-3 text-xs font-semibold text-paper">{ru.common.save}</button>
                    <button type="button" onClick={() => setEdit(null)} className="rounded-full px-2 text-xs">{ru.common.cancel}</button>
                  </form>
                ) : (
                  <>
                    <p className="truncate font-semibold">{r.title}</p>
                    <p className="text-xs text-muted">/{r.slug} · {C.templates(r.templates)}{r.isActive ? "" : ` · ${C.hidden}`}</p>
                  </>
                )}
              </div>
              {edit?.id !== r.id && (
                <div className="flex flex-wrap items-center gap-1">
                  <button type="button" onClick={() => setEdit({ id: r.id, title: r.title })} className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold">{C.rename}</button>
                  <button type="button" disabled={pending} onClick={() => run(() => updateCategory({ id: r.id, title: r.title, isActive: !r.isActive }))}
                    className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold">{r.isActive ? C.hide : C.show}</button>
                  <button type="button" disabled={pending}
                    onClick={() => { if (confirm(C.deleteConfirm(r.title, r.templates))) run(() => deleteCategory(r.id)); }}
                    className="rounded-full px-3 py-1.5 text-xs font-semibold text-danger">{C.delete}</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
