"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { kk } from "@/lib/i18n/kk";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { TemplateInput, PublishProblem } from "@/lib/templates/admin-schema";
import type { FaceSlot, Quality } from "@/lib/templates/schema";
import { calculatePrice, formatKzt } from "@/lib/pricing";
import { FaceMap } from "@/components/face-map";
import { saveTemplate, changeStatus, createUploadUrl } from "./actions";

const e = kk.admin.editor;
type Status = "draft" | "published" | "disabled" | "archived";

const inputCls = "w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-brand";
const labelCls = "mb-1 block text-xs font-medium text-muted";

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`block ${className}`}><span className={labelCls}>{label}</span>{children}</label>;
}

function Num({ value, onChange, min, step = 1 }: { value: number | undefined; onChange: (v: number | undefined) => void; min?: number; step?: number }) {
  return (
    <input
      type="number" inputMode="numeric" className={inputCls} min={min} step={step}
      value={value ?? ""}
      onChange={(ev) => onChange(ev.target.value === "" ? undefined : Number(ev.target.value))}
    />
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-line bg-white p-5 sm:p-6">
      <h2 className="mb-4 font-display text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
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
  const [t, setT] = useState<TemplateInput>(initial);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string; problems?: PublishProblem[] } | null>(null);
  const [pending, start] = useTransition();
  const [configText, setConfigText] = useState(JSON.stringify(initial.providerConfig, null, 2));

  const set = <K extends keyof TemplateInput>(k: K, v: TemplateInput[K]) => { setT((p) => ({ ...p, [k]: v })); setDirty(true); };
  const setSlot = (i: number, patch: Partial<FaceSlot>) =>
    set("faceSlots", t.faceSlots.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const setQuality = (i: number, patch: Partial<Quality>) =>
    set("qualities", t.qualities.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const setPricing = (patch: Partial<TemplateInput["pricing"]>) => set("pricing", { ...t.pricing, ...patch });

  const moveSlot = (i: number, d: -1 | 1) => {
    const arr = [...t.faceSlots];
    const j = i + d;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    set("faceSlots", arr.map((s, k) => ({ ...s, order: k })));
  };

  const save = () => start(async () => {
    let providerConfig: Record<string, unknown>;
    try { providerConfig = configText.trim() ? JSON.parse(configText) : {}; }
    catch { setMsg({ kind: "err", text: e.providerConfigInvalid }); return; }
    const payload = { ...t, providerConfig, faceSlots: t.faceSlots.map((s, k) => ({ ...s, order: k })) };
    const r = await saveTemplate(payload, id);
    if (!r.ok) {
      setMsg({ kind: "err", text: r.error === "forbidden" ? kk.admin.forbidden : r.error === "invalid" ? e.invalid : kk.errors.generic });
      return;
    }
    setDirty(false);
    setMsg({ kind: "ok", text: e.saved });
    if (!id) router.replace(`/admin/templates/${r.id}`);
    else router.refresh();
  });

  const status_ = (action: "publish" | "unpublish" | "archive" | "restore") => start(async () => {
    if (!id) return;
    if (dirty) { setMsg({ kind: "err", text: e.unsavedPublish }); return; }
    const r = await changeStatus(id, action);
    if (!r.ok) {
      setMsg({ kind: "err", text: r.error === "forbidden" ? kk.admin.forbidden : kk.errors.generic, problems: r.problems });
      return;
    }
    setMsg({ kind: "ok", text: action === "publish" ? e.published : e.statusChanged });
    router.refresh();
  });

  const qualityPrices = t.qualities.filter((q) => q.available).map((q) => {
    try { return { q, total: calculatePrice(t.pricing, q, t.faceSlots.length).totalKzt }; }
    catch { return { q, total: null }; }
  });

  return (
    <div className="space-y-6 pb-28">
      <Section title={e.sections.basics}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={e.title} className="sm:col-span-2">
            <input className={inputCls} value={t.titleKk} maxLength={120} onChange={(ev) => set("titleKk", ev.target.value)} />
          </Field>
          <Field label={e.description} className="sm:col-span-2">
            <textarea className={`${inputCls} min-h-24`} value={t.descriptionKk} maxLength={1000} onChange={(ev) => set("descriptionKk", ev.target.value)} />
          </Field>
          <Field label={e.category}>
            <select className={inputCls} value={t.categoryId ?? ""} onChange={(ev) => set("categoryId", ev.target.value || null)}>
              <option value="">{e.noCategory}</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </Field>
          <Field label={e.tags}>
            <input
              className={inputCls}
              defaultValue={t.tags.join(", ")}
              onChange={(ev) => set("tags", ev.target.value.split(",").map((x) => x.trim()).filter(Boolean))}
            />
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
          <MediaField kind="cover" label={e.cover} path={t.coverAssetPath} mediaBase={mediaBase} onUploaded={(p) => set("coverAssetPath", p)} />
          <MediaField kind="preview" label={e.previewVideo} path={t.previewVideoPath} mediaBase={mediaBase} onUploaded={(p) => set("previewVideoPath", p)} />
        </div>
      </Section>

      <Section title={e.sections.faces}>
        <p className="mb-4 text-sm text-muted">{e.faceHint}</p>
        <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,320px)]">
          <ol className="space-y-4">
            {t.faceSlots.map((s, i) => (
              <li key={i} className="rounded-xl border border-line p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="font-display font-bold text-brand">{i + 1}</span>
                  <div className="flex gap-1 text-xs">
                    <button type="button" className="rounded-full px-2 py-1 hover:bg-brand-soft disabled:opacity-30" disabled={i === 0} onClick={() => moveSlot(i, -1)}>{e.moveUp}</button>
                    <button type="button" className="rounded-full px-2 py-1 hover:bg-brand-soft disabled:opacity-30" disabled={i === t.faceSlots.length - 1} onClick={() => moveSlot(i, 1)}>{e.moveDown}</button>
                    <button type="button" className="rounded-full px-2 py-1 text-danger hover:bg-red-50 disabled:opacity-30" disabled={t.faceSlots.length === 1} onClick={() => set("faceSlots", t.faceSlots.filter((_, j) => j !== i))}>{e.removeFace}</button>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={e.faceLabel} className="sm:col-span-2">
                    <input className={inputCls} value={s.labelKk} onChange={(ev) => setSlot(i, { labelKk: ev.target.value })} />
                  </Field>
                  <Field label={e.faceKey}>
                    <input className={inputCls} value={s.key} pattern="[a-z0-9_]+" onChange={(ev) => setSlot(i, { key: ev.target.value.toLowerCase() })} />
                  </Field>
                  <Field label={e.faceInput}>
                    <input className={inputCls} value={s.providerInput} onChange={(ev) => setSlot(i, { providerInput: ev.target.value })} />
                  </Field>
                  <Field label={e.posX}>
                    <input type="range" min={0} max={100} className="w-full accent-brand" value={Math.round(s.position.x * 100)} onChange={(ev) => setSlot(i, { position: { ...s.position, x: Number(ev.target.value) / 100 } })} />
                  </Field>
                  <Field label={e.posY}>
                    <input type="range" min={0} max={100} className="w-full accent-brand" value={Math.round(s.position.y * 100)} onChange={(ev) => setSlot(i, { position: { ...s.position, y: Number(ev.target.value) / 100 } })} />
                  </Field>
                </div>
              </li>
            ))}
            <li>
              <button
                type="button"
                disabled={t.faceSlots.length >= 10}
                className="rounded-full border border-dashed border-brand px-4 py-2 text-sm font-semibold text-brand hover:bg-brand-soft disabled:opacity-40"
                onClick={() => {
                  const n = t.faceSlots.length + 1;
                  set("faceSlots", [...t.faceSlots, { key: `face_${n}`, labelKk: `${n}-бет`, position: { x: 0.5, y: 0.4 }, providerInput: `face_${n}`, order: n - 1 }]);
                }}
              >
                + {e.addFace}
              </button>
            </li>
          </ol>
          <div className="lg:sticky lg:top-24 lg:self-start">
            <FaceMap slots={t.faceSlots} />
          </div>
        </div>
      </Section>

      <Section title={e.sections.qualities}>
        <div className="space-y-4">
          {t.qualities.map((q, i) => (
            <div key={i} className="grid gap-3 rounded-xl border border-line p-4 sm:grid-cols-4">
              <Field label={e.qualityLabel}><input className={inputCls} value={q.labelKk} onChange={(ev) => setQuality(i, { labelKk: ev.target.value })} /></Field>
              <Field label={e.qualityKey}><input className={inputCls} value={q.key} onChange={(ev) => setQuality(i, { key: ev.target.value.toLowerCase() })} /></Field>
              <Field label={e.resolution}><input className={inputCls} value={q.resolution ?? ""} onChange={(ev) => setQuality(i, { resolution: ev.target.value || undefined })} /></Field>
              <Field label={e.fps}><Num value={q.fps} min={1} onChange={(v) => setQuality(i, { fps: v })} /></Field>
              <Field label={e.maxDuration}><Num value={q.maxDurationSec} min={1} onChange={(v) => setQuality(i, { maxDurationSec: v })} /></Field>
              <Field label={e.providerQuality}><input className={inputCls} value={q.providerQuality} onChange={(ev) => setQuality(i, { providerQuality: ev.target.value })} /></Field>
              <Field label={e.surcharge}><Num value={q.surchargeKzt} min={0} onChange={(v) => setQuality(i, { surchargeKzt: v ?? 0 })} /></Field>
              <div className="flex items-end justify-between gap-2 pb-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4 accent-brand" checked={q.available} onChange={(ev) => setQuality(i, { available: ev.target.checked })} />
                  {e.available}
                </label>
                <button type="button" className="text-xs text-danger hover:underline disabled:opacity-30" disabled={t.qualities.length === 1} onClick={() => set("qualities", t.qualities.filter((_, j) => j !== i))}>{e.removeQuality}</button>
              </div>
            </div>
          ))}
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
            <Field label={e.basePrice}><Num value={t.pricing.basePriceKzt} min={0} onChange={(v) => setPricing({ basePriceKzt: v ?? 0 })} /></Field>
            <Field label={e.platformFee}><Num value={t.pricing.platformFeeKzt} min={0} onChange={(v) => setPricing({ platformFeeKzt: v ?? 0 })} /></Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" className="h-4 w-4 accent-brand" checked={t.pricing.chargeExtraFaces} onChange={(ev) => setPricing({ chargeExtraFaces: ev.target.checked })} />
              {e.chargeExtra}
            </label>
            {t.pricing.chargeExtraFaces && (
              <>
                <Field label={e.includedFaces}><Num value={t.pricing.includedFaces} min={1} onChange={(v) => setPricing({ includedFaces: v ?? 1 })} /></Field>
                <Field label={e.extraFacePrice}><Num value={t.pricing.extraFacePriceKzt} min={0} onChange={(v) => setPricing({ extraFacePriceKzt: v ?? 0 })} /></Field>
              </>
            )}
            <Field label={e.discount}>
              <select
                className={inputCls}
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
                <Field label={e.discountValue}><Num value={t.pricing.discount.value} min={0} onChange={(v) => setPricing({ discount: { ...t.pricing.discount!, value: v ?? 0 } })} /></Field>
                <Field label={e.discountStarts}>
                  <input type="datetime-local" className={inputCls} value={toLocal(t.pricing.discount.startsAt)} onChange={(ev) => setPricing({ discount: { ...t.pricing.discount!, startsAt: fromLocal(ev.target.value) } })} />
                </Field>
                <Field label={e.discountEnds}>
                  <input type="datetime-local" className={inputCls} value={toLocal(t.pricing.discount.endsAt)} onChange={(ev) => setPricing({ discount: { ...t.pricing.discount!, endsAt: fromLocal(ev.target.value) } })} />
                </Field>
              </>
            )}
            <Field label={e.minPrice}><Num value={t.pricing.minPriceKzt} min={0} onChange={(v) => setPricing({ minPriceKzt: v ?? 0 })} /></Field>
            <Field label={e.maxPrice}><Num value={t.pricing.maxPriceKzt} min={1} onChange={(v) => setPricing({ maxPriceKzt: v })} /></Field>
          </div>
          <div className="rounded-xl bg-brand-soft p-4 lg:self-start">
            <p className="mb-3 text-sm font-semibold">{e.pricePreview}</p>
            <ul className="space-y-2 text-sm">
              {qualityPrices.map(({ q, total }) => (
                <li key={q.key} className="flex justify-between gap-3">
                  <span>{q.labelKk || q.key}</span>
                  <span className="font-display font-semibold">{total === null ? "—" : formatKzt(total)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <Section title={e.sections.provider}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={e.providerKey}>
            <select className={inputCls} value={t.providerKey ?? ""} onChange={(ev) => set("providerKey", ev.target.value || null)}>
              <option value="dev">dev (демо)</option>
            </select>
          </Field>
          <Field label={e.maxUpload}>
            <Num value={Math.round(t.maxUploadBytes / 1024 / 1024)} min={1} onChange={(v) => set("maxUploadBytes", Math.min(10, Math.max(1, v ?? 1)) * 1024 * 1024)} />
          </Field>
          <Field label={e.providerConfig} className="sm:col-span-2">
            <textarea className={`${inputCls} min-h-28 font-mono text-xs`} value={configText} onChange={(ev) => { setConfigText(ev.target.value); setDirty(true); }} />
          </Field>
        </div>
      </Section>

      {/* Sticky action bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1 text-sm" aria-live="polite">
            {msg && (
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
          {id && status !== "published" && status !== "archived" && (
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
  kind, label, path, mediaBase, onUploaded,
}: { kind: "cover" | "preview"; label: string; path: string | null; mediaBase: string; onUploaded: (p: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const url = path ? (/^https?:/.test(path) ? path : `${mediaBase}/${path}`) : null;
  const accept = kind === "cover" ? "image/jpeg,image/png,image/webp" : "video/mp4,video/webm";
  const max = kind === "cover" ? 5 * 1024 * 1024 : 50 * 1024 * 1024;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setErr(null);
    if (!accept.split(",").includes(file.type) || file.size > max) { setErr(e.badFile); return; }
    setBusy(true);
    try {
      const r = await createUploadUrl({ kind, contentType: file.type, size: file.size });
      if (!r.ok) { setErr(e.uploadFailed); return; }
      const { error } = await supabaseBrowser().storage.from("template-media")
        .uploadToSignedUrl(r.path, r.token, file, { contentType: file.type });
      if (error) { setErr(e.uploadFailed); return; }
      onUploaded(r.path);
    } catch {
      setErr(e.uploadFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <span className={labelCls}>{label}</span>
      <div className="relative mx-auto aspect-[9/16] w-40 overflow-hidden rounded-xl border border-dashed border-line bg-paper">
        {url && kind === "cover" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="h-full w-full object-cover" />
        )}
        {url && kind === "preview" && <video src={url} muted loop playsInline autoPlay className="h-full w-full object-cover" />}
      </div>
      <label className="mt-3 flex cursor-pointer justify-center">
        <span className="rounded-full border border-line bg-white px-4 py-2 text-sm font-medium hover:border-ink">
          {busy ? e.uploading : url ? e.replace : e.upload}
        </span>
        <input type="file" accept={accept} className="sr-only" disabled={busy} onChange={(ev) => onFile(ev.target.files?.[0])} />
      </label>
      {err && <p className="mt-2 text-center text-sm text-danger">{err}</p>}
    </div>
  );
}
