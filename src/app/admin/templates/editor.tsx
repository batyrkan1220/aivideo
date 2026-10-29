"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ru } from "@/lib/i18n/ru";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { TemplateInput, PublishProblem } from "@/lib/templates/admin-schema";
import { autoFaceSlots } from "@/lib/templates/schema";
import { validateTemplateForm, firstErrorKey, type FieldErrors } from "@/lib/templates/editor-validation";
import { parseSeedanceConfig, seedanceSlots, SEEDANCE_MAX_PEOPLE, type SeedanceConfig } from "@/lib/templates/seedance-config";
import { calculatePrice, formatKzt } from "@/lib/pricing";
import { seedancePriceKzt, seedanceCostKzt, SEEDANCE_QUALITY, type SeedancePricing } from "@/lib/pricing-seedance";
import { FaceMap } from "@/components/face-map";
import { saveTemplate, changeStatus, createUploadUrl } from "./actions";

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
  id, initial, status, categories, mediaBase, seedancePricing,
}: {
  id: string | null;
  initial: TemplateInput;
  status: Status;
  categories: { id: string; title: string }[];
  mediaBase: string;
  seedancePricing: SeedancePricing;
}) {
  const router = useRouter();
  const [duration, setDuration] = useState<number | null>(null);
  // Every template is a Seedance template: one quality (720p), Seedance provider and config.
  const [t, setT] = useState<TemplateInput>(() => ({ ...initial, providerKey: "seedance", qualities: [SEEDANCE_QUALITY] }));
  // Template video length → automatic price preview.
  useEffect(() => {
    if (!t.previewVideoPath) return;
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => setDuration(Number.isFinite(v.duration) ? v.duration : null);
    v.src = /^https?:/.test(t.previewVideoPath) ? t.previewVideoPath : `${mediaBase}/${t.previewVideoPath}`;
    return () => { v.onloadedmetadata = null; v.removeAttribute("src"); };
  }, [t.previewVideoPath, mediaBase]);
  const [sd, setSdState] = useState<SeedanceConfig>(() =>
    parseSeedanceConfig(initial.providerKey === "seedance" ? initial.providerConfig : {}));
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string; problems?: PublishProblem[] } | null>(null);
  const [pending, start] = useTransition();
  // Errors appear after the first save/publish attempt and then update live as the admin types.
  const [mode, setMode] = useState<null | "save" | "publish">(null);

  const configText = JSON.stringify(sd);
  const errors: FieldErrors = mode ? validateTemplateForm(t, configText, mode === "publish") : {};
  const err = (k: string) => errors[k];
  const errorCount = Object.keys(errors).length;

  const set = <K extends keyof TemplateInput>(k: K, v: TemplateInput[K]) => { setT((p) => ({ ...p, [k]: v })); setDirty(true); };
  const setPricing = (patch: Partial<TemplateInput["pricing"]>) => set("pricing", { ...t.pricing, ...patch });
  const setSd = (patch: Partial<SeedanceConfig>) => { setSdState((p) => ({ ...p, ...patch })); setDirty(true); };

  // Customer photo slots = the number of people to replace, left → right (the server derives them too).
  const slots = seedanceSlots(sd.people);

  /** Client check first (shows red fields), then the authoritative server save. */
  const persist = async (forPublish: boolean): Promise<string | null> => {
    const found = validateTemplateForm(t, configText, forPublish);
    if (Object.keys(found).length) {
      setMode(forPublish ? "publish" : "save");
      setMsg({ kind: "err", text: forPublish ? e.fixBeforePublish : e.fixBeforeSave });
      requestAnimationFrame(() => goTo(firstErrorKey(found)));
      return null;
    }
    const sent = slots.length ? slots : autoFaceSlots(1);
    // Older templates without a cover: make one from the video now.
    let cover = t.coverAssetPath;
    if (!cover && t.previewVideoPath) {
      const blob = await captureCover(`${mediaBase}/${t.previewVideoPath}`);
      cover = blob ? await uploadCover(blob) : null;
      if (cover) set("coverAssetPath", cover);
    }
    // Kling: a full-size frame of the video = the scene the customer is put into.
    let cfg = sd;
    if (sd.mode === "kling" && !sd.framePath && t.previewVideoPath) {
      const blob = await captureCover(`${mediaBase}/${t.previewVideoPath}`, 1280);
      const framePath = blob ? await uploadCover(blob) : null;
      if (framePath) { cfg = { ...sd, framePath }; setSdState(cfg); }
    }
    const payload = { ...t, coverAssetPath: cover, providerKey: "seedance", providerConfig: cfg, faceSlots: sent };
    const r = await saveTemplate(payload, id);
    if (!r.ok) {
      setMsg({ kind: "err", text: r.error === "forbidden" ? ru.admin.forbidden : r.error === "invalid" ? e.invalid : ru.errors.generic });
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

  const costOpts = { mode: sd.mode, people: sd.people };
  const autoPrice = seedancePriceKzt(duration, Number(t.pricing.basePriceKzt) || 0, seedancePricing, costOpts);
  const costKzt = duration ? seedanceCostKzt(duration, seedancePricing, costOpts) : null;

  return (
    <div className="space-y-6 pb-56 sm:pb-28">
      <p className="text-xs text-muted">{e.requiredNote}</p>

      <Section title={e.sections.basics}>
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
        <VideoField error={err("preview")} path={t.previewVideoPath} mediaBase={mediaBase} onUploaded={(p) => { set("previewVideoPath", p); setSd({ framePath: null }); }} onCover={(p) => set("coverAssetPath", p)} />
      </Section>

      <Section title={e.seedance.title}>
        <p className="text-sm text-muted">{e.seedance.intro}</p>
        <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_minmax(0,320px)]">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={e.seedance.mode} className="sm:col-span-2">
              <select className={inputCls()} value={sd.mode} onChange={(ev) => { const m = ev.target.value as SeedanceConfig["mode"]; setSd(m === "kling" || m === "wan" ? { mode: m, people: 1 } : { mode: m }); }}>
                {(["wan", "kling", "swap", "scene"] as const).map((k) => <option key={k} value={k}>{e.seedance.modeOptions[k]}</option>)}
              </select>
              <span className="mt-1 block text-xs text-muted">{e.seedance.modeHint[sd.mode]}</span>
              <details className="mt-2 rounded-xl bg-paper px-3 py-2 text-xs">
                <summary className="cursor-pointer font-semibold">{e.seedance.guideTitle}</summary>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-muted">
                  {e.seedance.guide.map((g) => <li key={g}>{g}</li>)}
                </ul>
              </details>
            </Field>
            <Field label={e.seedance.people}>
              <select className={inputCls()} value={sd.people} disabled={sd.mode === "kling" || sd.mode === "wan"} onChange={(ev) => setSd({ people: Number(ev.target.value) })}>
                {Array.from({ length: SEEDANCE_MAX_PEOPLE }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <span className="mt-1 block text-xs text-muted">{e.seedance.peopleHint}</span>
            </Field>
            {sd.mode === "scene" && <Field label={e.seedance.aspect}>
              <select className={inputCls()} value={sd.aspectRatio} onChange={(ev) => setSd({ aspectRatio: ev.target.value as SeedanceConfig["aspectRatio"] })}>
                {(Object.keys(e.seedance.aspectOptions) as SeedanceConfig["aspectRatio"][]).map((k) => <option key={k} value={k}>{e.seedance.aspectOptions[k]}</option>)}
              </select>
            </Field>}
            <Field label={e.seedance.framing} className="sm:col-span-2">
              <select className={inputCls()} value={sd.framing} onChange={(ev) => setSd({ framing: ev.target.value as SeedanceConfig["framing"] })}>
                {(["face", "half", "full"] as const).map((k) => <option key={k} value={k}>{e.seedance.framingOptions[k]}</option>)}
              </select>
              <span className="mt-1 block text-xs text-muted">{e.seedance.framingHint}</span>
            </Field>
            {(sd.mode === "scene" || sd.mode === "kling") && <>
            <Field label={e.seedance.prompt} field="seedance.prompt" error={err("seedance.prompt")} className="sm:col-span-2">
              <textarea className={`${inputCls(err("seedance.prompt"))} min-h-24`} value={sd.prompt} maxLength={1500} onChange={(ev) => setSd({ prompt: ev.target.value })} />
              <span className="mt-1 block text-xs text-muted">{e.seedance.promptHint}</span>
            </Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" className="h-4 w-4 accent-brand" checked={sd.allowWish} onChange={(ev) => setSd({ allowWish: ev.target.checked })} />
              {e.seedance.allowWish}
            </label>
            </>}
            <p className={`text-xs sm:col-span-2 ${duration !== null && (duration < 3.5 || duration > 30.5) ? "font-semibold text-danger" : "text-muted"}`}>
              {sd.mode === "wan" ? e.seedance.durationHintWan : sd.mode === "swap" ? e.seedance.durationHintSwap : sd.mode === "kling" ? e.seedance.durationHintKling : e.seedance.durationHint}{duration !== null ? ` · ${Math.round(duration * 10) / 10} сек` : ""}
            </p>
          </div>
          {slots.length > 0 && <FaceMap slots={slots} mediaBase={mediaBase} />}
        </div>
      </Section>

      <Section title={e.sections.pricing}>
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
          {autoPrice !== null && costKzt !== null && <p className={`mt-1 text-sm font-medium ${autoPrice - costKzt >= 0 ? "text-success" : "text-danger"}`}>{e.profit(formatKzt(autoPrice - costKzt))}</p>}
        </div>
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

async function uploadCover(blob: Blob): Promise<string | null> {
  const r = await createUploadUrl({ kind: "cover", contentType: "image/jpeg", size: blob.size });
  if (!r.ok) return null;
  const { error } = await supabaseBrowser().storage.from("template-media")
    .uploadToSignedUrl(r.path, r.token, blob, { contentType: "image/jpeg" });
  return error ? null : r.path;
}

const VIDEO_TYPES = ["video/mp4", "video/webm"];
const VIDEO_MAX = 50 * 1024 * 1024;

function VideoField({
  error, path, mediaBase, onUploaded, onCover,
}: { error?: string; path: string | null; mediaBase: string; onUploaded: (p: string) => void; onCover: (p: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const url = path ? (/^https?:/.test(path) ? path : `${mediaBase}/${path}`) : null;
  const shownError = uploadErr ?? (url ? undefined : error);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setUploadErr(null);
    if (!VIDEO_TYPES.includes(file.type) || file.size > VIDEO_MAX) { setUploadErr(e.badFile); return; }
    setBusy(true);
    try {
      const r = await createUploadUrl({ kind: "preview", contentType: file.type, size: file.size });
      if (!r.ok) { setUploadErr(e.uploadFailed); return; }
      const { error: upErr } = await supabaseBrowser().storage.from("template-media")
        .uploadToSignedUrl(r.path, r.token, file, { contentType: file.type });
      if (upErr) { setUploadErr(e.uploadFailed); return; }
      onUploaded(r.path);
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
