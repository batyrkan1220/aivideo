"use client";
import { useActionState } from "react";
import { savePixels, type PixelsState } from "./actions";

type V = { tiktokPixelId: string; tiktokTestCode: string; metaPixelId: string; metaTestCode: string; ga4Id: string; ymId: string;
  has: { tiktokToken: boolean; metaToken: boolean; ga4Secret: boolean } };

const LABELS: Record<string, string> = {
  tiktokPixelId: "TikTok Pixel ID", tiktokToken: "TikTok Events API token", tiktokTestCode: "TikTok test event code",
  metaPixelId: "Meta Pixel ID", metaToken: "Meta Conversions API token", metaTestCode: "Meta test event code",
  ga4Id: "GA4 Measurement ID", ga4Secret: "GA4 API secret", ymId: "Яндекс Метрика: номер счётчика",
};

const input = "mt-1 h-10 w-full rounded-xl border border-line bg-white px-3 font-mono text-base sm:text-sm";
function Id({ name, value, ph }: { name: string; value: string; ph: string }) {
  return (
    <label className="text-sm"><span className="font-medium">{LABELS[name]}</span>
      <input name={name} defaultValue={value} placeholder={ph} autoComplete="off" className={input} /></label>
  );
}
function Secret({ name, set }: { name: "tiktokToken" | "metaToken" | "ga4Secret"; set: boolean }) {
  return (
    <label className="text-sm"><span className="font-medium">{LABELS[name]}</span>
      <input name={name} type="password" placeholder={set ? "•••••• сохранён — оставьте пустым" : "вставьте токен"} autoComplete="new-password" className={input} />
      {set && <span className="mt-1 flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" name={`clear_${name}`} className="h-3.5 w-3.5" /> удалить сохранённый</span>}
    </label>
  );
}
const badge = (on: boolean) => `rounded-full px-2 py-0.5 text-xs font-semibold ${on ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "bg-paper text-muted ring-1 ring-line"}`;
function Card({ title, on, api, hint, children }: { title: string; on: boolean; api?: boolean; hint: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-line bg-white p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">{title}</h2>
        <span className={badge(on)}>{on ? "подключён" : "выключен"}</span>
        {api !== undefined && <span className={badge(api)}>{api ? "сервер: да" : "сервер: нет"}</span>}
      </div>
      <p className="mt-1 text-sm text-muted">{hint}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">{children}</div>
    </section>
  );
}

export function PixelsForm({ v }: { v: V }) {
  const [state, action, pending] = useActionState<PixelsState, FormData>(savePixels, {});
  return (
    <form action={action} className="space-y-4">
      <Card title="TikTok" on={!!v.tiktokPixelId} api={v.has.tiktokToken} hint="Pixel: ViewContent, AddToCart, InitiateCheckout, CompletePayment. Токен Events API — покупка отправляется и с сервера (точнее атрибуция).">
        <Id name="tiktokPixelId" value={v.tiktokPixelId} ph="C1A2B3C4D5E6F7G8H9" />
        <Secret name="tiktokToken" set={v.has.tiktokToken} />
        <Id name="tiktokTestCode" value={v.tiktokTestCode} ph="TEST12345 (только для проверки)" />
      </Card>
      <Card title="Meta (Facebook / Instagram)" on={!!v.metaPixelId} api={v.has.metaToken} hint="Pixel: PageView, ViewContent, AddToCart, InitiateCheckout, Purchase. Токен Conversions API — покупка и с сервера.">
        <Id name="metaPixelId" value={v.metaPixelId} ph="123456789012345" />
        <Secret name="metaToken" set={v.has.metaToken} />
        <Id name="metaTestCode" value={v.metaTestCode} ph="TEST12345 (только для проверки)" />
      </Card>
      <Card title="Google Analytics 4" on={!!v.ga4Id} api={v.has.ga4Secret} hint="view_item, add_to_cart, begin_checkout, purchase. API secret (Measurement Protocol) — покупка и с сервера.">
        <Id name="ga4Id" value={v.ga4Id} ph="G-XXXXXXXXXX" />
        <Secret name="ga4Secret" set={v.has.ga4Secret} />
      </Card>
      <Card title="Яндекс Метрика" on={!!v.ymId} hint="Просмотры страниц, Вебвизор, электронная коммерция (detail, add, purchase) и цели: view_template, photo_uploaded, checkout, purchase.">
        <Id name="ymId" value={v.ymId} ph="12345678" />
      </Card>
      <div className="flex items-center gap-3">
        <button disabled={pending} className="h-11 rounded-full bg-night px-6 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Сохраняем…" : "Сохранить"}</button>
        {state.ok && <span className="text-sm text-success">Сохранено. На сайте — в течение минуты.</span>}
        {state.error && <span className="text-sm text-danger">{state.error === "invalid" ? `Проверьте поле: ${LABELS[state.field ?? ""] ?? state.field}` : state.error === "forbidden" ? "Нет доступа" : "Не удалось сохранить"}</span>}
      </div>
    </form>
  );
}
