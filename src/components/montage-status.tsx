"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Download, RotateCcw, Send, Sparkles } from "lucide-react";
import { haptic, launchInitData, telegramApp } from "@/lib/telegram/client";

type Status = { status: "draft" | "queued" | "processing" | "completed" | "failed"; error?: string | null; durationSec?: number | null };

const FAIL: Record<string, string> = {
  no_cuts: "В видео не нашлось подходящих моментов. Попробуйте другие видео.",
  clip_missing: "Видео не загрузились до конца. Попробуйте ещё раз.",
  too_large: "Ролик получился слишком большим. Выберите длину поменьше.",
};

/** Автомонтаж result page: waits for the render (polls), then the video with download / Telegram. */
export function MontageStatus({ id, initial }: { id: string; initial: Status }) {
  const [s, setS] = useState<Status>(initial);
  const [sent, setSent] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const inTg = useSyncExternalStore(() => () => {}, () => !!launchInitData(), () => false);
  const waiting = s.status === "queued" || s.status === "processing";

  useEffect(() => {
    if (!waiting) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/montage/${id}`, { cache: "no-store" });
        const j = (await r.json()) as Status & { ok?: boolean };
        if (!stop && j.ok) {
          if (j.status === "completed") haptic("success");
          setS(j);
        }
      } catch { /* next tick */ }
    };
    const t = window.setInterval(() => void tick(), 4000);
    void tick();
    return () => { stop = true; window.clearInterval(t); };
  }, [id, waiting]);

  const sendToChat = async () => {
    if (sent === "sending") return;
    setSent("sending");
    haptic("tap");
    try {
      const r = await fetch(`/api/montage/${id}/telegram`, { method: "POST" });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean };
      setSent(j.ok ? "sent" : "error");
      haptic(j.ok ? "success" : "error");
    } catch { setSent("error"); }
  };
  const download = async () => {
    const wa = telegramApp();
    if (inTg && wa?.downloadFile && wa.isVersionAtLeast?.("8.0")) {
      try {
        const j = (await (await fetch(`/api/montage/${id}/video?download=1&json=1`)).json()) as { url: string; fileName: string };
        wa.downloadFile({ url: j.url, file_name: j.fileName });
        return;
      } catch { /* the plain link below */ }
    }
    location.href = `/api/montage/${id}/video?download=1`;
  };

  if (waiting) {
    return (
      <div className="rounded-card bg-surface p-6 text-center ring-1 ring-line">
        <span className="mx-auto mb-4 block h-12 w-12 animate-spin rounded-full border-4 border-mist border-t-ink" aria-hidden />
        <h2 className="t-h2">Собираем ваш ролик…</h2>
        <p className="mt-2 text-sm text-muted">Выбираем лучшие моменты и склеиваем. Обычно 1–3 минуты. Можно закрыть страницу — готовый ролик придёт в Telegram.</p>
      </div>
    );
  }
  if (s.status === "failed") {
    return (
      <div className="rounded-card bg-surface p-6 text-center ring-1 ring-line">
        <h2 className="t-h2">Не получилось собрать ролик</h2>
        <p className="mt-2 text-sm text-muted">{FAIL[s.error ?? ""] ?? "Что-то пошло не так. Попробуйте ещё раз — это бесплатно."}</p>
        <Link href="/montage" className="btn-glow mt-5 inline-flex h-12 items-center gap-2 rounded-full px-6 font-semibold"><RotateCcw size={16} aria-hidden />Попробовать снова</Link>
      </div>
    );
  }
  if (s.status !== "completed") return <p className="text-center text-sm text-muted">Монтаж не найден.</p>;
  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,320px)_1fr] md:items-start">
      <video src={`/api/montage/${id}/video`} controls playsInline className="mx-auto aspect-[9/16] w-full max-w-[320px] rounded-[1.5rem] bg-night object-cover ring-1 ring-black/5" />
      <div className="space-y-3 text-center md:text-left">
        <h2 className="t-h1">Ролик готов!</h2>
        {s.durationSec ? <p className="text-sm text-muted">{Math.round(Number(s.durationSec))} сек · 9:16 для TikTok, Reels, Shorts</p> : null}
        <div className="mx-auto grid max-w-sm gap-2 md:mx-0">
          {inTg && (
            <button type="button" onClick={() => void sendToChat()} disabled={sent === "sending"}
              className="inline-flex h-13 w-full items-center justify-center gap-2 whitespace-nowrap rounded-full bg-[#2AABEE] px-6 font-semibold text-white disabled:opacity-70">
              <Send size={18} aria-hidden />{sent === "sending" ? "Отправляем…" : "Отправить в чат Telegram"}
            </button>
          )}
          <button type="button" onClick={() => void download()} className={`${inTg ? "border border-line bg-surface text-ink" : "btn-glow"} inline-flex h-13 w-full items-center justify-center gap-2 whitespace-nowrap rounded-full px-6 font-semibold`}>
            <Download size={18} aria-hidden />Скачать видео
          </button>
          <Link href="/montage" className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-line px-6 text-sm font-semibold">
            <Sparkles size={16} aria-hidden />Сделать ещё
          </Link>
        </div>
        {sent === "sent" && <p className="text-sm font-medium text-success">Отправили в чат с ботом — оттуда можно сохранить в галерею.</p>}
        {sent === "error" && <p className="text-sm text-danger">Не удалось отправить. Попробуйте скачать.</p>}
        <p className="text-xs text-muted">Ролик хранится 30 дней.</p>
      </div>
    </div>
  );
}
