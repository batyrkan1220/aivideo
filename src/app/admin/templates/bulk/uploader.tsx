"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { ru } from "@/lib/i18n/ru";
import { supabaseBrowser } from "@/lib/supabase/client";
import { formatKzt } from "@/lib/pricing";
import { PHOTO_ASPECTS, PHOTO_MAX_PEOPLE } from "@/lib/templates/photo-config";
import { createPhotoTemplates, createUploadUrl } from "../actions";

const B = ru.admin.bulk;
type Row = { id: number; file: File; preview: string; title: string; state: "wait" | "upload" | "done" | "error" };
const MAX_FILES = 300;
const PARALLEL = 4;
const BATCH = 10;

/** "summer_beach-01.jpg" → "Summer beach 01" */
function titleFrom(name: string, i: number) {
  const t = name.replace(/\.[^.]+$/, "").replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
  return t.length >= 2 ? t.charAt(0).toUpperCase() + t.slice(1) : `${B.photoN} ${i + 1}`;
}

/** Re-encodes to JPEG (max 1600 px) and uploads to template-media; returns the storage path. */
async function uploadExample(file: File): Promise<string | null> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.9));
    if (!blob) return null;
    const r = await createUploadUrl({ kind: "cover", contentType: "image/jpeg", size: blob.size });
    if (!r.ok) return null;
    const { error } = await supabaseBrowser().storage.from("template-media").uploadToSignedUrl(r.path, r.token, blob, { contentType: "image/jpeg" });
    return error ? null : r.path;
  } catch {
    return null;
  }
}

export function BulkPhotoUpload({ categories, canPublish, costKzt }: { categories: { id: string; title: string }[]; canPublish: boolean; costKzt: number }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [price, setPrice] = useState(990);
  const [people, setPeople] = useState(1);
  const [aspect, setAspect] = useState<(typeof PHOTO_ASPECTS)[number]>("3:4");
  const [prompt, setPrompt] = useState("");
  const [allowWish, setAllowWish] = useState(true);
  const [publish, setPublish] = useState(canPublish);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ created: number; failed: number } | null>(null);
  const seq = useRef(0);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    setResult(null);
    const files = [...list].filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type));
    setRows((prev) => [...prev, ...files.slice(0, MAX_FILES - prev.length).map((file) => {
      const id = seq.current++;
      return { id, file, preview: URL.createObjectURL(file), title: titleFrom(file.name, id), state: "wait" as const };
    })]);
  };
  const patch = (id: number, p: Partial<Row>) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const remove = (id: number) => setRows((prev) => prev.filter((r) => r.id !== id));

  const start = async () => {
    const todo = rows.filter((r) => r.state !== "done");
    if (!todo.length || !(price > 0)) return;
    setRunning(true);
    setResult(null);
    let created = 0;
    let failed = 0;
    // Upload in parallel, create templates in small batches as uploads finish (order kept).
    for (let i = 0; i < todo.length; i += BATCH) {
      const chunk = todo.slice(i, i + BATCH);
      const paths: (string | null)[] = new Array(chunk.length).fill(null);
      let next = 0;
      await Promise.all(Array.from({ length: PARALLEL }, async () => {
        while (next < chunk.length) {
          const k = next++;
          patch(chunk[k].id, { state: "upload" });
          paths[k] = await uploadExample(chunk[k].file);
          if (!paths[k]) patch(chunk[k].id, { state: "error" });
        }
      }));
      const ok = chunk.map((r, k) => ({ r, path: paths[k] })).filter((x): x is { r: Row; path: string } => !!x.path);
      if (ok.length) {
        const res = await createPhotoTemplates({
          items: ok.map(({ r, path }) => ({ coverPath: path, title: r.title.trim().length >= 2 ? r.title.trim() : `${B.photoN} ${r.id + 1}` })),
          categoryId: categoryId || null, priceKzt: price, people, aspectRatio: aspect, prompt, allowWish, publish,
        });
        const n = res.ok ? res.ids.length : 0;
        ok.forEach(({ r }, k) => patch(r.id, { state: k < n ? "done" : "error" }));
        created += n;
        failed += ok.length - n;
      }
      failed += chunk.length - ok.length;
    }
    setRunning(false);
    setResult({ created, failed });
  };

  const inputCls = "w-full rounded-xl border border-line bg-white px-3 py-2 text-sm";
  const waiting = rows.filter((r) => r.state !== "done").length;

  return (
    <div className="space-y-6">
      <section className="rounded-card border border-line bg-white p-5">
        <h2 className="mb-4 font-semibold">{B.settings}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm"><span className="mb-1 block font-medium">{B.price}</span>
            <input type="number" min={1} step={10} className={inputCls} value={price} onChange={(e) => setPrice(Math.max(0, Math.round(Number(e.target.value) || 0)))} />
            <span className="mt-1 block text-xs text-muted">{B.cost(formatKzt(costKzt))}</span>
          </label>
          <label className="text-sm"><span className="mb-1 block font-medium">{B.category}</span>
            <select className={inputCls} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">{ru.admin.editor.noCategory}</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </label>
          <label className="text-sm"><span className="mb-1 block font-medium">{B.people}</span>
            <select className={inputCls} value={people} onChange={(e) => setPeople(Number(e.target.value))}>
              {Array.from({ length: PHOTO_MAX_PEOPLE }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="text-sm"><span className="mb-1 block font-medium">{B.aspect}</span>
            <select className={inputCls} value={aspect} onChange={(e) => setAspect(e.target.value as typeof aspect)}>
              {PHOTO_ASPECTS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label className="text-sm sm:col-span-2 lg:col-span-4"><span className="mb-1 block font-medium">{B.prompt}</span>
            <textarea className={`${inputCls} min-h-16`} maxLength={2000} value={prompt} placeholder={B.promptPlaceholder} onChange={(e) => setPrompt(e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand" checked={allowWish} onChange={(e) => setAllowWish(e.target.checked)} />{ru.admin.editor.seedance.allowWish}</label>
          {canPublish && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand" checked={publish} onChange={(e) => setPublish(e.target.checked)} />{B.publish}</label>}
        </div>
      </section>

      <section className="rounded-card border border-line bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">{B.photos(rows.length)}</h2>
          <div className="flex flex-wrap gap-2">
            <label className={`inline-flex cursor-pointer items-center rounded-full border border-ink px-4 py-2 text-sm font-semibold hover:bg-ink hover:text-white ${running ? "pointer-events-none opacity-50" : ""}`}>
              + {B.choose}
              <input type="file" multiple accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={running} onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
            </label>
            {rows.length > 0 && !running && <button type="button" className="rounded-full px-4 py-2 text-sm text-muted hover:text-danger" onClick={() => setRows([])}>{B.clear}</button>}
          </div>
        </div>
        <p className="mt-1 text-xs text-muted">{B.hint(MAX_FILES)}</p>

        {rows.length > 0 && (
          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {rows.map((r) => (
              <li key={r.id} className="space-y-1.5">
                <div className="relative aspect-[3/4] overflow-hidden rounded-xl bg-paper">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.preview} alt="" className="h-full w-full object-cover" />
                  <span className={`absolute left-1.5 top-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.state === "done" ? "bg-success text-white" : r.state === "error" ? "bg-danger text-white" : r.state === "upload" ? "bg-white text-ink" : "hidden"}`}>
                    {r.state === "done" ? "✓" : r.state === "error" ? B.failed : B.uploading}
                  </span>
                  {!running && r.state !== "done" && (
                    <button type="button" aria-label={ru.admin.list.delete} onClick={() => remove(r.id)} className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-xs text-white">✕</button>
                  )}
                </div>
                <input className="w-full rounded-lg border border-line px-2 py-1 text-xs" value={r.title} maxLength={120} disabled={running || r.state === "done"} onChange={(e) => patch(r.id, { title: e.target.value })} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="sticky bottom-4 flex flex-wrap items-center gap-3 rounded-card border border-line bg-white p-4 shadow-lg">
        <button type="button" disabled={running || !waiting || !(price > 0)} onClick={() => void start()}
          className="h-11 rounded-full bg-brand px-6 text-sm font-semibold text-white disabled:opacity-50">
          {running ? B.running : B.create(waiting)}
        </button>
        {result && (
          <p className="text-sm">
            <span className="font-semibold text-success">{B.created(result.created)}</span>
            {result.failed > 0 && <span className="ml-2 text-danger">{B.failedCount(result.failed)}</span>}
            <Link href="/admin/templates" className="ml-3 font-semibold text-brand hover:underline">{B.toList}</Link>
          </p>
        )}
      </div>
    </div>
  );
}
