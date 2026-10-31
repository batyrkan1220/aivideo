/*
  TrendMe service worker: makes the Mini App reopen fast.
  - App code (/_next/static, fingerprinted, never changes): cache-first.
  - Template covers from Supabase Storage (public template-media images): cache-first, capped.
  Pages, API calls, videos (range requests) and private files are never touched.
*/
const STATIC = "tm-static-v1";
const IMAGES = "tm-img-v1";
const KEEP = [STATIC, IMAGES];

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (!KEEP.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function trim(name, max) {
  const c = await caches.open(name);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

async function cacheFirst(name, req, max, cors = false) {
  const c = await caches.open(name);
  const hit = await c.match(req.url);
  if (hit) return hit;
  // Cross-origin images are fetched in CORS mode (Supabase allows it) so the cached copy is a
  // normal response, not an opaque one (opaque entries cost a lot of storage quota).
  let res;
  try {
    res = await fetch(cors ? new Request(req.url, { mode: "cors", credentials: "omit" }) : req);
  } catch {
    return fetch(req);
  }
  if (res.ok) c.put(req.url, res.clone()).then(() => trim(name, max)).catch(() => {});
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || req.headers.has("range")) return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin && url.pathname.startsWith("/_next/static/")) {
    e.respondWith(cacheFirst(STATIC, req, 400));
    return;
  }
  if (req.destination === "image" && url.pathname.includes("/storage/v1/object/public/template-media/")) {
    e.respondWith(cacheFirst(IMAGES, req, 300, true));
  }
});
