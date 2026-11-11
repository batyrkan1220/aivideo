import "server-only";
import { getKlingFaceImageTask, getKlingImageTask, submitKlingFaceImage } from "./kling";
import type { ProviderJobStatus } from "./types";

/**
 * The Character Sheet, one fixed way: kling-v2-1 with the customer's photo as the subject reference at the
 * highest face similarity (omni-image redrew the face: "адамның түрі 1в1 шығуы керек"). No admin options.
 */
const REF = { reference: "subject" as const, imageFidelity: 0.8, humanFidelity: 1 };

export const SHEET_PROMPT =
  "Character reference sheet of this exact person, photorealistic photo. The same person shown four times side by side on a plain light-grey studio background: " +
  "front view, three-quarter view, side profile, and a close-up portrait of the face. The face must be identical to the reference photo in every view: " +
  "the same facial features, face shape, eyes, eyebrows, nose, lips, ears, skin tone, skin texture, moles, age, hairstyle and hair colour, beard if any. " +
  "Do not beautify, slim, retouch, idealise or change the face in any way. The same clothing as in the photo. " +
  "Neutral pose, even soft studio light, sharp detail, no text, no labels.";

/** Sends one sheet task; the id is prefixed "f:" (face-reference endpoint). */
export async function submitSheet(photoUrl: string): Promise<string> {
  return `f:${await submitKlingFaceImage({ imageUrl: photoUrl, prompt: SHEET_PROMPT, aspectRatio: "16:9", ...REF })}`;
}

/** Old tasks (without a prefix or "o:") were sent to omni-image. */
export function sheetTask(id: string): Promise<ProviderJobStatus> {
  if (id.startsWith("f:")) return getKlingFaceImageTask(id.slice(2));
  return getKlingImageTask(id.startsWith("o:") ? id.slice(2) : id);
}
