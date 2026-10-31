"use client";
import { useRef, useState, useTransition } from "react";
import { ru } from "@/lib/i18n/ru";
import { formatKzt } from "@/lib/pricing";
import { supabaseBrowser } from "@/lib/supabase/client";
import { comboPhotoUploadUrl, deleteCombo, saveCombo } from "./actions";

const T = ru.admin.combos;
type Photo = { key: string; id?: string; path?: string; url: string; state: "ready" | "uploading" | "error" };
type Combo = { id: string; title: string; description: string; discountPercent: number; pricePerPhoto: number; priceKzt: number; photos: { id: string; url: string | null }[] };
type Draft = { id: string | null; title: string; description: string; discountPercent: number; pricePerPhoto: number; photos: Photo[] };

const MAX = 20;
const PARALLEL = 4;
let seq = 0;

/** Re-encodes to JPEG (max 1600 px) and uploads to template-media; returns the storage path. */
async function upload(file: File): Promise<string | null> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.9));
    if (!blob) return null;
    const r = await comboPhotoUploadUrl({ contentType: "image/jpeg", size: blob.size });
    if (!r.ok) return null;
    const { error } = await supabaseBrowser().storage.from("template-media").uploadToSignedUrl(r.path, r.token, blob, { contentType: "image/jpeg" });
    return error ? null : r.path;
  } catch {
    return null;
  }
}

/** Combos list + editor: upload the example photos right here; the price is computed live. */
export function ComboEditor({ combos }: { combos: Combo[] }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  const ready = (draft?.photos ?? []).filter((p) => p.state === "ready");
  const uploading = (draft?.photos ?? []).some((p) => p.state === "uploading");
  const sum = ready.length * (draft?.pricePerPhoto ?? 0);
  const price = Math.max(10, Math.round((sum * (1 - (draft?.discountPercent ?? 0) / 100)) / 10) * 10);

  const patchPhoto = (key: string, p: Partial<Photo>) =>
    setDraft((d) => d && ({ ...d, photos: d.photos.map((x) => (x.key === key ? { ...x, ...p } : x)) }));

  const addFiles = async (list: FileList | null) => {
    if (!list || !draft) return;
    const files = [...list].filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type)).slice(0, MAX - draft.photos.length);
    const added = files.map((f) => ({ key: `n${seq++}`, url: URL.createObjectURL(f), state: "uploading" as const, file: f }));
    setDraft((d) => d && ({ ...d, photos: [...d.photos, ...added.map((a) => ({ key: a.key, url: a.url, state: a.state }))] }));
    let next = 0;
    await Promise.all(Array.from({ length: PARALLEL }, async () => {
      while (next < added.length) {
        const a = added[next++];
        const path = await upload(a.file);
        patchPhoto(a.key, path ? { path, state: "ready" } : { state: "error" });
      }
    }));
  };

  const move = (key: string, dir: -1 | 1) => setDraft((d) => {
    if (!d) return d;
    const i = d.photos.findIndex((p) => p.key === key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= d.photos.length) return d;
    const photos = [...d.photos];
    [photos[i], photos[j]] = [photos[j], photos[i]];
    return { ...d, photos };
  });

  const save = () => draft && start(async () => {
    const r = await saveCombo({
      id: draft.id, title: draft.title, description: draft.description,
      discountPercent: draft.discountPercent, pricePerPhoto: draft.pricePerPhoto,
      photos: ready.map((p) => (p.id ? { id: p.id } : { path: p.path! })),
    });
    setMsg(r);
    if (r.ok) setDraft(null);
  });
  const remove = (id: string) => {
    if (!confirm(T.removeConfirm)) return;
    start(async () => setMsg(await deleteCombo(id)));
  };
  const edit = (c: Combo) => {
    setMsg(null);
    setDraft({
      id: c.id, title: c.title, description: c.description, discountPercent: c.discountPercent, pricePerPhoto: c.pricePerPhoto,
      photos: c.photos.map((p) => ({ key: p.id, id: p.id, url: p.url ?? "", state: "ready" as const })),
    });
  };

  return (
    <div className="space-y-6">
      {msg && <p className={`rounded-xl px-4 py-3 text-sm ${msg.error ? "bg-danger/10 text-danger" : "bg-success/10 text-success"}`}>{msg.error ?? msg.ok}</p>}

      {!draft && (
        <>
          <button type="button" onClick={() => { setMsg(null); setDraft({ id: null, title: "", description: "", discountPercent: 20, pricePerPhoto: 990, photos: [] }); }}
            className="h-11 rounded-full bg-ink px-5 text-sm font-semibold text-paper">+ {T.new}</button>
          {combos.length === 0 ? <p className="text-muted">{T.empty}</p> : (
            <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
              {combos.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 p-4">
                  <div className="flex -space-x-3">
                    {c.photos.slice(0, 4).map((p) => p.url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={p.id} src={p.url} alt="" className="h-12 w-9 rounded-lg object-cover ring-2 ring-white" />
                    ))}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{c.title}</p>
                    <p className="text-sm text-muted">{T.photos(c.photos.length)} · −{c.discountPercent}% · {formatKzt(c.priceKzt)}</p>
                  </div>
                  <button type="button" className="rounded-full border border-line px-4 py-2 text-sm font-semibold" onClick={() => edit(c)}>{T.edit}</button>
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
          <div className="flex flex-wrap gap-4">
            <label className="block w-44 text-sm font-semibold">{T.perPhoto}
              <input type="number" min={10} step={10} value={draft.pricePerPhoto}
                onChange={(e) => setDraft({ ...draft, pricePerPhoto: Math.max(10, Number(e.target.value) || 10) })}
                className="mt-1 h-11 w-full rounded-xl border border-line px-3 font-normal" />
            </label>
            <label className="block w-36 text-sm font-semibold">{T.discount}
              <input type="number" min={0} max={90} value={draft.discountPercent}
                onChange={(e) => setDraft({ ...draft, discountPercent: Math.max(0, Math.min(90, Number(e.target.value) || 0)) })}
                className="mt-1 h-11 w-full rounded-xl border border-line px-3 font-normal" />
            </label>
          </div>

          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">{T.pick} <span className="font-normal text-muted">· {T.picked(ready.length)} / {MAX}</span></p>
              <button type="button" disabled={draft.photos.length >= MAX} onClick={() => input.current?.click()}
                className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-paper disabled:opacity-50">{T.upload}</button>
              <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only"
                onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
            </div>
            {draft.photos.length > 0 && (
              <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-6">
                {draft.photos.map((p, i) => (
                  <li key={p.key} className="relative overflow-hidden rounded-xl border border-line">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt="" className={`aspect-[3/4] w-full object-cover ${p.state === "ready" ? "" : "opacity-50"}`} />
                    <span className="absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-ink text-xs font-bold text-paper">{i + 1}</span>
                    {p.state === "uploading" && <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold">{T.uploading}</span>}
                    {p.state === "error" && <span className="absolute inset-0 flex items-center justify-center bg-danger/20 text-xs font-semibold text-danger">✕</span>}
                    <div className="flex items-center justify-between bg-surface px-1 py-1 text-xs">
                      <button type="button" onClick={() => move(p.key, -1)} className="px-1.5" aria-label="←">←</button>
                      <button type="button" onClick={() => setDraft({ ...draft, photos: draft.photos.filter((x) => x.key !== p.key) })} className="font-semibold text-danger">{T.removePhoto}</button>
                      <button type="button" onClick={() => move(p.key, 1)} className="px-1.5" aria-label="→">→</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl bg-paper px-4 py-3 text-sm">
            <span>{T.sum}: <b>{formatKzt(sum)}</b></span>
            <span>{T.price}: <b className="text-lg">{formatKzt(ready.length >= 2 ? price : 0)}</b></span>
          </div>

          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={pending || uploading || ready.length < 2 || !draft.title.trim()} onClick={save}
              className="h-11 rounded-full bg-ink px-6 text-sm font-semibold text-paper disabled:opacity-50">{pending ? ru.common.loading : T.save}</button>
            <button type="button" onClick={() => setDraft(null)} className="h-11 rounded-full border border-line px-6 text-sm font-semibold">{ru.common.cancel}</button>
          </div>
        </div>
      )}
    </div>
  );
}
