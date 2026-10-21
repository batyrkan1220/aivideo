/** Only allow same-site relative redirects (prevents open-redirect attacks). */
export function safeNext(raw: unknown, fallback = "/"): string {
  if (typeof raw !== "string" || !raw) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  return raw;
}
