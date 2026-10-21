"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit, getSessionUser } from "@/lib/auth/session";
import { supabaseAdmin, supabaseServer } from "@/lib/supabase/server";
import { kk } from "@/lib/i18n/kk";

export type FormState = { ok?: string; error?: string };
const ACTIVE = ["queued", "processing", "postprocessing"];

export async function updateDisplayName(_: FormState, fd: FormData): Promise<FormState> {
  const user = await getSessionUser();
  if (!user) return { error: kk.errors.unauthorized };
  const name = z.string().trim().min(1).max(80).safeParse(fd.get("displayName"));
  if (!name.success) return { error: kk.errors.generic };
  const sb = await supabaseServer(); // RLS: users may update only their own row (role is locked)
  const { error } = await sb.from("profiles").update({ display_name: name.data }).eq("id", user.id);
  if (error) return { error: kk.errors.generic };
  revalidatePath("/account");
  return { ok: kk.account.nameSaved };
}

/** Removes every storage object under the user's folder (paginated), plus orphan-safe. */
async function removeFolder(bucket: string, userId: string) {
  const db = supabaseAdmin();
  for (let i = 0; i < 50; i++) {
    const { data } = await db.storage.from(bucket).list(userId, { limit: 1000 });
    if (!data?.length) return;
    await db.storage.from(bucket).remove(data.map((f) => `${userId}/${f.name}`));
  }
}

async function ownOrder(orderId: unknown, userId: string) {
  const id = z.string().uuid().safeParse(orderId);
  if (!id.success) return null;
  const { data } = await supabaseAdmin().from("orders")
    .select("id,generation_status").eq("id", id.data).eq("user_id", userId).maybeSingle();
  return data;
}

export async function deleteVideo(fd: FormData) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const o = await ownOrder(fd.get("orderId"), user.id);
  if (!o) redirect("/account");
  const db = supabaseAdmin();
  const { data: v } = await db.from("generated_videos").select("private_storage_path").eq("order_id", o.id).maybeSingle();
  if (v) {
    await db.storage.from("generated-videos").remove([v.private_storage_path]);
    await db.from("generated_videos").delete().eq("order_id", o.id);
    await audit(user.id, "video.delete", "order", o.id);
  }
  revalidatePath(`/orders/${o.id}`);
  redirect(`/orders/${o.id}?deleted=video`);
}

export async function deleteOrderPhotos(fd: FormData) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const o = await ownOrder(fd.get("orderId"), user.id);
  if (!o) redirect("/account");
  if (ACTIVE.includes(o.generation_status)) redirect(`/orders/${o.id}?error=busy`);
  const db = supabaseAdmin();
  const { data: assets } = await db.from("order_assets").select("private_storage_path").eq("order_id", o.id);
  if (assets?.length) await db.storage.from("user-uploads").remove(assets.map((a) => a.private_storage_path));
  await db.from("order_assets").delete().eq("order_id", o.id);
  await db.from("orders").update({ photos_deleted_at: new Date().toISOString() }).eq("id", o.id);
  await audit(user.id, "photos.delete", "order", o.id);
  revalidatePath(`/orders/${o.id}`);
  redirect(`/orders/${o.id}?deleted=photos`);
}

export async function deleteAllPhotos(_: FormState): Promise<FormState> {
  const user = await getSessionUser();
  if (!user) return { error: kk.errors.unauthorized };
  const db = supabaseAdmin();
  const { data: busy } = await db.from("orders").select("id").eq("user_id", user.id).in("generation_status", ACTIVE).limit(1);
  if (busy?.length) return { error: kk.result.busy };
  await removeFolder("user-uploads", user.id);
  const { data: rows } = await db.from("order_assets").select("order_id").eq("user_id", user.id);
  await db.from("order_assets").delete().eq("user_id", user.id);
  const orderIds = [...new Set((rows ?? []).map((r) => r.order_id).filter(Boolean))] as string[];
  if (orderIds.length) await db.from("orders").update({ photos_deleted_at: new Date().toISOString() }).in("id", orderIds);
  await audit(user.id, "photos.delete_all", "profile", user.id);
  revalidatePath("/account");
  return { ok: kk.account.allPhotosDeleted };
}

/**
 * Permanently deletes the account: photos, videos, profile and auth user.
 * Orders/payments stay as anonymised records (user_id → null) for accounting.
 */
export async function deleteAccount(_: FormState, fd: FormData): Promise<FormState> {
  const user = await getSessionUser();
  if (!user) return { error: kk.errors.unauthorized };
  if (String(fd.get("confirm") ?? "").trim().toUpperCase() !== kk.account.deleteAccountWord) {
    return { error: kk.account.deleteAccountWrong };
  }
  const db = supabaseAdmin();
  const { data: busy } = await db.from("orders").select("id").eq("user_id", user.id).in("generation_status", ACTIVE).limit(1);
  if (busy?.length) return { error: kk.account.deleteAccountBusy };

  const { data: orders } = await db.from("orders").select("id").eq("user_id", user.id);
  const orderIds = (orders ?? []).map((o) => o.id);
  await removeFolder("user-uploads", user.id);
  await removeFolder("generated-videos", user.id);
  if (orderIds.length) {
    await db.from("generated_videos").delete().in("order_id", orderIds);
    await db.from("orders").update({ photos_deleted_at: new Date().toISOString() }).in("id", orderIds);
  }
  await db.from("order_assets").delete().eq("user_id", user.id);
  await audit(null, "account.delete", "profile", null, { orders: orderIds.length });

  const { error } = await db.auth.admin.deleteUser(user.id); // cascades profile; orders keep user_id = null
  if (error) { console.error("[account.delete]", error.message); return { error: kk.errors.generic }; }
  const sb = await supabaseServer();
  await sb.auth.signOut();
  redirect("/?account=deleted");
}
