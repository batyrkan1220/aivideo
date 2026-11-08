import "server-only";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/server";
import { tg } from "./bot";

const RECHECK_MS = 7 * 86400_000;
const busy = new Set<string>();

/** Public URL of a stored avatar. */
export function avatarUrl(path: string | null | undefined): string | null {
  return path ? `${env().NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/avatars/${path}` : null;
}

type PhotoSize = { file_id: string; width: number; height: number };

/**
 * Copies the user's Telegram profile photo (the 320 px size) into the `avatars` bucket.
 * Runs at most once a week per user; a user whose photo is hidden by privacy settings simply has none.
 * Never throws (callers fire and forget).
 */
export async function refreshTelegramAvatar(userId: string, telegramId: number, force = false): Promise<void> {
  if (busy.has(userId)) return;
  busy.add(userId);
  try {
    const db = supabaseAdmin();
    const { data: p } = await db.from("profiles").select("avatar_path,avatar_checked_at").eq("id", userId).maybeSingle();
    if (!p) return;
    if (!force && p.avatar_checked_at && Date.now() - Date.parse(p.avatar_checked_at) < RECHECK_MS) return;

    const photos = await tg<{ photos: PhotoSize[][] }>("getUserProfilePhotos", { user_id: telegramId, limit: 1 });
    if (!photos) return; // Telegram unreachable: try again next time
    const sizes = photos.photos[0] ?? [];
    const pick = [...sizes].sort((a, b) => a.width - b.width).find((s) => s.width >= 300) ?? sizes.at(-1);
    let path: string | null = null;
    if (pick) {
      const file = await tg<{ file_path?: string }>("getFile", { file_id: pick.file_id });
      const token = env().TELEGRAM_BOT_TOKEN;
      if (file?.file_path && token) {
        const res = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length > 0 && buf.length <= 1_000_000) {
            const name = `${userId}/${randomUUID()}.jpg`;
            const { error } = await db.storage.from("avatars").upload(name, buf, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false });
            if (!error) path = name;
          }
        }
      }
      if (!path) return; // download failed: keep the old one, retry next time
    }
    await db.from("profiles").update({ avatar_path: path, avatar_checked_at: new Date().toISOString() }).eq("id", userId);
    if (p.avatar_path && p.avatar_path !== path) await db.storage.from("avatars").remove([p.avatar_path]);
  } catch (err) {
    console.error("[avatar] failed", err instanceof Error ? err.message.slice(0, 120) : "error");
  } finally {
    busy.delete(userId);
  }
}
