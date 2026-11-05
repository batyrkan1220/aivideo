/**
 * Quick in-browser check of a customer photo before upload: too dark / too bright / flat,
 * blurry, and — where the browser has a face detector — no face, several faces, face too small.
 * These are soft warnings: the customer can still upload, but most bad videos start with such photos.
 * Pixel maths is separate (assessGray) so it can be unit-tested without a browser.
 */
export type PhotoIssue = "dark" | "bright" | "flat" | "blurry" | "no_face" | "many_faces" | "face_small" | "landscape";
export type Framing = "face" | "half" | "full" | "auto";

const SIDE = 256;
/** Issues that block the upload (the photo cannot work), the rest are warnings. */
export const BLOCKING: PhotoIssue[] = ["many_faces"];

/** gray: one byte per pixel, row-major. */
export function assessGray(gray: ArrayLike<number>, w: number, h: number): PhotoIssue[] {
  const n = w * h;
  if (!n) return [];
  let sum = 0;
  for (let i = 0; i < n; i++) sum += gray[i];
  const mean = sum / n;
  let sq = 0;
  for (let i = 0; i < n; i++) sq += (gray[i] - mean) ** 2;
  const std = Math.sqrt(sq / n);
  // Sharpness: variance of the Laplacian over the central area (where the person usually is).
  const x0 = Math.floor(w * 0.2), x1 = Math.ceil(w * 0.8), y0 = Math.floor(h * 0.1), y1 = Math.ceil(h * 0.9);
  let ls = 0, ls2 = 0, cnt = 0;
  for (let y = Math.max(1, y0); y < Math.min(h - 1, y1); y++) {
    for (let x = Math.max(1, x0); x < Math.min(w - 1, x1); x++) {
      const i = y * w + x;
      const l = gray[i - w] + gray[i + w] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      ls += l; ls2 += l * l; cnt++;
    }
  }
  const lapVar = cnt ? ls2 / cnt - (ls / cnt) ** 2 : 0;
  const out: PhotoIssue[] = [];
  if (mean < 55) out.push("dark");
  else if (mean > 215) out.push("bright");
  if (std < 22) out.push("flat");
  else if (lapVar < 18) out.push("blurry");
  return out;
}

type NativeFace = { boundingBox: { width: number } };
type NativeDetector = { detect: (img: ImageBitmap | HTMLCanvasElement) => Promise<NativeFace[]> };

/** Faces as widths relative to the image width, or null when no detector could run. */
export type FaceWidths = number[] | null;

/**
 * Faces that count: a real second person, not a tiny face on a poster in the background
 * (smaller than 35 % of the biggest face).
 */
export function faceIssues(faces: FaceWidths, framing: Framing): PhotoIssue[] {
  if (!faces) return [];
  if (faces.length === 0) return ["no_face"];
  const big = Math.max(...faces);
  const people = faces.filter((w) => w >= big * 0.35).length;
  if (people > 1) return ["many_faces"];
  if (big < (framing === "full" ? 0.03 : framing === "face" ? 0.18 : 0.08)) return ["face_small"];
  return [];
}

// Tiny Face Detector (face-api, ~190 KB model in /models/face), loaded on the first photo only.
let faceApi: Promise<typeof import("@vladmandic/face-api") | null> | null = null;
function loadFaceApi() {
  faceApi ??= (async () => {
    try {
      const fa = await import("@vladmandic/face-api/dist/face-api.esm.js");
      await fa.nets.tinyFaceDetector.loadFromUri("/models/face");
      // Warm-up compiles the shaders. A failure here must not disable detection.
      try {
        const warm = document.createElement("canvas");
        warm.width = warm.height = 64;
        for (const inputSize of [416, 608]) await fa.detectAllFaces(warm, new fa.TinyFaceDetectorOptions({ inputSize, scoreThreshold: 0.9 }));
      } catch { /* the real photo or video frame still runs */ }
      return fa as unknown as typeof import("@vladmandic/face-api");
    } catch { faceApi = null; return null; }
  })();
  return faceApi;
}
/** Loads and warms up the detector in the background, when the browser is idle. */
export function preloadFaceDetector() {
  const go = () => void loadFaceApi();
  const idle = (globalThis as unknown as { requestIdleCallback?: (cb: () => void, o?: object) => void }).requestIdleCallback;
  if (idle) idle(go, { timeout: 2500 }); else setTimeout(go, 800);
}

type Box = { x: number; y: number; w: number; h: number };
const iou = (a: Box, b: Box) => {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const i = x * y;
  return i / (a.w * a.h + b.w * b.h - i || 1);
};
/** Adds boxes that are not the same face as one already found. */
export function mergeBoxes(into: Box[], add: Box[]) {
  for (const b of add) if (!into.some((a) => iou(a, b) > 0.25 || (Math.abs(a.x + a.w / 2 - b.x - b.w / 2) < a.w / 2 && Math.abs(a.y + a.h / 2 - b.y - b.h / 2) < a.h / 2))) into.push(b);
  return into;
}

async function detectFaces(canvas: HTMLCanvasElement, bmp: ImageBitmap): Promise<FaceWidths> {
  const fa = await loadFaceApi();
  if (fa) {
    try {
      const run = async (c: HTMLCanvasElement, size: number, score: number) =>
        (await fa.detectAllFaces(c, new fa.TinyFaceDetectorOptions({ inputSize: size, scoreThreshold: score }))).map((d) => ({ x: d.box.x, y: d.box.y, w: d.box.width, h: d.box.height }));
      const W = canvas.width, H = canvas.height;
      const boxes: Box[] = await run(canvas, 416, 0.45);
      // Group / full-length photos: faces are tiny in the whole frame. Look again in 2×2
      // overlapping tiles, where each face is twice as big for the detector.
      // Only when nothing or one small face was found (a big single face = a normal portrait).
      if (boxes.length === 0 || (boxes.length === 1 && boxes[0].w / W < 0.12)) {
        const tw = Math.round(W * 0.58), th = Math.round(H * 0.58);
        const tile = document.createElement("canvas");
        tile.width = tw; tile.height = th;
        const tx = tile.getContext("2d");
        if (tx) {
          for (const [ox, oy] of [[0, 0], [W - tw, 0], [0, H - th], [W - tw, H - th]]) {
            tx.clearRect(0, 0, tw, th);
            tx.drawImage(canvas, ox, oy, tw, th, 0, 0, tw, th);
            mergeBoxes(boxes, (await run(tile, 608, 0.5)).map((b) => ({ ...b, x: b.x + ox, y: b.y + oy })));
            // Two real people found → the answer is known, skip the remaining tiles.
            const ws = boxes.map((b) => b.w).sort((p, q) => q - p);
            if (ws.length > 1 && ws[1] >= ws[0] * 0.35) break;
          }
        }
      }
      if (boxes.length) return boxes.map((b) => b.w / W);
      // A close-up whose face fills the frame is often missed: retry with a border around it.
      const pad = document.createElement("canvas");
      pad.width = W * 2; pad.height = H * 2;
      const px = pad.getContext("2d");
      if (!px) return [];
      px.fillStyle = "#808080"; px.fillRect(0, 0, pad.width, pad.height);
      px.drawImage(canvas, W / 2, H / 2);
      return (await run(pad, 416, 0.4)).map((b) => Math.min(1, b.w / W));
    } catch { /* fall through to the browser detector */ }
  }
  const FD = (globalThis as unknown as { FaceDetector?: new (o: object) => NativeDetector }).FaceDetector;
  if (!FD) return null;
  try {
    const faces = await new FD({ fastMode: true, maxDetectedFaces: 10 }).detect(bmp);
    return faces.map((f) => f.boundingBox.width / bmp.width);
  } catch { return null; }
}

export async function checkPhoto(file: File, framing: Framing = "auto"): Promise<PhotoIssue[]> {
  try {
    if (typeof createImageBitmap !== "function") return [];
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, SIDE / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) { bmp.close(); return []; }
    ctx.drawImage(bmp, 0, 0, w, h);
    const rgba = ctx.getImageData(0, 0, w, h).data;
    const gray = new Uint8ClampedArray(w * h);
    for (let i = 0, j = 0; i < gray.length; i++, j += 4) gray[i] = (rgba[j] * 299 + rgba[j + 1] * 587 + rgba[j + 2] * 114) / 1000;
    const issues = assessGray(gray, w, h);
    if (framing === "full" && bmp.width > bmp.height * 1.15) issues.push("landscape");
    // Faces: a larger copy for the detector (small faces in group photos need pixels).
    const ds = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
    const fc = document.createElement("canvas");
    fc.width = Math.max(1, Math.round(bmp.width * ds)); fc.height = Math.max(1, Math.round(bmp.height * ds));
    fc.getContext("2d")?.drawImage(bmp, 0, 0, fc.width, fc.height);
    issues.push(...faceIssues(await detectFaces(fc, bmp), framing));
    bmp.close();
    return issues;
  } catch {
    return [];
  }
}

export type VideoPerson = { x: number; size: number; image: Blob | null }; // face centre (0..1 from the left), face width / frame width

/** Evenly spaced times from the start of the video to the end, so a person who appears only later is still found. */
function videoSampleTimes(duration: number): number[] {
  const d = Number.isFinite(duration) && duration > 0.3 ? duration : 1;
  const end = Math.max(0.12, d - 0.12);
  const count = Math.min(20, Math.max(6, Math.ceil(d)));
  return Array.from({ length: count }, (_, i) => 0.12 + ((end - 0.12) * i) / Math.max(1, count - 1));
}

function faceJpeg(source: HTMLCanvasElement, box: Box): Promise<Blob | null> {
  const pad = Math.max(box.w, box.h) * 0.45;
  const side = Math.max(box.w, box.h) + pad * 2;
  const sx = Math.max(0, Math.min(box.x + box.w / 2 - side / 2, source.width - 1));
  const sy = Math.max(0, Math.min(box.y + box.h / 2 - side / 2, source.height - 1));
  const sw = Math.min(side, source.width - sx);
  const sh = Math.min(side, source.height - sy);
  const out = document.createElement("canvas");
  out.width = out.height = 512;
  const ctx = out.getContext("2d");
  if (!ctx || sw < 2 || sh < 2) return Promise.resolve(null);
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, 512, 512);
  return new Promise((res) => out.toBlob((b) => res(b), "image/jpeg", 0.9));
}

function seekVideo(v: HTMLVideoElement, t: number): Promise<void> {
  const end = Number.isFinite(v.duration) ? Math.max(0, v.duration - 0.05) : t;
  const target = Math.min(Math.max(0, t), end);
  if (Math.abs(v.currentTime - target) < 0.04) return Promise.resolve();
  return new Promise((res) => {
    const done = () => { v.onseeked = null; clearTimeout(timer); res(); };
    const timer = setTimeout(done, 2000);
    v.onseeked = done;
    v.currentTime = target;
  });
}

/**
 * Template editor: every person who appears anywhere in the video, as one @element each.
 * Faces are followed from the first frame to the last. The same person keeps one slot;
 * someone who shows up only in another part of the video gets the next slot. Left → right.
 * null = detector unavailable.
 */
export async function detectVideoPeople(videoUrl: string): Promise<VideoPerson[] | null> {
  const fa = await loadFaceApi();
  if (!fa) return null;
  const v = document.createElement("video");
  v.muted = true; v.playsInline = true; v.preload = "auto"; v.crossOrigin = "anonymous"; v.src = videoUrl;
  try {
    await new Promise<void>((res, rej) => { v.onloadeddata = () => res(); v.onerror = () => rej(new Error("load")); });
    const c = document.createElement("canvas");
    const W = Math.min(960, v.videoWidth || 720);
    c.width = W; c.height = Math.round(W * ((v.videoHeight || 1280) / (v.videoWidth || 720)));
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    const H = c.height;
    type Track = { x: number; y: number; size: number; n: number; image: Blob | null };
    const tracks: Track[] = [];
    for (const t of videoSampleTimes(v.duration || 1)) {
      await seekVideo(v, t);
      ctx.drawImage(v, 0, 0, c.width, c.height);
      const boxes = mergeBoxes([], (await fa.detectAllFaces(c, new fa.TinyFaceDetectorOptions({ inputSize: 608, scoreThreshold: 0.45 })))
        .map((f) => ({ x: f.box.x, y: f.box.y, w: f.box.width, h: f.box.height }))).filter((b) => b.w / W > 0.03);
      const faces = boxes
        .map((b) => ({ box: b, x: (b.x + b.w / 2) / W, y: (b.y + b.h / 2) / H, size: b.w / W }))
        .sort((a, b) => b.size - a.size);
      const used = new Set<number>();
      for (const face of faces) {
        let best = -1;
        let bestDist = 0.35;
        tracks.forEach((tr, i) => {
          if (used.has(i)) return;
          const dist = Math.hypot(tr.x - face.x, tr.y - face.y);
          if (dist < bestDist) { best = i; bestDist = dist; }
        });
        const shot = face.size >= (best >= 0 ? tracks[best].size : 0) ? await faceJpeg(c, face.box) : null;
        if (best >= 0) {
          const tr = tracks[best];
          used.add(best);
          tr.x = (tr.x * tr.n + face.x) / (tr.n + 1);
          tr.y = (tr.y * tr.n + face.y) / (tr.n + 1);
          if (face.size >= tr.size && shot) tr.image = shot;
          tr.size = Math.max(tr.size, face.size);
          tr.n += 1;
        } else if (tracks.length < 8) {
          tracks.push({ x: face.x, y: face.y, size: face.size, n: 1, image: shot });
          used.add(tracks.length - 1);
        }
      }
    }
    return tracks.map((tr) => ({ x: tr.x, size: tr.size, image: tr.image })).sort((a, b) => a.x - b.x);
  } catch {
    return null;
  }
}
