import "server-only";

/**
 * Tiny in-process cache for data that changes rarely (settings, categories, showcase, catalog pages).
 * The database is far from the server (Tokyo ↔ Ohio), so every saved round trip is ~150–200 ms.
 * Concurrent callers share one in-flight request. Admin writes call clearMemo() so changes show at once
 * (the app runs as a single instance); otherwise entries expire after their TTL.
 */
type Entry = { at: number; ttl: number; value?: unknown; pending?: Promise<unknown> };
const store = new Map<string, Entry>();

export async function memo<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const e = store.get(key);
  if (e && "value" in e && now - e.at < e.ttl) return e.value as T;
  if (e?.pending) return e.pending as Promise<T>;
  const pending = load().then(
    (value) => { store.set(key, { at: Date.now(), ttl: ttlMs, value }); return value; },
    (err) => { store.delete(key); throw err; },
  );
  store.set(key, { ...(e ?? { at: 0, ttl: ttlMs }), pending });
  return pending;
}

/** Drops cached entries (all, or those whose key starts with `prefix`). */
export function clearMemo(prefix = "") {
  for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k);
}
