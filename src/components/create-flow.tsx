"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { kk } from "@/lib/i18n/kk";
import { calculatePrice, formatKzt } from "@/lib/pricing";
import { slotPreviewSrc, type FaceSlot, type PricingConfig, type Quality } from "@/lib/templates/schema";
import { PHOTO_TYPES, validatePhotoMeta, type PhotoError } from "@/lib/uploads/validate";
import { requestPhotoUpload, confirmPhotoUpload, removePhotoUpload, createOrder } from "@/lib/orders/actions";
import { startCheckout } from "@/lib/payments/actions";
import { normalizeKzPhone } from "@/lib/payments/phone";
import { useSavedPhone, savePhone } from "@/lib/payments/saved-phone";

type SlotState =
  | { phase: "empty" }
  | { phase: "uploading"; preview: string; progress: number }
  | { phase: "verifying"; preview: string }
  | { phase: "ready"; preview: string; assetId: string }
  | { phase: "error"; preview?: string; message: string };

const c = kk.create;
const errText = (e: string) => (c.errors as Record<string, string>)[e] ?? kk.errors.generic;

/** Reads real pixel dimensions in the browser (also proves the file is a decodable image). */
async function readDimensions(file: File): Promise<{ width: number; height: number } | null> {
  try {
    const bmp = await createImageBitmap(file);
    const d = { width: bmp.width, height: bmp.height };
    bmp.close();
    return d;
  } catch {
    return null;
  }
}

/** PUT to the signed upload URL with real progress events. */
function uploadWithProgress(url: string, file: File, anonKey: string, onProgress: (p: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("apikey", anonKey);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (ev) => ev.lengthComputable && onProgress(Math.round((ev.loaded / ev.total) * 100));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(String(xhr.status))));
    xhr.onerror = () => reject(new Error("network"));
    const fd = new FormData();
    fd.append("cacheControl", "3600");
    fd.append("", file);
    xhr.send(fd);
  });
}

export function CreateFlow({
  templateId, slots, qualities, pricing, maxUploadBytes, minDimension, maxDimension, supabaseUrl, anonKey, askPhone = false,
}: {
  templateId: string;
  slots: FaceSlot[];
  qualities: Quality[];
  pricing: PricingConfig;
  maxUploadBytes: number;
  minDimension: number;
  maxDimension: number;
  supabaseUrl: string;
  anonKey: string;
  /** Kaspi invoice payments need the customer's Kaspi phone number. */
  askPhone?: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<Record<string, SlotState>>(() =>
    Object.fromEntries(slots.map((s) => [s.key, { phase: "empty" } as SlotState])));
  const available = qualities.filter((q) => q.available);
  const [quality, setQuality] = useState(available[0]?.key ?? "");
  const [consent, setConsent] = useState(false);
  const [phone, setPhone] = useSavedPhone();
  const needPhone = askPhone;
  const phoneOk = !needPhone || !!normalizeKzPhone(phone);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const previews = useRef<string[]>([]);

  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const setSlot = (key: string, s: SlotState) => setState((prev) => ({ ...prev, [key]: s }));
  const limits = { maxBytes: maxUploadBytes, minDimension, maxDimension };

  const onPick = async (slot: FaceSlot, file: File | undefined) => {
    if (!file) return;
    setFormError(null);
    const prev = state[slot.key];
    if (prev.phase === "ready") void removePhotoUpload(prev.assetId); // replacing: drop the old file

    const preview = URL.createObjectURL(file);
    previews.current.push(preview);
    const dims = await readDimensions(file);
    const localErr: PhotoError | null = validatePhotoMeta({ contentType: file.type, size: file.size, ...dims }, limits);
    if (localErr) { setSlot(slot.key, { phase: "error", preview, message: errText(localErr) }); return; }

    setSlot(slot.key, { phase: "uploading", preview, progress: 0 });
    const req = await requestPhotoUpload({ templateId, slotKey: slot.key, contentType: file.type, size: file.size, ...dims });
    if (!req.ok) {
      if (req.error === "unauthorized") { router.push(`/login?next=/templates/${templateId}`); return; }
      setSlot(slot.key, { phase: "error", preview, message: errText(req.error) });
      return;
    }
    try {
      const url = `${supabaseUrl}/storage/v1/object/upload/sign/user-uploads/${req.path}?token=${encodeURIComponent(req.token)}`;
      await uploadWithProgress(url, file, anonKey, (p) => setSlot(slot.key, { phase: "uploading", preview, progress: p }));
    } catch {
      void removePhotoUpload(req.assetId);
      setSlot(slot.key, { phase: "error", preview, message: c.errors.upload_failed });
      return;
    }
    setSlot(slot.key, { phase: "verifying", preview });
    const conf = await confirmPhotoUpload(req.assetId);
    if (!conf.ok) { setSlot(slot.key, { phase: "error", preview, message: errText(conf.error) }); return; }
    setSlot(slot.key, { phase: "ready", preview, assetId: req.assetId });
  };

  const onRemove = (slot: FaceSlot) => {
    const s = state[slot.key];
    if (s.phase === "ready") void removePhotoUpload(s.assetId);
    setSlot(slot.key, { phase: "empty" });
  };

  const readyCount = slots.filter((s) => state[s.key].phase === "ready").length;
  const missing = slots.length - readyCount;
  const selected = available.find((q) => q.key === quality);
  const price = selected ? calculatePrice(pricing, selected, slots.length) : null;
  const canSubmit = missing === 0 && !!selected && consent && phoneOk && !pending;

  const submit = () => start(async () => {
    setFormError(null);
    if (!consent) { setFormError(c.errors.consent_required); return; }
    if (!phoneOk) { setFormError(kk.order.payErrors.phone_invalid); return; }
    const assets: Record<string, string> = {};
    for (const s of slots) {
      const st = state[s.key];
      if (st.phase !== "ready") { setFormError(c.errors.photos_missing); return; }
      assets[s.key] = st.assetId;
    }
    const r = await createOrder({ templateId, quality, assets, consent: true });
    if (!r.ok) {
      if (r.error === "unauthorized") { router.push(`/login?next=/templates/${templateId}`); return; }
      setFormError(errText(r.error));
      return;
    }
    // One click: the order is created and payment starts right away (the action redirects to it).
    if (askPhone) savePhone(phone);
    const fd = new FormData();
    fd.set("orderId", r.orderId);
    if (askPhone) fd.set("phone", phone);
    const pay = await startCheckout({}, fd);
    // Only reached when payment could not start: the order is saved, pay from its page.
    router.push(`/orders/${r.orderId}${pay?.error ? `?pay_error=${pay.error}` : ""}`);
  });

  const gridCols = slots.length === 1 ? "grid-cols-1 max-w-[220px]" : slots.length === 2 ? "grid-cols-2" : "grid-cols-3";

  return (
    <div className="space-y-8">
      <section>
        <h2 className="font-display text-lg font-bold">{c.photosTitle}</h2>
        <p className="mt-1 text-sm text-muted">
          {slots.length > 1 ? `${c.multiHint(slots.length)} ${c.photosHint}` : kk.upload.faceHint}
        </p>
        {/* Slots are laid out left → right, in the same order as people in the video. */}
        <ol className={`mt-4 grid gap-3 ${gridCols} ${slots.length > 3 ? "sm:grid-cols-4" : ""}`}>
          {slots.map((s, i) => (
            <li key={s.key}>
              <SlotCard index={i} slot={s} st={state[s.key]} mediaBase={`${supabaseUrl}/storage/v1/object/public/template-media`} onPick={(f) => onPick(s, f)} onRemove={() => onRemove(s)} />
            </li>
          ))}
        </ol>
        <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
          {c.tips.map((tip) => <li key={tip}>✓ {tip}</li>)}
        </ul>
      </section>

      {/* Akool templates have one fixed quality, so the picker only appears when there is a real choice. */}
      {available.length > 1 && <section>
        <h2 className="font-display text-lg font-bold">{c.qualityTitle}</h2>
        <div role="radiogroup" className="mt-3 divide-y divide-line rounded-card border border-line bg-white">
          {available.map((q) => {
            const p = calculatePrice(pricing, q, slots.length).totalKzt;
            const specs = [q.resolution, q.fps ? `${q.fps} ${kk.template.fps}` : null].filter(Boolean).join(", ");
            return (
              <label key={q.key} className="flex cursor-pointer items-center gap-4 px-5 py-4 has-[:checked]:bg-brand-soft">
                <input type="radio" name="quality" value={q.key} checked={quality === q.key} onChange={() => setQuality(q.key)} className="h-4 w-4 accent-brand" />
                <span className="flex-1">
                  <span className="block font-medium">{q.labelKk}</span>
                  {specs && <span className="block text-sm text-muted">{specs}</span>}
                </span>
                <span className="font-display font-semibold">{formatKzt(p)}</span>
              </label>
            );
          })}
        </div>
      </section>}

      {price && (
        <section className="rounded-card bg-ink p-5 text-white sm:p-6">
          <h2 className="font-display text-lg font-bold">{c.summaryTitle}</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <Row label={kk.pricing.videoPrice} value={formatKzt(price.basePriceKzt)} />
            {price.qualitySurchargeKzt > 0 && <Row label={`${kk.pricing.quality}: ${selected?.labelKk}`} value={`+${formatKzt(price.qualitySurchargeKzt)}`} />}
            {price.extraFacesKzt > 0 && <Row label={`${kk.pricing.extraFaces} (${price.extraFaces})`} value={`+${formatKzt(price.extraFacesKzt)}`} />}
            {price.platformFeeKzt > 0 && <Row label={kk.pricing.platformFee} value={`+${formatKzt(price.platformFeeKzt)}`} />}
            {price.discountKzt > 0 && <Row label={kk.pricing.discount} value={`−${formatKzt(price.discountKzt)}`} />}
            <div className="flex items-baseline justify-between border-t border-white/20 pt-3">
              <dt className="font-semibold">{kk.pricing.total}</dt>
              <dd className="font-display text-2xl font-bold">{formatKzt(price.totalKzt)}</dd>
            </div>
          </dl>

          <div className="mt-5 space-y-3 text-sm text-white/85">
            {needPhone && (
              <label className="block">
                <span className="mb-1 block font-medium text-white">{kk.tole.phoneLabel}</span>
                <input
                  type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                  placeholder={kk.tole.phonePlaceholder}
                  className={`h-12 w-full rounded-xl border bg-white px-4 text-base text-ink outline-none ${phone && !phoneOk ? "border-danger" : "border-transparent"}`}
                />
                <span className="mt-1 block text-xs text-white/70">{kk.tole.phoneHint}</span>
              </label>
            )}
            <label className="flex gap-3">
              <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-flash" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>{kk.consent.combined}</span>
            </label>
          </div>

          <p className="mt-4 min-h-5 text-sm text-flash" aria-live="polite">
            {formError ?? (missing > 0 ? c.missingPhotos(missing) : "")}
          </p>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="mt-2 h-13 w-full rounded-full bg-flash px-7 font-semibold text-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending ? c.paying : price ? c.payNow(formatKzt(price.totalKzt)) : c.confirm}
          </button>
        </section>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-white/75">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function SlotCard({
  index, slot, st, mediaBase, onPick, onRemove,
}: { index: number; slot: FaceSlot; st: SlotState; mediaBase: string; onPick: (f: File | undefined) => void; onRemove: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = st.phase === "uploading" || st.phase === "verifying";
  const preview = "preview" in st ? st.preview : undefined;
  const border =
    st.phase === "ready" ? "border-success" : st.phase === "error" ? "border-danger" : "border-line border-dashed";

  return (
    <div>
      {slot.previewImagePath && (
        // Akool: which person in the video this photo replaces.
        <div className="mb-2 flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={slotPreviewSrc(slot.previewImagePath, mediaBase)!} alt={kk.upload.personInVideo(index + 1)} className="h-12 w-10 rounded-lg border border-line object-cover" />
          <span className="text-xs leading-tight text-muted">{kk.upload.replacesPerson}</span>
        </div>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        aria-label={`${slot.labelKk}: ${preview ? kk.upload.replace : kk.upload.choose}`}
        className={`relative flex aspect-[3/4] w-full flex-col items-center justify-center overflow-hidden rounded-card border-2 bg-white text-center transition-colors hover:border-brand ${border}`}
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <>
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft font-display text-lg font-bold text-brand">
              {index + 1}
            </span>
            <span className="mt-2 px-2 text-xs font-medium text-muted">{kk.upload.choose}</span>
          </>
        )}
        {st.phase === "uploading" && (
          <span className="absolute inset-x-0 bottom-0 h-1.5 bg-black/20">
            <span className="block h-full bg-brand transition-[width]" style={{ width: `${st.progress}%` }} />
          </span>
        )}
        {(st.phase === "uploading" || st.phase === "verifying" || st.phase === "ready") && (
          <span className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-xs font-semibold ${st.phase === "ready" ? "bg-success text-white" : "bg-white/90 text-ink"}`}>
            {st.phase === "uploading" ? `${st.progress}%` : st.phase === "verifying" ? c.verifying : `✓ ${c.ready}`}
          </span>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={PHOTO_TYPES.join(",")}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = ""; }}
      />
      <p className="mt-2 text-sm font-medium leading-tight">{slot.labelKk}</p>
      {st.phase === "error" && <p className="mt-1 text-xs text-danger" role="alert">{st.message}</p>}
      {(st.phase === "ready" || st.phase === "error") && (
        <div className="mt-1 flex gap-3 text-xs">
          <button type="button" className="font-semibold text-brand hover:underline" onClick={() => inputRef.current?.click()}>{kk.upload.replace}</button>
          <button type="button" className="text-muted hover:text-danger" onClick={onRemove}>{kk.upload.remove}</button>
        </div>
      )}
    </div>
  );
}
