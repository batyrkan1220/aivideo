"use server";
import { revalidatePath } from "next/cache";
import { clearMemo } from "@/lib/cache/memo";
import { audit, getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { SHOWCASE_KEY, showcaseSchema } from "@/lib/templates/showcase";
import { ru } from "@/lib/i18n/ru";

export type ShowcaseState = { ok?: string; error?: string };

export async function saveShowcase(_: ShowcaseState, fd: FormData): Promise<ShowcaseState> {
  const u = await getSessionUser();
  if (!u || !can(u.role, "templates.manage")) return { error: ru.admin.forbidden };
  const raw = ["center", "left", "right"].map((k) => String(fd.get(k) ?? "") || null);
  const parsed = showcaseSchema.safeParse(raw);
  if (!parsed.success) return { error: ru.errors.generic };
  const ids = parsed.data.filter(Boolean);
  if (new Set(ids).size !== ids.length) return { error: ru.admin.home.duplicate };

  if (ids.length) {
    const { data } = await supabaseAdmin().from("templates").select("id").in("id", ids as string[]).eq("status", "published").eq("kind", "catalog");
    if ((data?.length ?? 0) !== ids.length) return { error: ru.errors.generic };
  }
  const { error } = await supabaseAdmin().from("site_settings").upsert({
    key: SHOWCASE_KEY, value: parsed.data, updated_by: u.id, updated_at: new Date().toISOString(),
  });
  if (error) return { error: ru.errors.generic };
  await audit(u.id, "home.showcase_update", "site_settings", SHOWCASE_KEY, { value: parsed.data });
  clearMemo();
  revalidatePath("/");
  return { ok: ru.admin.home.saved };
}
