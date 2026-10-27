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
      // Warm-up: the first run compiles the GPU shaders for both input sizes (seconds on a
      // phone). Doing it now means the customer's photo is checked at full speed.
      const warm = document.createElement("canvas");
      warm.width = warm.height = 64;
      for (const inputSize of [416, 608]) await fa.detectAllFaces(warm, new fa.TinyFaceDetectorOptions({ inputSize, scoreThreshold: 0.9 }));
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
