"use client";
/** Chrome / Android «Install app» prompt, kept until the page asks for it. */
type BIP = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
let saved: BIP | null = null;
const subs = new Set<() => void>();

export function captureInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); saved = e as BIP; subs.forEach((f) => f()); });
  window.addEventListener("appinstalled", () => { saved = null; subs.forEach((f) => f()); });
}
export const installPromptReady = () => !!saved;
export function onInstallPrompt(cb: () => void) { subs.add(cb); return () => { subs.delete(cb); }; }
export async function promptInstall(): Promise<boolean> {
  if (!saved) return false;
  const p = saved;
  saved = null;
  await p.prompt();
  const r = await p.userChoice.catch(() => ({ outcome: "dismissed" as const }));
  subs.forEach((f) => f());
  return r.outcome === "accepted";
}
