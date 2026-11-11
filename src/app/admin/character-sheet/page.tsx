import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ru } from "@/lib/i18n/ru";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { FACE_PROMPT, OMNI_PROMPT, sheetSettings } from "@/lib/generation/sheet-settings";
import { SheetTester } from "./tester";

export default function CharacterSheetPage() {
  return (
    <Suspense fallback={<div className="skeleton h-96 rounded-card" />}>
      <Body />
    </Suspense>
  );
}

async function Body() {
  const u = await getSessionUser();
  if (!u) redirect("/login?next=/admin/character-sheet");
  if (!can(u.role, "templates.manage")) return <p className="text-muted">{ru.admin.forbidden}</p>;
  await connection();
  const saved = await sheetSettings();
  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-2xl">Character Sheet</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Перед каждым видео Kling рисует такой лист по фото клиента, и он идёт в видео вместе с фото. Здесь можно проверить на любом фото,
          как он получается, и подобрать промпт. «Сохранить для заказов» — заказы будут рисовать лист с этими настройками. Включается и выключается кнопкой «Character Sheet» в разделе «Шаблоны».
        </p>
      </header>
      <SheetTester saved={saved} prompts={{ face: FACE_PROMPT, omni: OMNI_PROMPT }} />
    </div>
  );
}
