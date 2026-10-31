import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  supabaseAdmin: () => ({ from: () => ({ select: async () => ({ data: [{ key: "paid", text: "Ok {title}!", button: "Ашу", updated_at: "2026-10-22T00:00:00Z" }] }) }) }),
}));
const { botMessage, BOT_MESSAGES, clearBotMessageCache } = await import("@/lib/telegram/messages");

describe("bot messages", () => {
  it("uses the saved override and escapes placeholders", async () => {
    clearBotMessageCache();
    expect(await botMessage("paid", { title: "<Би> & co" })).toEqual({ text: "Ok &lt;Би&gt; &amp; co!", button: "Ашу" });
  });
  it("falls back to defaults and tidies an empty name", async () => {
    const m = await botMessage("welcome", { name: "" });
    expect(m.text.startsWith("Привет! 👋")).toBe(true);
    expect(m.button).toBe(BOT_MESSAGES.welcome.button);
  });
  it("profile texts fit Telegram limits", () => {
    expect(BOT_MESSAGES.description.text.length).toBeLessThanOrEqual(512);
    expect(BOT_MESSAGES.short_description.text.length).toBeLessThanOrEqual(120);
  });
});
