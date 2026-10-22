import { describe, it, expect } from "vitest";
import { verifyInitData, signInitData } from "../telegram/init-data";
import { checkWebhookSecret, webhookSecret, escapeHtml } from "../telegram/bot";
import { isTelegramEmail, telegramEmail } from "../telegram/session";

const TOKEN = "123456789:AAEunit-test-token_abcdefghijklmnopqrs";
const now = 1_800_000_000;
const user = JSON.stringify({ id: 42, first_name: "Айгерім", username: "aigerim" });
const fields = { auth_date: String(now - 60), query_id: "AAHdF6IQAAAAAN0XohDhrOrc", user };

describe("Telegram initData", () => {
  it("accepts data signed with the bot token", () => {
    const r = verifyInitData(signInitData(fields, TOKEN), TOKEN, now);
    expect(r).toMatchObject({ ok: true, user: { id: 42, username: "aigerim" } });
  });
  it("rejects a different bot token or any tampered field", () => {
    expect(verifyInitData(signInitData(fields, TOKEN), "999:other", now)).toEqual({ ok: false, reason: "bad_hash" });
    const tampered = signInitData(fields, TOKEN).replace("%22id%22%3A42", "%22id%22%3A43");
    expect(verifyInitData(tampered, TOKEN, now)).toEqual({ ok: false, reason: "bad_hash" });
  });
  it("rejects stale auth_date (replay) and missing hash/user", () => {
    expect(verifyInitData(signInitData({ ...fields, auth_date: String(now - 2 * 86400) }, TOKEN), TOKEN, now)).toEqual({ ok: false, reason: "expired" });
    expect(verifyInitData("auth_date=1&user=x", TOKEN, now)).toEqual({ ok: false, reason: "missing" });
    expect(verifyInitData(signInitData({ auth_date: String(now) }, TOKEN), TOKEN, now)).toEqual({ ok: false, reason: "no_user" });
  });
});

describe("Telegram bot webhook secret", () => {
  it("is derived from the token and checked in constant time", () => {
    const s = webhookSecret()!;
    expect(s).toMatch(/^[0-9a-f]{64}$/);
    expect(checkWebhookSecret(s)).toBe(true);
    expect(checkWebhookSecret("nope")).toBe(false);
    expect(checkWebhookSecret(null)).toBe(false);
  });
  it("escapes HTML in user-provided text", () => {
    expect(escapeHtml("<b>Тест & </b>")).toBe("&lt;b&gt;Тест &amp; &lt;/b&gt;");
  });
});

describe("Telegram placeholder accounts", () => {
  it("uses a reserved, recognisable email", () => {
    expect(telegramEmail(42)).toBe("tg42@telegram.trendme.kz");
    expect(isTelegramEmail("tg42@telegram.trendme.kz")).toBe(true);
    expect(isTelegramEmail("user@gmail.com")).toBe(false);
  });
});
