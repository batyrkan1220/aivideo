import type { MetadataRoute } from "next";

/** Installable app (Add to Home Screen): opens full screen, like a native app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TrendMe — видео с вашим лицом",
    short_name: "TrendMe",
    description: "Поставь себя в трендовое видео: выберите шаблон, загрузите фото — нейросеть создаст ролик с вами.",
    lang: "ru",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f5f4f1",
    theme_color: "#f5f4f1",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Тренды", url: "/", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Мои видео", url: "/orders", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Создать своё", url: "/create", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
