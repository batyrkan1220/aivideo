"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ru } from "@/lib/i18n/ru";
import { confirmAsync } from "@/lib/telegram/client";
import { deleteTemplate } from "./actions";

const L = ru.admin.list;

/** Deletes a template after confirmation; `full` = the larger button for the editor page. */
export function DeleteTemplateButton({ id, title, full = false }: { id: string; title: string; full?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const onClick = () => start(async () => {
    setErr(null);
    if (!(await confirmAsync(L.deleteConfirm(title)))) return;
    const r = await deleteTemplate(id);
    if (!r.ok) { setErr(r.error === "forbidden" ? ru.admin.forbidden : L.deleteFailed); return; }
    setErr(null);
    if (full) router.push("/admin/templates");
    router.refresh();
  });
  return (
    <>
    <button type="button" onClick={onClick} disabled={pending}
      className={full
        ? "rounded-full px-4 py-2 text-sm font-medium text-danger hover:bg-red-50 disabled:opacity-50"
        : "font-medium text-muted hover:text-danger disabled:opacity-50"}>
      {pending ? L.deleting : full ? L.deleteTemplate : L.delete}
    </button>
    {err && <span role="alert" className="text-xs text-danger">{err}</span>}
    </>
  );
}
