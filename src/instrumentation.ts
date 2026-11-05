/** Server start: log (in the background) whether the Kling API key and a Kling 4.0 pack work. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Keep the bot's description, menu button and commands in sync with the code (idempotent).
  setTimeout(() => {
    void (async () => {
      try {
        if (!process.env.TELEGRAM_BOT_TOKEN) return;
        const { pushBotProfile, pushBotCommands } = await import("@/lib/telegram/profile");
        await pushBotProfile();
        await pushBotCommands();
        console.log("[telegram] bot profile and commands synced");
      } catch (err) {
        console.error("[telegram] bot sync failed", err instanceof Error ? err.message : err);
      }
    })();
  }, 8_000);
  setTimeout(() => {
    void (async () => {
      try {
        const { klingStatus } = await import("@/lib/generation/kling");
        const k = await klingStatus();
        if (k.state === "none") return;
        const packs = (k.packs ?? []).map((p) => `${p.for40 ? "4.0" : "other"}:${p.remaining}/${p.total}`).join(",") || "none";
        console.log(`[kling] status=${k.state} packs=${packs}`);
        const { klingImageProbe } = await import("@/lib/generation/kling");
        console.log(`[kling] image api=${await klingImageProbe()}`);
        if (k.state === "ok") {
          const { klingRecentBilling } = await import("@/lib/generation/kling");
          for (const line of await klingRecentBilling(5)) console.log(`[kling] recent ${line}`);
        }
      } catch (err) {
        console.error("[kling] status check failed", err instanceof Error ? err.message : err);
      }
    })();
  }, 5_000);
}
