import { OBJECT_PRESETS, SEEDANCE_MAX_OBJECTS, SEEDANCE_MAX_PEOPLE, type SeedanceConfig, type SwapObject } from "./seedance-config";

/**
 * AI analysis of a template video (Gemini): who and what is in it, a cut-out of each, and a scene
 * note that keeps the video 1:1. Every catalog video template must have it before customers can
 * order it. Pure helpers shared by the admin editor (browser) and the server backfill.
 */
export type Box = [number, number, number, number]; // ymin, xmin, ymax, xmax in 0–1000
export type FoundPerson = { where: string; look: string; ru: string; frame: number; box: Box | null };
export type FoundObject = { what: string; look: string; ru: string; frame: number; box: Box | null };
export type Analysis = { people: FoundPerson[]; objects: FoundObject[]; scene: string };

/** Kling's image rules: sides 300 px or more, shape between 2:5 and 5:2. Cut-outs stay inside them. */
export function cutoutRect(W: number, H: number, box: Box): { sx: number; sy: number; sw: number; sh: number; outW: number; outH: number } | null {
  const [y0, x0, y1, x1] = box.map((v) => v / 1000);
  let cx = ((x0 + x1) / 2) * W, cy = ((y0 + y1) / 2) * H;
  let w = (x1 - x0) * W * 1.3, h = (y1 - y0) * H * 1.2;
  if (w < 24 || h < 24) return null;
  if (h > w * 2) w = h / 2; else if (w > h * 2) h = w / 2;
  w = Math.min(w, W); h = Math.min(h, H);
  cx = Math.min(Math.max(cx, w / 2), W - w / 2); cy = Math.min(Math.max(cy, h / 2), H - h / 2);
  const k = Math.min(720 / Math.max(w, h), Math.max(1, 320 / Math.min(w, h)));
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return { sx: Math.round(cx - w / 2), sy: Math.round(cy - h / 2), sw: Math.round(w), sh: Math.round(h), outW: even(w * k), outH: even(h * k) };
}

export const isAnalyzed = (cfg: Pick<SeedanceConfig, "analyzedAt">) => !!cfg.analyzedAt;

/**
 * New template config from an analysis. cuts = storage paths of the cut-outs (people, then things; "" if none).
 * keep: the admin's people count and things stay as they are (only descriptions and cut-outs are added).
 */
export function applyAnalysis(cfg: SeedanceConfig, a: Analysis, cuts: { people: string[]; objects: string[] }, keep = false, now = new Date()): SeedanceConfig {
  const n = keep ? cfg.people : Math.max(1, Math.min(SEEDANCE_MAX_PEOPLE, a.people.length));
  const positions = Array.from({ length: n }, (_, i) => {
    const p = a.people[i];
    return p ? [p.where, p.look].filter(Boolean).join(", ").slice(0, 120) : (cfg.positions[i] ?? "");
  });
  let objects: SwapObject[];
  if (keep) {
    // Same things as before; each takes the first found one of its kind.
    const used = new Set<number>();
    objects = cfg.objects.map((o) => {
      const j = a.objects.findIndex((f, k) => !used.has(k) && f.what === o.what);
      if (j < 0) return o;
      used.add(j);
      return { ...o, look: a.objects[j].look.slice(0, 120) || o.look, target: cuts.objects[j] || o.target };
    });
  } else {
    objects = a.objects.slice(0, SEEDANCE_MAX_OBJECTS).map((f, j) => {
      const preset = Object.values(OBJECT_PRESETS).find((p) => p.en === f.what);
      return { what: f.what, label: preset?.ru ?? "Фото предмета", look: f.look.slice(0, 120), ...(cuts.objects[j] ? { target: cuts.objects[j] } : {}) };
    });
  }
  const scene = a.scene ? `Keep the video 1:1: ${a.scene}`.slice(0, 1500) : "";
  return {
    ...cfg,
    people: n,
    positions,
    targets: Array.from({ length: n }, (_, i) => cuts.people[i] ?? ""),
    objects,
    // The scene note only fills an empty prompt; the admin's own text is never replaced here.
    prompt: cfg.prompt.trim() ? cfg.prompt : scene,
    showTargets: cuts.people.some(Boolean) || cuts.objects.some(Boolean) ? true : cfg.showTargets,
    analyzedAt: now.toISOString(),
  };
}

/** What Gemini should look for when the admin's counts are kept. */
export function analysisHint(cfg: SeedanceConfig, keep: boolean): { people: number; objects: string[] } | undefined {
  return keep ? { people: cfg.people, objects: cfg.objects.map((o) => o.what) } : undefined;
}
