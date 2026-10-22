import { z } from "zod";
import type { FaceSlot } from "./schema";

/**
 * Template provider config for Akool Character Swap V5 (shared by the admin editor, the
 * server save path and the generation adapter).
 *
 * Akool rules (docs.akool.com → Swap Studio → Character Swap V5, model akool-premium-multi-person):
 *  1. The template video is analysed once ("person analysis"); Akool returns every detected
 *     person with an `obj_id` (and, when returned, a preview image).
 *  2. The admin chooses which people customers replace (1–5).
 *  3. Each order creates a task with the SAME `video_url` string that was analysed and one
 *     mapping per chosen person: { obj_id, img_url: customer's photo }.
 *  4. Source video: about 3–20 seconds.
 */
export const AKOOL_MAX_PEOPLE = 5;

export const akoolPersonSchema = z.object({
  objId: z.number().int().min(0),
  previewPath: z.string().min(1).max(300).optional(),
});

export const akoolConfigSchema = z.object({
  resolution: z.enum(["480p", "720p"]).default("720p"),
  analysis: z.object({
    id: z.string().regex(/^[a-fA-F0-9]{24}$/),
    videoPath: z.string().min(1).max(300),   // template preview video path that was analysed
    videoUrl: z.string().url(),              // exact URL string sent to Akool (must be reused)
    trackManifestUrl: z.string().url().optional(),
    people: z.array(akoolPersonSchema).max(30),
  }).optional(),
  selected: z.array(z.number().int().min(0)).max(AKOOL_MAX_PEOPLE).default([]),
});
export type AkoolConfig = z.infer<typeof akoolConfigSchema>;
export type AkoolPerson = z.infer<typeof akoolPersonSchema>;

export function parseAkoolConfig(raw: unknown): AkoolConfig {
  const p = akoolConfigSchema.safeParse(raw ?? {});
  return p.success ? p.data : { resolution: "720p", selected: [] };
}

export function akoolSlotLabel(i: number, n: number) {
  return n === 1 ? "Сіздің фотоңыз" : `${i + 1}-адамның фотосы`;
}

/** Customer upload slots, in the admin's selection order. providerInput = `obj_<id>`. */
export function akoolSlots(cfg: AkoolConfig): FaceSlot[] {
  const people = cfg.analysis?.people ?? [];
  const chosen = cfg.selected
    .map((id) => people.find((p) => p.objId === id))
    .filter((p): p is AkoolPerson => !!p);
  const n = chosen.length;
  return chosen.map((p, i) => ({
    key: `face_${i + 1}`,
    labelKk: akoolSlotLabel(i, n),
    position: { x: (i + 1) / (n + 1), y: 0.42 },
    providerInput: `obj_${p.objId}`,
    ...(p.previewPath ? { previewImagePath: p.previewPath } : {}),
    order: i,
  }));
}

/**
 * Problems that block publishing an Akool template (empty = ready).
 * Not analysed at all is fine: the template is a one-person template and each order analyses
 * the video automatically ("auto mode"). An analysis of an older video is an error, because the
 * admin's person selection no longer matches the current video.
 */
export function akoolProblems(cfg: AkoolConfig, previewVideoPath: string | null) {
  const p: ("akool_video_changed" | "akool_no_people")[] = [];
  if (!cfg.analysis) return p;
  if (cfg.analysis.videoPath !== previewVideoPath) p.push("akool_video_changed");
  else if (!akoolSlots(cfg).length) p.push("akool_no_people");
  return p;
}
