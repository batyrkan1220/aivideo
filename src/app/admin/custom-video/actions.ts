"use server";
import { revalidatePath } from "next/cache";
import { audit, getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { CUSTOM_VIDEO_KEY, customVideoSettingsSchema } from "@/lib/custom-video/settings";

export type CustomVideoState = { ok?: boolean; error?: "forbidden" | "invalid" | "failed" };

export async function saveCustomVideoSettings(_: CustomVideoState, fd: FormData): Promise<CustomVideoState> {
  const u = await getSessionUser();
  if (!u || !can(u.role, "templates.manage")) return { error: "forbidden" };
  const p = customVideoSettingsSchema.safeParse({
    enabled: fd.get("enabled") === "on",
    priceKzt: Number(fd.get("priceKzt")),
    maxSeconds: Number(fd.get("maxSeconds")),
    maxMb: Number(fd.get("maxMb")),
  });
  if (!p.success) return { error: "invalid" };
  const { error } = await supabaseAdmin().from("site_settings").upsert({
    key: CUSTOM_VIDEO_KEY, value: p.data, updated_by: u.id, updated_at: new Date().toISOString(),
  });
  if (error) return { error: "failed" };
  await audit(u.id, "custom_video.settings", "site_settings", null, p.data);
  revalidatePath("/admin");
  return { ok: true };
}
