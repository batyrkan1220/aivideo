import { Suspense } from "react";
import { ru } from "@/lib/i18n/ru";
import { EditorLoader } from "../editor-loader";

export default function NewTemplatePage() {
  return (
    <Suspense fallback={<p className="text-muted">{ru.common.loading}</p>}>
      <EditorLoader id={null} />
    </Suspense>
  );
}
