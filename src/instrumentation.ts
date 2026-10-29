/** Server start: log (in the background) whether the Kling API key and a Kling 4.0 pack work. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  setTimeout(() => {
    void (async () => {
      try {
        const { klingStatus } = await import("@/lib/generation/kling");
        const k = await klingStatus();
        if (k.state === "none") return;
        const packs = (k.packs ?? []).map((p) => `${p.for40 ? "4.0" : "other"}:${p.remaining}/${p.total}`).join(",") || "none";
        console.log(`[kling] status=${k.state} packs=${packs}`);
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
