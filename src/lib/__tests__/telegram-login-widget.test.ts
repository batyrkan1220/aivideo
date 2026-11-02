import { describe, expect, it } from "vitest";
import { signLoginWidget, telegramLoginUrl, verifyLoginWidget } from "@/lib/telegram/login-widget";

const TOKEN = "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";
const now = 1_800_000_000;

describe("Telegram login widget", () => {
  it("accepts correctly signed data", () => {
    const d = signLoginWidget({ id: "42", first_name: "Aru", username: "aru", auth_date: String(now - 10) }, TOKEN);
    const r = verifyLoginWidget({ ...d, id: 42 }, TOKEN, now);
    expect(r.ok && r.user.id).toBe(42);
  });
  it("rejects tampering, other bots and old data", () => {
    const d = signLoginWidget({ id: "42", first_name: "Aru", auth_date: String(now - 10) }, TOKEN);
    expect(verifyLoginWidget({ ...d, id: "43" }, TOKEN, now).ok).toBe(false);
    expect(verifyLoginWidget(d, "999:ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ", now).ok).toBe(false);
    expect(verifyLoginWidget(d, TOKEN, now + 7200).ok).toBe(false);
    expect(verifyLoginWidget(null, TOKEN, now).ok).toBe(false);
  });
  it("builds the sign-in URL from the bot id only", () => {
    const u = telegramLoginUrl(TOKEN, "https://trendme.kz", "https://trendme.kz/telegram-login");
    expect(u).toContain("bot_id=123456");
    expect(u).not.toContain("ABCDEF");
  });
});
