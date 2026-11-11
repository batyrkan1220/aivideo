"use server";
import { randomUUID } from "node:crypto";
import { forgetProfile } from "@/lib/auth/session";
import { clearMemo } from "@/lib/cache/memo";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit, getSessionUser } from "@/lib/auth/session";
import { can, type Permission, type Role } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { paymentProvider } from "@/lib/payments";
import { handlePaymentWebhook } from "@/lib/payments/process";
import { signSandbox } from "@/lib/payments/sandbox";
import { generationProvider } from "@/lib/generation";
import { ru } from "@/lib/i18n/ru";

export type AdminState = { ok?: string; error?: string };
const E = ru.admin.orders.errors;
const ACTIVE = ["queued", "processing", "postprocessing"];

async function staff(perm: Permission) {
  const u = await getSessionUser();
  return u && can(u.role, perm) ? u : null;
}
const uuid = (v: FormDataEntryValue | null) => z.string().uuid().safeParse(v);

/** Re-queues generation for a paid order whose last job failed or was cancelled. */
export async function retryGeneration(_: AdminState, fd: FormData): Promise<AdminState> {
  const u = await staff("orders.retry");
  if (!u) return { error: E.forbidden };
  const id = uuid(fd.get("orderId"));
  if (!id.success) return { error: E.generic };
  const db = supabaseAdmin();
  const { data: o } = await db.from("orders")
    .select("id,payment_status,generation_status,photos_deleted_at,template_snapshot_json").eq("id", id.data).single();
  if (!o || o.payment_status !== "succeeded" || !["failed", "cancelled"].includes(o.generation_status) || o.photos_deleted_at) {
    return { error: E.not_eligible };
  }
  const provider = (o.template_snapshot_json as { provider_key?: string }).provider_key ?? "dev";
  const { error } = await db.from("generation_jobs").insert({ order_id: o.id, provider, status: "queued" });
  if (error) return { error: E.generic };
  await db.from("orders").update({ generation_status: "queued", completed_at: null }).eq("id", o.id);
  await audit(u.id, "order.retry_generation", "order", o.id);
  revalidatePath(`/admin/orders/${o.id}`);
  return { ok: ru.admin.orders.done };
}

/**
 * Makes the order's video again for free (support: the customer is unhappy with a finished result,
 * or it failed). Needs the customer's photos to still be stored. The new result replaces the old.
 */
export async function remakeOrder(_: AdminState, fd: FormData): Promise<AdminState> {
  const u = await staff("orders.retry");
  if (!u) return { error: E.forbidden };
  const id = uuid(fd.get("orderId"));
  if (!id.success) return { error: E.generic };
  const db = supabaseAdmin();
  const { data: o } = await db.from("orders")
    .select("id,payment_status,generation_status,photos_deleted_at,template_snapshot_json").eq("id", id.data).single();
  if (!o || o.payment_status !== "succeeded" || !["completed", "failed", "cancelled"].includes(o.generation_status)) {
    return { error: E.not_eligible };
  }
  if (o.photos_deleted_at) return { error: "Фото клиента уже удалены (срок хранения) — пересоздать нельзя. Попросите загрузить фото заново." };
  const { count } = await db.from("orders").select("id", { count: "exact", head: true }).eq("parent_order_id", o.id);
  if (count) return { error: "Это фото-комбо: пересоздайте нужную фотографию в её заказе." };
  const provider = (o.template_snapshot_json as { provider_key?: string }).provider_key ?? "dev";
  const { error } = await db.from("generation_jobs").insert({ order_id: o.id, provider, status: "queued" });
  if (error) return { error: E.generic };
  // The old still frame belongs to the old video.
  const { data: v } = await db.from("generated_videos").select("private_storage_path").eq("order_id", o.id).maybeSingle();
  if (v?.private_storage_path) await db.storage.from("generated-videos").remove([`${v.private_storage_path}.poster.webp`]);
  await db.from("orders").update({ generation_status: "queued", completed_at: null }).eq("id", o.id);
  await audit(u.id, "order.remake", "order", o.id);
  revalidatePath(`/admin/orders/${o.id}`);
  revalidatePath("/admin/support", "layout");
  return { ok: "Поставлено в очередь — готовое видео придёт клиенту в Telegram" };
}

/** Stops an active generation (asks the provider to cancel when it supports it). */
export async function cancelGeneration(_: AdminState, fd: FormData): Promise<AdminState> {
  const u = await staff("orders.cancel");
  if (!u) return { error: E.forbidden };
  const id = uuid(fd.get("orderId"));
  if (!id.success) return { error: E.generic };
  const r = await cancelActiveJob(id.data);
  if (!r) return { error: E.not_eligible };
  await audit(u.id, "order.cancel_generation", "order", id.data);
  revalidatePath(`/admin/orders/${id.data}`);
  return { ok: ru.admin.orders.done };
}

async function cancelActiveJob(orderId: string) {
  const db = supabaseAdmin();
  const { data: job } = await db.from("generation_jobs").select("id,provider,provider_job_id,status")
    .eq("order_id", orderId).in("status", ACTIVE).maybeSingle();
  if (!job) return false;
  const p = generationProvider(job.provider);
  if (p?.cancel && job.provider_job_id) {
    try { await p.cancel(job.provider_job_id); } catch (e) { console.error("[admin.cancel]", e); }
  }
  await db.from("generation_jobs").update({
    status: "cancelled", completed_at: new Date().toISOString(), error_code: "cancelled_by_admin",
    safe_error_message: ru.order.generation.cancelled,
  }).eq("id", job.id);
  await db.from("orders").update({ generation_status: "cancelled" }).eq("id", orderId);
  return true;
}

/**
 * Refunds the successful payment of an order through its provider. The payment is
 * marked refunded only by the provider's verified callback (sandbox: signed event).
 */
export async function refundPayment(_: AdminState, fd: FormData): Promise<AdminState> {
  const u = await staff("orders.refund");
  if (!u) return { error: E.forbidden };
  const id = uuid(fd.get("orderId"));
  if (!id.success) return { error: E.generic };
  const db = supabaseAdmin();
  const { data: pay } = await db.from("payments")
    .select("id,provider,provider_payment_id,amount_kzt,currency,status").eq("order_id", id.data).eq("status", "succeeded").maybeSingle();
  if (!pay?.provider_payment_id) return { error: E.not_eligible };

  await cancelActiveJob(id.data); // no point generating a refunded order

  if (pay.provider === "sandbox") {
    const body = JSON.stringify({
      eventId: `evt_${randomUUID()}`, eventType: "payment.refunded", providerPaymentId: pay.provider_payment_id,
      status: "refunded", amountKzt: pay.amount_kzt, currency: pay.currency, ts: Date.now(),
    });
    const out = await handlePaymentWebhook("sandbox", body, new Headers({ "x-sandbox-signature": signSandbox(body) }));
    if (out.http !== 200) return { error: E.generic };
  } else {
    const p = paymentProvider(pay.provider);
    if (!p?.refund) return { error: E.refund_unsupported };
    const r = await p.refund(pay.provider_payment_id, pay.amount_kzt);
    if (!r.ok) return { error: E.generic };
  }
  await audit(u.id, "order.refund", "order", id.data, { amount_kzt: pay.amount_kzt, provider: pay.provider });
  revalidatePath(`/admin/orders/${id.data}`);
  return { ok: ru.admin.orders.done };
}

const ROLES = ["user", "super_admin", "template_manager", "order_support"] as const;

export async function changeRole(_: AdminState, fd: FormData): Promise<AdminState> {
  const u = await staff("users.manage");
  if (!u) return { error: E.forbidden };
  const id = uuid(fd.get("userId"));
  const role = z.enum(ROLES).safeParse(fd.get("role"));
  if (!id.success || !role.success) return { error: E.generic };
  if (id.data === u.id) return { error: ru.admin.users.selfLock }; // avoid locking yourself out
  const db = supabaseAdmin();
  const { data: before } = await db.from("profiles").select("role").eq("id", id.data).single();
  const { error } = await db.from("profiles").update({ role: role.data as Role }).eq("id", id.data);
  forgetProfile(id.data);
  if (error) return { error: E.generic };
  await audit(u.id, "user.role_change", "profile", id.data, { from: before?.role, to: role.data });
  revalidatePath("/admin/users");
  return { ok: ru.admin.users.saved };
}

/** Lets a user order without payment (owner tests, gifts) — or takes that back. */
export async function setFreeOrders(_: AdminState, fd: FormData): Promise<AdminState> {
  const u = await staff("users.manage");
  if (!u) return { error: E.forbidden };
  const id = uuid(fd.get("userId"));
  if (!id.success) return { error: E.generic };
  const on = fd.get("free") === "1";
  const db = supabaseAdmin();
  const { error } = on
    ? await db.from("free_order_users").upsert({ user_id: id.data, granted_by: u.id })
    : await db.from("free_order_users").delete().eq("user_id", id.data);
  if (error) return { error: E.generic };
  clearMemo(`free:${id.data}`);
  await audit(u.id, on ? "user.free_orders_on" : "user.free_orders_off", "profile", id.data);
  revalidatePath("/admin/users");
  return { ok: ru.admin.users.saved };
}

/**
 * Support: the video a Kling task returned, also an in-between one (the first person's run before the
 * second, or one shot). Kling keeps the files for about 30 days. The task ids are in the order's log.
 */
export async function klingTaskVideo(taskId: string): Promise<{ url?: string; error?: string }> {
  if (!(await staff("orders.view"))) return { error: "Нет доступа" };
  if (!/^\d{6,30}$/.test(taskId.trim())) return { error: "Неверный номер задачи" };
  try {
    const { getKlingTask } = await import("@/lib/generation/kling");
    const st = await getKlingTask(taskId.trim());
    if (st.state === "succeeded") return { url: st.outputUrl };
    return { error: st.state === "failed" ? "Задача Kling завершилась с ошибкой" : "Задача ещё выполняется" };
  } catch {
    return { error: "Kling не ответил" };
  }
}

/** Support: a Kling Element made for this order (its id, or why it failed). Elements are deleted after the video. */
export async function klingElementInfo(taskId: string): Promise<{ text?: string; error?: string }> {
  if (!(await staff("orders.view"))) return { error: "Нет доступа" };
  if (!/^\d{6,30}$/.test(taskId.trim())) return { error: "Неверный номер задачи" };
  try {
    const { getKlingElementTask } = await import("@/lib/generation/kling");
    const st = await getKlingElementTask(taskId.trim());
    if (st.state === "done") return { text: `Элемент создан: ID ${st.elementId}. После готового видео он удаляется из Kling (в нём лицо клиента).` };
    if (st.state === "failed") return { error: `Элемент не создан: ${st.reason || "ошибка Kling"}` };
    return { text: "Элемент ещё создаётся" };
  } catch {
    return { error: "Kling не ответил" };
  }
}
