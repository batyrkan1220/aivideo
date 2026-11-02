import { Suspense } from "react";
import { connection } from "next/server";
import { ru } from "@/lib/i18n/ru";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { pixelSettings } from "@/lib/pixels/settings";
import { PageHead } from "../ui";
import { PixelsForm } from "./form";

export const metadata = { title: "Пиксели и аналитика" };

export default function PixelsPage() {
  return (
    <div>
      <PageHead title="Пиксели и аналитика" lead="TikTok, Meta, Google Analytics, Яндекс Метрика. Токены хранятся только на сервере и здесь не показываются." />
      <Suspense fallback={<p className="text-muted">{ru.common.loading}</p>}>
        <Body />
      </Suspense>
    </div>
  );
}

async function Body() {
  await connection();
  const u = await getSessionUser();
  if (!u || !can(u.role, "users.manage")) return <p className="text-muted">{ru.admin.forbidden}</p>;
  const s = await pixelSettings();
  return (
    <>
      <PixelsForm v={{
        tiktokPixelId: s.tiktokPixelId, tiktokTestCode: s.tiktokTestCode, metaPixelId: s.metaPixelId, metaTestCode: s.metaTestCode,
        ga4Id: s.ga4Id, ymId: s.ymId,
        has: { tiktokToken: !!s.tiktokToken, metaToken: !!s.metaToken, ga4Secret: !!s.ga4Secret },
      }} />
      <section className="mt-6 rounded-card border border-line bg-white p-5 text-sm">
        <h2 className="font-semibold">Какие события отправляются</h2>
        <table className="mt-3 w-full text-left text-xs sm:text-sm">
          <thead className="text-muted"><tr><th className="py-1 pr-3 font-medium">Шаг</th><th className="py-1 pr-3 font-medium">TikTok</th><th className="py-1 pr-3 font-medium">Meta</th><th className="py-1 pr-3 font-medium">GA4</th><th className="py-1 font-medium">Метрика</th></tr></thead>
          <tbody className="divide-y divide-line">
            <tr><td className="py-1.5 pr-3">Любая страница</td><td>PageView</td><td>PageView</td><td>page_view</td><td>hit</td></tr>
            <tr><td className="py-1.5 pr-3">Открыл шаблон</td><td>ViewContent</td><td>ViewContent</td><td>view_item</td><td>detail · view_template</td></tr>
            <tr><td className="py-1.5 pr-3">Загрузил фото</td><td>AddToCart</td><td>AddToCart</td><td>add_to_cart</td><td>add · photo_uploaded</td></tr>
            <tr><td className="py-1.5 pr-3">Нажал «Оплатить»</td><td>InitiateCheckout</td><td>InitiateCheckout</td><td>begin_checkout</td><td>checkout</td></tr>
            <tr><td className="py-1.5 pr-3">Оплата прошла</td><td>CompletePayment*</td><td>Purchase*</td><td>purchase*</td><td>purchase</td></tr>
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted">* В браузере и с сервера (если указан токен) с одним event_id — платформа засчитывает покупку один раз. Валюта KZT, сумма — реально оплаченная.</p>
      </section>
    </>
  );
}
