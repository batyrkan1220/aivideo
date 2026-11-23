/** «Мультфильм»: the looks the admin can pick (shared by the form and the server action). */
export const CARTOON_STYLES = [
  { key: "3d", label: "3D мультфильм", hint: "как современный анимационный фильм",
    look: "a modern 3D animated feature film: stylised 3D cartoon characters with soft rounded shapes, slightly larger expressive eyes, smooth subsurface skin shading, soft global illumination, rich colours" },
  { key: "pixar", label: "Pixar", hint: "как мультфильмы Pixar",
    look: "a Pixar-style 3D animated film. Each person keeps their own face shape, features and body proportions, only rendered the Pixar way: smooth stylised 3D skin with soft subsurface shading, hair as soft sculpted 3D strands, eyes a little larger and more expressive, clean simplified fabric textures, rich saturated colours, polished feature-film render quality; the original scene lighting stays, rendered with soft Pixar-like shading" },
  { key: "anime", label: "Аниме", hint: "японская 2D-анимация",
    look: "Japanese 2D anime: clean line art, cel shading with crisp shadows, vivid colours, painted anime backgrounds" },
  { key: "painted", label: "Акварельное аниме", hint: "мягкое, рисованное от руки",
    look: "a soft hand-painted anime film: gentle watercolour backgrounds, warm natural light, simple clean character drawing, calm pastel palette" },
  { key: "2d", label: "2D мультик", hint: "классический рисованный",
    look: "a classic hand-drawn 2D cartoon: bold clean outlines, flat bright colours, simple cartoon shading, lively cartoon proportions" },
  { key: "clay", label: "Пластилин", hint: "stop-motion",
    look: "claymation stop-motion: everything sculpted from plasticine with visible fingerprints and soft clay texture, miniature handmade set" },
  { key: "comic", label: "Комикс", hint: "чернила и полутона",
    look: "a comic book: bold black ink outlines, halftone dot shading, saturated flat colours, graphic novel look" },
] as const;
export type CartoonStyle = (typeof CARTOON_STYLES)[number]["key"];

/** Style transfer only: every frame of the video stays the same, just drawn in the chosen look. */
export function cartoonPrompt(style: CartoonStyle, extra: string): string {
  const s = CARTOON_STYLES.find((x) => x.key === style) ?? CARTOON_STYLES[0];
  return [
    `Redraw @video_1 as ${s.look}.`,
    "This is a pure style transfer of @video_1, frame by frame. Keep 100% of the content: the same people, the same faces and facial features, expressions, hairstyles, skin tone, body shape and proportions, the same clothes and their colours, the same pose, every movement, gesture and lip movement at exactly the same moment, the same camera movement, framing and cuts, the same background, objects and lighting direction, the same timing and length.",
    "Trace the original exactly like a rotoscope animator: the outlines of every person, garment, object and background element follow the original frame; nothing moves, appears or disappears that does not in @video_1.",
    "Every person stays clearly recognisable as the same person, now drawn as a cartoon character of this style. Do not add, remove, replace or move anything; do not change the story or the composition. Only the rendering style changes, consistently in every frame, with no flicker.",
    ...(extra ? [`Extra details from the editor (only about the look): ${extra}`] : []),
    "Keep the original sound. No subtitles, no text, no watermarks.",
  ].join("\n");
}
