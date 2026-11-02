"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { kk } from "@/lib/i18n/kk";
import { calculatePrice, formatKzt } from "@/lib/pricing";
import { applySeedancePricing, seedanceAutoPriceKzt, type SeedancePricing } from "@/lib/pricing-seedance";
import { slotPreviewSrc, type FaceSlot, type PricingConfig, type Quality } from "@/lib/templates/schema";
import { PHOTO_TYPES, validatePhotoMeta, type PhotoError } from "@/lib/uploads/validate";
import { requestPhotoUpload, confirmPhotoUpload, removePhotoUpload, createOrder, reusePhoto } from "@/lib/orders/actions";
import { startCheckout } from "@/lib/payments/actions";
import { normalizeKzPhone } from "@/lib/payments/phone";
import { useSavedPhone, savePhone } from "@/lib/payments/saved-phone";
import { compressPhoto } from "@/lib/uploads/compress";
import type { Framing } from "@/lib/uploads/photo-quality";
import { PhotoTips } from "./photo-tips";
import { KzPhoneInput } from "./kz-phone-input";
import { seedanceSlots, SEEDANCE_MAX_PEOPLE, SEEDANCE_MIN_SEC as MIN_VIDEO_SECONDS } from "@/lib/templates/seedance-config";
import { haptic, ensureBotCanWrite } from "@/lib/telegram/client";
import { requestVideoUpload, confirmVideoUpload, removeVideoUpload, type VideoError } from "@/lib/custom-video/actions";
import { aspectAllowed, nearestOutputAspect } from "@/lib/custom-video/aspect";
import { ensureGuestSession } from "@/lib/auth/guest";
import { discounted } from "@/lib/engage/price";
import { pixelEvent, pixelEventOnce } from "@/lib/pixels/client";
import { TelegramBotLogin } from "./telegram-bot-login";


type SlotState =
  | { phase: "empty" }
  | { phase: "uploading"; preview: string; progress: number }
  | { phase: "verifying"; preview: string }
  | { phase: "ready"; preview: string; assetId: string }
  | { phase: "error"; preview?: string; message: string };

const c = kk.create;
/** true: guests confirm with Telegram before paying; false: after (on the order page). */
const TELEGRAM_BEFORE_PAY = false;
const EMPTY: SlotState = { phase: "empty" };
const cv = kk.customVideo;
const videoErr = (e: VideoError, l: { maxSeconds: number; maxMb: number }) =>
  e === "too_long" ? cv.errors.too_long(l.maxSeconds) : e === "too_large" ? cv.errors.too_large(l.maxMb)
  : e === "too_short" ? cv.errors.too_short : e === "bad_aspect" ? cv.errors.bad_aspect : e === "bad_type" ? cv.errors.bad_type : e === "unreadable" ? cv.errors.unreadable
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
  | { phase: "ready"; preview: string; videoId: string; durationSec: number; aspect: number | null }
  | { phase: "error"; message: string };

/** Duration and shape from the browser's own decoder (the server re-checks both from the file). */
function readVideoMeta(url: string): Promise<{ durationSec: number; aspect: number | null } | null> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    let settled = false;
    const done = (d: { durationSec: number; aspect: number | null } | null) => { if (settled) return; settled = true; v.removeAttribute("src"); v.load(); resolve(d); };
    v.onloadedmetadata = () => done(Number.isFinite(v.duration)
      ? { durationSec: v.duration, aspect: v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : null } : null);
    v.onerror = () => done(null);
    setTimeout(() => done(null), 15_000);
    v.src = url;
  });
}

export function CreateFlow({
  templateId, slots: baseSlots, qualities, pricing, maxUploadBytes, minDimension, maxDimension, supabaseUrl, anonKey, askPhone = false, freeOrders = false, signedIn = true, needTelegram = false, noTabBar = false, discount = null, savedPhotos = [], item, customVideo, seedancePricing, allowWish = false, seedanceMode = "wan", media = "video", wishRequired = false, outfit = "photo",
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
  /** false: a visitor (e.g. from an ad) — the first upload quietly creates a guest account. */
  signedIn?: boolean;
  /** Guest or visitor: before paying, a one-tap Telegram confirmation (the account + where the video is sent). */
  needTelegram?: boolean;
  /** Ad landing: no bottom tab bar, so the pay bar sits at the very bottom. */
  noTabBar?: boolean;
  /** Personal discount (e.g. "second video −20%"); the server applies it again when ordering. */
  discount?: { percent: number; expiresAt: string } | null;
  /** The customer's earlier photos still kept: one tap fills a slot ("another video with this photo"). */
  savedPhotos?: { assetId: string; url: string }[];
  /** For ad pixels: what this form sells (template id, name, starting price). */
  item?: { id: string; name: string; price: number };
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
  /** Video templates: clothing rule; "choice" = the customer picks (default: as in the template). */
  outfit?: "photo" | "template" | "choice";
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
  const [needWrite, setNeedWrite] = useState(false);
  const [pending, start] = useTransition();
  const previews = useRef<string[]>([]);
  const pickSeq = useRef<Record<string, number>>({}); // latest pick per slot (older results are dropped)

  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const setSlot = (key: string, s: SlotState) => setState((prev) => ({ ...prev, [key]: s }));
  // Visitors: one guest account for this page (created on the first upload, shared by all slots).
  const session = useRef<Promise<boolean> | null>(signedIn ? Promise.resolve(true) : null);
  const ensureSession = () => (session.current ??= ensureGuestSession().then((r) => r.ok, () => false)
    .then((ok) => { if (!ok) session.current = null; return ok; }));
  // Guest at payment: the order is saved, then Telegram confirms who it is for.
  const [tgOrder, setTgOrder] = useState<string | null>(null);
  const [needTg, setNeedTg] = useState(needTelegram);
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
    // Checked before uploading, so nothing is sent that Kling would refuse later.
    const meta = await readVideoMeta(preview);
    if (meta === null) { setVideo({ phase: "error", message: cv.errors.unreadable }); return; }
    const { durationSec, aspect } = meta;
    if (durationSec > customVideo.maxSeconds + 0.5) { setVideo({ phase: "error", message: cv.errors.too_long(customVideo.maxSeconds) }); return; }
    if (durationSec < MIN_VIDEO_SECONDS) { setVideo({ phase: "error", message: cv.errors.too_short }); return; }
    if (aspect && !aspectAllowed(aspect)) { setVideo({ phase: "error", message: cv.errors.bad_aspect }); return; }
    if (!(await ensureSession())) { setVideo({ phase: "error", message: kk.errors.generic }); return; }
    const req = await requestVideoUpload({ contentType: type, size: file.size, durationSec, ...(aspect ? { aspect } : {}) });
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
    setVideo({ phase: "ready", preview, videoId: req.videoId, durationSec: conf.durationSec, aspect: conf.aspect ?? aspect });
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
  const [outfitPick, setOutfitPick] = useState<"template" | "photo">("template");
  const effOutfit = outfit === "choice" ? outfitPick : outfit;
  // Create → AI photo: the first photo is the customer's own example, the next one is their face.
  const refPhoto = media === "photo" && baseSlots.some((s) => s.providerInput === "example");
  // Optional prompt stays folded; a checkbox opens it (a required one, for AI photos, is always open).
  const [promptOn, setPromptOn] = useState(false);
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
    if (!(await ensureSession())) { setSlot(slot.key, { phase: "error", preview, message: kk.errors.generic }); return; }
    const assetId = await upload(slot, file, preview);
    if (!assetId) return;
    if (pickSeq.current[slot.key] !== seq) { void removePhotoUpload(assetId); return; } // replaced meanwhile
    setSlot(slot.key, { phase: "ready", preview, assetId });
    haptic("success");
    if (item) pixelEventOnce(`add.${templateId}.${assetId}`, { type: "add", item });
  };

  /** "Use this photo again": fills the first empty slot with a copy of an earlier photo. */
  const onReuse = async (sp: { assetId: string; url: string }) => {
    const slot = slots.find((x) => (state[x.key] ?? EMPTY).phase !== "ready") ?? slots[0];
    if (!slot) return;
    setFormError(null);
    setSlot(slot.key, { phase: "verifying", preview: sp.url });
    const r = await reusePhoto({ templateId, slotKey: slot.key, sourceAssetId: sp.assetId });
    if (!r.ok) { haptic("error"); setSlot(slot.key, { phase: "error", preview: sp.url, message: errText(r.error) }); return; }
    setSlot(slot.key, { phase: "ready", preview: sp.url, assetId: r.assetId });
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
  const disc = discount && price && price.totalKzt > 0 && !freeOrders ? discount.percent : 0; // only active ones are passed in
  const finalKzt = price ? (disc ? discounted(price.totalKzt, disc) : price.totalKzt) : null;
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
    // Mini App: the bot must be allowed to send the finished video — no permission, no order.
    if (!(await ensureBotCanWrite())) { haptic("error"); setNeedWrite(true); return; }
    const r = await createOrder({ templateId, quality, assets, consent: true, ...(allowWish && wish.trim() ? { wish: wish.trim() } : {}), ...(outfit === "choice" ? { outfit: outfitPick } : {}), ...(customVideo && video.phase === "ready" ? { videoId: video.videoId } : {}) });
    if (!r.ok) {
      if (r.error === "unauthorized") { router.push(customVideo ? "/login?next=/create" : `/login?next=/templates/${templateId}`); return; }
      if (r.error === "video_missing") { setVideo({ phase: "empty" }); setFormError(cv.errors.missing); return; }
      haptic("error");
      setFormError(errText(r.error));
      return;
    }
    if (needPhone) savePhone(phone);
    if (item) pixelEvent({ type: "checkout", item, orderId: r.orderId, value: finalKzt ?? item.price });
    // Guests pay right away; the finished video opens after a Telegram sign-in (order page).
    if (needTg && TELEGRAM_BEFORE_PAY) { setTgOrder(r.orderId); return; }
    if (r.free) { router.push(`/orders/${r.orderId}`); return; }
    await pay(r.orderId);
  });

  // One click: payment starts right away (the action redirects to it).
  const pay = async (orderId: string) => {
    const fd = new FormData();
    fd.set("orderId", orderId);
    if (needPhone) fd.set("phone", phone);
    const res = await startCheckout({}, fd);
    // Only reached when payment could not start: the order is saved, pay from its page.
    router.push(`/orders/${orderId}${res?.error ? `?pay_error=${res.error}` : ""}`);
  };
  const afterTelegram = (orderId: string) => start(async () => {
    setNeedTg(false);
    await pay(orderId);
  });

  const gridCols = slots.length === 2 ? "grid-cols-2" : "grid-cols-3";
  let step = 0;
  const hint = blocker === "video" ? cv.priceAfterUpload : blocker === "wish" ? c.needWish : blocker === "phone" ? c.needPhone : blocker === "consent" ? c.needConsent : null;

  return (
    <div className="space-y-4">
      {/* Personal offer, e.g. after the first video: "−20% until tomorrow 16:20". */}
      {disc > 0 && discount && (
        <div className="flex items-center gap-3 rounded-[20px] bg-night px-4 py-3 text-white">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-lg text-night" aria-hidden>🎁</span>
          <span className="min-w-0 text-sm">
            <span className="block font-extrabold">{c.discountTitle(disc)}</span>
            <span className="block text-white/70">{c.discountUntil(new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Almaty" }).format(new Date(discount.expiresAt)))}</span>
          </span>
        </div>
      )}
      {/* Visitor at payment: one tap in Telegram confirms the account (and where the video will be sent). */}
      {tgOrder && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 sm:items-center" role="dialog" aria-modal aria-label={c.tgConfirm.title}>
          <div className="w-full max-w-md rounded-t-[28px] bg-surface p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-2xl sm:rounded-[28px]">
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line sm:hidden" />
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-extrabold tracking-tight">{c.tgConfirm.title}</h2>
                <p className="mt-1 text-sm text-muted">{c.tgConfirm.text}</p>
              </div>
              <button type="button" onClick={() => setTgOrder(null)} aria-label={kk.common.close} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-paper text-muted">✕</button>
            </div>
            <ul className="my-4 space-y-1.5 text-sm">
              {c.tgConfirm.points.map((p) => <li key={p} className="flex gap-2"><span className="text-emerald-600" aria-hidden>✓</span>{p}</li>)}
            </ul>
            {pending ? (
              <p className="py-3 text-center text-sm font-semibold" role="status">{c.tgConfirm.paying}</p>
            ) : (
              <TelegramBotLogin next={`/orders/${tgOrder}`} onDone={() => afterTelegram(tgOrder)} />
            )}
          </div>
        </div>
      )}
      {/* Mini App: the customer declined "allow the bot to message you" — explain why it is needed and ask again. */}
      {needWrite && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 sm:items-center" role="dialog" aria-modal aria-label={c.writeAccess.title}>
          <div className="w-full max-w-md rounded-t-[28px] bg-surface p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] text-center shadow-2xl sm:rounded-[28px]">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand text-2xl" aria-hidden>🔔</span>
            <h2 className="mt-3 text-xl font-extrabold tracking-tight">{c.writeAccess.title}</h2>
            <p className="mt-1.5 text-sm text-muted">{c.writeAccess.text}</p>
            <ul className="mt-4 space-y-1.5 text-left text-sm">
              {c.writeAccess.points.map((x) => <li key={x} className="flex gap-2"><span className="text-emerald-600" aria-hidden>✓</span>{x}</li>)}
            </ul>
            <button type="button" onClick={() => { setNeedWrite(false); submit(); }}
              className="btn-glow mt-5 h-12 w-full rounded-full text-[15px] font-extrabold">{c.writeAccess.allow}</button>
            <button type="button" onClick={() => setNeedWrite(false)} className="mt-2 h-10 w-full text-sm font-semibold text-muted">{c.writeAccess.later}</button>
          </div>
        </div>
      )}
      {/* Step: the customer's own video */}
      {customVideo && (
        <section ref={videoRef} className={`rounded-card border bg-surface p-4 transition-shadow sm:p-5 ${nudge === "video" ? "border-ink ring-4 ring-lavender" : "border-line"}`}>
          <StepTitle n={++step} done={video.phase === "ready"}>{cv.stepVideo}</StepTitle>
          <p className="mt-1 text-sm text-muted">{cv.videoHint}</p>
          <div className="mt-3">
            <VideoPicker st={video} limits={customVideo} onPick={onPickVideo} onRemove={onRemoveVideo} />
          </div>
        </section>
      )}

      {/* Step: photos */}
      <section ref={photosRef} className={`rounded-card border bg-surface p-4 transition-shadow sm:p-5 ${nudge === "photo" ? "border-ink ring-4 ring-lavender" : "border-line"}`}>
        <StepTitle n={++step} done={missing === 0}>{refPhoto ? c.stepRefPhotos : slots.length > 1 ? c.stepPhotos(slots.length) : c.stepPhoto}</StepTitle>
        {slots.length > 1 && refPhoto && <p className="mt-1 text-sm text-muted">{c.refPhotosHint}</p>}
        {!refPhoto && savedPhotos.length > 0 && missing > 0 && (
          <div className="mt-3 rounded-2xl bg-brand-soft/60 p-3 ring-1 ring-[#d9ec8a]">
            <p className="text-[13px] font-bold">{c.reuseTitle}</p>
            <div className="mt-2 flex gap-2">
              {savedPhotos.map((sp) => (
                <button key={sp.assetId} type="button" onClick={() => onReuse(sp)} aria-label={c.reuseUse}
                  className="relative h-16 w-12 shrink-0 overflow-hidden rounded-xl bg-surface ring-2 ring-white transition-transform active:scale-95">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={sp.url} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
              <span className="self-center text-xs text-muted">{c.reuseHint}</span>
            </div>
          </div>
        )}
        {!refPhoto && <PhotoTips />}
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

      {/* Clothing: the customer picks (only on templates that allow it). */}
      {outfit === "choice" && media === "video" && (
        <section className="rounded-card border border-line bg-surface p-4 sm:p-5">
          <p className="text-[16px] font-extrabold tracking-tight">{c.outfit.title}</p>
          <div className="mt-3 grid grid-cols-2 gap-1 rounded-full border border-line bg-paper p-1" role="radiogroup" aria-label={c.outfit.title}>
            {(["template", "photo"] as const).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={outfitPick === k} onClick={() => setOutfitPick(k)}
                className={`h-11 rounded-full text-sm font-bold transition-colors ${outfitPick === k ? "bg-night text-white" : "text-muted active:text-ink"}`}>
                {c.outfit[k]}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">{outfitPick === "template" ? c.outfit.hintTemplate : c.outfit.hintPhoto}</p>
        </section>
      )}

      {/* Customer's wish for the AI: mood, style, details (optional, lower priority than the template rules). */}
      {allowWish && (() => {
        const w = wishRequired ? c.photoBrief : c.wish;
        return (
        <section className={`rounded-card border bg-surface p-4 transition-shadow sm:p-5 ${nudge === "wish" ? "border-ink ring-4 ring-lavender" : "border-line"}`}>
          {wishRequired ? (
            <StepTitle n={++step} done={!!wish.trim()}>{w.title}</StepTitle>
          ) : (
            <label className="flex cursor-pointer items-center justify-between gap-3">
              <span className="text-[16px] font-extrabold tracking-tight">{c.promptToggle}</span>
              <input type="checkbox" className="h-5 w-5 shrink-0 accent-[#161616]" checked={promptOn}
                onChange={(e) => { setPromptOn(e.target.checked); if (!e.target.checked) setWish(""); else setTimeout(() => wishRef.current?.focus(), 50); }} />
            </label>
          )}
          {(wishRequired || promptOn) && (
            <>
              <p className="mt-1 text-sm text-muted">{!wishRequired && media === "video" && !customVideo ? c.wishOutfitNote(effOutfit) : w.hint}</p>
              <textarea ref={wishRef} value={wish} onChange={(e) => setWish(e.target.value.slice(0, 300))} maxLength={300} rows={wishRequired ? 3 : 2}
                placeholder={w.placeholder} aria-label={w.title} required={wishRequired}
                className="mt-3 w-full rounded-2xl border border-line bg-surface px-3 py-2 text-base outline-none focus:border-ink" />
              <p className="mt-1 text-right text-xs text-muted">{wish.length}/300</p>
            </>
          )}
        </section>
        );
      })()}

      {/* Quality: a dropdown, 720p by default; picking Full HD updates the total right away. */}
      {effQualities.length > 1 && <section className="rounded-card border border-line bg-surface p-4 sm:p-5">
        <label htmlFor="quality" className="text-[16px] font-extrabold tracking-tight">{c.qualityTitle}</label>
        <div className="relative mt-3">
          <select id="quality" value={quality} onChange={(e) => setQuality(e.target.value)}
            className="h-13 w-full appearance-none rounded-2xl border-2 border-line bg-paper pl-4 pr-11 text-[16px] font-semibold text-ink outline-none focus:border-ink">
            {effQualities.map((q) => {
              const extra = waitingForVideo ? null : calculatePrice(effPricing, q, faceCount).totalKzt - calculatePrice(effPricing, effQualities[0], faceCount).totalKzt;
              return (
                <option key={q.key} value={q.key}>
                  {q.key === "1080p" ? `Высокое (1080p)${extra ? ` · +${formatKzt(extra)}` : ""}` : `Обычное (720p)${extra === null ? "" : ` · ${c.qualityIncluded.toLowerCase()}`}`}
                </option>
              );
            })}
          </select>
          <svg viewBox="0 0 24 24" className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m8 10 4-4 4 4M8 14l4 4 4-4" /></svg>
        </div>
      </section>}

      {/* Step: Kaspi phone */}
      {needPhone && (
        <section className={`rounded-card bg-[#f14635] p-4 text-white transition-shadow sm:p-5 ${nudge === "phone" ? "ring-4 ring-[#f14635]/35" : ""}`}>
          {/* Kaspi step: Kaspi red with the Kaspi mark, so the customer instantly sees where the bill goes. */}
          <h2 className="flex items-center gap-2.5 text-[16px] font-extrabold tracking-tight sm:text-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/kaspi.png" alt="Kaspi" width={32} height={32} className="h-8 w-8 shrink-0 rounded-[9px] ring-2 ring-white/70" />
            {(++step, c.stepPhone)}
            {phoneOk && !!phone && <span className="ml-auto flex h-6 w-6 items-center justify-center rounded-full bg-white text-[12px] font-extrabold text-[#f14635]" aria-hidden>✓</span>}
          </h2>
          <KzPhoneInput
            ref={phoneRef} value={phone} onChange={setPhone} ariaLabel={kk.tole.phoneLabel} invalid={!!phone && !phoneOk}
            className={`mt-3 h-13 w-full rounded-2xl border-2 bg-white text-lg transition-colors ${phone && !phoneOk ? "border-night" : "border-white focus-within:border-night"}`}
          />
          <p className="mt-1.5 text-xs font-medium text-white/90">
            {phone && !phoneOk ? `⚠️ ${kk.order.payErrors.phone_invalid}` : kk.tole.phoneHint}
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
        <div className={`sticky ${noTabBar ? "bottom-[calc(0.75rem+env(safe-area-inset-bottom))]" : "bottom-[calc(5.25rem+env(safe-area-inset-bottom))]"} z-20 -mx-1 rounded-[28px] border border-line bg-white px-4 pb-2.5 pt-2.5 shadow-[0_16px_40px_-18px_rgba(60,40,20,0.35)] sm:static sm:mx-0 sm:rounded-card sm:p-4`}>
          <label ref={consentRef} className={`-mx-1 mb-2 flex cursor-pointer items-start gap-2.5 rounded-lg px-1 py-1 text-xs leading-snug transition-colors ${nudge === "consent" ? "bg-peach ring-2 ring-peach" : ""}`}>
            <input type="checkbox" className="mt-px h-[18px] w-[18px] shrink-0 accent-[#161616]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span className="text-muted">{customVideo ? cv.consent : kk.consent.combined}</span>
          </label>
          <div className="flex items-center gap-3">
            <div className="min-w-0 shrink-0">
              <p className="text-xs text-muted">{c.total}</p>
              {disc > 0 && price && <p className="text-[11px] font-semibold leading-none text-muted"><s>{formatKzt(price.totalKzt)}</s> <span className="rounded bg-brand px-1 text-night">−{disc}%</span></p>}
              <p className="font-display text-xl font-bold leading-tight">{finalKzt !== null ? formatKzt(finalKzt) : "—"}</p>
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
                : freeOrders ? c.freeNow : finalKzt !== null ? c.payNow(formatKzt(finalKzt)) : c.confirm}
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
    <h2 className="flex items-center gap-2.5 text-[16px] font-extrabold tracking-tight sm:text-lg">
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-extrabold ${done ? "bg-brand text-night" : "bg-night text-white"}`}>
        {done ? "✓" : n}
      </span>
      {children}
    </h2>
  );
}

/** "Өз видеом": requirements up front, then the video in its real shape with upload progress and the output format. */
function VideoPicker({ st, limits, onPick, onRemove }: { st: VideoState; limits: { maxSeconds: number; maxMb: number }; onPick: (f: File | undefined) => void; onRemove: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = st.phase === "uploading" || st.phase === "verifying";
  const preview = "preview" in st ? st.preview : undefined;
  const aspect = st.phase === "ready" && st.aspect ? st.aspect : 9 / 16;
  const out = st.phase === "ready" ? nearestOutputAspect(st.aspect) : null;
  const R = cv.rules;
  const rules: { icon: React.ReactNode; v: string; sub: string }[] = [
    { icon: <path d="M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />, v: R.length(limits.maxSeconds), sub: R.lengthSub },
    { icon: <path d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14" />, v: R.size(limits.maxMb), sub: R.sizeSub },
    { icon: <><rect x="3" y="5" width="13" height="14" rx="2" /><path d="m16 10 5-3v10l-5-3" /></>, v: R.format, sub: R.formatSub },
    { icon: <><rect x="3" y="7" width="7" height="12" rx="1.5" /><rect x="13" y="10" width="8" height="6" rx="1.5" /></>, v: R.shape, sub: R.shapeSub },
  ];
  return (
    <div>
      {preview ? (
        <div className="flex items-start gap-4">
          <div className="relative w-32 shrink-0 overflow-hidden rounded-2xl bg-night shadow-[0_10px_24px_-12px_rgba(0,0,0,0.45)] ring-1 ring-black/5"
            style={{ aspectRatio: String(Math.min(1.6, Math.max(0.5, aspect))) }}>
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
            {st.phase === "uploading" && (
              <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-black/10">
                <span className="block h-full rounded-full bg-brand transition-[width]" style={{ width: `${Math.max(6, st.progress)}%` }} />
              </span>
            )}
            {st.phase === "ready" && (
              <dl className="mt-2 grid gap-1.5 text-[13px]">
                <div className="flex items-center gap-2">
                  <dt className="w-[4.5rem] shrink-0 text-muted">{R.lengthSub[0].toUpperCase() + R.lengthSub.slice(1)}</dt>
                  <dd className="font-semibold">{cv.seconds(Math.round(st.durationSec))}</dd>
                </div>
                {out && (
                  <div className="flex items-center gap-2">
                    <dt className="w-[4.5rem] shrink-0 text-muted">{cv.outputLabel}</dt>
                    <dd className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2 py-0.5 font-semibold text-night">
                      <span className={`inline-block rounded-[3px] border-[1.5px] border-current ${out === "9:16" ? "h-3 w-[7px]" : out === "1:1" ? "h-2.5 w-2.5" : "h-[7px] w-3"}`} aria-hidden />
                      {cv.outputs[out]}
                    </dd>
                  </div>
                )}
              </dl>
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
        <>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className={`group flex w-full items-center gap-4 rounded-2xl border-2 border-dashed p-4 text-left transition-[colors,transform] active:scale-[0.99] ${st.phase === "error" ? "border-danger bg-danger/10" : "border-[#c9cdf5] bg-lavender/60 hover:border-ink"}`}
          >
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-surface text-night shadow-sm transition-transform group-hover:scale-105">
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
              </svg>
            </span>
            <span className="min-w-0">
              <span className="block font-bold">{cv.pickTitle}</span>
              <span className="mt-0.5 block text-sm text-muted">{cv.pickText(limits.maxSeconds, limits.maxMb)}</span>
            </span>
          </button>

          {/* What Kling accepts, shown before picking: no surprises after paying. */}
          <div className="mt-3 rounded-2xl bg-paper p-3 ring-1 ring-line">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted">{R.title}</p>
            <ul className="mt-2 grid grid-cols-2 gap-2">
              {rules.map((r) => (
                <li key={r.sub} className="flex items-center gap-2.5 rounded-xl bg-surface px-2.5 py-2 ring-1 ring-line">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-night">
                    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>{r.icon}</svg>
                  </span>
                  <span className="min-w-0 leading-tight">
                    <span className="block text-[13px] font-extrabold">{r.v}</span>
                    <span className="block truncate text-[11px] text-muted">{r.sub}</span>
                  </span>
                </li>
              ))}
            </ul>
            <ul className="mt-2.5 space-y-1 text-[12.5px] text-muted">
              {R.tips.map((t) => (
                <li key={t} className="flex gap-2"><span className="mt-[1px] text-emerald-600" aria-hidden>✓</span>{t}</li>
              ))}
            </ul>
          </div>
        </>
      )}
      <input ref={inputRef} type="file" accept="video/mp4,video/quicktime,.mp4,.mov" className="sr-only" tabIndex={-1}
        onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = ""; }} />
      {st.phase === "error" && (
        <p className="mt-2 flex gap-2 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger" role="alert"><span aria-hidden>⚠️</span>{st.message}</p>
      )}
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
        className={`flex w-full items-center gap-4 rounded-2xl border-2 p-3 text-left transition-[colors,transform] active:scale-[0.99] ${st.phase === "ready" ? "border-[#9cbf12] bg-brand-soft/50" : st.phase === "error" ? "border-danger bg-danger/10" : "border-dashed border-[#c9cdf5] bg-lavender/60 hover:border-brand"}`}
      >
        <span className="relative h-32 w-24 shrink-0 overflow-hidden rounded-2xl bg-surface shadow-sm">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className="h-full w-full object-cover" />
          ) : (
            <svg viewBox="0 0 24 24" className="absolute inset-0 m-auto h-9 w-9 text-night" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
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
    st.phase === "ready" ? "border-[#9cbf12]" : st.phase === "error" ? "border-danger" : "border-line border-dashed";

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
        className={`relative flex aspect-[3/4] w-full flex-col items-center justify-center overflow-hidden rounded-card border-2 bg-surface text-center transition-colors hover:border-ink ${border}`}
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <>
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-night text-lg font-extrabold text-white">
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
