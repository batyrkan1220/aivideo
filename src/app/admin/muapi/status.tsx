import { connection } from "next/server";
import { muapiStatus } from "@/lib/generation/seedance";

/** muapi (Seedance) connection: key accepted + balance. */
export async function MuapiStatus() {
  await connection();
  const s = await muapiStatus();
  const tone = s.state === "ok" ? (s.balance !== undefined && s.balance < 10 ? "bg-flash/20" : "bg-green-50") : "bg-red-50 text-danger";
  const text =
    s.state === "none" ? "muapi (AI видео): ключ MUAPI_API_KEY не задан в Render — видео не генерируются."
    : s.state === "auth" ? "muapi (AI видео): ключ отклонён (неверный или отозван). Проверьте MUAPI_API_KEY в Render."
    : s.state === "error" ? "muapi (AI видео): не удалось связаться с muapi. Обновите страницу позже."
    : `muapi (AI видео): подключено ✓ · баланс ${s.balance !== undefined ? `$${s.balance.toFixed(2)}` : "—"}${s.balance !== undefined && s.balance < 10 ? " — пополните, иначе заказы не будут генерироваться" : ""}`;
  return <p className={`rounded-card p-4 text-sm font-medium ${tone}`}>{text}</p>;
}
