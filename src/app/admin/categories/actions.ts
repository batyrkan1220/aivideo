"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit, requirePermission, ForbiddenError } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { clearMemo } from "@/lib/cache/memo";
import { ru } from "@/lib/i18n/ru";

export type CatState = { ok?: string; error?: string };
const C = ru.admin.categories;

async function guard() {
  try { return await requirePermission("templates.manage"); } catch (e) { if (e instanceof ForbiddenError) return null; throw e; }
}

/** Latin URL slug from a Kazakh / Russian title ("Мерекелік" → "merekelik"). */
const MAP: Record<string, string> = {
  а: "a", ә: "a", б: "b", в: "v", г: "g", ғ: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "i", к: "k", қ: "q",
  л: "l", м: "m", н: "n", ң: "n", о: "o", ө: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ұ: "u", ү: "u", ф: "f", х: "h",
  һ: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", і: "i", ь: "", э: "e", ю: "yu", я: "ya",
};
function slugify(title: string) {
  const s = title.toLowerCase().split("").map((ch) => MAP[ch] ?? ch).join("")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return s || "category";
}
async function uniqueSlug(base: string, exceptId?: string) {
  const db = supabaseAdmin();
  for (let i = 0; i < 50; i++) {
    const slug = i ? `${base}-${i + 1}` : base;
    const { data } = await db.from("categories").select("id").eq("slug", slug).maybeSingle();
    if (!data || data.id === exceptId) return slug;
  }
  return `${base}-${Date.now()}`;
}
function done(msg: string): CatState {
  clearMemo("cat:");
  revalidatePath("/admin/categories");
  revalidatePath("/admin/templates");
  return { ok: msg };
}

const title = z.string().trim().min(1).max(60);

export async function createCategory(raw: unknown): Promise<CatState> {
  const u = await guard();
  if (!u) return { error: ru.admin.forbidden };
  const p = z.object({ title }).safeParse(raw);
  if (!p.success) return { error: C.invalid };
  const db = supabaseAdmin();
  const { data: last } = await db.from("categories").select("sort_order").order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await db.from("categories").insert({
    title_kk: p.data.title, slug: await uniqueSlug(slugify(p.data.title)), sort_order: (last?.sort_order ?? 0) + 10, is_active: true,
  }).select("id").single();
  if (error || !data) { console.error("[admin.category.create]", error?.code); return { error: C.invalid }; }
  await audit(u.id, "category.create", "category", data.id, { title: p.data.title });
  return done(C.created);
}

export async function updateCategory(raw: unknown): Promise<CatState> {
  const u = await guard();
  if (!u) return { error: ru.admin.forbidden };
  const p = z.object({ id: z.string().uuid(), title, isActive: z.boolean() }).safeParse(raw);
  if (!p.success) return { error: C.invalid };
  const { error } = await supabaseAdmin().from("categories").update({ title_kk: p.data.title, is_active: p.data.isActive }).eq("id", p.data.id);
  if (error) return { error: C.invalid };
  await audit(u.id, "category.update", "category", p.data.id, { title: p.data.title, active: p.data.isActive });
  return done(C.saved);
}

/** Moves a category one place up or down (swaps sort_order with its neighbour). */
export async function moveCategory(id: string, dir: -1 | 1): Promise<CatState> {
  const u = await guard();
  if (!u) return { error: ru.admin.forbidden };
  if (!z.string().uuid().safeParse(id).success) return { error: C.invalid };
  const db = supabaseAdmin();
  const { data: all } = await db.from("categories").select("id,sort_order").order("sort_order").order("created_at");
  const list = all ?? [];
  const i = list.findIndex((c) => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return {};
  // Normalise to 10, 20, 30… then swap the two.
  const order = list.map((c) => c.id);
  [order[i], order[j]] = [order[j], order[i]];
  await Promise.all(order.map((cid, k) => db.from("categories").update({ sort_order: (k + 1) * 10 }).eq("id", cid)));
  return done(C.saved);
}

/** Deletes a category; its templates stay and simply lose the category. */
export async function deleteCategory(id: string): Promise<CatState> {
  const u = await guard();
  if (!u) return { error: ru.admin.forbidden };
  if (!z.string().uuid().safeParse(id).success) return { error: C.invalid };
  const { error } = await supabaseAdmin().from("categories").delete().eq("id", id);
  if (error) return { error: C.invalid };
  await audit(u.id, "category.delete", "category", id, {});
  return done(C.deleted);
}
