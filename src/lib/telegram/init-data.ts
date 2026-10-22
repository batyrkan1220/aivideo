import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Validates Telegram Mini App `initData` (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):
 *   secret_key = HMAC_SHA256(key = "WebAppData", data = bot_token)
 *   hash       = hex(HMAC_SHA256(key = secret_key, data = data_check_string))
 * where data_check_string = every received field except `hash`, sorted by key, as "key=value" joined by "\n".
 * auth_date older than maxAgeSec is rejected (replay guard).
 */
export type TelegramUser = { id: number; first_name?: string; last_name?: string; username?: string; language_code?: string };

export type InitDataResult =
  | { ok: true; user: TelegramUser; authDate: number }
  | { ok: false; reason: "missing" | "bad_hash" | "expired" | "no_user" };

export function verifyInitData(initData: string, botToken: string, nowSec = Math.floor(Date.now() / 1000), maxAgeSec = 24 * 3600): InitDataResult {
  if (!initData || !botToken) return { ok: false, reason: "missing" };
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return { ok: false, reason: "missing" };

  const pairs: string[] = [];
  params.forEach((value, key) => { if (key !== "hash") pairs.push(`${key}=${value}`); });
  pairs.sort();
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(pairs.join("\n")).digest();
  const got = Buffer.from(hash, "hex");
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return { ok: false, reason: "bad_hash" };

  const authDate = Number(params.get("auth_date"));
  if (!Number.isInteger(authDate) || nowSec - authDate > maxAgeSec || authDate - nowSec > 300) return { ok: false, reason: "expired" };

  let user: TelegramUser | null = null;
  try { user = JSON.parse(params.get("user") ?? "null"); } catch { user = null; }
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) return { ok: false, reason: "no_user" };
  return { ok: true, user, authDate };
}

/** Test helper / documentation of the exact signing scheme. */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const pairs = Object.entries(fields).map(([k, v]) => `${k}=${v}`).sort();
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret).update(pairs.join("\n")).digest("hex");
  const p = new URLSearchParams(fields);
  p.set("hash", hash);
  return p.toString();
}
