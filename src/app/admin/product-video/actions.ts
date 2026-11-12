"use server";
import { revalidatePath } from "next/cache";
import { clearMemo } from "@/lib/cache/memo";
import { audit, getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { PRODUCT_VIDEO_KEY, productVideoSettingsSchema } from "@/lib/product-video/settings";

export type ProductVideoState = { ok?: boolean; error?: "forbidden" | "invalid" | "failed" };

export async function saveProductVideoSettings(_: ProductVideoState, fd: FormData): Promise<ProductVideoState> {
  const u = await getSessionUser();
  if (!u || !can(u.role, "templates.manage")) return { error: "forbidden" };
  const p = productVideoSettingsSchema.safeParse({
    enabled: fd.get("enabled") === "on",
    price5Kzt: Number(fd.get("price5Kzt")),
    price10Kzt: Number(fd.get("price10Kzt")),
  });
  if (!p.success) return { error: "invalid" };
  const { error } = await supabaseAdmin().from("site_settings").upsert({
    key: PRODUCT_VIDEO_KEY, value: p.data, updated_by: u.id, updated_at: new Date().toISOString(),
  });
  if (error) return { error: "failed" };
  await audit(u.id, "product_video.settings", "site_settings", null, p.data);
  clearMemo();
  revalidatePath("/admin");
  revalidatePath("/product");
  return { ok: true };
}
