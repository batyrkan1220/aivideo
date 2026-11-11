import "server-only";
import { z } from "zod";
import { memo } from "@/lib/cache/memo";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getKlingFaceImageTask, getKlingImageTask, submitKlingFaceImage, submitKlingImage } from "./kling";
import type { ProviderJobStatus } from "./types";

/**
 * How the Character Sheet is drawn (admin test page saves it; orders use it).
 * engine "face": kling-v2-1 with the photo as a face/subject reference — keeps the person (omni-image
 * redrew the face: "1в1 ұқсамайды"). engine "omni": kling-image-o1, the photo as <<<image_1>>>.
 */
export const SHEET_KEY = "character_sheet";

export const FACE_PROMPT =
  "Character reference sheet of this exact person, photorealistic. The same person shown four times side by side on a plain light-grey studio background: " +
  "front view, three-quarter view, side profile, and a close-up portrait of the face. Identical face in every view, exactly as in the reference photo: " +
  "the same facial features, face shape, eyes, nose, lips, skin tone, age, hairstyle and hair colour. Do not beautify, slim, retouch or change the face. " +
  "The same clothing as in the photo. Neutral pose, even soft studio light, sharp detail, no text, no labels.";

export const OMNI_PROMPT =
  "Character reference sheet of the person in <<<image_1>>>. It must be exactly the same person: the same face, facial features, " +
  "eye shape, nose, lips, skin tone, age, hairstyle and hair colour, body type and the same clothing as in <<<image_1>>>. " +
  "Show the person four times side by side on a plain light-grey studio background: full-body front view, three-quarter view, " +
  "side profile, and a close-up portrait of the face. Neutral standing pose, even soft studio light, sharp photorealistic photo, " +
  "no text, no labels, no frames, no other people. Do not beautify or change the face.";

const schema = z.object({
  engine: z.enum(["face", "omni"]).default("face"),
  reference: z.enum(["subject", "face"]).default("subject"),
  imageFidelity: z.number().min(0).max(1).default(0.5),
  humanFidelity: z.number().min(0).max(1).default(1),
  aspectRatio: z.enum(["16:9", "4:3", "1:1", "3:4", "9:16", "3:2", "2:3", "21:9"]).default("16:9"),
  prompt: z.string().max(2400).default(""),
});
export type SheetSettings = z.infer<typeof schema>;
export const parseSheetSettings = (v: unknown) => schema.parse(v ?? {});
export const sheetPrompt = (s: SheetSettings) => s.prompt.trim() || (s.engine === "face" ? FACE_PROMPT : OMNI_PROMPT);

export function sheetSettings(): Promise<SheetSettings> {
  return memo("settings:character_sheet", 60_000, async () => {
    try {
      const { data } = await supabaseAdmin().from("site_settings").select("value").eq("key", SHEET_KEY).maybeSingle();
      return schema.parse(data?.value ?? {});
    } catch {
      return schema.parse({});
    }
  }, { swr: true });
}

/** Sends one sheet task; the id is prefixed with its engine ("f:" / "o:") so polling knows where to ask. */
export async function submitSheet(photoUrl: string, s: SheetSettings): Promise<string> {
  const prompt = sheetPrompt(s);
  if (s.engine === "omni") return `o:${await submitKlingImage({ photoUrls: [photoUrl], exampleUrl: null, prompt, aspectRatio: s.aspectRatio })}`;
  return `f:${await submitKlingFaceImage({ imageUrl: photoUrl, prompt, reference: s.reference, imageFidelity: s.imageFidelity, humanFidelity: s.humanFidelity, aspectRatio: s.aspectRatio })}`;
}

export function sheetTask(id: string): Promise<ProviderJobStatus> {
  if (id.startsWith("f:")) return getKlingFaceImageTask(id.slice(2));
  return getKlingImageTask(id.startsWith("o:") ? id.slice(2) : id);
}
