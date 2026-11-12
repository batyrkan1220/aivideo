"use client";

/** PUT to a Supabase signed upload URL with real progress; a 45 s stall aborts (weak mobile network). */
export function uploadWithProgress(url: string, file: File, anonKey: string, onProgress: (p: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("apikey", anonKey);
    xhr.setRequestHeader("x-upsert", "false");
    let stall = 0;
    const watch = () => { window.clearTimeout(stall); stall = window.setTimeout(() => xhr.abort(), 45_000); };
    xhr.upload.onprogress = (ev) => { watch(); if (ev.lengthComputable) onProgress(Math.round((ev.loaded / ev.total) * 100)); };
    xhr.onload = () => { window.clearTimeout(stall); if (xhr.status >= 200 && xhr.status < 300) resolve(); else reject(new Error(String(xhr.status))); };
    xhr.onerror = () => { window.clearTimeout(stall); reject(new Error("network")); };
    xhr.onabort = () => reject(new Error("stalled"));
    watch();
    const fd = new FormData();
    fd.append("cacheControl", "3600");
    fd.append("", file);
    xhr.send(fd);
  });
}

/** Duration of a local video or audio file from the browser's decoder (null: unreadable). */
export function readMediaDuration(url: string, kind: "video" | "audio" = "video"): Promise<number | null> {
  return new Promise((resolve) => {
    const v = document.createElement(kind);
    v.preload = "metadata";
    v.muted = true;
    let settled = false;
    const done = (d: number | null) => { if (settled) return; settled = true; v.removeAttribute("src"); v.load(); resolve(d); };
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? v.duration : null);
    v.onerror = () => done(null);
    setTimeout(() => done(null), 15_000);
    v.src = url;
  });
}
