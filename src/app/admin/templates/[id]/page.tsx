import { Suspense } from "react";
import { kk } from "@/lib/i18n/kk";
import { EditorLoader } from "../editor-loader";

export default function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="text-muted">{kk.common.loading}</p>}>
      <Loader params={params} />
    </Suspense>
  );
}

async function Loader({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditorLoader id={id} />;
}
