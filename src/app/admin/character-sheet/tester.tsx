"use client";
import { useEffect, useRef, useState } from "react";
import { compressPhoto } from "@/lib/uploads/compress";
import { checkSheetTest, saveSheetSettings, startSheetTest } from "./actions";

type Engine = "face" | "omni";
type Settings = { engine: Engine; reference: "subject" | "face"; imageFidelity: number; humanFidelity: number; aspectRatio: string; prompt: string };
type Run = { task: string; photo: string; started: number; label: string; url?: string; error?: string };

const ASPECTS = ["16:9", "4:3", "1:1", "3:4", "9:16", "3:2", "2:3", "21:9"];

export function SheetTester({ saved, prompts }: { saved: Settings; prompts: Record<Engine, string> }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [s, setS] = useState<Settings>({ ...saved, prompt: saved.prompt || prompts[saved.engine] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [runs, setRuns] = useState<Run[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const runsRef = useRef(runs);
  useEffect(() => { runsRef.current = runs; }, [runs]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((x) => ({ ...x, [k]: v }));

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

  const form = () => {
    const fd = new FormData();
    fd.set("engine", s.engine); fd.set("reference", s.reference);
    fd.set("imageFidelity", String(s.imageFidelity)); fd.set("humanFidelity", String(s.humanFidelity));
    fd.set("aspect", s.aspectRatio); fd.set("prompt", s.prompt);
    return fd;
  };
  const label = () => s.engine === "omni" ? "Omni (o1)" : `Лицо-референс v2.1 · ${s.reference === "face" ? "face" : "subject"} · фото ${s.imageFidelity}${s.reference === "subject" ? ` · лицо ${s.humanFidelity}` : ""}`;

  async function run() {
    if (!file) { setError("Выберите фото"); return; }
    setBusy(true); setError(""); setNote("");
    try {
      const fd = form();
      fd.set("photo", await compressPhoto(file, 300));
      const r = await startSheetTest(fd);
      if (!r.ok) setError(r.error);
      else setRuns((all) => [{ task: r.task, photo: r.photo, started: Date.now(), label: label() }, ...all]);
    } catch {
      setError("Не получилось отправить");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setNote("");
    const r = await saveSheetSettings(form());
    setNote(r.ok ? "Сохранено — заказы будут использовать эти настройки" : "Не сохранилось");
  }

  const field = "h-10 rounded-full border border-line bg-white px-4 text-sm";
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
            <input type="file" accept="image/jpeg,image/png" className="sr-only"
              onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); setPreview(f ? URL.createObjectURL(f) : null); }} />
          </label>
          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap gap-2">
              {(["face", "omni"] as const).map((e) => (
                <button key={e} type="button" onClick={() => setS((x) => ({ ...x, engine: e, prompt: prompts[e] }))}
                  className={`rounded-full border px-4 py-2 text-sm font-semibold ${s.engine === e ? "border-ink bg-ink text-paper" : "border-line bg-white hover:border-ink"}`}>
                  {e === "face" ? "Лицо-референс (v2.1)" : "Omni (o1)"}
                </button>
              ))}
            </div>
            {s.engine === "face" && (
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="text-sm">
                  <span className="mb-1 block font-semibold">Референс</span>
                  <select value={s.reference} onChange={(e) => set("reference", e.target.value as Settings["reference"])} className={`${field} w-full`}>
                    <option value="subject">subject — человек целиком</option>
                    <option value="face">face — только лицо</option>
                  </select>
                </label>
                <Slider label="Близость к фото" value={s.imageFidelity} onChange={(v) => set("imageFidelity", v)} />
                {s.reference === "subject" && <Slider label="Сходство лица" value={s.humanFidelity} onChange={(v) => set("humanFidelity", v)} />}
              </div>
            )}
            <label className="block">
              <span className="mb-2 block text-sm font-semibold">Промпт {s.engine === "omni" && <span className="font-normal text-muted">(&lt;&lt;&lt;image_1&gt;&gt;&gt; — загруженное фото)</span>}</span>
              <textarea value={s.prompt} onChange={(e) => set("prompt", e.target.value)} rows={6}
                className="w-full rounded-xl border border-line bg-paper p-3 text-sm leading-relaxed focus:border-ink focus:outline-none" />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <select value={s.aspectRatio} onChange={(e) => set("aspectRatio", e.target.value)} className={field}>
                {ASPECTS.map((a) => <option key={a}>{a}</option>)}
              </select>
              <button type="button" onClick={() => set("prompt", prompts[s.engine])} className={`${field} hover:border-ink`}>Промпт по умолчанию</button>
              <button type="button" disabled={busy} onClick={run} className="h-10 rounded-full bg-ink px-5 text-sm font-semibold text-paper disabled:opacity-60">
                {busy ? "Отправляю…" : "Создать Character Sheet"}
              </button>
              <button type="button" onClick={save} className={`${field} font-semibold hover:border-ink`}>Сохранить для заказов</button>
            </div>
            {error && <p className="text-sm text-red-700">{error}</p>}
            {note && <p className="text-sm text-muted">{note}</p>}
            <p className="text-xs text-muted">Каждый запуск списывается в Kling (как одно фото). Обычно готово за 30–90 секунд. Для «face» на фото должно быть ровно одно лицо.</p>
          </div>
        </div>
      </section>

      {runs.map((r) => (
        <section key={r.task} className="rounded-card border border-line/80 bg-surface p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">{r.url ? "Готово" : r.error ? "Ошибка" : `Kling рисует… ${Math.round((now - r.started) / 1000)} с`}</h2>
            <span className="text-xs text-muted">{r.label}</span>
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

function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="text-sm">
      <span className="mb-1 flex justify-between font-semibold"><span>{label}</span><span className="font-mono">{value.toFixed(2)}</span></span>
      <input type="range" min={0} max={1} step={0.05} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-black" />
    </label>
  );
}
