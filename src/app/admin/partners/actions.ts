"use server";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit, getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { CODE_RE, PARTNER_DEFAULTS_KEY } from "@/lib/partners";
import { createTeliksAccount, processTeliksPayout, resetTeliksPassword, syncTeliksPartner } from "@/lib/partners/teliks";

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
  await syncTeliksPartner(id.data).catch(() => {});
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

export type TeliksState = { ok?: boolean; password?: string; error?: "forbidden" | "invalid" | "not_configured" | "exists" | "email_taken" | "failed" };

export async function createTeliksLogin(_: TeliksState, fd: FormData): Promise<TeliksState> {
  const u = await admin();
  if (!u) return { error: "forbidden" };
  const p = z.object({ id: z.string().uuid(), email: z.string().trim().toLowerCase().email().max(254) }).safeParse({ id: fd.get("id"), email: fd.get("email") });
  if (!p.success) return { error: "invalid" };
  const r = await createTeliksAccount(p.data.id, p.data.email);
  if (!r.ok) return { error: r.error };
  await audit(u.id, "partner.teliks_account", "partner", p.data.id, { email: p.data.email });
  revalidatePath(`/admin/partners/${p.data.id}`);
  return { ok: true, password: r.password };
}

export async function resetTeliksLogin(_: TeliksState, fd: FormData): Promise<TeliksState> {
  const u = await admin();
  if (!u) return { error: "forbidden" };
  const id = z.string().uuid().safeParse(fd.get("id"));
  if (!id.success) return { error: "invalid" };
  const r = await resetTeliksPassword(id.data);
  if (!r.ok) return { error: "failed" };
  await audit(u.id, "partner.teliks_password_reset", "partner", id.data);
  return { ok: true, password: r.password };
}

export async function processPayoutRequest(fd: FormData) {
  const u = await admin();
  if (!u) return;
  const p = z.object({ id: z.string().uuid(), request: z.string().uuid(), action: z.enum(["paid", "rejected"]) })
    .safeParse({ id: fd.get("id"), request: fd.get("request"), action: fd.get("action") });
  if (!p.success) return;
  if (await processTeliksPayout(p.data.id, p.data.request, p.data.action, u.id)) {
    await audit(u.id, `partner.payout_request_${p.data.action}`, "partner", p.data.id, { request: p.data.request });
  }
  revalidatePath(`/admin/partners/${p.data.id}`);
  revalidatePath("/admin/partners");
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
