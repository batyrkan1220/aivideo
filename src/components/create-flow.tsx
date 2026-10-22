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
import { compressPhoto } from "@/lib/uploads/compress";

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
    setSlot(slot.key, { phase: "uploading", preview, progress: 0 });
    file = await compressPhoto(file, minDimension);
    const dims = await readDimensions(file);
    const localErr: PhotoError | null = validatePhotoMeta({ contentType: file.type, size: file.size, ...dims }, limits);
    if (localErr) { setSlot(slot.key, { phase: "error", preview, message: errText(localErr) }); return; }

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
  const photosRef = useRef<HTMLElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const consentRef = useRef<HTMLLabelElement>(null);
  const [nudge, setNudge] = useState<null | "photo" | "phone" | "consent">(null);
  const blocker = missing > 0 ? "photo" : !phoneOk || (needPhone && !phone) ? "phone" : !consent ? "consent" : null;
  const busyUpload = slots.some((s) => state[s.key].phase === "uploading" || state[s.key].phase === "verifying");

  /** The pay button is always tappable: it points the user to whatever is still missing. */
  const onPay = () => {
    if (pending) return;
    if (blocker === "photo" && !busyUpload) {
      // Open the file picker straight away for the first photo that is still missing.
      const idx = slots.findIndex((s) => state[s.key].phase !== "ready");
      const inputs = photosRef.current?.querySelectorAll<HTMLInputElement>('input[type="file"]');
      inputs?.[Math.max(0, idx)]?.click();
      return;
    }
    if (blocker) {
      setNudge(blocker);
      const el = blocker === "photo" ? photosRef.current : blocker === "phone" ? phoneRef.current : consentRef.current;
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (blocker === "phone") phoneRef.current?.focus({ preventScroll: true });
      setTimeout(() => setNudge(null), 1800);
      return;
    }
    submit();
  };

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

  const gridCols = slots.length === 2 ? "grid-cols-2" : "grid-cols-3";
  let step = 0;
  const hint = blocker === "phone" ? c.needPhone : blocker === "consent" ? c.needConsent : null;

  return (
    <div className="space-y-4">
      {/* Step: photos */}
      <section ref={photosRef} className={`rounded-card border bg-white p-4 transition-shadow sm:p-5 ${nudge === "photo" ? "border-brand ring-4 ring-brand/20" : "border-line"}`}>
        <StepTitle n={++step} done={missing === 0}>{slots.length > 1 ? c.stepPhotos(slots.length) : c.stepPhoto}</StepTitle>
        {slots.length > 1 && <p className="mt-1 text-sm text-muted">{c.photosHint}</p>}
        {slots.length === 1 ? (
          <div className="mt-3">
            <SinglePhoto slot={slots[0]} st={state[slots[0].key]} onPick={(f) => onPick(slots[0], f)} onRemove={() => onRemove(slots[0])} />
          </div>
        ) : (
          <ol className={`mt-3 grid gap-3 ${gridCols} ${slots.length > 3 ? "sm:grid-cols-4" : ""}`}>
            {slots.map((s, i) => (
              <li key={s.key}>
                <SlotCard index={i} slot={s} st={state[s.key]} mediaBase={`${supabaseUrl}/storage/v1/object/public/template-media`} onPick={(f) => onPick(s, f)} onRemove={() => onRemove(s)} />
              </li>
            ))}
          </ol>
        )}
        <ul className="mt-3 grid gap-1 text-xs text-muted sm:grid-cols-3">
          {c.tips.map((tip) => <li key={tip} className="flex gap-1.5"><span className="text-success">✓</span>{tip}</li>)}
        </ul>
      </section>

      {/* Akool templates have one fixed quality, so the picker only appears when there is a real choice. */}
      {available.length > 1 && <section className="rounded-card border border-line bg-white p-4 sm:p-5">
        <StepTitle n={++step} done>{c.qualityTitle}</StepTitle>
        <div role="radiogroup" className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line">
          {available.map((q) => {
            const p = calculatePrice(pricing, q, slots.length).totalKzt;
            const specs = [q.resolution, q.fps ? `${q.fps} ${kk.template.fps}` : null].filter(Boolean).join(", ");
            return (
              <label key={q.key} className="flex cursor-pointer items-center gap-4 px-4 py-3 has-[:checked]:bg-brand-soft">
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

      {/* Step: Kaspi phone */}
      {needPhone && (
        <section className={`rounded-card border bg-white p-4 transition-shadow sm:p-5 ${nudge === "phone" ? "border-brand ring-4 ring-brand/20" : "border-line"}`}>
          <StepTitle n={++step} done={phoneOk && !!phone}>{c.stepPhone}</StepTitle>
          <input
            ref={phoneRef}
            type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
            placeholder={kk.tole.phonePlaceholder} aria-label={kk.tole.phoneLabel}
            className={`mt-3 h-13 w-full rounded-xl border-2 bg-paper px-4 text-lg tracking-wide text-ink outline-none transition-colors focus:border-brand focus:bg-white ${phone && !phoneOk ? "border-danger" : "border-line"}`}
          />
          <p className={`mt-1.5 text-xs ${phone && !phoneOk ? "text-danger" : "text-muted"}`}>
            {phone && !phoneOk ? kk.order.payErrors.phone_invalid : kk.tole.phoneHint}
          </p>
        </section>
      )}

      {/* Step: pay. On phones the total + button stick above the bottom tab bar. */}
      {price && (
        <section className="rounded-card border border-line bg-white p-4 sm:p-5">
          <StepTitle n={++step} done={false}>{c.stepPay}</StepTitle>
          {(price.qualitySurchargeKzt > 0 || price.extraFacesKzt > 0 || price.platformFeeKzt > 0 || price.discountKzt > 0) && (
            <dl className="mt-3 space-y-1.5 text-sm">
              <Row label={kk.pricing.videoPrice} value={formatKzt(price.basePriceKzt)} />
              {price.qualitySurchargeKzt > 0 && <Row label={`${kk.pricing.quality}: ${selected?.labelKk}`} value={`+${formatKzt(price.qualitySurchargeKzt)}`} />}
              {price.extraFacesKzt > 0 && <Row label={`${kk.pricing.extraFaces} (${price.extraFaces})`} value={`+${formatKzt(price.extraFacesKzt)}`} />}
              {price.platformFeeKzt > 0 && <Row label={kk.pricing.platformFee} value={`+${formatKzt(price.platformFeeKzt)}`} />}
              {price.discountKzt > 0 && <Row label={kk.pricing.discount} value={`−${formatKzt(price.discountKzt)}`} />}
            </dl>
          )}
          <label ref={consentRef} className={`mt-3 flex cursor-pointer gap-3 rounded-xl p-3 text-sm transition-colors ${nudge === "consent" ? "bg-flash/30 ring-2 ring-flash" : "bg-paper"}`}>
            <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-brand" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span className="text-muted">{kk.consent.combined}</span>
          </label>
          <p className="mt-3 text-xs text-muted">{c.afterPay}</p>
        </section>
      )}

      {price && (
        <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 -mx-4 border-t border-line bg-white/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:rounded-card sm:border sm:p-4">
          <div className="flex items-center gap-3">
            <div className="min-w-0 shrink-0">
              <p className="text-xs text-muted">{c.total}</p>
              <p className="font-display text-xl font-bold leading-tight">{formatKzt(price.totalKzt)}</p>
            </div>
            <button
              type="button"
              onClick={onPay}
              aria-disabled={!!blocker || pending}
              className={`flex h-13 flex-1 items-center justify-center gap-2 rounded-full px-5 font-semibold transition-all active:scale-[0.98] ${blocker === "photo" ? "bg-ink text-white" : "bg-brand text-white hover:bg-brand-dark"} ${pending || (blocker === "photo" && busyUpload) ? "opacity-70" : ""}`}
            >
              {pending && <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />}
              {pending ? c.paying : blocker === "photo" ? (busyUpload ? kk.upload.uploading : `📷 ${c.pickTitle}`) : c.payNow(formatKzt(price.totalKzt))}
            </button>
          </div>
          <p className="mt-1.5 min-h-4 text-center text-xs text-danger" aria-live="polite">
            {formError ?? (blocker ? <span className="text-muted">{hint}</span> : "")}
          </p>
        </div>
      )}
    </div>
  );
}

function StepTitle({ n, done, children }: { n: number; done: boolean; children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2.5 font-display text-base font-bold sm:text-lg">
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm ${done ? "bg-success text-white" : "bg-brand-soft text-brand"}`}>
        {done ? "✓" : n}
      </span>
      {children}
    </h2>
  );
}

/** One-person templates: a big, thumb-friendly photo picker with live upload state. */
function SinglePhoto({ slot, st, onPick, onRemove }: { slot: FaceSlot; st: SlotState; onPick: (f: File | undefined) => void; onRemove: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = st.phase === "uploading" || st.phase === "verifying";
  const preview = "preview" in st ? st.preview : undefined;
  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        aria-label={`${slot.labelKk}: ${preview ? kk.upload.replace : kk.upload.choose}`}
        className={`flex w-full items-center gap-4 rounded-xl border-2 p-3 text-left transition-colors ${st.phase === "ready" ? "border-success bg-emerald-50" : st.phase === "error" ? "border-danger bg-red-50" : "border-dashed border-brand/40 bg-brand-soft/50 hover:border-brand"}`}
      >
        <span className="relative h-24 w-[4.5rem] shrink-0 overflow-hidden rounded-lg bg-white">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className="h-full w-full object-cover" />
          ) : (
            <svg viewBox="0 0 24 24" className="absolute inset-0 m-auto h-9 w-9 text-brand" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M4 8a2 2 0 0 1 2-2h1.5l1.2-1.8A1 1 0 0 1 9.5 4h5a1 1 0 0 1 .8.4L16.5 6H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" /><circle cx="12" cy="12.5" r="3.5" />
            </svg>
          )}
          {busy && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/35">
              <span className="h-7 w-7 animate-spin rounded-full border-[3px] border-white/40 border-t-white" />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">
            {st.phase === "ready" ? `✓ ${c.photoReady}` : busy ? (st.phase === "uploading" && st.progress > 0 ? `${kk.upload.uploading} ${st.progress}%` : c.verifying) : c.pickTitle}
          </span>
          <span className="mt-0.5 block text-sm text-muted">{st.phase === "ready" ? kk.upload.replace : c.pickText}</span>
          {st.phase === "uploading" && (
            <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-black/10">
              <span className="block h-full rounded-full bg-brand transition-[width]" style={{ width: `${Math.max(8, st.progress)}%` }} />
            </span>
          )}
        </span>
      </button>
      <input ref={inputRef} type="file" accept={PHOTO_TYPES.join(",")} className="sr-only" tabIndex={-1}
        onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = ""; }} />
      {st.phase === "error" && (
        <p className="mt-2 text-sm text-danger" role="alert">
          {st.message} <button type="button" className="ml-1 font-semibold underline" onClick={onRemove}>{kk.upload.remove}</button>
        </p>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
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
