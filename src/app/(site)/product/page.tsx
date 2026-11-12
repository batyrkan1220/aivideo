import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { env } from "@/lib/env";
import { getSessionUser } from "@/lib/auth/session";
import { isGuestEmail } from "@/lib/telegram/session";
import { LoginToCreate } from "@/components/login-to-create";
import { CreateFlow } from "@/components/create-flow";
import { Logo } from "@/components/logo";
import { ButtonLink } from "@/components/ui/button";
import { isFreeOrderUser } from "@/lib/orders/free";
import { activeDiscount } from "@/lib/engage/discount";
import { adOffer } from "@/lib/engage/offer";
import { productTemplate, productVideoSettings } from "@/lib/product-video/settings";

export const metadata = { title: "Видео товара" };

/** «Видео товара»: product photo (+ model photo) → an ad video with AI (Kling 4.0). */
export default function ProductPage() {
  return (
    <main className="mx-auto w-full max-w-xl px-4 pb-4 pt-3 md:pt-10">
      <div className="tg-only mb-3 flex items-center"><Logo className="text-base" /></div>
      <header className="mb-5">
        <span className="inline-flex rounded-full bg-brand px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-night">Новое</span>
        <h1 className="mt-3 text-[28px] font-extrabold leading-none tracking-tight">Видео товара</h1>
        <p className="mt-2 text-muted">Загрузите фото товара и, если хотите, фото модели — ИИ снимет рекламный ролик: в руках, на примерке, в студии. Для Kaspi, Instagram и TikTok.</p>
        <ol className="mt-3 flex flex-wrap gap-2 text-[12px] font-semibold">
          {["1. Фото товара", "2. Модель — по желанию", "3. Сцена", "4. Готово за 3–7 минут"].map((x) => (
            <li key={x} className="rounded-full bg-surface px-3 py-1.5 ring-1 ring-line">{x}</li>
          ))}
        </ol>
      </header>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-[24px] bg-surface" aria-hidden />}>
        <Body />
      </Suspense>
      <Link href="/montage" className="mt-8 flex items-center justify-between gap-3 rounded-[24px] bg-surface px-4 py-3.5 ring-1 ring-line hover:bg-mist">
        <span className="min-w-0">
          <span className="block text-[15px] font-extrabold">✂️ Автомонтаж</span>
          <span className="block truncate text-[12px] text-muted">Свои видео → один ролик из лучших моментов · бесплатно</span>
        </span>
        <span className="text-muted" aria-hidden>→</span>
      </Link>
    </main>
  );
}

async function Body() {
  await connection();
  const [user, s, t] = await Promise.all([getSessionUser(), productVideoSettings(), productTemplate()]);
  if (!s.enabled || !t) {
    return (
      <div className="rounded-[24px] border border-dashed border-line bg-surface px-6 py-12 text-center">
        <h2 className="text-lg font-bold">Скоро откроем</h2>
        <p className="mt-1 text-sm text-muted">Видео товара временно недоступно.</p>
        <ButtonLink href="/" className="mt-5">К шаблонам</ButtonLink>
      </div>
    );
  }
  if (!user || isGuestEmail(user.email)) return <LoginToCreate next="/product" />;
  const e = env();
  return (
    <CreateFlow
      templateId={t.id} slots={t.faceSlots} qualities={t.qualities} pricing={t.pricing}
      allowWish product={{ prices: { 5: s.price5Kzt, 10: s.price10Kzt } }}
      maxUploadBytes={Math.min(t.maxUploadBytes, e.UPLOAD_MAX_BYTES)} minDimension={e.UPLOAD_MIN_DIMENSION} maxDimension={e.UPLOAD_MAX_DIMENSION}
      supabaseUrl={e.NEXT_PUBLIC_SUPABASE_URL} anonKey={e.NEXT_PUBLIC_SUPABASE_ANON_KEY}
      askPhone={e.PAYMENT_PROVIDER === "tole" || e.PAYMENT_PROVIDER === "tole_sandbox"}
      freeOrders={await isFreeOrderUser(user.id)}
      discount={(await activeDiscount(user.id)) ?? (await adOffer(user.id))}
      signedIn needTelegram={false}
      item={{ id: t.id, name: "Видео товара", price: s.price5Kzt }}
    />
  );
}
