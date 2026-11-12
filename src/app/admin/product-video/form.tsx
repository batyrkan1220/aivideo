"use client";
import { useActionState } from "react";
import { saveProductVideoSettings, type ProductVideoState } from "./actions";

const ERR = { forbidden: "Нет прав.", invalid: "Проверьте значения.", failed: "Не удалось сохранить." } as const;

/** «Видео товара»: on/off and the price for 5 and 10 seconds. */
export function ProductVideoForm({ value, cost }: { value: { enabled: boolean; price5Kzt: number; price10Kzt: number }; cost: { 5: number; 10: number } }) {
  const [state, action, pending] = useActionState<ProductVideoState, FormData>(saveProductVideoSettings, {});
  const input = "mt-1 h-10 w-full rounded-xl border border-line px-3 text-base sm:text-sm";
  return (
    <section className="rounded-card border border-line bg-white p-5">
      <h2 className="font-semibold">«Видео товара»</h2>
      <p className="mt-1 text-sm text-muted">
        Клиент загружает фото товара (и по желанию фото модели), выбирает сцену, 5 или 10 сек и формат; Kling 4.0 Omni снимает новый ролик по этим фото.
        Себестоимость Kling ≈ {cost[5].toLocaleString("ru-RU")} ₸ за 5 сек и {cost[10].toLocaleString("ru-RU")} ₸ за 10 сек (720p).
      </p>
      <form action={action} className="mt-4 grid gap-4 sm:grid-cols-3 sm:items-end">
        <label className="flex items-center gap-2 text-sm font-medium sm:col-span-3">
          <input type="checkbox" name="enabled" defaultChecked={value.enabled} className="h-4 w-4 accent-brand" /> Включено (вкладка «Товар» в меню)
        </label>
        <label className="text-sm"><span className="font-medium">Цена 5 сек, ₸</span>
          <input name="price5Kzt" type="number" min={100} step={10} defaultValue={value.price5Kzt} className={input} /></label>
        <label className="text-sm"><span className="font-medium">Цена 10 сек, ₸</span>
          <input name="price10Kzt" type="number" min={100} step={10} defaultValue={value.price10Kzt} className={input} /></label>
        <div className="flex items-center gap-3">
          <button disabled={pending} className="h-10 rounded-full bg-ink px-4 text-sm font-semibold text-white disabled:opacity-50">{pending ? "…" : "Сохранить"}</button>
          {state.ok && <span className="text-sm text-success">Сохранено</span>}
          {state.error && <span className="text-sm text-danger">{ERR[state.error]}</span>}
        </div>
      </form>
    </section>
  );
}
