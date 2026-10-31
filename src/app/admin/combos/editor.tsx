"use client";
import { useMemo, useState, useTransition } from "react";
import { ru } from "@/lib/i18n/ru";
import { formatKzt } from "@/lib/pricing";
import { deleteCombo, saveCombo } from "./actions";

const T = ru.admin.combos;
type Item = { id: string; title: string; priceKzt: number; cover: string | null };
type Combo = { id: string; title: string; description: string; discountPercent: number; templateIds: string[]; priceKzt: number };
type Draft = { id: string | null; title: string; description: string; discountPercent: number; templateIds: string[] };

const empty: Draft = { id: null, title: "", description: "", discountPercent: 20, templateIds: [] };

/** Combos list + editor: pick photo templates, set a discount, the price is computed live. */
export function ComboEditor({ combos, items }: { combos: Combo[]; items: Item[] }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const picked = (draft?.templateIds ?? []).map((id) => byId.get(id)).filter((x): x is Item => !!x);
  const sum = picked.reduce((s, i) => s + i.priceKzt, 0);
  const price = Math.max(10, Math.round((sum * (1 - (draft?.discountPercent ?? 0) / 100)) / 10) * 10);

  const toggle = (id: string) => setDraft((d) => d && ({ ...d, templateIds: d.templateIds.includes(id) ? d.templateIds.filter((x) => x !== id) : [...d.templateIds, id] }));
  const save = () => draft && start(async () => {
    const r = await saveCombo(draft);
    setMsg(r);
    if (r.ok) setDraft(null);
  });
  const remove = (id: string) => {
    if (!confirm(T.removeConfirm)) return;
    start(async () => setMsg(await deleteCombo(id)));
  };

  return (
    <div className="space-y-6">
      {msg && <p className={`rounded-xl px-4 py-3 text-sm ${msg.error ? "bg-danger/10 text-danger" : "bg-success/10 text-success"}`}>{msg.error ?? msg.ok}</p>}

      {!draft && (
        <>
          <button type="button" onClick={() => { setMsg(null); setDraft({ ...empty }); }} className="h-11 rounded-full bg-ink px-5 text-sm font-semibold text-paper">+ {T.new}</button>
          {combos.length === 0 ? <p className="text-muted">{T.empty}</p> : (
            <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
              {combos.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{c.title}</p>
                    <p className="text-sm text-muted">{T.photos(c.templateIds.length)} · −{c.discountPercent}% · {formatKzt(c.priceKzt)}</p>
                  </div>
                  <button type="button" className="rounded-full border border-line px-4 py-2 text-sm font-semibold" onClick={() => { setMsg(null); setDraft({ id: c.id, title: c.title, description: c.description, discountPercent: c.discountPercent, templateIds: c.templateIds }); }}>{T.edit}</button>
                  <button type="button" disabled={pending} className="rounded-full px-4 py-2 text-sm font-semibold text-danger" onClick={() => remove(c.id)}>{T.remove}</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {draft && (
        <div className="space-y-4 rounded-2xl border border-line bg-surface p-5">
          <label className="block text-sm font-semibold">{T.name}
            <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={120}
              className="mt-1 h-11 w-full rounded-xl border border-line px-3 font-normal" />
          </label>
          <label className="block text-sm font-semibold">{T.description}
            <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} maxLength={500}
              className="mt-1 h-11 w-full rounded-xl border border-line px-3 font-normal" />
          </label>
          <label className="block w-40 text-sm font-semibold">{T.discount}
            <input type="number" min={0} max={90} value={draft.discountPercent}
              onChange={(e) => setDraft({ ...draft, discountPercent: Math.max(0, Math.min(90, Number(e.target.value) || 0)) })}
              className="mt-1 h-11 w-full rounded-xl border border-line px-3 font-normal" />
          </label>

          <div>
            <p className="text-sm font-semibold">{T.pick} <span className="font-normal text-muted">· {T.picked(picked.length)}</span></p>
            {items.length === 0 ? <p className="mt-2 text-sm text-muted">{T.noTemplates}</p> : (
              <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-6">
                {items.map((i) => {
                  const n = draft.templateIds.indexOf(i.id);
                  return (
                    <li key={i.id}>
                      <button type="button" onClick={() => toggle(i.id)} aria-pressed={n >= 0}
                        className={`relative block w-full overflow-hidden rounded-xl border-2 text-left ${n >= 0 ? "border-ink" : "border-transparent"}`}>
                        {i.cover
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={i.cover} alt="" className="aspect-[3/4] w-full object-cover" />
                          : <span className="flex aspect-[3/4] items-center justify-center bg-paper text-2xl">📸</span>}
                        {n >= 0 && <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-ink text-xs font-bold text-paper">{n + 1}</span>}
                        <span className="block truncate px-1.5 py-1 text-xs">{i.title} · {formatKzt(i.priceKzt)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl bg-paper px-4 py-3 text-sm">
            <span>{T.sum}: <b>{formatKzt(sum)}</b></span>
            <span>{T.price}: <b className="text-lg">{formatKzt(picked.length >= 2 ? price : 0)}</b></span>
          </div>

          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={pending || picked.length < 2 || !draft.title.trim()} onClick={save}
              className="h-11 rounded-full bg-ink px-6 text-sm font-semibold text-paper disabled:opacity-50">{pending ? ru.common.loading : T.save}</button>
            <button type="button" onClick={() => setDraft(null)} className="h-11 rounded-full border border-line px-6 text-sm font-semibold">{ru.common.cancel}</button>
          </div>
        </div>
      )}
    </div>
  );
}
