"use client";
import { useEffect, useRef, useState } from "react";
import { compressPhoto } from "@/lib/uploads/compress";
import { checkSheetTest, startSheetTest } from "./actions";

type Run = { task: string; photo: string; started: number; url?: string; error?: string };

export function SheetTester({ defaultPrompt }: { defaultPrompt: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [aspect, setAspect] = useState("16:9");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [runs, setRuns] = useState<Run[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const runsRef = useRef(runs);
  useEffect(() => { runsRef.current = runs; }, [runs]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  // Poll the running tasks every 5 s.
  useEffect(() => {
    const t = setInterval(async () => {
      setNow(Date.now());
      for (const r of runsRef.current.filter((x) => !x.url && !x.error)) {
        const st = await checkSheetTest(r.task);
        if (st.state === "waiting") continue;
        setRuns((all) => all.map((x) => x.task === r.task ? { ...x, ...(st.state === "done" ? { url: st.url } : { error: st.error }) } : x));
      }
    }, 5000);
    return () => clearInterval(t);
  }, []);

  async function run() {
    if (!file) { setError("Выберите фото"); return; }
    setBusy(true); setError("");
    try {
      const fd = new FormData();
      fd.set("photo", await compressPhoto(file, 256));
      fd.set("prompt", prompt);
      fd.set("aspect", aspect);
      const r = await startSheetTest(fd);
      if (!r.ok) setError(r.error);
      else setRuns((all) => [{ task: r.task, photo: r.photo, started: Date.now() }, ...all]);
    } catch {
      setError("Не получилось отправить");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-card border border-line/80 bg-surface p-4 sm:p-5">
        <div className="grid gap-5 md:grid-cols-[12rem_minmax(0,1fr)]">
          <label className="block cursor-pointer">
            <span className="mb-2 block text-sm font-semibold">Фото человека</span>
            <span className="flex aspect-[3/4] w-full items-center justify-center overflow-hidden rounded-xl bg-mist text-center text-sm text-muted ring-1 ring-line hover:ring-ink">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {preview ? <img src={preview} alt="" className="h-full w-full object-cover" /> : "Нажмите, чтобы выбрать"}
            </span>
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only"
              onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); setPreview(f ? URL.createObjectURL(f) : null); }} />
          </label>
          <div className="min-w-0 space-y-3">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold">Промпт <span className="font-normal text-muted">(&lt;&lt;&lt;image_1&gt;&gt;&gt; — загруженное фото)</span></span>
              <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={7}
                className="w-full rounded-xl border border-line bg-paper p-3 text-sm leading-relaxed focus:border-ink focus:outline-none" />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <select value={aspect} onChange={(e) => setAspect(e.target.value)} className="h-10 rounded-full border border-line bg-white px-4 text-sm">
                {["16:9", "4:3", "1:1", "3:4", "9:16"].map((a) => <option key={a}>{a}</option>)}
              </select>
              <button type="button" onClick={() => setPrompt(defaultPrompt)} className="h-10 rounded-full border border-line px-4 text-sm hover:border-ink">Промпт как в заказах</button>
              <button type="button" disabled={busy} onClick={run} className="h-10 rounded-full bg-ink px-5 text-sm font-semibold text-paper disabled:opacity-60">
                {busy ? "Отправляю…" : "Создать Character Sheet"}
              </button>
            </div>
            {error && <p className="text-sm text-red-700">{error}</p>}
            <p className="text-xs text-muted">Каждый запуск списывается в Kling (как одно фото). Обычно готово за 30–90 секунд.</p>
          </div>
        </div>
      </section>

      {runs.map((r) => (
        <section key={r.task} className="rounded-card border border-line/80 bg-surface p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">{r.url ? "Готово" : r.error ? "Ошибка" : `Kling рисует… ${Math.round((now - r.started) / 1000)} с`}</h2>
            <span className="font-mono text-xs text-muted">{r.task}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={r.photo} alt="Фото" className="aspect-[3/4] w-32 rounded-xl bg-mist object-cover ring-1 ring-line" />
            {r.url ? (
              <a href={r.url} target="_blank" rel="noreferrer" className="block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.url} alt="Character Sheet" className="w-full rounded-xl bg-mist ring-1 ring-line" />
              </a>
            ) : r.error ? <p className="text-sm text-red-700">{r.error}</p> : <div className="skeleton aspect-video w-full rounded-xl" />}
          </div>
        </section>
      ))}
    </div>
  );
}
