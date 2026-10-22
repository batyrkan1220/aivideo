/**
 * Shrinks a phone photo before upload: longest side ≤ MAX_SIDE, JPEG ~0.9, EXIF rotation applied.
 * A 4–8 MB camera photo becomes ~300–600 KB, so upload and server checks take a second, not ten.
 * Small/already-light images, and any browser failure, keep the original file.
 */
const MAX_SIDE = 1600;
const LIGHT_BYTES = 900 * 1024;

export async function compressPhoto(file: File, minSide: number): Promise<File> {
  try {
    if (typeof createImageBitmap !== "function") return file;
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const { width, height } = bmp;
    const longest = Math.max(width, height);
    if (longest <= MAX_SIDE && file.size <= LIGHT_BYTES) { bmp.close(); return file; }
    const scale = Math.min(1, MAX_SIDE / longest);
    const w = Math.round(width * scale), h = Math.round(height * scale);
    if (Math.min(w, h) < minSide) { bmp.close(); return file; } // never drop below the quality floor
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) { bmp.close(); return file; }
    ctx.fillStyle = "#fff"; // PNG transparency → white instead of black
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}
