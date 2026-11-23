"use client";
import { useEffect, useRef, useState } from "react";
import { readMediaDuration, uploadWithProgress } from "@/lib/uploads/direct";
import { checkCartoon, requestCartoonUpload, startCartoon, type CartoonEngine, type CartoonRun } from "./actions";
import { CARTOON_STYLES } from "./styles";

type Run = CartoonRun & { url?: string; external?: boolean; error?: string; source?: string };

const ENGINES: { key: CartoonEngine; label: string; hint: string; max: number }[] = [
  { key: "o3", label: "Kling O3", hint: "3.0 Omni · до 15 сек", max: 15.4 },
  { key: "v4", label: "Kling 4.0", hint: "до 30 сек", max: 30.4 },
  { key: "flash", label: "Kling 4.0 Flash", hint: "дешевле · 720p · до 20 сек", max: 20.4 },
];
const engineLabel = (r: CartoonRun) => ENGINES.find((e) => e.key === (r.engine ?? (r.flash ? "flash" : "v4")))?.label ?? "Kling";
const styleLabel = (k: string) => CARTOON_STYLES.find((s) => s.key === k)?.label ?? k;

export function CartoonTool({ initialRuns, anonKey }: { initialRuns: CartoonRun[]; anonKey: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [sec, setSec] = useState<number | null>(null);
  const [style, setStyle] = useState<string>(CARTOON_STYLES[0].key);
  const [extra, setExtra] = useState("");
  const [engine, setEngine] = useState<CartoonEngine>("o3");
  const [hd, setHd] = useState(false);
  const [phase, setPhase] = useState<"idle" | "upload" | "send">("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [runs, setRuns] = useState<Run[]>(initialRuns);
  const [now, setNow] = useState(() => Date.now());
  const runsRef = useRef(runs);
  useEffect(() => { runsRef.current = runs; }, [runs]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      setNow(Date.now());
      for (const r of runsRef.current.filter((x) => !x.url && !x.error)) {
        const st = await checkCartoon(r.task);
        if (stop || st.state === "waiting") continue;
        setRuns((all) => all.map((x) => x.task === r.task ? { ...x, ...(st.state === "done" ? { url: st.url, external: st.external } : { error: st.error }) } : x));
      }
    };
    void tick();
    const t = setInterval(tick, 8000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  async function pick(f: File | null) {
    setError(""); setFile(f); setSec(null);
    if (preview) URL.revokeObjectURL(preview);
    const url = f ? URL.createObjectURL(f) : null;
    setPreview(url);
    if (!url) return;
    const d = await readMediaDuration(url);
    setSec(d);
    // A video longer than the chosen model takes: move to one that takes it.
    if (d != null) setEngine((cur) => (d <= ENGINES.find((e) => e.key === cur)!.max ? cur : (ENGINES.find((e) => d <= e.max)?.key ?? cur)));
  }

  async function run() {
    if (!file) { setError("Выберите видео"); return; }
    if (sec == null) { setError("Не удалось прочитать длительность видео"); return; }
    if (sec < 3) { setError("Видео короче 3 секунд"); return; }
    const eng = ENGINES.find((e) => e.key === engine)!;
    if (sec > eng.max) { setError(`${eng.label} берёт видео ${eng.hint.split("· ").pop()} — обрежьте его или выберите другую модель`); return; }
    if (file.size > 50 * 1024 * 1024) { setError("Видео больше 50 МБ — сожмите его"); return; }
    setError(""); setPhase("upload"); setProgress(0);
    try {
      const up = await requestCartoonUpload(file.type, file.size);
      if (!up.ok) { setError(up.error); return; }
      await uploadWithProgress(up.url, file, anonKey, setProgress);
      setPhase("send");
      const r = await startCartoon({ path: up.path, style, extra, durationSec: sec, engine, hd });
      if (!r.ok) { setError(r.error); return; }
      setRuns((all) => [{ ...r.run, source: preview ?? undefined }, ...all]);
    } catch {
      setError("Видео не загрузилось — проверьте интернет и попробуйте ещё раз");
    } finally {
      setPhase("idle");
    }
  }

  const busy = phase !== "idle";
  const chip = (on: boolean) => `rounded-xl border-2 px-3 py-2 text-left text-sm transition-colors ${on ? "border-ink bg-paper" : "border-line bg-surface hover:border-muted"}`;

  return (
    <div className="space-y-5">
      <section className="rounded-card border border-line/80 bg-surface p-4 sm:p-5">
        <div className="grid gap-5 md:grid-cols-[14rem_minmax(0,1fr)]">
          <label className="block cursor-pointer">
            <span className="mb-2 block text-sm font-semibold">Видео (3–30 сек, MP4/MOV до 50 МБ)</span>
            <span className="flex aspect-[9/16] w-full items-center justify-center overflow-hidden rounded-xl bg-mist text-center text-sm text-muted ring-1 ring-line hover:ring-ink">
              {preview ? <video src={preview} className="h-full w-full object-cover" muted playsInline loop autoPlay /> : "Нажмите, чтобы выбрать"}
            </span>
            <input type="file" accept="video/mp4,video/quicktime" className="sr-only" onChange={(e) => void pick(e.target.files?.[0] ?? null)} />
            {sec != null && <span className="mt-1 block text-xs text-muted">{sec.toFixed(1)} сек · {file ? Math.round(file.size / 1048576) : 0} МБ</span>}
          </label>

          <div className="min-w-0 space-y-4">
            <div>
              <p className="mb-2 text-sm font-semibold">Стиль</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {CARTOON_STYLES.map((s) => (
                  <button key={s.key} type="button" onClick={() => setStyle(s.key)} className={chip(style === s.key)} aria-pressed={style === s.key}>
                    <span className="block font-semibold">{s.label}</span>
                    <span className="block text-xs text-muted">{s.hint}</span>
                  </button>
                ))}
              </div>
            </div>
            <label className="block text-sm">
              <span className="font-semibold">Уточнение стиля (необязательно)</span>
              <input value={extra} onChange={(e) => setExtra(e.target.value)} maxLength={400} placeholder="Например: тёплые цвета, вечерний свет"
                className="mt-1 h-10 w-full rounded-xl border border-line bg-paper px-3 text-base sm:text-sm" />
            </label>
            <div>
              <p className="mb-2 text-sm font-semibold">Модель</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {ENGINES.map((e) => {
                  const tooLong = sec != null && sec > e.max;
                  return (
                    <button key={e.key} type="button" disabled={tooLong} onClick={() => setEngine(e.key)} className={`${chip(engine === e.key)} disabled:opacity-40`} aria-pressed={engine === e.key}>
                      <span className="block font-semibold">{e.label}</span>
                      <span className="block text-xs text-muted">{tooLong ? "видео длиннее" : e.hint}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <label className={`flex items-center gap-2 text-sm ${engine === "flash" ? "opacity-50" : ""}`}>
              <input type="checkbox" checked={hd && engine !== "flash"} disabled={engine === "flash"} onChange={(e) => setHd(e.target.checked)} className="h-4 w-4 accent-brand" />
              1080p (дороже{engine === "o3" ? ", режим pro" : ""})
            </label>
            <button type="button" disabled={busy || !file} onClick={run} className="h-11 rounded-full bg-ink px-6 text-sm font-semibold text-paper disabled:opacity-60">
              {phase === "upload" ? `Загружаю… ${progress}%` : phase === "send" ? "Отправляю в Kling…" : "Сделать мультфильм"}
            </button>
            {error && <p className="text-sm text-red-700">{error}</p>}
            <p className="text-xs text-muted">Каждый запуск списывается в Kling (как видео той же длины). Обычно готово за 3–10 минут; страницу можно закрыть — результат останется здесь.</p>
          </div>
        </div>
      </section>

      {runs.map((r) => {
        const waited = Math.max(0, Math.round((now - Date.parse(r.at)) / 1000));
        return (
          <section key={r.task} className="rounded-card border border-line/80 bg-surface p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold">
                {r.url ? "Готово" : r.error ? "Ошибка" : `Kling рисует… ${Math.floor(waited / 60)}:${String(waited % 60).padStart(2, "0")}`}
                <span className="ml-2 text-sm font-normal text-muted">{styleLabel(r.style)} · {Number(r.sec).toFixed(0)} сек · {engineLabel(r)}</span>
              </h2>
              <span className="text-xs text-muted">{new Date(r.at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {r.source && <video src={r.source} className="max-h-[70vh] w-full rounded-xl bg-mist ring-1 ring-line" controls muted playsInline />}
              {r.url && r.external ? (
                <div className="space-y-2">
                  <p className="text-sm text-muted">Видео больше 50 МБ — здесь его не показать, откройте файл у Kling.</p>
                  <a href={r.url} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-full bg-ink px-4 text-sm font-semibold text-paper">Открыть видео</a>
                </div>
              ) : r.url ? (
                <div className="space-y-2">
                  <video src={r.url} className="max-h-[70vh] w-full rounded-xl bg-black ring-1 ring-line" controls playsInline />
                  <a href={r.url} target="_blank" rel="noreferrer" download className="inline-flex h-10 items-center rounded-full bg-ink px-4 text-sm font-semibold text-paper">Скачать</a>
                </div>
              ) : r.error ? <p className="text-sm text-red-700">{r.error}</p> : <div className="skeleton aspect-[9/16] max-h-[70vh] w-full rounded-xl" />}
            </div>
          </section>
        );
      })}
    </div>
  );
}
