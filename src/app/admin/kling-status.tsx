import { connection } from "next/server";
import { klingStatus } from "@/lib/generation/kling";

/** Kling official API: key accepted + resource packs (Kling 4.0 needs a Flagship pack). */
export async function KlingStatus() {
  await connection();
  const s = await klingStatus();
  if (s.state === "none") return null;
  const has40 = (s.packs ?? []).some((p) => p.for40 && p.remaining > 0);
  const tone = s.state === "ok" ? (has40 ? "bg-green-50" : "bg-flash/20") : "bg-red-50 text-danger";
  const text =
    s.state === "auth" ? "Kling API: ключ отклонён. Проверьте KLING_API_KEY в Render."
    : s.state === "error" ? "Kling API: не удалось связаться. Обновите страницу позже."
    : `Kling API: подключено ✓ · ${(s.packs ?? []).length ? s.packs!.map((p) => `${p.name}: ${p.remaining}/${p.total}${p.for40 ? " (Kling 4.0)" : ""}`).join(" · ") : "нет активных пакетов"}${has40 ? "" : " — для Kling 4.0 нужен Flagship-пакет"} (остаток обновляется с задержкой до 12 ч)`;
  return <p className={`rounded-card p-4 text-sm font-medium ${tone}`}>{text}</p>;
}
