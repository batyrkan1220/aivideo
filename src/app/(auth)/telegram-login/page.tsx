import { Suspense } from "react";
import { kk } from "@/lib/i18n/kk";
import { TelegramCallback } from "./callback";

export const metadata = { title: kk.auth.telegram };

/** Telegram returns here with #tgAuthResult=…; the client posts it to the server and continues. */
export default function TelegramLoginPage() {
  return (
    <Suspense fallback={null}>
      <TelegramCallback />
    </Suspense>
  );
}
