import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ru } from "@/lib/i18n/ru";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
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
  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-2xl">Character Sheet</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Перед каждым видео Kling рисует такой лист по фото клиента, и он идёт в видео вместе с фото. Здесь можно проверить на любом фото,
          как он получается. Включается и выключается кнопкой «Character Sheet» в разделе «Шаблоны».
        </p>
      </header>
      <SheetTester />
    </div>
  );
}
