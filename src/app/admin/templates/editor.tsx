"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ru } from "@/lib/i18n/ru";
import { supabaseBrowser } from "@/lib/supabase/client";
import { autoFaceSlots } from "@/lib/templates/schema";
import type { TemplateInput, PublishProblem } from "@/lib/templates/admin-schema";
import { validateTemplateForm, firstErrorKey, type FieldErrors } from "@/lib/templates/editor-validation";
import { OBJECT_PRESETS, parseSeedanceConfig, seedanceSlots, SEEDANCE_MAX_OBJECTS, SEEDANCE_MAX_PEOPLE, SEEDANCE_MAX_SEC, SEEDANCE_MIN_SEC, type SeedanceConfig } from "@/lib/templates/seedance-config";
import { calculatePrice, formatKzt } from "@/lib/pricing";
import { seedancePriceKzt, seedanceCostKzt, klingUnitLabel, SEEDANCE_QUALITY, type SeedancePricing } from "@/lib/pricing-seedance";
import { FaceMap } from "@/components/face-map";
import { ANALYSIS_VERSION, applyAnalysis, cutoutRect, faceInCutout, type Box } from "@/lib/templates/analysis";
import { aspectAllowed } from "@/lib/custom-video/aspect";
import { saveTemplate, changeStatus, createUploadUrl, detectTemplateElements } from "./actions";
import { DeleteTemplateButton } from "./delete-button";
import { parsePhotoConfig, photoSlots, PHOTO_ASPECTS, PHOTO_MAX_PEOPLE, PHOTO_PROVIDER, PHOTO_QUALITY, type PhotoConfig } from "@/lib/templates/photo-config";

const e = ru.admin.editor;
type Status = "draft" | "published" | "disabled" | "archived";


const baseInput = "w-full rounded-xl border bg-white px-3 py-2 text-base outline-none sm:text-sm";
const inputCls = (err?: string) =>
  `${baseInput} ${err ? "border-danger bg-red-50/40 focus:border-danger focus:ring-2 focus:ring-danger/15" : "border-line focus:border-brand"}`;
const labelCls = "mb-1 block text-xs font-medium text-muted";

function Field({
  label, field, required, error, children, className = "",
}: { label: string; field?: string; required?: boolean; error?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className} data-field={field}>
      <label className="block">
        <span className={labelCls}>
          {label}
          {required && <><span className="text-danger" aria-hidden> *</span><span className="sr-only"> {e.requiredSr}</span></>}
        </span>
        {children}
      </label>
      {error && <p className="mt-1 text-xs font-medium text-danger" role="alert">{error}</p>}
    </div>
  );
}

function Num({ value, onChange, min, step = 1, error }: { value: number | undefined; onChange: (v: number | undefined) => void; min?: number; step?: number; error?: string }) {
  return (
    <input
      type="number" inputMode="numeric" className={inputCls(error)} min={min} step={step} aria-invalid={!!error}
      value={value ?? ""}
      onChange={(ev) => onChange(ev.target.value === "" ? undefined : Number(ev.target.value))}
    />
  );
}

function Section({ title, children, error, field }: { title: string; children: React.ReactNode; error?: string; field?: string }) {
  return (
    <section className={`rounded-card border bg-white p-5 sm:p-6 ${error ? "border-danger" : "border-line"}`} data-field={field}>
      <h2 className="mb-4 font-display text-lg font-bold">{title}</h2>
      {error && <p className="-mt-2 mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-danger" role="alert">{error}</p>}
      {children}
    </section>
  );
}

/** Scrolls to a field by key and focuses its first control. */
function goTo(key: string | null) {
  if (!key) return;
  const el = document.querySelector<HTMLElement>(`[data-field="${CSS.escape(key)}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.querySelector<HTMLElement>("input,select,textarea,button")?.focus({ preventScroll: true });
}

export function TemplateEditor({
  id, initial, status, categories, mediaBase, seedancePricing, canDelete = false,
}: {
  id: string | null;
  canDelete?: boolean;
  initial: TemplateInput;
  status: Status;
  categories: { id: string; title: string }[];
  mediaBase: string;
  seedancePricing: SeedancePricing;
}) {
  const router = useRouter();
  const [duration, setDuration] = useState<number | null>(null);
  const [aspect, setAspect] = useState<number | null>(null);
  const [frame, setFrame] = useState<{ w: number; h: number } | null>(null);
  // Every template is a Seedance template: one quality (720p), Seedance provider and config.
  const [t, setT] = useState<TemplateInput>(() => ({ ...initial, providerKey: "seedance", qualities: [SEEDANCE_QUALITY] }));
  // Template video length → automatic price preview.
  useEffect(() => {
    if (!t.previewVideoPath) return;
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      setDuration(Number.isFinite(v.duration) ? v.duration : null);
      setAspect(v.videoWidth > 0 && v.videoHeight > 0 ? Math.round((v.videoWidth / v.videoHeight) * 10000) / 10000 : null);
      setFrame(v.videoWidth > 0 && v.videoHeight > 0 ? { w: v.videoWidth, h: v.videoHeight } : null);
    };
    v.src = /^https?:/.test(t.previewVideoPath) ? t.previewVideoPath : `${mediaBase}/${t.previewVideoPath}`;
    return () => { v.onloadedmetadata = null; v.removeAttribute("src"); };
  }, [t.previewVideoPath, mediaBase]);
  const [sd, setSdState] = useState<SeedanceConfig>(() =>
    parseSeedanceConfig(initial.providerKey === "seedance" ? initial.providerConfig : {}));
  // Template type: video (Kling 4.0 video) or photo (Kling image model).
  const [kind, setKind] = useState<"video" | "photo">(initial.providerKey === PHOTO_PROVIDER ? "photo" : "video");
  const [ph, setPhState] = useState<PhotoConfig>(() => parsePhotoConfig(initial.providerKey === PHOTO_PROVIDER ? initial.providerConfig : {}));
  const setPh = (patch: Partial<PhotoConfig>) => { setPhState((p) => ({ ...p, ...patch })); setDirty(true); };
  const isPhoto = kind === "photo";
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string; problems?: PublishProblem[] } | null>(null);
  const [pending, start] = useTransition();
  // Errors appear after the first save/publish attempt and then update live as the admin types.
  const [mode, setMode] = useState<null | "save" | "publish">(null);

  const configText = JSON.stringify(isPhoto ? ph : sd);
  const errors: FieldErrors = mode ? validateTemplateForm(t, configText, mode === "publish", isPhoto) : {};
  const err = (k: string) => errors[k];
  const errorCount = Object.keys(errors).length;

  const set = <K extends keyof TemplateInput>(k: K, v: TemplateInput[K]) => { setT((p) => ({ ...p, [k]: v })); setDirty(true); };
  const setPricing = (patch: Partial<TemplateInput["pricing"]>) => set("pricing", { ...t.pricing, ...patch });
  const setSd = (patch: Partial<SeedanceConfig>) => { setSdState((p) => ({ ...p, ...patch })); setDirty(true); };

  // AI analysis (Gemini): people, things, a cut-out of each and a scene note that keeps the video 1:1.
  // Catalog video templates cannot be published or ordered without it.
  const [ai, setAi] = useState<{ busy: boolean; text?: string; err?: boolean; found?: string[] }>({ busy: false });
  // The prompt already had text: the scene note is offered, not written over it.
  const [sceneTip, setSceneTip] = useState<string | null>(null);
  const analyze = async () => {
    if (!t.previewVideoPath) return;
    setAi({ busy: true });
    const frames = await videoFrames(/^https?:/.test(t.previewVideoPath) ? t.previewVideoPath : `${mediaBase}/${t.previewVideoPath}`);
    if (!frames?.length) { setAi({ busy: false, err: true, text: e.seedance.aiFailed }); return; }
    const r = await detectTemplateElements(frames);
    if (!r.ok) { setAi({ busy: false, err: true, text: r.error === "not_configured" ? e.seedance.aiNoKey : r.error === "forbidden" ? ru.admin.forbidden : e.seedance.aiFailed }); return; }
    // hideFace: the copy Kling gets, with the original face pixelated so it cannot borrow that face.
    const cut = async (x: { frame: number; box: Box | null; face?: Box | null }, hideFace = false) => {
      if (hideFace && !x.face) return "";
      const blob = x.box ? await cropFrame(frames[x.frame] ?? frames[0], x.box, hideFace ? x.face : null) : null;
      return blob ? (await uploadTarget(blob)) ?? "" : "";
    };
    const found = r.people.slice(0, SEEDANCE_MAX_PEOPLE);
    const people = await Promise.all(found.map((p) => cut(p)));
    const peopleKling = await Promise.all(found.map((p) => cut(p, true)));
    const objects = await Promise.all(r.objects.slice(0, SEEDANCE_MAX_OBJECTS).map((o) => cut(o)));
    const next = applyAnalysis(sd, r, { people, objects, peopleKling });
    // A whole new analysis is a new start: edit mode keeps the template video 1:1.
    setSd({ ...next, klingMode: "edit" });
    const scene = r.scene ? `Keep the video 1:1: ${r.scene}` : "";
    setSceneTip(scene && sd.prompt.trim() ? scene : null);
    setAi({ busy: false, text: r.people.length ? e.seedance.aiDone : e.seedance.detectNone, found: [...r.people.map((x) => x.ru), ...r.objects.map((x) => x.ru)] });
  };

  // Customer photo slots = the number of people the admin set, left → right (the server derives them too).
  const slots = isPhoto ? photoSlots(ph.people, ph.labels) : seedanceSlots(sd.people, "face_", sd.labels, sd.objects, sd.targets);

  /** Client check first (shows red fields), then the authoritative server save. */
  const persist = async (forPublish: boolean): Promise<string | null> => {
    const found = validateTemplateForm(t, configText, forPublish, isPhoto);
    if (Object.keys(found).length) {
      setMode(forPublish ? "publish" : "save");
      setMsg({ kind: "err", text: forPublish ? e.fixBeforePublish : e.fixBeforeSave });
      requestAnimationFrame(() => goTo(firstErrorKey(found)));
      return null;
    }
    const sent = slots.length ? slots : autoFaceSlots(1);
    // Older templates without a cover: make one from the video now.
    let cover = t.coverAssetPath;
    if (!cover && t.previewVideoPath && !isPhoto) {
      const blob = await captureCover(`${mediaBase}/${t.previewVideoPath}`);
      cover = blob ? await uploadCover(blob) : null;
      if (cover) set("coverAssetPath", cover);
    }
    const payload = isPhoto
      ? { ...t, coverAssetPath: cover, previewVideoPath: null, providerKey: PHOTO_PROVIDER, providerConfig: ph, faceSlots: sent, qualities: [PHOTO_QUALITY] }
      : { ...t, coverAssetPath: cover, providerKey: "seedance", providerConfig: sd, faceSlots: sent };
    const r = await saveTemplate(payload, id, { durationSec: duration, aspect });
    if (!r.ok) {
      setMsg({ kind: "err", text: r.error === "too_long" ? e.durationBad : r.error === "forbidden" ? ru.admin.forbidden : r.error === "invalid" ? e.invalid : ru.errors.generic });
      return null;
    }
    setDirty(false);
    return r.id;
  };

  const save = () => start(async () => {
    const savedId = await persist(false);
    if (!savedId) return;
    setMode(null);
    setMsg({ kind: "ok", text: e.saved });
    if (!id) router.replace(`/admin/templates/${savedId}`);
    else router.refresh();
  });

  const status_ = (action: "publish" | "unpublish" | "archive" | "restore") => start(async () => {
    let targetId = id;
    if (action === "publish") {
      // Publishing validates with publish rules and saves pending edits first — one click.
      targetId = await persist(true);
      if (!targetId) return;
    } else if (dirty) {
      setMsg({ kind: "err", text: e.unsavedPublish });
      return;
    }
    if (!targetId) return;
    const r = await changeStatus(targetId, action);
    if (!r.ok) {
      setMsg({ kind: "err", text: r.error === "forbidden" ? ru.admin.forbidden : ru.errors.generic, problems: r.problems });
      if (!id) router.replace(`/admin/templates/${targetId}`);
      return;
    }
    setMode(null);
    setMsg({ kind: "ok", text: action === "publish" ? e.published : e.statusChanged });
    if (!id) router.replace(`/admin/templates/${targetId}`);
    else router.refresh();
  });

  const costOpts = { people: sd.people };
  const autoPrice = seedancePriceKzt(duration, Number(t.pricing.basePriceKzt) || 0, seedancePricing, costOpts);
  const costKzt = duration ? seedanceCostKzt(duration, seedancePricing, costOpts) : null;
  const unitLabel = duration ? klingUnitLabel(duration, seedancePricing) : null;

  return (
    <div className="space-y-6 pb-56 sm:pb-28">
      <p className="text-xs text-muted">{e.requiredNote}</p>

      <Section title={e.sections.basics}>
        {/* New templates are video only (photos live in combos); old photo templates keep their editor. */}
        {initial.providerKey === PHOTO_PROVIDER && (
        <div className="mb-4 inline-flex rounded-full border border-line p-1" role="radiogroup" aria-label={e.kind}>
          {(["video", "photo"] as const).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => { setKind(k); setDirty(true); }}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold ${kind === k ? "bg-ink text-white" : "text-muted hover:text-ink"}`}>
              {e.kindOptions[k]}
            </button>
          ))}
        </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={e.title} field="titleKk" required error={err("titleKk")} className="sm:col-span-2">
            <input className={inputCls(err("titleKk"))} aria-invalid={!!err("titleKk")} value={t.titleKk} maxLength={120} onChange={(ev) => set("titleKk", ev.target.value)} />
          </Field>
          <Field label={e.description} field="descriptionKk" error={err("descriptionKk")} className="sm:col-span-2">
            <textarea className={`${inputCls(err("descriptionKk"))} min-h-24`} value={t.descriptionKk} maxLength={1000} onChange={(ev) => set("descriptionKk", ev.target.value)} />
          </Field>
          <Field label={e.category}>
            <select className={inputCls()} value={t.categoryId ?? ""} onChange={(ev) => set("categoryId", ev.target.value || null)}>
              <option value="">{e.noCategory}</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </Field>
          <Field label={e.tags}>
            <input className={inputCls()} defaultValue={t.tags.join(", ")} onChange={(ev) => set("tags", ev.target.value.split(",").map((x) => x.trim()).filter(Boolean))} />
          </Field>
          <Field label={e.sortOrder}>
            <Num value={t.sortOrder} onChange={(v) => set("sortOrder", v ?? 0)} />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-brand" checked={t.isTrending} onChange={(ev) => set("isTrending", ev.target.checked)} />
            {e.trending}
          </label>
        </div>
      </Section>

      <Section title={e.sections.media}>
        {isPhoto
          ? <PhotoExampleField error={err("cover")} path={t.coverAssetPath} mediaBase={mediaBase} onUploaded={(p) => set("coverAssetPath", p)} />
          : <VideoField error={err("preview")} path={t.previewVideoPath} mediaBase={mediaBase} onUploaded={(p, meta) => {
              set("previewVideoPath", p); setDuration(meta?.duration ?? null); setAspect(meta?.aspect ?? null);
              // Cut-outs and the analysis belong to the old video.
              setSd({ targets: [], targetsKling: [], objects: sd.objects.map(({ target: _t, ...o }) => o), showTargets: false, analyzedAt: undefined });
            }} onCover={(p) => set("coverAssetPath", p)} />}
      </Section>

      {isPhoto ? (
      <Section title={e.photo.title}>
        <p className="text-sm text-muted">{e.photo.intro}</p>
        <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_minmax(0,320px)]">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={e.seedance.people}>
              <select className={inputCls()} value={ph.people} onChange={(ev) => setPh({ people: Number(ev.target.value) })}>
                {Array.from({ length: PHOTO_MAX_PEOPLE }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
            <Field label={e.photo.aspect}>
              <select className={inputCls()} value={ph.aspectRatio} onChange={(ev) => setPh({ aspectRatio: ev.target.value as PhotoConfig["aspectRatio"] })}>
                {PHOTO_ASPECTS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </Field>
            {ph.people > 1 && (
              <div className="grid gap-2 sm:col-span-2">
                <span className="text-sm font-medium">{e.seedance.labels}</span>
                {Array.from({ length: ph.people }, (_, i) => (
                  <input key={i} className={inputCls()} maxLength={40} placeholder={`${i + 1}-й человек (слева)`} value={ph.labels[i] ?? ""}
                    onChange={(ev) => { const l = [...ph.labels]; while (l.length < ph.people) l.push(""); l[i] = ev.target.value; setPh({ labels: l.slice(0, ph.people) }); }} />
                ))}
              </div>
            )}
            <label className="flex items-start gap-2 text-sm sm:col-span-2">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand" checked={ph.useExample} onChange={(ev) => setPh({ useExample: ev.target.checked })} />
              <span>{e.photo.useExample}<span className="block text-xs text-muted">{e.photo.useExampleHint}</span></span>
            </label>
            <Field label={e.photo.prompt} field="seedance.prompt" error={err("seedance.prompt")} className="sm:col-span-2">
              <textarea className={`${inputCls(err("seedance.prompt"))} min-h-24`} value={ph.prompt} maxLength={2000} placeholder={e.photo.promptPlaceholder} onChange={(ev) => setPh({ prompt: ev.target.value })} />
              <span className="mt-1 block text-xs text-muted">{e.photo.promptHint}</span>
            </Field>
          </div>
          {slots.length > 0 && <FaceMap slots={slots} mediaBase={mediaBase} />}
        </div>
      </Section>
      ) : (
      <Section title={e.seedance.title}>
        <p className="text-sm text-muted">{e.seedance.intro}</p>
        <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_minmax(0,320px)]">
          <div className="grid gap-5">
            {/* Step 1: AI analysis — required for every catalog video template. */}
            <div className={`rounded-2xl p-4 ring-1 ${sd.analyzedAt ? "bg-paper ring-line" : "bg-[#fff8e6] ring-[#f0c36d]"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">{e.seedance.step1}</span>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${sd.analyzedAt ? "bg-brand text-night" : "bg-[#f0c36d] text-night"}`}>
                  {sd.analyzedAt ? e.seedance.analyzed(new Date(sd.analyzedAt).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })) : e.seedance.notAnalyzed}{sd.analyzedAt && (sd.analysisVersion ?? 1) < ANALYSIS_VERSION ? ` · ${e.seedance.oldAnalysis}` : ""}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted">{e.seedance.step1Hint}</p>
              <button type="button" disabled={ai.busy || !t.previewVideoPath} onClick={() => void analyze()}
                className="mt-3 rounded-full bg-night px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
                {ai.busy ? e.seedance.aiBusy : sd.analyzedAt ? e.seedance.aiAgain : e.seedance.aiDetect}
              </button>
              {!t.previewVideoPath && <span className="ml-2 text-xs text-muted">{e.seedance.needVideo}</span>}
              {ai.text && <p className={`mt-2 text-xs font-medium ${ai.err ? "text-danger" : ""}`}>{ai.text}</p>}
              {ai.found && ai.found.length > 0 && <p className="mt-1 text-xs text-muted">{ai.found.join(" · ")}</p>}

              {/* What the AI found: each person and thing with its cut-out. Editable. */}
              {sd.analyzedAt && (
                <div className="mt-4 grid gap-3">
                  <datalist id="kling-positions">{Object.entries(e.seedance.positionOptions).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</datalist>
                  {Array.from({ length: sd.people }, (_, i) => (
                    <div key={`p${i}`} className="grid gap-3 rounded-xl bg-white p-3 ring-1 ring-line sm:grid-cols-[72px_1fr]">
                      <Cutout path={sd.targets[i]} mediaBase={mediaBase} label={`${i + 1}`} />
                      <div className="grid gap-2">
                        <span className="text-sm font-semibold">{e.seedance.personN(i + 1)}</span>
                        <input className={inputCls()} maxLength={120} list="kling-positions" placeholder={e.seedance.positionAuto(i + 1)} value={sd.positions[i] ?? ""}
                          onChange={(ev) => { const p = [...sd.positions]; while (p.length < sd.people) p.push(""); p[i] = ev.target.value; setSd({ positions: p.slice(0, sd.people) }); }} />
                        <input className={inputCls()} maxLength={40} placeholder={e.seedance.customerLabel(i + 1, sd.people)} value={sd.labels[i] ?? ""}
                          onChange={(ev) => { const l = [...sd.labels]; while (l.length < sd.people) l.push(""); l[i] = ev.target.value; setSd({ labels: l.slice(0, sd.people) }); }} />
                      </div>
                    </div>
                  ))}
                  {sd.objects.map((o, j) => (
                    <div key={`o${j}`} className="grid gap-3 rounded-xl bg-white p-3 ring-1 ring-line sm:grid-cols-[72px_1fr]">
                      <Cutout path={o.target} mediaBase={mediaBase} label="+" />
                      <div className="grid gap-2">
                        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                          <select className={inputCls()} value={(Object.entries(OBJECT_PRESETS).find(([, p]) => p.en === o.what)?.[0]) ?? "custom"}
                            onChange={(ev) => {
                              const p = OBJECT_PRESETS[ev.target.value as keyof typeof OBJECT_PRESETS];
                              const list = [...sd.objects];
                              list[j] = p ? { ...o, what: p.en, label: p.ru } : { ...o, what: "", label: "Фото предмета" };
                              setSd({ objects: list });
                            }}>
                            {Object.entries(OBJECT_PRESETS).map(([k, p]) => <option key={k} value={k}>{p.ru.replace("Фото ", "")}</option>)}
                            <option value="custom">Другое…</option>
                          </select>
                          <input className={inputCls()} maxLength={40} placeholder="Подпись для клиента" value={o.label}
                            onChange={(ev) => { const list = [...sd.objects]; list[j] = { ...o, label: ev.target.value }; setSd({ objects: list }); }} />
                          <button type="button" onClick={() => setSd({ objects: sd.objects.filter((_, k) => k !== j) })}
                            className="rounded-full px-3 text-sm font-medium text-muted hover:text-danger">Убрать</button>
                        </div>
                        <input className={inputCls()} maxLength={120} placeholder="Какой именно в видео, по-английски: the white car on the right" value={o.look ?? ""}
                          onChange={(ev) => { const list = [...sd.objects]; list[j] = { ...o, look: ev.target.value }; setSd({ objects: list }); }} />
                        {!Object.values(OBJECT_PRESETS).some((p) => p.en === o.what) && (
                          <input className={inputCls()} maxLength={40} placeholder="Что это по-английски (для ИИ), например: boat, guitar" value={o.what}
                            onChange={(ev) => { const list = [...sd.objects]; list[j] = { ...o, what: ev.target.value }; setSd({ objects: list }); }} />
                        )}
                      </div>
                    </div>
                  ))}
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <label className="inline-flex items-center gap-2">
                      <span className="text-muted">{e.seedance.people}:</span>
                      <select className="rounded-lg border border-line px-2 py-1" value={sd.people} onChange={(ev) => setSd({ people: Number(ev.target.value) })}>
                        {Array.from({ length: SEEDANCE_MAX_PEOPLE }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </label>
                    {sd.objects.length < SEEDANCE_MAX_OBJECTS && (
                      <button type="button" onClick={() => setSd({ objects: [...sd.objects, { what: OBJECT_PRESETS.car.en, label: OBJECT_PRESETS.car.ru }] })}
                        className="rounded-full border border-line bg-white px-3 py-1.5 font-semibold hover:border-ink">{e.seedance.addThing}</button>
                    )}
                    <label className="inline-flex items-center gap-2 font-medium">
                      <input type="checkbox" checked={sd.showTargets} onChange={(ev) => setSd({ showTargets: ev.target.checked })} />
                      {e.seedance.showTargets}
                    </label>
                  </div>
                  <span className="text-xs text-muted">{e.seedance.showTargetsHint}</span>
                </div>
              )}
            </div>

            {/* Step 2: the scene stays 1:1. */}
            <div className="grid gap-4 rounded-2xl bg-paper p-4 ring-1 ring-line sm:grid-cols-2">
              <span className="font-semibold sm:col-span-2">{e.seedance.step2}</span>
              <Field label={e.seedance.klingMode} className="sm:col-span-2">
                <select className={inputCls()} value={sd.klingMode} onChange={(ev) => setSd({ klingMode: ev.target.value as SeedanceConfig["klingMode"] })}>
                  <option value="edit">{e.seedance.klingModeOptions.edit}</option>
                  <option value="reference">{e.seedance.klingModeOptions.reference}</option>
                </select>
              </Field>
              <Field label={e.seedance.prompt} field="seedance.prompt" error={err("seedance.prompt")} className="sm:col-span-2">
                <textarea className={`${inputCls(err("seedance.prompt"))} min-h-24`} value={sd.prompt} maxLength={1500} onChange={(ev) => setSd({ prompt: ev.target.value })} />
                <span className="mt-1 block text-xs text-muted">{e.seedance.promptHint}</span>
                {sceneTip && (
                  <span className="mt-2 block rounded-xl bg-white p-2 text-xs ring-1 ring-line">
                    {e.seedance.aiScene} <span className="font-medium">{sceneTip}</span>
                    <button type="button" onClick={() => { setSd({ prompt: sceneTip.slice(0, 1500) }); setSceneTip(null); }} className="ml-2 font-semibold underline">{e.seedance.aiSceneUse}</button>
                  </span>
                )}
              </Field>
              <p className={`text-xs sm:col-span-2 ${(duration !== null && (duration < 2.5 || duration > 30.5)) ? "font-semibold text-danger" : "text-muted"}`}>
                {e.seedance.durationHint}{duration !== null ? ` · ${Math.round(duration * 10) / 10} сек` : ""}{frame ? ` · ${frame.w}×${frame.h}` : ""}
              </p>
            </div>

            {/* Step 3: what the customer chooses and uploads. */}
            <div className="grid gap-4 rounded-2xl bg-paper p-4 ring-1 ring-line sm:grid-cols-2">
              <span className="font-semibold sm:col-span-2">{e.seedance.step3}</span>
              <Field label={e.seedance.outfit}>
                <select className={inputCls()} value={sd.outfit} onChange={(ev) => setSd({ outfit: ev.target.value as SeedanceConfig["outfit"] })}>
                  <option value="photo">{e.seedance.outfitOptions.photo}</option>
                  <option value="template">{e.seedance.outfitOptions.template}</option>
                  <option value="choice">{e.seedance.outfitOptions.choice}</option>
                </select>
              </Field>
              <Field label={e.seedance.aspect}>
                <select className={inputCls()} value={sd.aspectRatio} onChange={(ev) => setSd({ aspectRatio: ev.target.value as SeedanceConfig["aspectRatio"] })}>
                  {(["9:16", "16:9", "1:1", "adaptive"] as const).map((k) => <option key={k} value={k}>{e.seedance.aspectOptions[k]}</option>)}
                </select>
              </Field>
              <Field label={e.seedance.framing} className="sm:col-span-2">
                <select className={inputCls()} value={sd.framing} onChange={(ev) => setSd({ framing: ev.target.value as SeedanceConfig["framing"] })}>
                  {(["face", "half", "full"] as const).map((k) => <option key={k} value={k}>{e.seedance.framingOptions[k]}</option>)}
                </select>
              </Field>
            </div>
          </div>
          {slots.length > 0 && <FaceMap slots={slots} mediaBase={mediaBase} />}
        </div>
      </Section>
      )}

      <Section title={e.sections.pricing}>
        {isPhoto ? (
        <div className="rounded-xl bg-brand-soft p-4">
          <p className="text-sm font-semibold">{e.pricePreview}</p>
          <p className="mt-1 font-display text-3xl font-bold">{t.pricing.basePriceKzt > 0 ? formatKzt(calculatePrice({ ...t.pricing, chargeExtraFaces: false }, PHOTO_QUALITY, Math.max(1, slots.length)).totalKzt) : "—"}</p>
          <p className="mt-1 text-sm text-muted">{e.photo.priceHint(formatKzt(Math.round(seedancePricing.photoCostUsd * seedancePricing.tengePerUsd)))}</p>
        </div>
        ) : (
        <div className="rounded-xl bg-brand-soft p-4">
          <p className="text-sm font-semibold">{e.pricePreview}</p>
          <p className="mt-1 font-display text-3xl font-bold">
            {autoPrice === null ? "—" : formatKzt(calculatePrice({ ...t.pricing, basePriceKzt: autoPrice, chargeExtraFaces: false }, { ...SEEDANCE_QUALITY }, Math.max(1, slots.length)).totalKzt)}
          </p>
          <p className="mt-1 text-sm text-muted">
            {duration === null ? e.durationUnknown
              : duration > 30.5 || duration < 3.5 ? e.durationBad
              : !t.pricing.basePriceKzt && autoPrice !== null
                ? e.autoPrice(formatKzt(autoPrice), Math.round(duration), formatKzt(costKzt ?? 0))
                : e.manualPrice(formatKzt(costKzt ?? 0))}
          </p>
          {unitLabel && <p className="mt-1 text-sm font-semibold">{unitLabel}</p>}
          {autoPrice !== null && costKzt !== null && <p className={`mt-1 text-sm font-medium ${autoPrice - costKzt >= 0 ? "text-success" : "text-danger"}`}>{e.profit(formatKzt(autoPrice - costKzt))}</p>}
        </div>
        )}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label={e.basePrice} field="pricing.basePriceKzt" required error={err("pricing.basePriceKzt")}>
            <Num value={t.pricing.basePriceKzt} min={0} error={err("pricing.basePriceKzt")} onChange={(v) => setPricing({ basePriceKzt: v as number })} />
            <span className="mt-1 block text-xs text-muted">{e.basePriceHint}</span>
          </Field>
        </div>
        <details className="mt-4 rounded-xl border border-line p-3">
          <summary className="cursor-pointer text-sm font-medium">{e.pricingAdvanced}</summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label={e.platformFee} field="pricing.platformFeeKzt" error={err("pricing.platformFeeKzt")}>
              <Num value={t.pricing.platformFeeKzt} min={0} error={err("pricing.platformFeeKzt")} onChange={(v) => setPricing({ platformFeeKzt: v ?? 0 })} />
            </Field>
            <Field label={e.discount}>
              <select
                className={inputCls()}
                value={t.pricing.discount?.type ?? ""}
                onChange={(ev) => setPricing({ discount: ev.target.value ? { type: ev.target.value as "percent" | "fixed", value: t.pricing.discount?.value ?? 0 } : undefined })}
              >
                <option value="">{e.discountNone}</option>
                <option value="percent">{e.discountPercent}</option>
                <option value="fixed">{e.discountFixed}</option>
              </select>
            </Field>
            {t.pricing.discount && (
              <>
                <Field label={e.discountValue} field="pricing.discount.value" required error={err("pricing.discount.value")}>
                  <Num value={t.pricing.discount.value} min={0} error={err("pricing.discount.value")} onChange={(v) => setPricing({ discount: { ...t.pricing.discount!, value: v as number } })} />
                </Field>
                <Field label={e.discountStarts}>
                  <input type="datetime-local" className={inputCls()} value={toLocal(t.pricing.discount.startsAt)} onChange={(ev) => setPricing({ discount: { ...t.pricing.discount!, startsAt: fromLocal(ev.target.value) } })} />
                </Field>
                <Field label={e.discountEnds} field="pricing.discount.endsAt" error={err("pricing.discount.endsAt")}>
                  <input type="datetime-local" className={inputCls(err("pricing.discount.endsAt"))} value={toLocal(t.pricing.discount.endsAt)} onChange={(ev) => setPricing({ discount: { ...t.pricing.discount!, endsAt: fromLocal(ev.target.value) } })} />
                </Field>
              </>
            )}
            <Field label={e.minPrice} field="pricing.minPriceKzt" error={err("pricing.minPriceKzt")}>
              <Num value={t.pricing.minPriceKzt} min={0} error={err("pricing.minPriceKzt")} onChange={(v) => setPricing({ minPriceKzt: v ?? 0 })} />
            </Field>
            <Field label={e.maxPrice} field="pricing.maxPriceKzt" error={err("pricing.maxPriceKzt")}>
              <Num value={t.pricing.maxPriceKzt} min={1} error={err("pricing.maxPriceKzt")} onChange={(v) => setPricing({ maxPriceKzt: v })} />
            </Field>
          </div>
        </details>
      </Section>

      {/* Sticky action bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-end gap-2 px-4 py-3 sm:gap-3">
          <div className="w-full min-w-0 text-sm sm:w-auto sm:flex-1" aria-live="polite">
            {errorCount > 0 ? (
              <p className="flex flex-wrap items-center gap-x-3 font-medium text-danger">
                <span>{e.errorsCount(errorCount)}</span>
                <button type="button" onClick={() => goTo(firstErrorKey(errors))} className="underline underline-offset-2">{e.goToError}</button>
              </p>
            ) : msg && (
              <div className={msg.kind === "ok" ? "text-success" : "text-danger"}>
                <p>{msg.text}</p>
                {msg.problems?.length ? (
                  <ul className="mt-1 list-disc pl-5">{msg.problems.map((p) => <li key={p}>{e.problems[p]}</li>)}</ul>
                ) : null}
              </div>
            )}
          </div>
          {id && (
            <Link href={`/admin/templates/${id}/preview`} className="rounded-full px-4 py-2 text-sm font-medium hover:bg-brand-soft">{e.preview}</Link>
          )}
          {id && status === "published" && (
            <button type="button" disabled={pending} onClick={() => status_("unpublish")} className="rounded-full border border-line px-4 py-2 text-sm font-medium hover:border-ink">{e.unpublish}</button>
          )}
          {id && status !== "archived" && status !== "published" && (
            <button type="button" disabled={pending} onClick={() => status_("archive")} className="rounded-full px-4 py-2 text-sm font-medium text-muted hover:text-ink">{e.archive}</button>
          )}
          {id && canDelete && <DeleteTemplateButton id={id} title={t.titleKk || ru.admin.editor.editTitle} full />}
          {id && status === "archived" && (
            <button type="button" disabled={pending} onClick={() => status_("restore")} className="rounded-full border border-line px-4 py-2 text-sm font-medium hover:border-ink">{e.restore}</button>
          )}
          <button type="button" disabled={pending} onClick={save} className="h-11 rounded-full border border-ink px-6 text-sm font-semibold hover:bg-ink hover:text-white disabled:opacity-50">
            {pending ? e.saving : e.save}
          </button>
          {status !== "published" && status !== "archived" && (
            <button type="button" disabled={pending} onClick={() => status_("publish")} className="h-11 rounded-full bg-brand px-6 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50">
              {e.publish}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function toLocal(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocal(v: string) {
  return v ? new Date(v).toISOString() : undefined;
}

/**
 * Grabs one frame of the video as a small JPEG. Catalog cards show this image instead of
 * downloading every video, which keeps pages with many templates fast.
 */
async function captureCover(source: File | string, maxWidth = 540): Promise<Blob | null> {
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  v.crossOrigin = "anonymous";
  const objectUrl = typeof source === "string" ? null : URL.createObjectURL(source);
  v.src = objectUrl ?? (source as string);
  try {
    await new Promise<void>((res, rej) => { v.onloadeddata = () => res(); v.onerror = () => rej(new Error("load")); });
    v.currentTime = Math.min(0.5, (v.duration || 1) / 2);
    await new Promise<void>((res, rej) => { v.onseeked = () => res(); v.onerror = () => rej(new Error("seek")); });
    const w = Math.min(maxWidth, v.videoWidth || maxWidth);
    const h = Math.round(w * ((v.videoHeight || 960) / (v.videoWidth || 540)));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d")!.drawImage(v, 0, 0, w, h);
    return await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", maxWidth > 540 ? 0.92 : 0.8));
  } catch {
    return null;
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

function Cutout({ path, mediaBase, label }: { path?: string; mediaBase: string; label: string }) {
  const src = path ? (/^https?:/.test(path) ? path : `${mediaBase}/${path}`) : null;
  return src
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={src} alt="" className="h-24 w-[72px] rounded-lg object-cover ring-1 ring-line" />
    : <span className="grid h-24 w-[72px] place-items-center rounded-lg bg-paper text-lg font-bold text-muted ring-1 ring-line">{label}</span>;
}

/** Cut-out of a template person or thing (box in 0–1000 of the frame): 1:2–2:1, 320–720 px. */
async function cropFrame(b64: string, box: Box, face: Box | null = null): Promise<Blob | null> {
  try {
    const img = new Image();
    img.src = `data:image/jpeg;base64,${b64}`;
    await img.decode();
    const r = cutoutRect(img.naturalWidth, img.naturalHeight, box);
    if (!r) return null;
    const c = document.createElement("canvas");
    c.width = r.outW; c.height = r.outH;
    const ctx = c.getContext("2d");
    ctx?.drawImage(img, r.sx, r.sy, r.sw, r.sh, 0, 0, c.width, c.height);
    const f = face ? faceInCutout(img.naturalWidth, img.naturalHeight, box, face) : null;
    if (face && !f) return null;
    if (ctx && f) {
      // Pixelate the face: draw it 6×6 and blow it back up without smoothing.
      const tiny = document.createElement("canvas");
      tiny.width = 6; tiny.height = 6;
      tiny.getContext("2d")?.drawImage(c, f.x, f.y, f.w, f.h, 0, 0, 6, 6);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tiny, 0, 0, 6, 6, f.x, f.y, f.w, f.h);
    }
    return await new Promise<Blob | null>((res) => c.toBlob((b) => res(b), "image/jpeg", 0.85));
  } catch {
    return null;
  }
}

async function uploadTarget(blob: Blob): Promise<string | null> {
  const r = await createUploadUrl({ kind: "target", contentType: "image/jpeg", size: blob.size });
  if (!r.ok) return null;
  const { error } = await supabaseBrowser().storage.from("template-media")
    .uploadToSignedUrl(r.path, r.token, blob, { contentType: "image/jpeg" });
  return error ? null : r.path;
}

async function uploadCover(blob: Blob): Promise<string | null> {
  const r = await createUploadUrl({ kind: "cover", contentType: "image/jpeg", size: blob.size });
  if (!r.ok) return null;
  const { error } = await supabaseBrowser().storage.from("template-media")
    .uploadToSignedUrl(r.path, r.token, blob, { contentType: "image/jpeg" });
  return error ? null : r.path;
}

/** Example photo for a photo template: re-encoded to a JPEG (max 1600 px) and stored as the cover. */
async function uploadExamplePhoto(file: File): Promise<string | null> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.9));
    return blob ? await uploadCover(blob) : null;
  } catch {
    return null;
  }
}

function PhotoExampleField({ error, path, mediaBase, onUploaded }: { error?: string; path: string | null; mediaBase: string; onUploaded: (p: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const url = path ? (/^https?:/.test(path) ? path : `${mediaBase}/${path}`) : null;
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setFailed(false);
    const p = await uploadExamplePhoto(file);
    setBusy(false);
    if (p) onUploaded(p); else setFailed(true);
  };
  return (
    <div data-field="cover" className="flex flex-wrap items-start gap-4">
      <div className="flex aspect-[3/4] w-40 items-center justify-center overflow-hidden rounded-xl border border-line bg-paper">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <span className="px-3 text-center text-xs text-muted">{ru.admin.editor.photo.noExample}</span>}
      </div>
      <div className="min-w-0 flex-1 space-y-2 text-sm">
        <p className="text-muted">{ru.admin.editor.photo.exampleHint}</p>
        <label className="inline-flex cursor-pointer items-center rounded-full border border-ink px-4 py-2 font-semibold hover:bg-ink hover:text-white">
          {busy ? ru.admin.editor.uploading : url ? ru.admin.editor.replace : ru.admin.editor.upload}
          <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={busy} onChange={(ev) => { void onFile(ev.target.files?.[0]); ev.target.value = ""; }} />
        </label>
        {(failed || error) && <p className="text-danger" role="alert">{failed ? ru.admin.editor.uploadFailed : error}</p>}
      </div>
    </div>
  );
}

function readVideoMeta(file: File): Promise<{ duration: number; aspect: number | null } | null> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(file);
    const finish = (meta: { duration: number; aspect: number | null } | null) => {
      URL.revokeObjectURL(url);
      v.onloadedmetadata = null;
      v.onerror = null;
      v.removeAttribute("src");
      resolve(meta);
    };
    const timer = setTimeout(() => finish(null), 8_000);
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      clearTimeout(timer);
      const duration = Number.isFinite(v.duration) ? v.duration : null;
      const aspect = v.videoWidth > 0 && v.videoHeight > 0 ? Math.round((v.videoWidth / v.videoHeight) * 10000) / 10000 : null;
      finish(duration && duration > 0 ? { duration, aspect } : null);
    };
    v.onerror = () => { clearTimeout(timer); finish(null); };
    v.src = url;
  });
}

const VIDEO_TYPES = ["video/mp4", "video/webm"];
const VIDEO_MAX = 50 * 1024 * 1024;

function VideoField({
  error, path, mediaBase, onUploaded, onCover,
}: {
  error?: string; path: string | null; mediaBase: string;
  onUploaded: (p: string, meta: { duration: number; aspect: number | null } | null) => void;
  onCover: (p: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const url = path ? (/^https?:/.test(path) ? path : `${mediaBase}/${path}`) : null;
  const shownError = uploadErr ?? (url ? undefined : error);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setUploadErr(null);
    if (!VIDEO_TYPES.includes(file.type) || file.size > VIDEO_MAX) { setUploadErr(e.badFile); return; }
    const meta = await readVideoMeta(file);
    if (meta && (meta.duration < SEEDANCE_MIN_SEC - 0.5 || meta.duration > SEEDANCE_MAX_SEC + 0.5)) { setUploadErr(e.durationBad); return; }
    // Kling takes 2:5–5:2 only. Size is fixed by the server (a 720 px copy), shape cannot be.
    if (meta?.aspect && !aspectAllowed(meta.aspect)) { setUploadErr(e.aspectBad); return; }
    setBusy(true);
    try {
      const r = await createUploadUrl({ kind: "preview", contentType: file.type, size: file.size });
      if (!r.ok) { setUploadErr(e.uploadFailed); return; }
      const { error: upErr } = await supabaseBrowser().storage.from("template-media")
        .uploadToSignedUrl(r.path, r.token, file, { contentType: file.type });
      if (upErr) { setUploadErr(e.uploadFailed); return; }
      onUploaded(r.path, meta);
      // Cover for catalog cards, made from this video (best effort).
      const blob = await captureCover(file);
      onCover(blob ? await uploadCover(blob) : null);
    } catch {
      setUploadErr(e.uploadFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-field="preview" className="flex flex-col items-center gap-3 sm:flex-row sm:items-start sm:gap-6">
      <div className={`relative aspect-[9/16] w-40 shrink-0 overflow-hidden rounded-xl border-2 border-dashed bg-paper ${shownError ? "border-danger bg-red-50/50" : "border-line"}`}>
        {url && <video src={url} muted loop playsInline autoPlay className="h-full w-full object-cover" />}
      </div>
      <div className="text-center sm:text-left">
        <span className={labelCls}>{e.previewVideo}<span className="text-danger" aria-hidden> *</span><span className="sr-only"> {e.requiredSr}</span></span>
        <p className="max-w-sm text-sm text-muted">{e.videoHint}</p>
        <label className="mt-3 inline-flex cursor-pointer">
          <span className={`rounded-full border bg-white px-4 py-2 text-sm font-medium hover:border-ink ${shownError ? "border-danger text-danger" : "border-line"}`}>
            {busy ? e.uploading : url ? e.replace : e.upload}
          </span>
          <input type="file" accept={VIDEO_TYPES.join(",")} className="sr-only" disabled={busy} onChange={(ev) => onFile(ev.target.files?.[0])} />
        </label>
        {shownError && <p className="mt-2 text-xs font-medium text-danger" role="alert">{shownError}</p>}
      </div>
    </div>
  );
}

/**
 * "New template": Next keeps visited pages alive (React Activity), so without this the form
 * would reopen with the previous template's fields, video and cover. A fresh key per navigation
 * starts every "+ New template" visit empty (browser back/forward still restores the draft).
 */
export function NewTemplateEditor(props: Omit<Parameters<typeof TemplateEditor>[0], "id">) {
  const { bfcacheId } = useRouter();
  return <TemplateEditor key={bfcacheId} id={null} {...props} />;
}

/** Up to 6 JPEG frames (≤640 px, under ~900 KB together: the server action limit is 1 MB) from the template video, base64 without the data: prefix. null = the browser could not read it. */
async function videoFrames(url: string): Promise<string[] | null> {
  const v = document.createElement("video");
  v.muted = true; v.playsInline = true; v.preload = "auto"; v.crossOrigin = "anonymous"; v.src = url;
  try {
    await new Promise<void>((res, rej) => { v.onloadeddata = () => res(); v.onerror = () => rej(new Error("load")); setTimeout(() => rej(new Error("timeout")), 20_000); });
    const d = v.duration || 1;
    const scale = Math.min(1, 640 / Math.max(v.videoWidth || 720, v.videoHeight || 1280));
    const c = document.createElement("canvas");
    c.width = Math.round((v.videoWidth || 720) * scale); c.height = Math.round((v.videoHeight || 1280) * scale);
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    const out: string[] = [];
    for (const f of [0.05, 0.2, 0.4, 0.6, 0.8, 0.95]) {
      v.currentTime = Math.min(d * f, Math.max(0, d - 0.1));
      await new Promise<void>((res) => { v.onseeked = () => res(); });
      ctx.drawImage(v, 0, 0, c.width, c.height);
      out.push(c.toDataURL("image/jpeg", 0.72).split(",")[1] ?? "");
    }
    const frames = out.filter(Boolean);
    while (frames.length > 3 && frames.reduce((n, f) => n + f.length, 0) > 800_000) frames.splice(Math.floor(frames.length / 2), 1);
    return frames;
  } catch {
    return null;
  } finally {
    v.removeAttribute("src"); v.load();
  }
}
