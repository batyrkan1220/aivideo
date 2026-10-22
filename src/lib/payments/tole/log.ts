import "server-only";

/**
 * Structured, redacted Tole logs. Only allow-listed keys with primitive values are written, so
 * API keys, webhook secrets, phone numbers, QR tokens, payment URLs and raw provider payloads
 * can never end up in logs by accident.
 */
const ALLOWED = new Set([
  "paymentId", "orderId", "commandId", "paymentIntentId", "webhookId", "eventType", "status",
  "kind", "httpStatus", "code", "attempt", "reason", "mode", "path", "outcome", "result",
]);

export function toleLog(event: string, fields: Record<string, unknown> = {}, level: "info" | "error" = "info") {
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!ALLOWED.has(k)) continue;
    if (v === null || typeof v === "number" || typeof v === "boolean") safe[k] = v;
    else if (typeof v === "string") safe[k] = v.length > 80 ? `${v.slice(0, 80)}…` : v;
  }
  const line = JSON.stringify({ src: "tole", event, ...safe });
  if (level === "error") console.error(line); else console.log(line);
}
