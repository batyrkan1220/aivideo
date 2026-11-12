"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Clapperboard, Music2, Plus, Sparkles, Type, VolumeX, Volume2, X } from "lucide-react";
import { createMontage, requestMontageUpload, startMontage, type MontageError } from "@/lib/montage/actions";
import { MAX_CLIP_SEC, MAX_CLIPS, type MontageOptions } from "@/lib/montage/plan";
import { readMediaDuration, uploadWithProgress } from "@/lib/uploads/direct";
import { haptic } from "@/lib/telegram/client";

type Clip = { key: string; name: string; preview: string; durationSec: number | null; progress: number; path?: string; error?: string };
type Music = { name: string; progress: number; path?: string; error?: string } | null;

const MAX_MB = 50;
const ERR: Record<MontageError, string> = {
  unauthorized: "Войдите, чтобы сделать монтаж.",
  limit: "Сегодня уже 3 монтажа — это лимит бесплатного теста. Возвращайтесь завтра.",
  bad_type: "Этот формат не подходит. Видео — MP4 или MOV, музыка — MP3, M4A или WAV.",
  too_large: `Файл больше ${MAX_MB} МБ.`,
  too_long: `Видео длиннее ${MAX_CLIP_SEC / 60} минут.`,
  too_many: `Не больше ${MAX_CLIPS} видео.`,
  no_clips: "Добавьте хотя бы одно видео и дождитесь загрузки.",
  generic: "Не получилось. Попробуйте ещё раз.",
};

const STYLES: { v: MontageOptions["style"]; t: string; d: string }[] = [
  { v: "dynamic", t: "Динамичный", d: "быстрые склейки" },
  { v: "smooth", t: "Плавный", d: "мягкие переходы" },
  { v: "cinema", t: "Кино", d: "длинные кадры, кино-цвет" },
];
const LENGTHS: MontageOptions["length"][] = [15, 30, 60];

export function MontageMaker({ supabaseUrl, anonKey }: { supabaseUrl: string; anonKey: string }) {
  const router = useRouter();
  const [clips, setClips] = useState<Clip[]>([]);
  const [music, setMusic] = useState<Music>(null);
  const [opts, setOpts] = useState<MontageOptions>({ style: "dynamic", length: 30, sound: "original", title: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const draft = useRef<Promise<string | null> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const musicInput = useRef<HTMLInputElement>(null);

  const montageId = () => (draft.current ??= createMontage().then((r) => {
    if (r.ok) return r.id;
    setError(ERR[r.error]);
    draft.current = null;
    return null;
  }, () => { draft.current = null; return null; }));

  const patch = (key: string, p: Partial<Clip>) => setClips((all) => all.map((c) => (c.key === key ? { ...c, ...p } : c)));

  const signedUrl = (path: string, token: string) => `${supabaseUrl}/storage/v1/object/upload/sign/user-videos/${path}?token=${encodeURIComponent(token)}`;

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setError("");
    const room = MAX_CLIPS - clips.length;
    if (files.length > room) setError(ERR.too_many);
    const list = Array.from(files).slice(0, Math.max(0, room));
    const added: Clip[] = list.map((f) => ({ key: crypto.randomUUID(), name: f.name, preview: URL.createObjectURL(f), durationSec: null, progress: 0 }));
    setClips((all) => [...all, ...added]);
    haptic("tap");
    const id = await montageId();
    for (const [i, f] of list.entries()) {
      const c = added[i];
      const type = f.type || (f.name.toLowerCase().endsWith(".mov") ? "video/quicktime" : "video/mp4");
      if (!["video/mp4", "video/quicktime"].includes(type)) { patch(c.key, { error: ERR.bad_type }); continue; }
      if (f.size > MAX_MB * 1024 * 1024) { patch(c.key, { error: ERR.too_large }); continue; }
      const dur = await readMediaDuration(c.preview);
      if (dur === null) { patch(c.key, { error: "Не удалось прочитать видео." }); continue; }
      if (dur > MAX_CLIP_SEC + 0.5) { patch(c.key, { error: ERR.too_long, durationSec: dur }); continue; }
      patch(c.key, { durationSec: dur });
      if (!id) { patch(c.key, { error: ERR.generic }); continue; }
      const req = await requestMontageUpload({ montageId: id, kind: "clip", contentType: type, size: f.size, durationSec: dur });
      if (!req.ok) { patch(c.key, { error: ERR[req.error] }); continue; }
      try {
        await uploadWithProgress(signedUrl(req.path, req.token), new File([f], f.name, { type }), anonKey, (p) => patch(c.key, { progress: p }));
        patch(c.key, { path: req.path, progress: 100 });
      } catch {
        patch(c.key, { error: "Загрузка прервалась. Удалите и добавьте снова." });
      }
    }
  };

  const addMusic = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    setError("");
    const type = f.type || "audio/mpeg";
    if (f.size > MAX_MB * 1024 * 1024) { setMusic({ name: f.name, progress: 0, error: ERR.too_large }); return; }
    setMusic({ name: f.name, progress: 0 });
    const id = await montageId();
    if (!id) return;
    const req = await requestMontageUpload({ montageId: id, kind: "music", contentType: type, size: f.size, durationSec: 0 });
    if (!req.ok) { setMusic({ name: f.name, progress: 0, error: ERR[req.error] }); return; }
    try {
      await uploadWithProgress(signedUrl(req.path, req.token), new File([f], f.name, { type }), anonKey, (p) => setMusic({ name: f.name, progress: p }));
      setMusic({ name: f.name, progress: 100, path: req.path });
    } catch {
      setMusic({ name: f.name, progress: 0, error: "Загрузка прервалась. Выберите файл снова." });
    }
  };

  const move = (i: number, d: -1 | 1) => setClips((all) => {
    const j = i + d;
    if (j < 0 || j >= all.length) return all;
    const next = [...all];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  const ready = clips.filter((c) => c.path && !c.error);
  const uploading = clips.some((c) => !c.path && !c.error) || (opts.sound === "music" && !!music && !music.path && !music.error);
  const totalSec = ready.reduce((a, c) => a + (c.durationSec ?? 0), 0);
  const canStart = ready.length > 0 && !uploading && !busy && (opts.sound !== "music" || !!music?.path);

  const start = async () => {
    if (!canStart) return;
    setBusy(true);
    setError("");
    haptic("tap");
    const id = await montageId();
    if (!id) { setBusy(false); return; }
    const r = await startMontage({
      montageId: id, clips: ready.map((c) => ({ path: c.path!, durationSec: c.durationSec ?? 0 })),
      music: opts.sound === "music" ? music?.path ?? null : null, options: opts,
    }).catch(() => ({ ok: false as const, error: "generic" as MontageError }));
    if (!r.ok) { setError(ERR[r.error]); setBusy(false); haptic("error"); return; }
    haptic("success");
    router.push(`/montage/${id}`);
  };

  const chip = (on: boolean) => `min-w-0 rounded-2xl px-2.5 py-2.5 text-left ring-1 transition-colors ${on ? "bg-ink text-paper ring-ink" : "bg-surface ring-line hover:ring-ink"}`;

  return (
    <div className="space-y-5">
      {/* 1. Clips */}
      <section className="rounded-card bg-surface p-4 ring-1 ring-line sm:p-5">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="font-semibold">1. Ваши видео</h2>
          <span className="text-xs text-muted">{clips.length}/{MAX_CLIPS} · до {MAX_MB} МБ каждое</span>
        </div>
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {clips.map((c, i) => (
            <li key={c.key} className="relative aspect-[9/16] overflow-hidden rounded-2xl bg-night ring-1 ring-line">
              <video src={c.preview} muted playsInline preload="metadata" className="h-full w-full object-cover" />
              <span className="absolute left-1.5 top-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-bold text-white">{i + 1}</span>
              <button type="button" aria-label="Удалить" onClick={() => setClips((all) => all.filter((x) => x.key !== c.key))}
                className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white"><X size={14} /></button>
              {c.error ? (
                <p className="absolute inset-x-0 bottom-0 bg-danger/90 p-1.5 text-[10px] leading-tight text-white">{c.error}</p>
              ) : !c.path ? (
                <div className="absolute inset-x-2 bottom-2 h-1.5 overflow-hidden rounded-full bg-white/30"><div className="h-full bg-brand transition-[width]" style={{ width: `${c.progress}%` }} /></div>
              ) : (
                <div className="absolute inset-x-1.5 bottom-1.5 flex items-center justify-between">
                  <button type="button" aria-label="Раньше" disabled={i === 0} onClick={() => move(i, -1)} className="flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white disabled:opacity-30"><ArrowLeft size={13} /></button>
                  <span className="rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">{Math.round(c.durationSec ?? 0)} с</span>
                  <button type="button" aria-label="Позже" disabled={i === clips.length - 1} onClick={() => move(i, 1)} className="flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white disabled:opacity-30"><ArrowRight size={13} /></button>
                </div>
              )}
            </li>
          ))}
          {clips.length < MAX_CLIPS && (
            <li>
              <button type="button" onClick={() => fileInput.current?.click()}
                className="flex aspect-[9/16] w-full flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-line text-sm font-semibold text-muted hover:border-ink hover:text-ink">
                <Plus size={22} aria-hidden />{clips.length ? "Ещё" : "Добавить видео"}
              </button>
            </li>
          )}
        </ul>
        <input ref={fileInput} type="file" accept="video/mp4,video/quicktime,video/*" multiple className="sr-only"
          onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
        <p className="mt-3 text-xs text-muted">Порядок видео = порядок в ролике (стрелками можно поменять). Из каждого возьмём самые живые и светлые моменты.</p>
      </section>

      {/* 2. Settings */}
      <section className="space-y-4 rounded-card bg-surface p-4 ring-1 ring-line sm:p-5">
        <h2 className="font-semibold">2. Как смонтировать</h2>
        <div>
          <p className="mb-2 text-sm font-semibold">Стиль</p>
          <div className="grid grid-cols-3 gap-2">
            {STYLES.map((s) => (
              <button key={s.v} type="button" onClick={() => setOpts((o) => ({ ...o, style: s.v }))} className={chip(opts.style === s.v)}>
                <span className="block truncate text-[13px] font-semibold">{s.t}</span>
                <span className={`block text-[11px] ${opts.style === s.v ? "text-paper/70" : "text-muted"}`}>{s.d}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold">Длина ролика</p>
          <div className="grid grid-cols-3 gap-2">
            {LENGTHS.map((l) => (
              <button key={l} type="button" onClick={() => setOpts((o) => ({ ...o, length: l }))} className={chip(opts.length === l)}>
                <span className="block text-center text-sm font-semibold">{l} сек</span>
              </button>
            ))}
          </div>
          {ready.length > 0 && totalSec * 0.85 < opts.length && (
            <p className="mt-1.5 text-xs text-muted">Видео немного — ролик выйдет около {Math.max(1, Math.round(totalSec * 0.85))} сек.</p>
          )}
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold">Звук</p>
          <div className="grid grid-cols-3 gap-2">
            {([["original", "Из видео", Volume2], ["music", "Своя музыка", Music2], ["mute", "Без звука", VolumeX]] as const).map(([v, t, Icon]) => (
              <button key={v} type="button" onClick={() => setOpts((o) => ({ ...o, sound: v }))} className={`${chip(opts.sound === v)} flex flex-col items-center gap-1`}>
                <Icon size={18} aria-hidden /><span className="text-xs font-semibold">{t}</span>
              </button>
            ))}
          </div>
          {opts.sound === "music" && (
            <div className="mt-2 rounded-2xl bg-mist p-3">
              {music ? (
                <div className="flex items-center gap-2 text-sm">
                  <Music2 size={16} aria-hidden className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{music.name}</span>
                  {music.error ? <span className="text-xs text-danger">{music.error}</span> : !music.path ? <span className="text-xs text-muted">{music.progress}%</span> : <span className="text-xs text-success">готово</span>}
                  <button type="button" onClick={() => musicInput.current?.click()} className="text-xs font-semibold underline">заменить</button>
                </div>
              ) : (
                <button type="button" onClick={() => musicInput.current?.click()} className="w-full text-sm font-semibold">+ Выбрать трек (MP3, M4A, WAV)</button>
              )}
              <p className="mt-1.5 text-[11px] text-muted">Музыка будет громко, звук из видео — тихо под ней. Используйте треки, на которые у вас есть права.</p>
            </div>
          )}
          <input ref={musicInput} type="file" accept="audio/*" className="sr-only" onChange={(e) => { void addMusic(e.target.files); e.target.value = ""; }} />
        </div>
        <label className="block">
          <span className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><Type size={15} aria-hidden />Титр в начале <span className="font-normal text-muted">(по желанию)</span></span>
          <input value={opts.title} maxLength={40} onChange={(e) => setOpts((o) => ({ ...o, title: e.target.value }))} placeholder="Например: Наш той 2026"
            className="h-12 w-full rounded-2xl border border-line bg-paper px-4 text-[15px] focus:border-ink focus:outline-none" />
        </label>
      </section>

      {error && <p className="rounded-2xl bg-danger/10 p-3 text-sm text-danger" role="alert">{error}</p>}
      <button type="button" onClick={() => void start()} disabled={!canStart}
        className="btn-glow inline-flex h-14 w-full items-center justify-center gap-2 rounded-full px-6 text-base font-semibold disabled:opacity-50">
        {busy ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden /> : <Sparkles size={18} aria-hidden />}
        {uploading ? "Загружаем видео…" : "Сделать монтаж"}
      </button>
      <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted"><Clapperboard size={14} aria-hidden />Бесплатно, пока в тесте · до 3 роликов в день</p>
    </div>
  );
}
