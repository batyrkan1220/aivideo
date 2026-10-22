"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { kk } from "@/lib/i18n/kk";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { TemplateInput, PublishProblem } from "@/lib/templates/admin-schema";
import { autoFaceSlots, type Quality } from "@/lib/templates/schema";
import { validateTemplateForm, firstErrorKey, parseConfig, type FieldErrors } from "@/lib/templates/editor-validation";
import { calculatePrice, formatKzt } from "@/lib/pricing";
import { FaceMap } from "@/components/face-map";
import { parseAkoolConfig, akoolSlots, type AkoolConfig } from "@/lib/templates/akool-config";
import { AkoolPeople } from "./akool-people";
import { saveTemplate, changeStatus, createUploadUrl } from "./actions";

const e = kk.admin.editor;
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
  id, initial, status, categories, mediaBase,
}: {
  id: string | null;
  initial: TemplateInput;
  status: Status;
  categories: { id: string; title: string }[];
  mediaBase: string;
}) {
  const router = useRouter();
  // Templates of the removed WaveSpeed provider are moved to Akool (they must be analysed again).
  const [t, setT] = useState<TemplateInput>(() =>
    initial.providerKey === "wavespeed" ? { ...initial, providerKey: "akool", providerConfig: {} } : initial);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string; problems?: PublishProblem[] } | null>(null);
  const [pending, start] = useTransition();
  const [configText, setConfigText] = useState(() =>
    JSON.stringify(initial.providerKey === "akool" ? parseAkoolConfig(initial.providerConfig)
      : initial.providerKey === "wavespeed" ? parseAkoolConfig({}) : initial.providerConfig ?? {}));
  // Errors appear after the first save/publish attempt and then update live as the admin types.
  const [mode, setMode] = useState<null | "save" | "publish">(null);

  const errors: FieldErrors = mode ? validateTemplateForm(t, configText, mode === "publish") : {};
  const err = (k: string) => errors[k];
  const errorCount = Object.keys(errors).length;

  const set = <K extends keyof TemplateInput>(k: K, v: TemplateInput[K]) => { setT((p) => ({ ...p, [k]: v })); setDirty(true); };
  const setQuality = (i: number, patch: Partial<Quality>) =>
    set("qualities", t.qualities.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const setPricing = (patch: Partial<TemplateInput["pricing"]>) => set("pricing", { ...t.pricing, ...patch });

  // Provider config, edited only through the structured controls below.
  const cfg = parseConfig(configText);
  const isAkool = t.providerKey === "akool";
  const akool = parseAkoolConfig(cfg);
  const setAkool = (next: AkoolConfig) => { setConfigText(JSON.stringify(next)); setDirty(true); };
  // Akool: customer photo slots = the people chosen from the video analysis (server derives them too).
  const slots = isAkool ? akoolSlots(akool) : t.faceSlots;
  const setFaceCount = (n: number) => set("faceSlots", autoFaceSlots(n));
  const setProvider = (key: string | null) => {
    set("providerKey", key);
    setConfigText(JSON.stringify(key === "akool" ? parseAkoolConfig(cfg) : {}));
  };

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
    const payload = { ...t, providerConfig: cfg ?? {}, faceSlots: sent.map((s, k) => ({ ...s, order: k })) };
    const r = await saveTemplate(payload, id);
    if (!r.ok) {
      setMsg({ kind: "err", text: r.error === "forbidden" ? kk.admin.forbidden : r.error === "invalid" ? e.invalid : kk.errors.generic });
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
      setMsg({ kind: "err", text: r.error === "forbidden" ? kk.admin.forbidden : kk.errors.generic, problems: r.problems });
      if (!id) router.replace(`/admin/templates/${targetId}`);
      return;
    }
    setMode(null);
    setMsg({ kind: "ok", text: action === "publish" ? e.published : e.statusChanged });
    if (!id) router.replace(`/admin/templates/${targetId}`);
    else router.refresh();
  });

  const qualityPrices = t.qualities.filter((q) => q.available).map((q) => {
    try { return { q, total: calculatePrice(t.pricing, q, Math.max(1, slots.length)).totalKzt }; }
    catch { return { q, total: null }; }
  });

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
        <div className="grid gap-6 sm:grid-cols-2">
          <MediaField kind="cover" field="cover" label={e.cover} error={err("cover")} path={t.coverAssetPath} mediaBase={mediaBase} onUploaded={(p) => set("coverAssetPath", p)} />
          <MediaField kind="preview" field="preview" label={e.previewVideo} error={err("preview")} path={t.previewVideoPath} mediaBase={mediaBase} onUploaded={(p) => set("previewVideoPath", p)} />
        </div>
      </Section>

      <Section title={e.sections.provider}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={e.providerKey} field="providerKey" required error={err("providerKey")}>
            <select className={inputCls(err("providerKey"))} value={t.providerKey ?? ""} onChange={(ev) => setProvider(ev.target.value || null)}>
              <option value="">—</option>
              <option value="dev">dev (демо)</option>
              <option value="akool">Akool — бүкіл басты ауыстыру (Head Swap)</option>
            </select>
          </Field>
          <Field label={e.maxUpload} field="maxUploadBytes" required error={err("maxUploadBytes")}>
            <Num value={Math.round(t.maxUploadBytes / 1024 / 1024)} min={1} error={err("maxUploadBytes")} onChange={(v) => set("maxUploadBytes", (v ?? 0) * 1024 * 1024)} />
          </Field>

          {isAkool && (
            <Field label={e.akool.resolution} className="sm:col-span-2">
              <select className={`${inputCls()} sm:max-w-xs`} value={akool.resolution} onChange={(ev) => setAkool({ ...akool, resolution: ev.target.value as AkoolConfig["resolution"] })}>
                <option value="720p">720p</option>
                <option value="480p">480p</option>
              </select>
              <span className="mt-1 block text-xs text-muted">{e.akool.creditsHint}</span>
            </Field>
          )}
        </div>
      </Section>

      <Section title={isAkool ? e.akool.title : e.sections.faces}>
        {isAkool ? (
          <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,320px)]">
            <AkoolPeople
              videoPath={t.previewVideoPath}
              mediaBase={mediaBase}
              cfg={akool}
              onChange={setAkool}
              analysisError={err("akool.analysis")}
              peopleError={err("akool.people")}
            />
            {slots.length > 0 && <FaceMap slots={slots} mediaBase={mediaBase} />}
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,320px)]">
            <div>
              <span className={labelCls}>{e.peopleCount}<span className="text-danger" aria-hidden> *</span></span>
              <div className="flex items-center gap-3">
                <button type="button" aria-label={e.fewer} disabled={t.faceSlots.length <= 1} onClick={() => setFaceCount(t.faceSlots.length - 1)} className="h-11 w-11 rounded-full border border-line text-xl font-semibold hover:border-ink disabled:opacity-30">−</button>
                <output className="w-10 text-center font-display text-3xl font-bold" aria-live="polite">{t.faceSlots.length}</output>
                <button type="button" aria-label={e.more} disabled={t.faceSlots.length >= 10} onClick={() => setFaceCount(t.faceSlots.length + 1)} className="h-11 w-11 rounded-full border border-line text-xl font-semibold hover:border-ink disabled:opacity-30">+</button>
              </div>
              <p className="mt-4 max-w-md text-sm text-muted">{e.faceHint}</p>
            </div>
            <FaceMap slots={t.faceSlots} />
          </div>
        )}
      </Section>

      <Section title={e.sections.qualities} field="qualities" error={err("qualities")}>
        <div className="space-y-4">
          {t.qualities.map((q, i) => {
            const k = (f: string) => `quality.${i}.${f}`;
            const rowHasError = Object.keys(errors).some((x) => x.startsWith(`quality.${i}.`));
            return (
              <div key={i} className={`grid gap-3 rounded-xl border p-4 sm:grid-cols-4 ${rowHasError ? "border-danger/60" : "border-line"}`}>
                <Field label={e.qualityLabel} field={k("labelKk")} required error={err(k("labelKk"))}>
                  <input className={inputCls(err(k("labelKk")))} aria-invalid={!!err(k("labelKk"))} value={q.labelKk} onChange={(ev) => setQuality(i, { labelKk: ev.target.value })} />
                </Field>
                <Field label={e.qualityKey} field={k("key")} required error={err(k("key"))}>
                  <input className={inputCls(err(k("key")))} aria-invalid={!!err(k("key"))} value={q.key} onChange={(ev) => setQuality(i, { key: ev.target.value.toLowerCase() })} />
                </Field>
                <Field label={e.resolution}>
                  <input className={inputCls()} value={q.resolution ?? ""} onChange={(ev) => setQuality(i, { resolution: ev.target.value || undefined })} />
                </Field>
                <Field label={e.fps} field={k("fps")} error={err(k("fps"))}>
                  <Num value={q.fps} min={1} error={err(k("fps"))} onChange={(v) => setQuality(i, { fps: v })} />
                </Field>
                <Field label={e.maxDuration}>
                  <Num value={q.maxDurationSec} min={1} onChange={(v) => setQuality(i, { maxDurationSec: v })} />
                </Field>
                <Field label={e.providerQuality} field={k("providerQuality")} required error={err(k("providerQuality"))}>
                  <input className={inputCls(err(k("providerQuality")))} aria-invalid={!!err(k("providerQuality"))} value={q.providerQuality} onChange={(ev) => setQuality(i, { providerQuality: ev.target.value })} />
                </Field>
                <Field label={e.surcharge} field={k("surchargeKzt")} error={err(k("surchargeKzt"))}>
                  <Num value={q.surchargeKzt} min={0} error={err(k("surchargeKzt"))} onChange={(v) => setQuality(i, { surchargeKzt: v ?? 0 })} />
                </Field>
                <div className="flex items-end justify-between gap-2 pb-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4 accent-brand" checked={q.available} onChange={(ev) => setQuality(i, { available: ev.target.checked })} />
                    {e.available}
                  </label>
                  <button type="button" className="text-xs text-danger hover:underline disabled:opacity-30" disabled={t.qualities.length === 1} onClick={() => set("qualities", t.qualities.filter((_, j) => j !== i))}>{e.removeQuality}</button>
                </div>
              </div>
            );
          })}
          <button
            type="button"
            disabled={t.qualities.length >= 6}
            className="rounded-full border border-dashed border-brand px-4 py-2 text-sm font-semibold text-brand hover:bg-brand-soft disabled:opacity-40"
            onClick={() => set("qualities", [...t.qualities, { key: `q${t.qualities.length + 1}`, labelKk: "", providerQuality: "", surchargeKzt: 0, available: true }])}
          >
            + {e.addQuality}
          </button>
        </div>
      </Section>

      <Section title={e.sections.pricing}>
        <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,300px)]">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={e.basePrice} field="pricing.basePriceKzt" required error={err("pricing.basePriceKzt")}>
              <Num value={t.pricing.basePriceKzt} min={0} error={err("pricing.basePriceKzt")} onChange={(v) => setPricing({ basePriceKzt: v as number })} />
            </Field>
            <Field label={e.platformFee} field="pricing.platformFeeKzt" error={err("pricing.platformFeeKzt")}>
              <Num value={t.pricing.platformFeeKzt} min={0} error={err("pricing.platformFeeKzt")} onChange={(v) => setPricing({ platformFeeKzt: v ?? 0 })} />
            </Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" className="h-4 w-4 accent-brand" checked={t.pricing.chargeExtraFaces} onChange={(ev) => setPricing({ chargeExtraFaces: ev.target.checked })} />
              {e.chargeExtra}
            </label>
            {t.pricing.chargeExtraFaces && (
              <>
                <Field label={e.includedFaces} field="pricing.includedFaces" required error={err("pricing.includedFaces")}>
                  <Num value={t.pricing.includedFaces} min={1} error={err("pricing.includedFaces")} onChange={(v) => setPricing({ includedFaces: v as number })} />
                </Field>
                <Field label={e.extraFacePrice} field="pricing.extraFacePriceKzt" required error={err("pricing.extraFacePriceKzt")}>
                  <Num value={t.pricing.extraFacePriceKzt} min={0} error={err("pricing.extraFacePriceKzt")} onChange={(v) => setPricing({ extraFacePriceKzt: v as number })} />
                </Field>
              </>
            )}
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
          <div className="rounded-xl bg-brand-soft p-4 lg:self-start">
            <p className="mb-3 text-sm font-semibold">{e.pricePreview}</p>
            <ul className="space-y-2 text-sm">
              {qualityPrices.map(({ q, total }) => (
                <li key={q.key} className="flex justify-between gap-3">
                  <span>{q.labelKk || q.key}</span>
                  <span className="font-display font-semibold">{total === null || Number.isNaN(total) ? "—" : formatKzt(total)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
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

function MediaField({
  kind, field, label, error, path, mediaBase, onUploaded,
}: { kind: "cover" | "preview"; field: string; label: string; error?: string; path: string | null; mediaBase: string; onUploaded: (p: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const url = path ? (/^https?:/.test(path) ? path : `${mediaBase}/${path}`) : null;
  const accept = kind === "cover" ? "image/jpeg,image/png,image/webp" : "video/mp4,video/webm";
  const max = kind === "cover" ? 5 * 1024 * 1024 : 50 * 1024 * 1024;
  const shownError = uploadErr ?? (url ? undefined : error);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setUploadErr(null);
    if (!accept.split(",").includes(file.type) || file.size > max) { setUploadErr(e.badFile); return; }
    setBusy(true);
    try {
      const r = await createUploadUrl({ kind, contentType: file.type, size: file.size });
      if (!r.ok) { setUploadErr(e.uploadFailed); return; }
      const { error: upErr } = await supabaseBrowser().storage.from("template-media")
        .uploadToSignedUrl(r.path, r.token, file, { contentType: file.type });
      if (upErr) { setUploadErr(e.uploadFailed); return; }
      onUploaded(r.path);
    } catch {
      setUploadErr(e.uploadFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-field={field}>
      <span className={labelCls}>{label}<span className="text-danger" aria-hidden> *</span><span className="sr-only"> {e.requiredSr}</span></span>
      <div className={`relative mx-auto aspect-[9/16] w-40 overflow-hidden rounded-xl border-2 border-dashed bg-paper ${shownError ? "border-danger bg-red-50/50" : "border-line"}`}>
        {url && kind === "cover" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="h-full w-full object-cover" />
        )}
        {url && kind === "preview" && <video src={url} muted loop playsInline autoPlay className="h-full w-full object-cover" />}
      </div>
      <label className="mt-3 flex cursor-pointer justify-center">
        <span className={`rounded-full border bg-white px-4 py-2 text-sm font-medium hover:border-ink ${shownError ? "border-danger text-danger" : "border-line"}`}>
          {busy ? e.uploading : url ? e.replace : e.upload}
        </span>
        <input type="file" accept={accept} className="sr-only" disabled={busy} onChange={(ev) => onFile(ev.target.files?.[0])} />
      </label>
      {shownError && <p className="mt-2 text-center text-xs font-medium text-danger" role="alert">{shownError}</p>}
    </div>
  );
}
