"use client";
import { useEffect, useRef, useState } from "react";
import { ru } from "@/lib/i18n/ru";
import { AKOOL_MAX_PEOPLE, type AkoolConfig } from "@/lib/templates/akool-config";
import { startPersonAnalysis, checkPersonAnalysis, type AnalysisError } from "./akool-actions";

const a = ru.admin.editor.akool;
const POLL_MS = 3_000;
const MAX_WAIT_MS = 6 * 60_000;

/**
 * Akool step 1–2: analyse the template video, then pick which detected people customers
 * replace (1–5). Selection order = the order of photo slots on the order page.
 */
export function AkoolPeople({
  videoPath, mediaBase, cfg, onChange, analysisError, peopleError,
}: {
  videoPath: string | null;
  mediaBase: string;
  cfg: AkoolConfig;
  onChange: (next: AkoolConfig) => void;
  analysisError?: string;
  peopleError?: string;
}) {
  const [run, setRun] = useState<{ state: "idle" } | { state: "running"; progress: number | null } | { state: "error"; text: string }>({ state: "idle" });
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const current = cfg.analysis && cfg.analysis.videoPath === videoPath ? cfg.analysis : null;
  const errText = (e: AnalysisError, reason?: string) => (a.errors[e] ?? ru.errors.generic) + (reason ? ` (${reason})` : "");

  const analyse = async () => {
    if (!videoPath) return;
    setRun({ state: "running", progress: null });
    const s = await startPersonAnalysis(videoPath);
    if (!s.ok) { setRun({ state: "error", text: errText(s.error) }); return; }
    const until = Date.now() + MAX_WAIT_MS;
    while (alive.current && Date.now() < until) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const c = await checkPersonAnalysis(s.id, videoPath, s.videoUrl);
      if (!alive.current) return;
      if (!c.ok) { setRun({ state: "error", text: errText(c.error, c.reason) }); return; }
      if (!c.done) { setRun({ state: "running", progress: c.progress }); continue; }
      const people = c.analysis.people;
      onChange({ ...cfg, analysis: c.analysis, selected: people.length === 1 ? [people[0].objId] : [] });
      setRun({ state: "idle" });
      return;
    }
    if (alive.current) setRun({ state: "error", text: a.errors.timeout });
  };

  const toggle = (objId: number) => {
    const sel = cfg.selected.includes(objId)
      ? cfg.selected.filter((x) => x !== objId)
      : cfg.selected.length < AKOOL_MAX_PEOPLE ? [...cfg.selected, objId] : cfg.selected;
    onChange({ ...cfg, selected: sel });
  };

  const running = run.state === "running";
  return (
    <div className="space-y-4">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
        {a.steps.map((s) => <li key={s}>{s}</li>)}
      </ol>
      {!current && <p className="rounded-xl bg-brand-soft px-3 py-2 text-sm">{a.autoNote}</p>}

      <div data-field="akool.analysis">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!videoPath || running}
            onClick={analyse}
            className={`h-11 rounded-full px-5 text-sm font-semibold text-white disabled:opacity-40 ${analysisError ? "bg-danger" : "bg-brand hover:bg-brand-dark"}`}
          >
            {running ? a.analysing(run.progress) : current ? a.reanalyse : a.analyse}
          </button>
          {!videoPath && <span className="text-sm text-muted">{a.needVideo}</span>}
        </div>
        {run.state === "error" && <p className="mt-2 text-sm font-medium text-danger" role="alert">{run.text}</p>}
        {analysisError && run.state !== "error" && <p className="mt-2 text-sm font-medium text-danger" role="alert">{analysisError}</p>}
      </div>

      {current && (
        <div data-field="akool.people">
          <p className="mb-2 text-sm font-medium">
            {a.found(current.people.length)} <span className="text-muted">{a.pick(AKOOL_MAX_PEOPLE)}</span>
          </p>
          <ul className={`grid grid-cols-3 gap-3 rounded-xl p-1 sm:grid-cols-5 ${peopleError ? "ring-2 ring-danger" : ""}`}>
            {current.people.map((p) => {
              const n = cfg.selected.indexOf(p.objId);
              const on = n >= 0;
              const full = !on && cfg.selected.length >= AKOOL_MAX_PEOPLE;
              return (
                <li key={p.objId}>
                  <button
                    type="button"
                    aria-pressed={on}
                    disabled={full}
                    onClick={() => toggle(p.objId)}
                    className={`relative block aspect-[3/4] w-full overflow-hidden rounded-xl border-2 bg-paper transition ${on ? "border-brand" : "border-line hover:border-ink"} disabled:opacity-40`}
                  >
                    {p.previewPath ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`${mediaBase}/${p.previewPath}`} alt={a.personAlt(p.objId + 1)} className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-sm font-semibold text-muted">
                        <span className="h-8 w-8 rounded-full bg-line" aria-hidden />
                        {a.personAlt(p.objId + 1)}
                      </span>
                    )}
                    <span className={`absolute left-1.5 top-1.5 flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-xs font-bold ${on ? "bg-brand text-white" : "bg-white/90 text-muted"}`}>
                      {on ? n + 1 : "+"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {peopleError && <p className="mt-2 text-sm font-medium text-danger" role="alert">{peopleError}</p>}
          <p className="mt-2 text-xs text-muted">{a.orderHint}</p>
        </div>
      )}
    </div>
  );
}
