/** Photo validation shared by client (fast feedback) and server (authoritative). */

export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type PhotoType = (typeof PHOTO_TYPES)[number];
export const PHOTO_EXT: Record<PhotoType, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export type PhotoError = "bad_type" | "too_large" | "too_small" | "too_big_dimensions" | "unreadable";

export type PhotoLimits = { maxBytes: number; minDimension: number; maxDimension: number };

export function validatePhotoMeta(
  meta: { contentType: string; size: number; width?: number; height?: number },
  limits: PhotoLimits,
): PhotoError | null {
  if (!(PHOTO_TYPES as readonly string[]).includes(meta.contentType)) return "bad_type";
  if (meta.size > limits.maxBytes) return "too_large";
  if (meta.size <= 0 || !meta.width || !meta.height) return "unreadable";
  if (Math.min(meta.width, meta.height) < limits.minDimension) return "too_small";
  if (Math.max(meta.width, meta.height) > limits.maxDimension) return "too_big_dimensions";
  return null;
}

/** Detect the real image type from magic bytes (never trust the declared MIME type alone). */
export function sniffImageType(b: Uint8Array): PhotoType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}
