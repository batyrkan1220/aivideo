"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { kk } from "@/lib/i18n/kk";
import { calculatePrice, formatKzt } from "@/lib/pricing";
import { applySeedancePricing, seedanceAutoPriceKzt, type SeedancePricing } from "@/lib/pricing-seedance";
import { slotPreviewSrc, type FaceSlot, type PricingConfig, type Quality } from "@/lib/templates/schema";
import { PHOTO_TYPES, validatePhotoMeta, type PhotoError } from "@/lib/uploads/validate";
import { requestPhotoUpload, confirmPhotoUpload, removePhotoUpload, createOrder } from "@/lib/orders/actions";
import { startCheckout } from "@/lib/payments/actions";
import { normalizeKzPhone } from "@/lib/payments/phone";
import { useSavedPhone, savePhone } from "@/lib/payments/saved-phone";
import { compressPhoto } from "@/lib/uploads/compress";
import type { Framing } from "@/lib/uploads/photo-quality";
import { seedanceSlots, SEEDANCE_MAX_PEOPLE } from "@/lib/templates/seedance-config";
import { haptic } from "@/lib/telegram/client";
import { requestVideoUpload, confirmVideoUpload, removeVideoUpload, type VideoError } from "@/lib/custom-video/actions";

type SlotState =
  | { phase: "empty" }
  | { phase: "uploading"; preview: string; progress: number }
  | { phase: "verifying"; preview: string }
  | { phase: "ready"; preview: string; assetId: string }
  | { phase: "error"; preview?: string; message: string };

const c = kk.create;
const EMPTY: SlotState = { phase: "empty" };
const cv = kk.customVideo;
const videoErr = (e: VideoError, l: { maxSeconds: number; maxMb: number }) =>
  e === "too_long" ? cv.errors.too_long(l.maxSeconds) : e === "too_large" ? cv.errors.too_large(l.maxMb)
  : e === "too_short" ? cv.errors.too_short : e === "bad_type" ? cv.errors.bad_type : e === "unreadable" ? cv.errors.unreadable
  : e === "disabled" ? cv.errors.disabled : e === "rate_limited" ? c.errors.rate_limited : kk.errors.generic;
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

type VideoState =
  | { phase: "empty" }
  | { phase: "uploading"; preview: string; progress: number }
  | { phase: "verifying"; preview: string }
  | { phase: "ready"; preview: string; videoId: string; durationSec: number }
  | { phase: "error"; message: string };

/** Duration from the browser's own decoder (the server re-checks it from the file). */
function readVideoDuration(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    const done = (d: number | null) => { v.removeAttribute("src"); v.load(); resolve(d); };
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? v.duration : null);
    v.onerror = () => done(null);
    setTimeout(() => done(null), 15_000);
    v.src = url;
  });
}

export function CreateFlow({
  templateId, slots: baseSlots, qualities, pricing, maxUploadBytes, minDimension, maxDimension, supabaseUrl, anonKey, askPhone = false, freeOrders = false, customVideo, seedancePricing, allowWish = false, seedanceMode = "wan", media = "video", wishRequired = false,
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
  /** Admin-approved test/gift user: no payment step, the video is made right away. */
  freeOrders?: boolean;
  /** "Өз видеом": the customer uploads their own video first. */
  customVideo?: { maxSeconds: number; maxMb: number };
  /** With customVideo: the price is computed from the uploaded video's length and the quality. */
  seedancePricing?: SeedancePricing;
  /** The customer may write a wish for the AI (background, outfit, style). */
  allowWish?: boolean;
  /** Template mode: face swap only or Seedance scene + face swap (custom-video price). */
  seedanceMode?: "swap" | "scene" | "kling" | "wan" | "pvr" | "k4" | "kd";
  /** What the customer gets: a video or (photo templates) a photo. */
  media?: "video" | "photo";
  /** Create → AI photo: the description is required (it is the whole brief). */
  wishRequired?: boolean;
  /** What photo the template needs (face / waist-up / full body); "auto" = like the person in the video. */
  framing?: Framing;
}) {
  const router = useRouter();
  const [state, setState] = useState<Record<string, SlotState>>(() =>
    Object.fromEntries(baseSlots.map((s) => [s.key, { phase: "empty" } as SlotState])));
  const available = qualities.filter((q) => q.available);
  const [quality, setQuality] = useState(available[0]?.key ?? "");
  const [consent, setConsent] = useState(false);
  const [phone, setPhone] = useSavedPhone();
  const needPhone = askPhone && !freeOrders;
  const phoneOk = !needPhone || !!normalizeKzPhone(phone);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const previews = useRef<string[]>([]);
  const pickSeq = useRef<Record<string, number>>({}); // latest pick per slot (older results are dropped)

  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const setSlot = (key: string, s: SlotState) => setState((prev) => ({ ...prev, [key]: s }));
  const [video, setVideo] = useState<VideoState>({ phase: "empty" });
  const videoRef = useRef<HTMLElement>(null);

  const onPickVideo = async (file: File | undefined) => {
    if (!file || !customVideo) return;
    setFormError(null);
    if (video.phase === "ready") void removeVideoUpload(video.videoId);
    const type = file.type || (/\.mov$/i.test(file.name) ? "video/quicktime" : "video/mp4");
    if (!["video/mp4", "video/quicktime"].includes(type)) { setVideo({ phase: "error", message: cv.errors.bad_type }); return; }
    if (file.size > customVideo.maxMb * 1024 * 1024) { setVideo({ phase: "error", message: cv.errors.too_large(customVideo.maxMb) }); return; }
    const preview = URL.createObjectURL(file);
    previews.current.push(preview);
    setVideo({ phase: "uploading", preview, progress: 0 });
    const durationSec = await readVideoDuration(preview);
    if (durationSec === null) { setVideo({ phase: "error", message: cv.errors.unreadable }); return; }
    if (durationSec > customVideo.maxSeconds + 0.5) { setVideo({ phase: "error", message: cv.errors.too_long(customVideo.maxSeconds) }); return; }
    const req = await requestVideoUpload({ contentType: type, size: file.size, durationSec });
    if (!req.ok) {
      if (req.error === "unauthorized") { router.push("/login?next=/create"); return; }
      setVideo({ phase: "error", message: videoErr(req.error, customVideo) });
      return;
    }
    try {
      const url = `${supabaseUrl}/storage/v1/object/upload/sign/user-videos/${req.path}?token=${encodeURIComponent(req.token)}`;
      await uploadWithProgress(url, new File([file], file.name, { type }), anonKey, (p) => setVideo({ phase: "uploading", preview, progress: p }));
    } catch {
      void removeVideoUpload(req.videoId);
      setVideo({ phase: "error", message: cv.errors.upload_failed });
      return;
    }
    setVideo({ phase: "verifying", preview });
    const conf = await confirmVideoUpload(req.videoId);
    if (!conf.ok) { setVideo({ phase: "error", message: videoErr(conf.error, customVideo) }); return; }
    setVideo({ phase: "ready", preview, videoId: req.videoId, durationSec: conf.durationSec });
  };
  const onRemoveVideo = () => {
    if (video.phase === "ready") void removeVideoUpload(video.videoId);
    setVideo({ phase: "empty" });
  };

  // "Өз видеом": the customer says how many people in their video to replace (photos left → right).
  const readyVideoId = video.phase === "ready" ? video.videoId : null;
  const [peopleCount, setPeopleCount] = useState(1);
  const slots = customVideo ? seedanceSlots(peopleCount, "p_") : baseSlots;
  const [wish, setWish] = useState("");
  const limits = { maxBytes: maxUploadBytes, minDimension, maxDimension };

  const onPick = async (slot: FaceSlot, file: File | undefined) => {
    if (!file) return;
    setFormError(null);
    const prev = state[slot.key] ?? EMPTY;
    if (prev.phase === "ready") void removePhotoUpload(prev.assetId); // replacing: drop the old file

    const preview = URL.createObjectURL(file);
    previews.current.push(preview);
    setSlot(slot.key, { phase: "verifying", preview });
    file = await compressPhoto(file, minDimension);
    const dims = await readDimensions(file);
    const localErr: PhotoError | null = validatePhotoMeta({ contentType: file.type, size: file.size, ...dims }, limits);
    if (localErr) { haptic("error"); setSlot(slot.key, { phase: "error", preview, message: errText(localErr) }); return; }
    const seq = (pickSeq.current[slot.key] ?? 0) + 1;
    pickSeq.current[slot.key] = seq;
    const assetId = await upload(slot, file, preview);
    if (!assetId) return;
    if (pickSeq.current[slot.key] !== seq) { void removePhotoUpload(assetId); return; } // replaced meanwhile
    setSlot(slot.key, { phase: "ready", preview, assetId });
    haptic("success");
  };

  /** Uploads the photo; returns the asset id or null (the slot then shows the error). */
  const upload = async (slot: FaceSlot, file: File, preview: string): Promise<string | null> => {
    setSlot(slot.key, { phase: "uploading", preview, progress: 0 });
    const dims = await readDimensions(file);

    const req = await requestPhotoUpload({ templateId, slotKey: slot.key, contentType: file.type, size: file.size, ...dims });
    if (!req.ok) {
      if (req.error === "unauthorized") { router.push(`/login?next=/templates/${templateId}`); return null; }
      setSlot(slot.key, { phase: "error", preview, message: errText(req.error) });
      return null;
    }
    try {
      const url = `${supabaseUrl}/storage/v1/object/upload/sign/user-uploads/${req.path}?token=${encodeURIComponent(req.token)}`;
      await uploadWithProgress(url, file, anonKey, (p) => setSlot(slot.key, { phase: "uploading", preview, progress: p }));
    } catch {
      void removePhotoUpload(req.assetId);
      setSlot(slot.key, { phase: "error", preview, message: c.errors.upload_failed });
      return null;
    }
    const conf = await confirmPhotoUpload(req.assetId);
    if (!conf.ok) { setSlot(slot.key, { phase: "error", preview, message: errText(conf.error) }); return null; }
    return req.assetId;
  };

  const onRemove = (slot: FaceSlot) => {
    const s = state[slot.key] ?? EMPTY;
    pickSeq.current[slot.key] = (pickSeq.current[slot.key] ?? 0) + 1;
    if (s.phase === "ready") void removePhotoUpload(s.assetId);
    setSlot(slot.key, { phase: "empty" });
  };

  const readyCount = slots.filter((s) => (state[s.key] ?? EMPTY).phase === "ready").length;
  const missing = slots.length - readyCount;
  const faceCount = slots.length;
  const pickPhoto = (slot: FaceSlot, f: File | undefined) => {
    void onPick(slot, f);
  };
  // "Өз видеом": price appears once the video length is known (seconds × credits × tenge).
  const dyn = customVideo && seedancePricing && video.phase === "ready"
    ? applySeedancePricing(pricing, seedanceAutoPriceKzt(video.durationSec, seedancePricing, { mode: seedanceMode, people: slots.length })) : null;
  const waitingForVideo = !!customVideo && !dyn;
  const effPricing = dyn?.pricing ?? pricing;
  const effQualities = (dyn?.qualities ?? qualities).filter((q) => q.available);
  const selected = effQualities.find((q) => q.key === quality) ?? effQualities[0];
  const price = selected && !waitingForVideo ? calculatePrice(effPricing, selected, faceCount) : null;
  const photosRef = useRef<HTMLElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const consentRef = useRef<HTMLLabelElement>(null);
  const [nudge, setNudge] = useState<null | "video" | "photo" | "wish" | "phone" | "consent">(null);
  const wishRef = useRef<HTMLTextAreaElement>(null);
  const videoMissing = !!customVideo && video.phase !== "ready";
  const busyVideo = video.phase === "uploading" || video.phase === "verifying";
  const wishMissing = wishRequired && wish.trim().length < 3;
  const blocker = videoMissing ? "video" : missing > 0 ? "photo" : wishMissing ? "wish" : !phoneOk || (needPhone && !phone) ? "phone" : !consent ? "consent" : null;
  const busyUpload = slots.some((s) => (state[s.key] ?? EMPTY).phase === "uploading" || (state[s.key] ?? EMPTY).phase === "verifying");

  /** The pay button is always tappable: it points the user to whatever is still missing. */
  const onPay = () => {
    if (pending) return;
    haptic(blocker ? "select" : "tap");
    if (blocker === "video") {
      if (!busyVideo) videoRef.current?.querySelector<HTMLInputElement>('input[type="file"]')?.click();
      return;
    }
    if (blocker === "photo" && !busyUpload) {
      // Open the file picker straight away for the first photo that is still missing.
      const idx = slots.findIndex((s) => (state[s.key] ?? EMPTY).phase !== "ready");
      const inputs = photosRef.current?.querySelectorAll<HTMLInputElement>('input[type="file"]');
      inputs?.[Math.max(0, idx)]?.click();
      return;
    }
    if (blocker) {
      setNudge(blocker);
      const el = blocker === "photo" ? photosRef.current as HTMLElement | null : blocker === "wish" ? wishRef.current : blocker === "phone" ? phoneRef.current : consentRef.current;
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (blocker === "phone") phoneRef.current?.focus({ preventScroll: true });
      if (blocker === "wish") wishRef.current?.focus({ preventScroll: true });
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
      const st = state[s.key] ?? EMPTY;
      if (st.phase === "ready") { assets[s.key] = st.assetId; continue; }
      setFormError(c.errors.photos_missing); return;
    }
    if (!Object.keys(assets).length) { setFormError(c.errors.photos_missing); return; }
    if (customVideo && video.phase !== "ready") { setFormError(cv.errors.missing); return; }
    const r = await createOrder({ templateId, quality, assets, consent: true, ...(allowWish && wish.trim() ? { wish: wish.trim() } : {}), ...(customVideo && video.phase === "ready" ? { videoId: video.videoId } : {}) });
    if (!r.ok) {
      if (r.error === "unauthorized") { router.push(customVideo ? "/login?next=/create" : `/login?next=/templates/${templateId}`); return; }
      if (r.error === "video_missing") { setVideo({ phase: "empty" }); setFormError(cv.errors.missing); return; }
      haptic("error");
      setFormError(errText(r.error));
      return;
    }
    if (r.free) { router.push(`/orders/${r.orderId}`); return; }
    // One click: the order is created and payment starts right away (the action redirects to it).
    if (needPhone) savePhone(phone);
    const fd = new FormData();
    fd.set("orderId", r.orderId);
    if (needPhone) fd.set("phone", phone);
    const pay = await startCheckout({}, fd);
    // Only reached when payment could not start: the order is saved, pay from its page.
    router.push(`/orders/${r.orderId}${pay?.error ? `?pay_error=${pay.error}` : ""}`);
  });

  const gridCols = slots.length === 2 ? "grid-cols-2" : "grid-cols-3";
  let step = 0;
  const hint = blocker === "video" ? cv.priceAfterUpload : blocker === "wish" ? c.needWish : blocker === "phone" ? c.needPhone : blocker === "consent" ? c.needConsent : null;

  return (
    <div className="space-y-4">
      {/* Step: the customer's own video */}
      {customVideo && (
        <section ref={videoRef} className={`rounded-card border bg-surface p-4 transition-shadow sm:p-5 ${nudge === "video" ? "border-brand ring-4 ring-brand/20" : "border-line"}`}>
          <StepTitle n={++step} done={video.phase === "ready"}>{cv.stepVideo}</StepTitle>
          <p className="mt-1 text-sm text-muted">{cv.videoHint(customVideo.maxSeconds)}</p>
          <div className="mt-3">
            <VideoPicker st={video} limits={customVideo} onPick={onPickVideo} onRemove={onRemoveVideo} />
          </div>
        </section>
      )}

      {/* Step: photos */}
      <section ref={photosRef} className={`rounded-card border bg-surface p-4 transition-shadow sm:p-5 ${nudge === "photo" ? "border-brand ring-4 ring-brand/20" : "border-line"}`}>
        <StepTitle n={++step} done={missing === 0}>{slots.length > 1 ? c.stepPhotos(slots.length) : c.stepPhoto}</StepTitle>
        {slots.length > 1 && <p className="mt-1 text-sm text-muted">{c.photosHint}</p>}
        {customVideo && readyVideoId && !["kling", "wan", "k4", "kd"].includes(seedanceMode) && (
          <div className="mt-3">
            <p className="text-sm font-medium">{cv.howMany}</p>
            <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label={cv.howMany}>
              {Array.from({ length: SEEDANCE_MAX_PEOPLE }, (_, i) => i + 1).map((n) => (
                <button key={n} type="button" role="radio" aria-checked={peopleCount === n}
                  onClick={() => {
                    // Fewer people: drop the photos of the people no longer replaced.
                    for (const s of seedanceSlots(peopleCount, "p_").slice(n)) onRemove(s);
                    setPeopleCount(n);
                  }}
                  className={`h-10 min-w-10 rounded-full px-3 text-sm font-semibold ${peopleCount === n ? "bg-ink text-paper" : "bg-paper text-ink ring-1 ring-line"}`}>{n}</button>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted">{cv.howManyHint}</p>
          </div>
        )}
        {customVideo && !readyVideoId ? (
          <p className="mt-3 rounded-2xl bg-paper px-4 py-5 text-center text-sm text-muted">{cv.photoAfterVideo}</p>
        ) : slots.length === 1 ? (
          <div className="mt-3">
            <SinglePhoto slot={slots[0]} st={state[slots[0].key] ?? EMPTY} onPick={(f) => pickPhoto(slots[0], f)} onRemove={() => onRemove(slots[0])} />
          </div>
        ) : (
          <ol className={`mt-3 grid gap-3 ${gridCols} ${slots.length > 3 ? "sm:grid-cols-4" : ""}`}>
            {slots.map((s, i) => (
              <li key={s.key}>
                <SlotCard index={i} slot={s} st={state[s.key] ?? EMPTY} mediaBase={`${supabaseUrl}/storage/v1/object/public/template-media`} onPick={(f) => pickPhoto(s, f)} onRemove={() => onRemove(s)} />
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Customer's wish for the AI: background, outfit, style (optional). */}
      {allowWish && (() => {
        const w = wishRequired ? c.photoBrief : c.wish;
        return (
        <section className={`rounded-card border bg-surface p-4 transition-shadow sm:p-5 ${nudge === "wish" ? "border-ink ring-4 ring-brand/60" : "border-line"}`}>
          <StepTitle n={++step} done={!!wish.trim()}>{w.title}</StepTitle>
          <p className="mt-1 text-sm text-muted">{w.hint}</p>
          <textarea ref={wishRef} value={wish} onChange={(e) => setWish(e.target.value.slice(0, 300))} maxLength={300} rows={wishRequired ? 3 : 2}
            placeholder={w.placeholder} aria-label={w.title} required={wishRequired}
            className="mt-3 w-full rounded-2xl border border-line bg-surface px-3 py-2 text-base outline-none focus:border-ink" />
          <div className="mt-2 flex flex-wrap gap-2">
            {w.examples.map((x) => {
              // Tag chips: tap adds the idea to the text; a chosen one shows × and removes it again.
              const parts = wish.split(";").map((p) => p.trim()).filter(Boolean);
              const on = parts.includes(x);
              return (
                <button key={x} type="button" aria-pressed={on}
                  onClick={() => setWish((v) => {
                    const ps = v.split(";").map((p) => p.trim()).filter(Boolean);
                    return (ps.includes(x) ? ps.filter((p) => p !== x) : [...ps, x]).join("; ").slice(0, 300);
                  })}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors active:scale-95 ${on ? "bg-night text-white" : "bg-lavender text-ink"}`}>
                  {on ? <>{x} <span aria-hidden className="text-white/70">✕</span></> : <>+ {x}</>}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-right text-xs text-muted">{wish.length}/300</p>
        </section>
        );
      })()}

      {/* Quality: one tier (720p); the picker only appears when there is a real choice. */}
      {effQualities.length > 1 && <section className="rounded-card border border-line bg-surface p-4 sm:p-5">
        <StepTitle n={++step} done>{c.qualityTitle}</StepTitle>
        <div role="radiogroup" className="mt-3 divide-y divide-line overflow-hidden rounded-2xl border border-line">
          {effQualities.map((q) => {
            const p = waitingForVideo ? null : calculatePrice(effPricing, q, faceCount).totalKzt;
            const specs = [q.resolution && !q.labelKk.includes(q.resolution) ? q.resolution : null, q.fps ? `${q.fps} ${kk.template.fps}` : null].filter(Boolean).join(", ");
            return (
              <label key={q.key} className="flex cursor-pointer items-center gap-4 px-4 py-3 has-[:checked]:bg-brand-soft">
                <input type="radio" name="quality" value={q.key} checked={quality === q.key} onChange={() => setQuality(q.key)} className="h-4 w-4 accent-brand" />
                <span className="flex-1">
                  <span className="block font-medium">{q.labelKk}</span>
                  {specs && <span className="block text-sm text-muted">{specs}</span>}
                </span>
                <span className="font-display font-semibold">{p === null ? "" : formatKzt(p)}</span>
              </label>
            );
          })}
        </div>
      </section>}

      {/* Step: Kaspi phone */}
      {needPhone && (
        <section className={`rounded-card border bg-surface p-4 transition-shadow sm:p-5 ${nudge === "phone" ? "border-brand ring-4 ring-brand/20" : "border-line"}`}>
          <StepTitle n={++step} done={phoneOk && !!phone}>{c.stepPhone}</StepTitle>
          <input
            ref={phoneRef}
            type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
            placeholder={kk.tole.phonePlaceholder} aria-label={kk.tole.phoneLabel}
            className={`mt-3 h-13 w-full rounded-2xl border-2 bg-paper px-4 text-lg tracking-wide text-ink outline-none transition-colors focus:border-brand focus:bg-surface ${phone && !phoneOk ? "border-danger" : "border-line"}`}
          />
          <p className={`mt-1.5 text-xs ${phone && !phoneOk ? "text-danger" : "text-muted"}`}>
            {phone && !phoneOk ? kk.order.payErrors.phone_invalid : kk.tole.phoneHint}
          </p>
        </section>
      )}

      {/* Price breakdown only when there is more than one line; the total and pay button stick at the bottom. */}
      {price && (price.extraFacesKzt > 0 || price.platformFeeKzt > 0 || price.discountKzt > 0) && (
        <section className="rounded-card border border-line bg-surface p-4 sm:p-5">
            <dl className="space-y-1.5 text-sm">
              <Row label={`${kk.pricing.videoPrice}${selected ? ` · ${selected.labelKk}` : ""}`} value={formatKzt(price.basePriceKzt + price.qualitySurchargeKzt)} />
              {price.extraFacesKzt > 0 && <Row label={`${kk.pricing.extraFaces} (${price.extraFaces})`} value={`+${formatKzt(price.extraFacesKzt)}`} />}
              {price.platformFeeKzt > 0 && <Row label={kk.pricing.platformFee} value={`+${formatKzt(price.platformFeeKzt)}`} />}
              {price.discountKzt > 0 && <Row label={kk.pricing.discount} value={`−${formatKzt(price.discountKzt)}`} />}
            </dl>
        </section>
      )}

      {(price || waitingForVideo) && (
        <div className="sticky bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-20 -mx-1 rounded-[1.5rem] border border-black/5 px-4 pb-2 pt-2.5 shadow-[0_14px_36px_-14px_rgba(0,0,0,0.25)] glass sm:static sm:mx-0 sm:rounded-card sm:p-4">
          <label ref={consentRef} className={`-mx-1 mb-2 flex cursor-pointer items-start gap-2.5 rounded-lg px-1 py-1 text-xs leading-snug transition-colors ${nudge === "consent" ? "bg-flash/40 ring-2 ring-flash" : ""}`}>
            <input type="checkbox" className="mt-px h-[18px] w-[18px] shrink-0 accent-brand" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span className="text-muted">{customVideo ? cv.consent : kk.consent.combined}</span>
          </label>
          <div className="flex items-center gap-3">
            <div className="min-w-0 shrink-0">
              <p className="text-xs text-muted">{c.total}</p>
              <p className="font-display text-xl font-bold leading-tight">{price ? formatKzt(price.totalKzt) : "—"}</p>
            </div>
            <button
              type="button"
              onClick={onPay}
              aria-disabled={!!blocker || pending}
              className={`flex h-13 flex-1 items-center justify-center gap-2 rounded-full px-5 font-semibold transition-all active:scale-[0.98] ${blocker === "photo" || blocker === "video" ? "bg-ink text-paper" : "btn-glow text-white"} ${pending || (blocker === "photo" && busyUpload) || (blocker === "video" && busyVideo) ? "opacity-70" : ""}`}
            >
              {pending && <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />}
              {pending ? (freeOrders ? c.creating : c.paying)
                : blocker === "video" ? (busyVideo ? kk.upload.uploading : `🎬 ${cv.pickTitle}`)
                : blocker === "photo" ? (busyUpload ? kk.upload.uploading : `📷 ${c.pickTitle}`)
                : freeOrders ? c.freeNow : price ? c.payNow(formatKzt(price.totalKzt)) : c.confirm}
            </button>
          </div>
          <p className="mt-1 min-h-4 text-center text-xs text-danger" aria-live="polite">
            {formError ?? (blocker && blocker !== "consent" ? <span className="text-muted">{hint}</span> : !blocker ? <span className="text-muted">{media === "photo" ? kk.photos.afterPayShort : c.afterPayShort}</span> : "")}
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

/** "Өз видеом": pick a video, see it immediately, upload with progress. */
function VideoPicker({ st, limits, onPick, onRemove }: { st: VideoState; limits: { maxSeconds: number; maxMb: number }; onPick: (f: File | undefined) => void; onRemove: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = st.phase === "uploading" || st.phase === "verifying";
  const preview = "preview" in st ? st.preview : undefined;
  return (
    <div>
      {preview ? (
        <div className="flex items-start gap-4">
          <div className="relative aspect-[9/16] w-32 shrink-0 overflow-hidden rounded-2xl bg-night">
            <video src={preview} muted loop playsInline autoPlay className="h-full w-full object-cover" />
            {busy && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/40">
                <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-white/40 border-t-white" />
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1 pt-1">
            <p className="font-semibold">
              {st.phase === "ready" ? `✓ ${cv.videoReady}` : st.phase === "uploading" && st.progress > 0 ? `${kk.upload.uploading} ${st.progress}%` : c.verifying}
            </p>
            {st.phase === "ready" && <p className="mt-0.5 text-sm text-muted">{cv.seconds(Math.round(st.durationSec))}</p>}
            {st.phase === "uploading" && (
              <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-black/10">
                <span className="block h-full rounded-full bg-brand transition-[width]" style={{ width: `${Math.max(6, st.progress)}%` }} />
              </span>
            )}
            {!busy && (
              <div className="mt-3 flex gap-4 text-sm">
                <button type="button" className="font-semibold text-brand hover:underline" onClick={() => inputRef.current?.click()}>{kk.upload.replace}</button>
                <button type="button" className="text-muted hover:text-danger" onClick={onRemove}>{kk.upload.remove}</button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={`flex w-full items-center gap-4 rounded-2xl border-2 border-dashed p-4 text-left transition-colors hover:border-brand ${st.phase === "error" ? "border-danger bg-danger/10" : "border-brand/40 bg-brand-soft/50"}`}
        >
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-surface text-brand">
            <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="5" width="13" height="14" rx="2" /><path d="m16 10 5-3v10l-5-3" />
            </svg>
          </span>
          <span className="min-w-0">
            <span className="block font-semibold">{cv.pickTitle}</span>
            <span className="mt-0.5 block text-sm text-muted">{cv.pickText(limits.maxSeconds, limits.maxMb)}</span>
          </span>
        </button>
      )}
      <input ref={inputRef} type="file" accept="video/mp4,video/quicktime,.mp4,.mov" className="sr-only" tabIndex={-1}
        onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = ""; }} />
      {st.phase === "error" && <p className="mt-2 text-sm text-danger" role="alert">{st.message}</p>}
    </div>
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
        className={`flex w-full items-center gap-4 rounded-2xl border-2 p-3 text-left transition-[colors,transform] active:scale-[0.99] ${st.phase === "ready" ? "border-success bg-success/10" : st.phase === "error" ? "border-danger bg-danger/10" : "border-dashed border-brand/50 bg-brand-soft/60 hover:border-brand"}`}
      >
        <span className="relative h-32 w-24 shrink-0 overflow-hidden rounded-2xl bg-surface shadow-sm">
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
          <span className="block text-lg font-bold leading-tight">
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
        // Which person in the video this photo replaces (when the slot has a preview).
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
        className={`relative flex aspect-[3/4] w-full flex-col items-center justify-center overflow-hidden rounded-card border-2 bg-surface text-center transition-colors hover:border-brand ${border}`}
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
          <span className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-xs font-semibold ${st.phase === "ready" ? "bg-success text-white" : "bg-white/90 text-night"}`}>
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
