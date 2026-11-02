"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { kk } from "@/lib/i18n/kk";
import { pollTelegramLogin, startTelegramLogin } from "@/lib/telegram/login-actions";
import { TelegramIcon } from "./telegram-icon";

const T = kk.auth;

/**
 * "Log in with Telegram" without email, password or phone number: opens our bot, the person taps
 * Start, and this page signs in by itself (it polls). The request is made before the click so the
 * Telegram link opens directly from the tap (no pop-up blockers).
 */
export function TelegramBotLogin({ next, onDone, compact = false }: { next: string; onDone?: (next: string) => void; compact?: boolean }) {
  const [req, setReq] = useState<{ id: string; botUrl: string } | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "waiting" | "done" | "error">("loading");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = useRef(false);

  const prepare = useCallback(async () => {
    setState("loading");
    const r = await startTelegramLogin(next);
    if (r.ok) { setReq({ id: r.id, botUrl: r.botUrl }); setState("ready"); } else setState("error");
  }, [next]);

  useEffect(() => { const t = setTimeout(() => void prepare(), 0); return () => clearTimeout(t); }, [prepare]);

  /** One poll; returns true while still waiting. */
  const check = useCallback(async (): Promise<boolean> => {
    if (!req || busy.current) return true;
    busy.current = true;
    try {
      const r = await pollTelegramLogin(req.id);
      if (r.state === "done") {
        setState("done");
        if (onDone) onDone(r.next ?? next); else window.location.replace(r.next ?? next);
        return false;
      }
      if (r.state === "expired") { void prepare(); return false; }
      return true;
    } catch {
      return true;
    } finally { busy.current = false; }
  }, [req, next, onDone, prepare]);

  // Waiting: poll every 2.5 s, and at once when the person comes back from Telegram.
  useEffect(() => {
    if (state !== "waiting") return;
    let stopped = false;
    const loop = async () => {
      if (stopped) return;
      const more = await check();
      if (more && !stopped) timer.current = setTimeout(loop, 2500);
    };
    timer.current = setTimeout(loop, 2500);
    const back = () => {
      if (document.visibilityState !== "visible") return;
      if (timer.current) clearTimeout(timer.current);
      void loop();
    };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => { stopped = true; if (timer.current) clearTimeout(timer.current); document.removeEventListener("visibilitychange", back); window.removeEventListener("focus", back); };
  }, [state, check]);

  const btn = "flex h-13 w-full items-center justify-center gap-2.5 rounded-full bg-[#2AABEE] px-5 py-3.5 text-[16px] font-bold text-white shadow-[0_12px_28px_-12px_rgba(42,171,238,0.9)] transition-[transform,background-color] hover:bg-[#229ED9] active:scale-[0.98]";

  if (state === "waiting" || state === "done") {
    return (
      <div className="text-center" role="status" aria-live="polite">
        <span className="mx-auto block h-9 w-9 animate-spin rounded-full border-[3px] border-[#2AABEE]/25 border-t-[#2AABEE]" aria-hidden />
        <p className="mt-3 font-bold">{state === "done" ? T.tgDone : T.tgWaiting}</p>
        {state === "waiting" && (
          <>
            <ol className="mx-auto mt-3 max-w-xs space-y-1.5 text-left text-sm text-muted">
              <li className="flex gap-2"><b className="text-ink">1.</b>{T.tgStep1}</li>
              <li className="flex gap-2"><b className="text-ink">2.</b>{T.tgStep2}</li>
              <li className="flex gap-2"><b className="text-ink">3.</b>{T.tgStep3}</li>
            </ol>
            {req && <a href={req.botUrl} target="_blank" rel="noopener" className="mt-4 inline-block text-sm font-semibold text-[#229ED9] hover:underline">{T.tgOpenAgain}</a>}
          </>
        )}
      </div>
    );
  }
  return (
    <div>
      {state === "error" ? (
        <button type="button" onClick={() => void prepare()} className={btn}><TelegramIcon />{T.tgRetry}</button>
      ) : (
        <a href={req?.botUrl ?? "#"} target="_blank" rel="noopener" aria-disabled={!req}
          onClick={(e) => { if (!req) { e.preventDefault(); return; } setState("waiting"); }}
          className={`${btn} ${!req ? "pointer-events-none opacity-70" : ""}`}>
          <TelegramIcon />{T.telegram}
        </a>
      )}
      {!compact && <p className="mt-2.5 text-center text-xs text-muted">{T.tgHint}</p>}
    </div>
  );
}
