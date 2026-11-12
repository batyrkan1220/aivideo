/**
 * «Видео товара»: scenes the customer picks. Shared by the form (labels) and the provider (prompts).
 * Photos go to Kling in slot order: @image_1 = the product, @image_2 = the model (when there is one).
 */
export type ProductScene = {
  key: string;
  label: string;
  emoji: string;
  /** "model" scenes need the model photo; "product" scenes show the product alone. */
  who: "model" | "product";
  /** What happens, in Kling's words (English: Kling follows it best). */
  action: string;
};

export const PRODUCT_SCENES: ProductScene[] = [
  { key: "hands", label: "В руках", emoji: "🤲", who: "model",
    action: "The person holds the product in their hands at chest height, slowly turns it towards the camera, shows the front and then the side, and smiles. Bright modern home interior, soft daylight from a window." },
  { key: "wear", label: "Примерка", emoji: "👗", who: "model",
    action: "The person wears or uses the product and shows it off to the camera like in a fashion reel: a slow turn, a step closer, a confident pose. If the product is clothing, shoes or an accessory, it is worn by the person; otherwise the person uses it naturally. Clean light studio, soft shadows." },
  { key: "unbox", label: "Распаковка", emoji: "📦", who: "model",
    action: "Unboxing: the person sits at a tidy table, opens a neat box, takes the product out, looks at it with delight and shows it close to the camera." },
  { key: "present", label: "Презентация", emoji: "🎤", who: "model",
    action: "The person stands facing the camera like a blogger in a short UGC ad, holds the product next to their face, points at it and nods enthusiastically, then gives a thumbs up. Cosy room with warm light." },
  { key: "street", label: "На улице", emoji: "🏙️", who: "model",
    action: "The person walks along a sunny city street with the product (worn or carried in hand), the camera tracks beside them; at the end they stop and show the product to the camera. Golden-hour light." },
  { key: "studio", label: "Студия", emoji: "✨", who: "product",
    action: "The product stands alone on a clean round podium in a bright studio; the camera slowly orbits around it, soft reflections, premium e-commerce look." },
  { key: "table", label: "На столе", emoji: "☕", who: "product",
    action: "The product lies on a stylish wooden table with a few matching props around it; the camera slowly pushes in from a wide shot to a detailed close-up. Soft morning light." },
  { key: "nature", label: "Природа", emoji: "🌿", who: "product",
    action: "The product stands on a stone among green leaves outdoors, sunlight flickers through the leaves, a light breeze moves the plants; the camera slowly circles the product." },
  { key: "dynamic", label: "Динамика", emoji: "⚡", who: "product",
    action: "A dynamic ad shot: the product spins slowly in the air in front of a bold coloured background that matches it, with light sparks and soft particles around it, then lands gently in the centre of the frame." },
];

export const PRODUCT_DURATIONS = [5, 10] as const;
export type ProductDuration = (typeof PRODUCT_DURATIONS)[number];
export const PRODUCT_ASPECTS = ["9:16", "1:1", "16:9"] as const;
export type ProductAspect = (typeof PRODUCT_ASPECTS)[number];

export const sceneFor = (key: string, withModel: boolean) =>
  PRODUCT_SCENES.find((s) => s.key === key && (s.who === "product" || withModel)) ?? null;

/** The Kling prompt: who/what each photo is, what must not change, the scene, the customer's details. */
export function buildProductPrompt(o: { scene: ProductScene; withModel: boolean; wish: string; durationSec: number }): string {
  const parts = [
    "@image_1 is the product. Keep the product exactly as in @image_1: the same shape, proportions, colours, materials, logo, label and any text on it. Do not redesign it.",
    o.withModel
      ? "@image_2 is the person. Keep their face, hairstyle, skin tone and body exactly as in @image_2, the same recognisable person in every frame."
      : "No people in the video; only hands may appear if the scene needs them.",
    o.scene.action.replace(/^The person/, o.withModel ? "The person from @image_2" : "The person"),
    `The product from @image_1 is clearly visible and in focus most of the time. One continuous shot of about ${o.durationSec} seconds, smooth camera, realistic commercial quality.`,
  ];
  if (o.wish) parts.push(`Customer details (follow them unless they change the product or the person): ${o.wish}`);
  parts.push("Audio: natural ambient sound and light background music, no speech. No subtitles, no captions, no watermarks.");
  return parts.join("\n");
}
