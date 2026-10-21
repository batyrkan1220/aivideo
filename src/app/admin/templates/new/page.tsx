import { Suspense } from "react";
import { kk } from "@/lib/i18n/kk";
import { EditorLoader } from "../editor-loader";

export default function NewTemplatePage() {
  return (
    <Suspense fallback={<p className="text-muted">{kk.common.loading}</p>}>
      <EditorLoader id={null} />
    </Suspense>
  );
}
