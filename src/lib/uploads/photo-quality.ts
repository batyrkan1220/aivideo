/**
 * Quick in-browser check of a customer photo before upload: too dark / too bright / flat,
 * blurry, and — where the browser has a face detector — no face, several faces, face too small.
 * These are soft warnings: the customer can still upload, but most bad videos start with such photos.
 * Pixel maths is separate (assessGray) so it can be unit-tested without a browser.
 */
export type PhotoIssue = "dark" | "bright" | "flat" | "blurry" | "no_face" | "many_faces" | "face_small" | "landscape";
export type Framing = "face" | "half" | "full" | "auto";

const SIDE = 256;

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

type Face = { boundingBox: { width: number; height: number } };
type Detector = { detect: (img: ImageBitmap) => Promise<Face[]> };

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
    // Face detector (Shape Detection API) where the browser has it; otherwise skipped.
    const FD = (globalThis as unknown as { FaceDetector?: new (o: object) => Detector }).FaceDetector;
    if (FD) {
      try {
        const faces = await new FD({ fastMode: true, maxDetectedFaces: 5 }).detect(bmp);
        if (faces.length === 0) issues.push("no_face");
        else if (faces.length > 1) issues.push("many_faces");
        else {
          const rel = faces[0].boundingBox.width / bmp.width;
          if (rel < (framing === "full" ? 0.05 : framing === "face" ? 0.2 : 0.1)) issues.push("face_small");
        }
      } catch { /* detector unavailable on this device */ }
    }
    bmp.close();
    return issues;
  } catch {
    return [];
  }
}
