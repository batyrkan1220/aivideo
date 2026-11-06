"use client";
import { useState } from "react";
import { reanalyzeTemplate } from "./actions";

/** Admin list: queue the AI analysis on the server (people count and things stay as set). */
export function ReanalyzeButton({ id }: { id: string }) {
  const [state, setState] = useState<"idle" | "busy" | "queued" | "err">("idle");
  return (
    <button type="button" disabled={state === "busy" || state === "queued"}
      onClick={async () => { setState("busy"); const r = await reanalyzeTemplate(id); setState(r.ok ? "queued" : "err"); }}
      className="rounded-full border border-line px-2.5 py-1 text-xs font-semibold hover:border-ink disabled:opacity-60">
      {state === "queued" ? "В очереди, ~1 мин" : state === "busy" ? "…" : state === "err" ? "Ошибка" : "✨ ИИ-анализ"}
    </button>
  );
}
