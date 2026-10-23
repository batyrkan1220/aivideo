"use server";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit, getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { CODE_RE, PARTNER_DEFAULTS_KEY } from "@/lib/partners";

export type PartnerState = { ok?: boolean; error?: "forbidden" | "invalid" | "code_taken" | "failed" };

async function admin() {
  const u = await getSessionUser();
  return u && can(u.role, "users.manage") ? u : null;
}

const optional = (max: number) => z.string().trim().max(max).transform((v) => v || null);
const partnerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  code: z.string().trim().toLowerCase().transform((v) => v || null).refine((v) => v === null || CODE_RE.test(v)),
  telegram_username: z.string().trim().transform((v) => v.replace(/^@/, "") || null).refine((v) => v === null || /^[A-Za-z0-9_]{3,32}$/.test(v)),
  percent: z.coerce.number().min(0).max(90),
  contact: optional(200),
  notes: optional(1000),
});

const read = (fd: FormData) => partnerSchema.safeParse({
  name: fd.get("name") ?? "", code: fd.get("code") ?? "", telegram_username: fd.get("telegram_username") ?? "",
  percent: String(fd.get("percent") ?? "").replace(",", "."), contact: fd.get("contact") ?? "", notes: fd.get("notes") ?? "",
});

export async function createPartner(_: PartnerState, fd: FormData): Promise<PartnerState> {
  const u = await admin();
  if (!u) return { error: "forbidden" };
  const p = read(fd);
  if (!p.success) return { error: "invalid" };
  const code = p.data.code ?? randomBytes(4).toString("hex");
  const { data, error } = await supabaseAdmin().from("partners").insert({ ...p.data, code, created_by: u.id }).select("id").single();
  if (error) return { error: error.code === "23505" ? "code_taken" : "failed" };
  await audit(u.id, "partner.create", "partner", data.id, { code, percent: p.data.percent });
  redirect(`/admin/partners/${data.id}`);
}

export async function updatePartner(_: PartnerState, fd: FormData): Promise<PartnerState> {
  const u = await admin();
  if (!u) return { error: "forbidden" };
  const id = z.string().uuid().safeParse(fd.get("id"));
  const p = read(fd);
  if (!id.success || !p.success) return { error: "invalid" };
  const { code, ...rest } = p.data;
  const db = supabaseAdmin();
  const { data: before } = await db.from("partners").select("telegram_username").eq("id", id.data).single();
  const changedTg = (before?.telegram_username ?? "").toLowerCase() !== (rest.telegram_username ?? "").toLowerCase();
  const { error } = await db.from("partners").update({
    ...rest, ...(code ? { code } : {}), active: fd.get("active") === "on", ...(changedTg ? { telegram_id: null } : {}),
  }).eq("id", id.data);
  if (error) return { error: error.code === "23505" ? "code_taken" : "failed" };
  await audit(u.id, "partner.update", "partner", id.data, { percent: rest.percent, active: fd.get("active") === "on" });
  revalidatePath(`/admin/partners/${id.data}`);
  revalidatePath("/admin/partners");
  return { ok: true };
}

export async function addPayout(_: PartnerState, fd: FormData): Promise<PartnerState> {
  const u = await admin();
  if (!u) return { error: "forbidden" };
  const p = z.object({ id: z.string().uuid(), amount: z.coerce.number().int().positive().max(100_000_000), note: optional(300) })
    .safeParse({ id: fd.get("id"), amount: String(fd.get("amount") ?? "").replace(/\s/g, ""), note: fd.get("note") ?? "" });
  if (!p.success) return { error: "invalid" };
  const { error } = await supabaseAdmin().from("partner_payouts").insert({ partner_id: p.data.id, amount_kzt: p.data.amount, note: p.data.note, created_by: u.id });
  if (error) return { error: "failed" };
  await audit(u.id, "partner.payout", "partner", p.data.id, { amount: p.data.amount });
  revalidatePath(`/admin/partners/${p.data.id}`);
  revalidatePath("/admin/partners");
  return { ok: true };
}

export async function savePartnerDefaults(_: PartnerState, fd: FormData): Promise<PartnerState> {
  const u = await admin();
  if (!u) return { error: "forbidden" };
  const percent = Number(String(fd.get("percent") ?? "").replace(",", "."));
  if (!Number.isFinite(percent) || percent < 0 || percent > 90) return { error: "invalid" };
  const value = { percent, autoActivate: fd.get("autoActivate") === "on" };
  const { error } = await supabaseAdmin().from("site_settings").upsert({ key: PARTNER_DEFAULTS_KEY, value, updated_by: u.id, updated_at: new Date().toISOString() });
  if (error) return { error: "failed" };
  await audit(u.id, "partner.defaults", "site_settings", null, value);
  revalidatePath("/admin/partners");
  return { ok: true };
}
