import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { TelegramUser } from "./init-data";

/**
 * Validates "Log in with Telegram" data (https://core.telegram.org/widgets/login#checking-authorization):
 *   secret_key = SHA256(bot_token)
 *   hash       = hex(HMAC_SHA256(key = secret_key, data = data_check_string))
 * data_check_string = every received field except `hash`, sorted by key, "key=value" joined by "\n".
 * auth_date older than maxAgeSec is rejected (replay guard).
 */
export type LoginWidgetResult =
  | { ok: true; user: TelegramUser }
  | { ok: false; reason: "missing" | "bad_hash" | "expired" };

const FIELDS = ["id", "first_name", "last_name", "username", "photo_url", "auth_date", "hash"] as const;

export function verifyLoginWidget(raw: unknown, botToken: string, nowSec = Math.floor(Date.now() / 1000), maxAgeSec = 3600): LoginWidgetResult {
  if (!raw || typeof raw !== "object" || !botToken) return { ok: false, reason: "missing" };
  const data: Record<string, string> = {};
  for (const k of FIELDS) {
    const v = (raw as Record<string, unknown>)[k];
    if (v === undefined || v === null) continue;
    if (typeof v !== "string" && typeof v !== "number") return { ok: false, reason: "missing" };
    data[k] = String(v);
  }
  const hash = data.hash;
  if (!hash || !/^[0-9a-f]{64}$/.test(hash) || !data.id || !data.auth_date) return { ok: false, reason: "missing" };

  const check = Object.keys(data).filter((k) => k !== "hash").sort().map((k) => `${k}=${data[k]}`).join("\n");
  const secret = createHash("sha256").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(check).digest();
  const got = Buffer.from(hash, "hex");
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return { ok: false, reason: "bad_hash" };

  const authDate = Number(data.auth_date);
  if (!Number.isInteger(authDate) || nowSec - authDate > maxAgeSec || authDate - nowSec > 300) return { ok: false, reason: "expired" };
  const id = Number(data.id);
  if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, reason: "missing" };
  return { ok: true, user: { id, first_name: data.first_name, last_name: data.last_name, username: data.username } };
}

/** Test helper / documentation of the signing scheme. */
export function signLoginWidget(fields: Record<string, string>, botToken: string): Record<string, string> {
  const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join("\n");
  const secret = createHash("sha256").update(botToken).digest();
  return { ...fields, hash: createHmac("sha256", secret).update(check).digest("hex") };
}

/** Telegram's own sign-in page; it returns to `returnTo` with #tgAuthResult=<base64 JSON>. */
export function telegramLoginUrl(botToken: string, origin: string, returnTo: string): string {
  const botId = botToken.split(":")[0];
  const q = new URLSearchParams({ bot_id: botId, origin, embed: "0", request_access: "write", return_to: returnTo });
  return `https://oauth.telegram.org/auth?${q}`;
}
