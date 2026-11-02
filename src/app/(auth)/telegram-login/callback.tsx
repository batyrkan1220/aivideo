"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { kk } from "@/lib/i18n/kk";
import { TelegramIcon } from "@/components/telegram-icon";

const safe = (n: string | null) => (n && n.startsWith("/") && !n.startsWith("//") ? n : "/account");

/** Reads Telegram's signed result from the URL fragment (never sent to any server by the browser). */
function readResult(): unknown | false | null {
  const m = /[#&]tgAuthResult=([^&]+)/.exec(window.location.hash);
  if (!m) return null;
  if (m[1] === "false") return false;
  try {
    let b = decodeURIComponent(m[1]).replace(/-/g, "+").replace(/_/g, "/");
    b += "=".repeat((4 - (b.length % 4)) % 4);
    const json = new TextDecoder().decode(Uint8Array.from(atob(b), (c) => c.charCodeAt(0)));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function TelegramCallback() {
  const next = safe(useSearchParams().get("next"));
  const [state, setState] = useState<"working" | "cancelled" | "failed">("working");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const data = readResult();
    history.replaceState(null, "", window.location.pathname + window.location.search); // drop the fragment
    if (data === false) { setTimeout(() => setState("cancelled"), 0); return; }
    if (!data) { setTimeout(() => setState("failed"), 0); return; }
    fetch("/api/telegram/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data }), credentials: "same-origin" })
      .then((r) => r.json().catch(() => ({})))
      .then((j: { ok?: boolean }) => { if (j.ok) window.location.replace(next); else setState("failed"); })
      .catch(() => setState("failed"));
  }, [next]);

  return (
    <div className="py-4 text-center" role="status" aria-live="polite">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#2AABEE] text-white shadow-[0_10px_24px_-12px_rgba(42,171,238,0.8)]">
        <TelegramIcon className="h-7 w-7" />
      </span>
      {state === "working" ? (
        <>
          <p className="mt-4 font-semibold">{kk.auth.telegramWorking}</p>
          <span className="mx-auto mt-4 block h-7 w-7 animate-spin rounded-full border-[3px] border-[#2AABEE]/25 border-t-[#2AABEE]" aria-hidden />
        </>
      ) : (
        <>
          <p className="mt-4 font-semibold">{state === "cancelled" ? kk.auth.telegramCancelled : kk.auth.telegramFailed}</p>
          <Link href={`/login?next=${encodeURIComponent(next)}`} className="mt-4 inline-block font-semibold text-brand hover:underline">{kk.auth.telegramBack}</Link>
        </>
      )}
    </div>
  );
}
