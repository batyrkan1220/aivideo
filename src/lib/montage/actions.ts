"use server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { track } from "@/lib/analytics";
import { MAX_CLIP_SEC, MAX_CLIPS } from "./plan";
import { montageOptionsSchema } from "./schema";

/*
  Автомонтаж (free test): a draft montage, signed uploads for its clips (and an optional track) into the
  private user-videos bucket under <user>/montage/<id>/, then start. 3 montages a day per customer.
*/

const BUCKET = "user-videos";
const PER_DAY = 3;
const MAX_MB = 50;
const CLIP_TYPES = ["video/mp4", "video/quicktime"];
const MUSIC_TYPES = ["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/wav", "audio/x-wav"];

export type MontageError = "unauthorized" | "limit" | "bad_type" | "too_large" | "too_long" | "too_many" | "no_clips" | "generic";

export async function createMontage(): Promise<{ ok: true; id: string } | { ok: false; error: MontageError }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "unauthorized" };
  const db = supabaseAdmin();
  const since = new Date(Date.now() - 86400_000).toISOString();
  const { count } = await db.from("montages").select("id", { count: "exact", head: true }).eq("user_id", user.id).neq("status", "draft").gte("created_at", since);
  if ((count ?? 0) >= PER_DAY) return { ok: false, error: "limit" };
  const { data, error } = await db.from("montages").insert({ user_id: user.id }).select("id").single();
  if (error || !data) return { ok: false, error: "generic" };
  return { ok: true, id: data.id };
}

const uploadSchema = z.object({
  montageId: z.string().uuid(),
  kind: z.enum(["clip", "music"]),
  contentType: z.string(),
  size: z.number().int().positive(),
  durationSec: z.number().nonnegative().max(3600),
});

export async function requestMontageUpload(raw: unknown): Promise<{ ok: true; path: string; token: string } | { ok: false; error: MontageError }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "unauthorized" };
  const p = uploadSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: "generic" };
  const { montageId, kind, contentType, size, durationSec } = p.data;
  if (!(kind === "clip" ? CLIP_TYPES : MUSIC_TYPES).includes(contentType)) return { ok: false, error: "bad_type" };
  if (size > MAX_MB * 1024 * 1024) return { ok: false, error: "too_large" };
  if (kind === "clip" && durationSec > MAX_CLIP_SEC + 0.5) return { ok: false, error: "too_long" };
  const db = supabaseAdmin();
  const { data: m } = await db.from("montages").select("id,status").eq("id", montageId).eq("user_id", user.id).maybeSingle();
  if (!m || m.status !== "draft") return { ok: false, error: "generic" };
  const ext = contentType === "video/quicktime" ? "mov" : kind === "clip" ? "mp4" : contentType.includes("wav") ? "wav" : contentType === "audio/mpeg" ? "mp3" : "m4a";
  const path = `${user.id}/montage/${montageId}/${kind}-${randomUUID()}.${ext}`;
  const { data: signed, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !signed) return { ok: false, error: "generic" };
  return { ok: true, path: signed.path, token: signed.token };
}

const startSchema = z.object({
  montageId: z.string().uuid(),
  clips: z.array(z.object({ path: z.string().max(300), durationSec: z.number().nonnegative().max(3600) })).min(1).max(MAX_CLIPS),
  music: z.string().max(300).nullable(),
  options: montageOptionsSchema,
});

export async function startMontage(raw: unknown): Promise<{ ok: true } | { ok: false; error: MontageError }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "unauthorized" };
  const p = startSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues.some((i) => i.path[0] === "clips") ? "no_clips" : "generic" };
  const { montageId, clips, music, options } = p.data;
  const prefix = `${user.id}/montage/${montageId}/`;
  if (!clips.every((c) => c.path.startsWith(prefix) && !c.path.includes("..")) || (music && (!music.startsWith(prefix) || music.includes("..")))) return { ok: false, error: "generic" };
  const db = supabaseAdmin();
  // Every file must really be there.
  const { data: files } = await db.storage.from(BUCKET).list(prefix.slice(0, -1), { limit: 50 });
  const have = new Set((files ?? []).map((f) => `${prefix}${f.name}`));
  if (!clips.every((c) => have.has(c.path)) || (music && !have.has(music))) return { ok: false, error: "no_clips" };
  const since = new Date(Date.now() - 86400_000).toISOString();
  const { count } = await db.from("montages").select("id", { count: "exact", head: true }).eq("user_id", user.id).neq("status", "draft").gte("created_at", since);
  if ((count ?? 0) >= PER_DAY) return { ok: false, error: "limit" };
  const { data: m } = await db.from("montages").update({
    status: "queued", clips, music_path: options.sound === "music" ? music : null, options, created_at: new Date().toISOString(),
  }).eq("id", montageId).eq("user_id", user.id).eq("status", "draft").select("id").maybeSingle();
  if (!m) return { ok: false, error: "generic" };
  await track("montage_started", { userId: user.id, props: { clips: clips.length, style: options.style, length: options.length, sound: options.sound } });
  const { processMontage } = await import("./run");
  void processMontage(montageId);
  return { ok: true };
}
