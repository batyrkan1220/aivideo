import "server-only";
import { videoFrameJpeg } from "@/lib/media/frame";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { track } from "@/lib/analytics";
import { faceSlotSchema } from "@/lib/templates/schema";
import { mediaUrl } from "@/lib/templates/queries";
import { kk } from "@/lib/i18n/kk";
import { generationProvider } from "./index";
import { ProviderError } from "./types";
import { isTestPaymentProvider } from "@/lib/payments/types";
import { notifyOrderOwner } from "@/lib/telegram/bot";
import { notifyAdmins } from "@/lib/telegram/admin";

type Job = {
  id: string; order_id: string; provider: string; provider_job_id: string | null; status: string;
  attempt_count: number; started_at: string | null; provider_cost: number | null;
  provider_state: Record<string, unknown> | null;
};

const POLL_EVERY_MS = 5_000;
const MAX_OUTPUT_BYTES = 50 * 1024 * 1024;   // generated-videos bucket limit
const backoffMs = (attempt: number) => Math.min(30_000 * 2 ** attempt, 30 * 60_000);

/** User-facing (Kazakh) message for an error code. Technical details stay in server logs. */
function safeMessage(code: string): string {
  return (kk.generation.errors as Record<string, string>)[code] ?? kk.generation.errors.generic;
}

/** Claims due jobs and advances each one step. Safe to run concurrently and repeatedly. */
export async function runWorker({ limit = 5, budgetMs = 20_000 } = {}) {
  const started = Date.now();
  const worker = `w_${randomUUID().slice(0, 8)}`;
  const db = supabaseAdmin();
  const { data: jobs, error } = await db.rpc("claim_generation_jobs", { p_worker: worker, p_limit: limit });
  if (error) { console.error("[worker.claim]", error.code, error.message); return { processed: 0 }; }

  let processed = 0;
  for (const job of (jobs ?? []) as Job[]) {
    if (Date.now() - started > budgetMs) {
      await db.from("generation_jobs").update({ locked_at: null, locked_by: null }).eq("id", job.id);
      continue;
    }
    try {
      await step(job);
      processed++;
    } catch (err) {
      console.error("[worker.step]", job.id, err instanceof Error ? err.message : err);
      await db.from("generation_jobs").update({ next_attempt_at: new Date(Date.now() + backoffMs(1)).toISOString() }).eq("id", job.id);
    } finally {
      await db.from("generation_jobs").update({ locked_at: null, locked_by: null }).eq("id", job.id).eq("locked_by", worker);
    }
  }
  return { processed };
}

async function step(job: Job) {
  if (job.status === "queued") return submitJob(job);
  return pollJob(job);
}

async function failJob(job: Job, code: string, extra: Record<string, unknown> = {}) {
  const db = supabaseAdmin();
  await db.from("generation_jobs").update({
    status: "failed", error_code: code, safe_error_message: safeMessage(code),
    completed_at: new Date().toISOString(), retryable: false, ...extra,
  }).eq("id", job.id);
  await db.from("orders").update({ generation_status: "failed" }).eq("id", job.order_id);
  await track("generation_failed", { orderId: job.order_id, props: { code } });
  await notifyOrderOwner(job.order_id, "failed");
  await notifyAdmins(job.order_id, "failed");
}

async function delay(job: Job, ms: number, extra: Record<string, unknown> = {}) {
  await supabaseAdmin().from("generation_jobs")
    .update({ next_attempt_at: new Date(Date.now() + ms).toISOString(), ...extra }).eq("id", job.id);
}

async function submitJob(job: Job) {
  const db = supabaseAdmin();
  const e = env();

  const { data: order } = await db.from("orders")
    .select("id,user_id,template_id,payment_status,template_snapshot_json").eq("id", job.order_id).single();
  if (!order) return failJob(job, "order_missing");
  if (order.payment_status !== "succeeded") return failJob(job, "unpaid"); // never generate unpaid orders

  const provider = generationProvider(job.provider);
  if (!provider) return failJob(job, "provider_not_configured");

  // Safety rail: a sandbox (test) payment must never spend real provider money for regular
  // users. Staff may still run real generations on sandbox orders to test the pipeline.
  if (provider.capabilities().producesRealVideo) {
    const { data: pay } = await db.from("payments").select("provider")
      .eq("order_id", order.id).eq("status", "succeeded").maybeSingle();
    if (isTestPaymentProvider(pay?.provider)) {
      const { data: prof } = await db.from("profiles").select("role").eq("id", order.user_id).maybeSingle();
      if (!prof || prof.role === "user") return failJob(job, "sandbox_payment_real_provider");
    }
  }

  // Concurrency and spending limits: wait, don't fail.
  const { count: running } = await db.from("generation_jobs").select("id", { count: "exact", head: true })
    .eq("status", "processing");
  if ((running ?? 0) >= e.WORKER_CONCURRENCY) return delay(job, 30_000);
  const { data: spent } = await db.rpc("provider_spend_today");
  if (Number(spent ?? 0) >= e.DAILY_PROVIDER_SPEND_LIMIT_USD) {
    console.error("[worker] daily provider spend limit reached");
    return delay(job, 10 * 60_000);
  }

  // Inputs, in the exact slot order of the version the user paid for.
  const snap = order.template_snapshot_json as Record<string, unknown>;
  const slots = z.array(faceSlotSchema).safeParse(snap.face_slots_json);
  if (!slots.success) return failJob(job, "invalid_template");
  const { data: assets } = await db.from("order_assets")
    .select("face_slot_key,private_storage_path,verified_at").eq("order_id", order.id);
  const ordered = [...slots.data].sort((a, b) => a.order - b.order);
  const faces = [];
  for (const s of ordered) {
    const a = assets?.find((x) => x.face_slot_key === s.key && x.verified_at);
    if (!a) return failJob(job, "missing_inputs");
    const { data: signed } = await db.storage.from("user-uploads").createSignedUrl(a.private_storage_path, 24 * 3600);
    if (!signed) return delay(job, backoffMs(job.attempt_count));
    faces.push({ slotKey: s.key, providerInput: s.providerInput, imageUrl: signed.signedUrl });
  }
  let templateVideoUrl = mediaUrl((snap.preview_video_path as string) ?? null) ?? "";
  // The template's cover = a frame of its video (Kling: the customer is put into this scene first).
  let templateFrameUrl: string | null = null;
  let coverUrl: string | null = null; // 540 px catalog cover: only if a full-size frame cannot be made
  if (!snap.user_video_path && order.template_id) {
    const { data: tpl } = await db.from("templates").select("cover_asset_path,frame:provider_config_json->>framePath").eq("id", order.template_id).maybeSingle();
    const t = tpl as { cover_asset_path: string | null; frame: string | null } | null;
    templateFrameUrl = mediaUrl(t?.frame ?? null);
    coverUrl = mediaUrl(t?.cover_asset_path ?? null);
  }
  if (typeof snap.user_video_path === "string" && snap.user_video_path) {
    // "Өз видеом": the customer's own private video, shared with the provider via a signed URL.
    const { data: signedVideo } = await db.storage.from("user-videos").createSignedUrl(snap.user_video_path, 24 * 3600);
    if (!signedVideo) return delay(job, backoffMs(job.attempt_count));
    templateVideoUrl = signedVideo.signedUrl;
  }
  const quality = (snap.quality as { providerQuality?: string } | undefined)?.providerQuality ?? "standard";
  // Provider config of the paid version + what the order adds: reference length and the customer's wish.
  const config = {
    ...((snap.provider_config_json as Record<string, unknown>) ?? {}),
    durationSec: Number(snap.video_duration_sec ?? snap.user_video_duration_sec) || null,
    ...(typeof snap.customer_wish === "string" ? { wish: snap.customer_wish } : {}),
  };
  // Kling builds the scene from its image: make sure there is a frame of the video to put the customer into.
  const wantsFrame = ["kling", "k4"].includes(String((config as { mode?: unknown }).mode)) || (config as { outfit?: unknown }).outfit === "template";
  if (!templateFrameUrl && wantsFrame && templateVideoUrl) {
    templateFrameUrl = (await ensureSceneFrame(order, templateVideoUrl, typeof snap.user_video_path === "string" && !!snap.user_video_path)) ?? coverUrl;
  }
  const input = { templateVideoUrl, templateFrameUrl, faces, quality, config };

  const problems = provider.validateInputs(input);
  if (problems.length) return failJob(job, "invalid_inputs", { safe_error_message: safeMessage("invalid_inputs") });

  try {
    const res = await provider.submit({ jobId: job.id, ...input });
    const now = new Date().toISOString();
    await db.from("generation_jobs").update({
      status: "processing", provider_job_id: res.providerJobId, provider_state: res.state ?? null, started_at: now,
      attempt_count: job.attempt_count + 1, provider_cost: res.cost ?? null, progress: 0,
      ...(res.credits !== undefined ? { provider_credits: res.credits } : {}),
      next_attempt_at: new Date(Date.now() + POLL_EVERY_MS).toISOString(),
    }).eq("id", job.id);
    await db.from("orders").update({ generation_status: "processing" }).eq("id", order.id);
    await track("generation_started", { userId: order.user_id, orderId: order.id });
  } catch (err) {
    const pe = err instanceof ProviderError ? err : new ProviderError("submit_error", true);
    const attempts = job.attempt_count + 1;
    console.error("[worker.submit]", job.id, pe.code, pe.message);
    // Only auto-retry when the provider did not accept (and therefore did not charge) the job.
    if (pe.retryable && attempts < e.GENERATION_MAX_ATTEMPTS) {
      return delay(job, backoffMs(attempts), { attempt_count: attempts, error_code: pe.code });
    }
    return failJob(job, pe.code, { attempt_count: attempts });
  }
}

async function pollJob(job: Job) {
  const db = supabaseAdmin();
  const provider = generationProvider(job.provider);
  if (!provider || !job.provider_job_id) return failJob(job, "provider_not_configured");

  let st;
  try {
    st = await provider.getStatus(job.provider_job_id, {
      startedAt: job.started_at ? new Date(job.started_at) : null,
      state: job.provider_state,
    });
  } catch (err) {
    console.error("[worker.poll]", job.id, err instanceof Error ? err.message : err);
    return delay(job, 30_000); // polling is free to retry
  }
  const polled = { last_polled_at: new Date().toISOString() };

  if (st.state === "queued" || st.state === "processing") {
    const next = st.next
      ? {
          provider_job_id: st.next.providerJobId,
          provider_state: st.next.state,
          provider_cost: (Number(job.provider_cost) || 0) + (st.next.cost ?? 0),
          ...(st.next.credits !== undefined ? { provider_credits: st.next.credits } : {}),
        }
      : {};
    return delay(job, POLL_EVERY_MS, { ...polled, ...next, progress: st.progress ?? null });
  }
  if (st.state === "failed") {
    return failJob(job, st.errorCode, { ...polled, provider_cost: st.cost ?? job.provider_cost });
  }
  if (st.state === "succeeded") return finalize(job, st.outputUrl, st.cost);
}

/** Download → validate → store privately → mark completed. Retries are free (provider already done). */
async function finalize(job: Job, outputUrl: string, cost?: number) {
  const db = supabaseAdmin();
  await db.from("generation_jobs").update({ status: "postprocessing", progress: 100 }).eq("id", job.id);
  await db.from("orders").update({ generation_status: "postprocessing" }).eq("id", job.order_id);

  const retryLater = async (code: string) => {
    const attempts = job.attempt_count + 1;
    if (attempts >= env().GENERATION_MAX_ATTEMPTS + 3) return failJob(job, code);
    return delay(job, backoffMs(attempts), { attempt_count: attempts, error_code: code });
  };

  let bytes: Uint8Array;
  try {
    const res = await fetch(outputUrl, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return retryLater("output_download_failed");
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_OUTPUT_BYTES) return failJob(job, "output_too_large");
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch {
    return retryLater("output_download_failed");
  }
  if (!bytes.byteLength || bytes.byteLength > MAX_OUTPUT_BYTES) return failJob(job, "output_invalid");
  const isMp4 = bytes.length > 12 && String.fromCharCode(...bytes.slice(4, 8)) === "ftyp";
  const isWebm = bytes.length > 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  if (!isMp4 && !isWebm) return failJob(job, "output_invalid");

  const { data: order } = await db.from("orders").select("user_id,template_snapshot_json").eq("id", job.order_id).single();
  if (!order) return failJob(job, "order_missing");
  const ext = isMp4 ? "mp4" : "webm";
  const path = `${order.user_id}/${job.order_id}.${ext}`;
  const { error: upErr } = await db.storage.from("generated-videos")
    .upload(path, bytes, { contentType: isMp4 ? "video/mp4" : "video/webm", upsert: true });
  if (upErr) return retryLater("output_store_failed");

  const quality = (order.template_snapshot_json as { quality?: { resolution?: string } }).quality;
  const expires = new Date(Date.now() + env().VIDEO_RETENTION_DAYS * 86400_000).toISOString();
  await db.from("generated_videos").upsert({
    order_id: job.order_id, private_storage_path: path, file_size: bytes.byteLength,
    resolution: quality?.resolution ?? null, expires_at: expires,
  }, { onConflict: "order_id" });

  const now = new Date().toISOString();
  await db.from("generation_jobs").update({
    status: "completed", completed_at: now, provider_cost: cost ?? job.provider_cost, error_code: null, provider_state: null,
  }).eq("id", job.id);
  await db.from("orders").update({ generation_status: "completed", completed_at: now }).eq("id", job.order_id);
  await notifyOrderOwner(job.order_id, "ready");
  await notifyAdmins(job.order_id, "ready");
  await track("generation_succeeded", { userId: order.user_id, orderId: job.order_id });
}

/**
 * A full-size frame of the template video (stored once on the template), or of the customer's own
 * video (private, per order). Best effort: null when ffmpeg or storage fails.
 */
async function ensureSceneFrame(order: { id: string; user_id: string; template_id: string | null }, videoUrl: string, own: boolean): Promise<string | null> {
  const db = supabaseAdmin();
  const jpg = await videoFrameJpeg(videoUrl);
  if (!jpg) return null;
  if (own) {
    const path = `${order.user_id}/${order.id}-frame.jpg`;
    const { error } = await db.storage.from("user-uploads").upload(path, jpg, { contentType: "image/jpeg", upsert: true });
    if (error) return null;
    const { data } = await db.storage.from("user-uploads").createSignedUrl(path, 24 * 3600);
    return data?.signedUrl ?? null;
  }
  if (!order.template_id) return null;
  const path = `frames/${order.template_id}-${Date.now()}.jpg`;
  const { error } = await db.storage.from("template-media").upload(path, jpg, { contentType: "image/jpeg", upsert: true });
  if (error) { console.error("[worker] frame upload failed", error.message); return null; }
  const { data: t } = await db.from("templates").select("provider_config_json").eq("id", order.template_id).single();
  await db.from("templates").update({ provider_config_json: { ...((t?.provider_config_json as Record<string, unknown>) ?? {}), framePath: path } }).eq("id", order.template_id);
  return mediaUrl(path);
}
