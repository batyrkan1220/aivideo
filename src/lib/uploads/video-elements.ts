/**
 * Admin scan: one frame every second, from the start of the template video to the end.
 * People come from the face detector. Clothing is the body under each face (the object model
 * has no garment class). Cars, animals, food and everything else come from the local
 * EfficientDet model in /models/coco. Nothing here is sent to Kling.
 */
import type { ObjectDetector } from "@mediapipe/tasks-vision";
import { loadFaceApi } from "./photo-quality";

export type FoundKind = "person" | "outfit" | "object";
export type FoundElement = {
  kind: FoundKind;
  what: string;
  label: string;
  x: number;
  size: number;
  image: Blob | null;
};

const NAMES: Record<string, string> = {
  person: "Человек",
  outfit: "Одежда",
  bicycle: "Велосипед",
  car: "Машина",
  motorcycle: "Мотоцикл",
  airplane: "Самолёт",
  bus: "Автобус",
  train: "Поезд",
  truck: "Грузовик",
  boat: "Лодка",
  "traffic light": "Светофор",
  "fire hydrant": "Гидрант",
  "stop sign": "Знак стоп",
  "parking meter": "Паркомат",
  bench: "Скамейка",
  bird: "Птица",
  cat: "Кошка",
  dog: "Собака",
  horse: "Лошадь",
  sheep: "Овца",
  cow: "Корова",
  elephant: "Слон",
  bear: "Медведь",
  zebra: "Зебра",
  giraffe: "Жираф",
  backpack: "Рюкзак",
  umbrella: "Зонт",
  handbag: "Сумка",
  tie: "Галстук",
  suitcase: "Чемодан",
  frisbee: "Фрисби",
  skis: "Лыжи",
  snowboard: "Сноуборд",
  "sports ball": "Мяч",
  kite: "Воздушный змей",
  "baseball bat": "Бита",
  "baseball glove": "Перчатка",
  skateboard: "Скейтборд",
  surfboard: "Сёрф",
  "tennis racket": "Ракетка",
  bottle: "Бутылка",
  "wine glass": "Бокал",
  cup: "Чашка",
  fork: "Вилка",
  knife: "Нож",
  spoon: "Ложка",
  bowl: "Миска",
  banana: "Банан",
  apple: "Яблоко",
  sandwich: "Сэндвич",
  orange: "Апельсин",
  broccoli: "Брокколи",
  carrot: "Морковь",
  "hot dog": "Хот-дог",
  pizza: "Пицца",
  donut: "Пончик",
  cake: "Торт",
  chair: "Стул",
  couch: "Диван",
  "potted plant": "Растение",
  bed: "Кровать",
  "dining table": "Стол",
  toilet: "Унитаз",
  tv: "Телевизор",
  laptop: "Ноутбук",
  mouse: "Мышь",
  remote: "Пульт",
  keyboard: "Клавиатура",
  "cell phone": "Телефон",
  microwave: "Микроволновка",
  oven: "Духовка",
  toaster: "Тостер",
  sink: "Раковина",
  refrigerator: "Холодильник",
  book: "Книга",
  clock: "Часы",
  vase: "Ваза",
  scissors: "Ножницы",
  "teddy bear": "Игрушка",
  "hair drier": "Фен",
  toothbrush: "Щётка",
};

/** Russian name for a detected class. Unknown classes keep their English name. */
export function elementLabel(what: string): string {
  return NAMES[what] ?? what;
}

/** One timestamp per second, from just after the start through the end (at most 45, plus the last second). */
export function sampleEverySecond(duration: number): number[] {
  const d = Number.isFinite(duration) && duration > 0.4 ? duration : 1;
  const end = Math.max(0.2, d - 0.08);
  const times: number[] = [];
  for (let t = 0.5; t <= end + 1e-6 && times.length < 45; t += 1) times.push(Number(Math.min(t, end).toFixed(3)));
  if (!times.length) times.push(Number(Math.min(0.4, end).toFixed(3)));
  const tail = Number(end.toFixed(3));
  if (tail - times[times.length - 1] > 0.75) times.push(tail);
  return times;
}

type Box = { x: number; y: number; w: number; h: number };
type Track = {
  kind: FoundKind;
  what: string;
  label: string;
  x: number;
  y: number;
  size: number;
  n: number;
  image: Blob | null;
};

let objectModel: Promise<ObjectDetector | null> | null = null;
function loadObjects(): Promise<ObjectDetector | null> {
  objectModel ??= (async () => {
    try {
      const { FilesetResolver, ObjectDetector } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks("/models/mediapipe");
      return await ObjectDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: "/models/coco/efficientdet_lite0.tflite" },
        runningMode: "IMAGE",
        scoreThreshold: 0.4,
        maxResults: 25,
      });
    } catch {
      objectModel = null;
      return null;
    }
  })();
  return objectModel;
}

function clampBox(box: Box, width: number, height: number): Box {
  const x = Math.max(0, Math.min(box.x, width - 1));
  const y = Math.max(0, Math.min(box.y, height - 1));
  return { x, y, w: Math.max(1, Math.min(box.w, width - x)), h: Math.max(1, Math.min(box.h, height - y)) };
}

function cropJpeg(source: HTMLCanvasElement, box: Box): Promise<Blob | null> {
  const pad = Math.max(box.w, box.h) * 0.12;
  const sx = Math.max(0, box.x - pad);
  const sy = Math.max(0, box.y - pad);
  const sw = Math.min(source.width - sx, box.w + pad * 2);
  const sh = Math.min(source.height - sy, box.h + pad * 2);
  if (sw < 2 || sh < 2) return Promise.resolve(null);
  const side = 512;
  const out = document.createElement("canvas");
  out.width = out.height = side;
  const ctx = out.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, side, side);
  const scale = Math.min(side / sw, side / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.drawImage(source, sx, sy, sw, sh, (side - dw) / 2, (side - dh) / 2, dw, dh);
  return new Promise((res) => out.toBlob((b) => res(b), "image/jpeg", 0.86));
}

function seekVideo(v: HTMLVideoElement, t: number): Promise<void> {
  const end = Number.isFinite(v.duration) ? Math.max(0, v.duration - 0.05) : t;
  const target = Math.min(Math.max(0, t), end);
  if (Math.abs(v.currentTime - target) < 0.04) return Promise.resolve();
  return new Promise((res) => {
    const done = () => { v.onseeked = null; clearTimeout(timer); res(); };
    const timer = setTimeout(done, 2000);
    v.onseeked = done;
    v.currentTime = target;
  });
}

/** Same thing across seconds stays one track. A new thing far from the others gets its own photo. */
async function observe(tracks: Track[], canvas: HTMLCanvasElement, box: Box, kind: FoundKind, what: string, x: number, y: number, size: number, distLimit: number) {
  let best = -1;
  let bestDist = distLimit;
  tracks.forEach((tr, i) => {
    if (tr.kind !== kind || tr.what !== what) return;
    const dist = Math.hypot(tr.x - x, tr.y - y);
    if (dist < bestDist) { best = i; bestDist = dist; }
  });
  if (best < 0 && tracks.length >= 24) return;
  const shot = best < 0 || size >= tracks[best].size ? await cropJpeg(canvas, box) : null;
  if (best >= 0) {
    const tr = tracks[best];
    tr.x = (tr.x * tr.n + x) / (tr.n + 1);
    tr.y = (tr.y * tr.n + y) / (tr.n + 1);
    if (size >= tr.size && shot) tr.image = shot;
    tr.size = Math.max(tr.size, size);
    tr.n += 1;
    return;
  }
  tracks.push({ kind, what, label: elementLabel(what), x, y, size, n: 1, image: shot });
}

function bodyForFace(face: Box, bodies: Box[]): Box | null {
  const cx = face.x + face.w / 2;
  const cy = face.y + face.h / 2;
  const hits = bodies.filter((b) => cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h);
  hits.sort((a, b) => a.w * a.h - b.w * b.h);
  return hits[0] ?? null;
}

function clothingBox(face: Box, body: Box | null, width: number, height: number): Box | null {
  const region = body ?? {
    x: face.x + face.w / 2 - face.w * 1.35,
    y: face.y + face.h * 0.8,
    w: face.w * 2.7,
    h: face.h * 3.2,
  };
  const y = Math.max(region.y, face.y + face.h * 0.65);
  const box = clampBox({ x: region.x, y, w: region.w, h: region.y + region.h - y }, width, height);
  if (box.w < width * 0.04 || box.h < height * 0.05) return null;
  return box;
}

function finish(tracks: Track[]): FoundElement[] {
  const people = tracks.filter((t) => t.kind === "person" && t.size >= 0.03).sort((a, b) => a.x - b.x).slice(0, 6);
  const outfits = tracks.filter((t) => t.kind === "outfit" && (t.n >= 2 || t.size >= 0.08)).sort((a, b) => a.x - b.x).slice(0, 4);
  let objects = tracks.filter((t) => t.kind === "object" && (t.n >= 2 || t.size >= 0.12)).sort((a, b) => b.size - a.size || b.n - a.n);
  while (people.length + outfits.length + objects.length > 16 && objects.length) objects = objects.slice(0, -1);
  return [...people, ...outfits, ...objects].slice(0, 16).map((t) => ({
    kind: t.kind, what: t.what, label: t.label, x: t.x, size: t.size, image: t.image,
  }));
}

/**
 * Every person, their clothing, and every other thing visible in the video.
 * null = the video or both detectors failed. [] = the frames were read and nothing qualified.
 */
export async function detectVideoElements(
  videoUrl: string,
  onProgress?: (done: number, total: number) => void,
): Promise<FoundElement[] | null> {
  const [faces, objects] = await Promise.all([loadFaceApi(), loadObjects()]);
  if (!faces && !objects) return null;
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  v.preload = "auto";
  v.crossOrigin = "anonymous";
  v.src = videoUrl;
  try {
    await new Promise<void>((res, rej) => {
      const timer = setTimeout(() => rej(new Error("load")), 20000);
      v.onloadeddata = () => { clearTimeout(timer); res(); };
      v.onerror = () => { clearTimeout(timer); rej(new Error("load")); };
    });
    const c = document.createElement("canvas");
    const width = Math.min(960, v.videoWidth || 720);
    c.width = width;
    c.height = Math.round(width * ((v.videoHeight || 1280) / (v.videoWidth || 720)));
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    const height = c.height;
    const times = sampleEverySecond(v.duration || 1);
    const tracks: Track[] = [];
    for (let i = 0; i < times.length; i++) {
      onProgress?.(i + 1, times.length);
      await seekVideo(v, times[i]);
      ctx.drawImage(v, 0, 0, width, height);
      const faceBoxes: Box[] = [];
      if (faces) {
        try {
          const found = await faces.detectAllFaces(c, new faces.TinyFaceDetectorOptions({ inputSize: 608, scoreThreshold: 0.45 }));
          for (const f of found) {
            const box = { x: f.box.x, y: f.box.y, w: f.box.width, h: f.box.height };
            if (box.w / width >= 0.025) faceBoxes.push(box);
          }
        } catch { /* this second still counts for objects */ }
      }
      const bodies: Box[] = [];
      const things: { box: Box; what: string }[] = [];
      if (objects) {
        try {
          for (const det of objects.detect(c).detections) {
            const what = det.categories[0]?.categoryName?.trim().toLowerCase() ?? "";
            const raw = det.boundingBox;
            if (!what || !raw) continue;
            const box = clampBox({ x: raw.originX, y: raw.originY, w: raw.width, h: raw.height }, width, height);
            if (what === "person") bodies.push(box);
            else if (Math.max(box.w / width, box.h / height) >= 0.04) things.push({ box, what: what.slice(0, 40) });
          }
        } catch { /* faces for this second still count */ }
      }
      if (faceBoxes.length) {
        for (const face of faceBoxes) {
          const x = (face.x + face.w / 2) / width;
          const y = (face.y + face.h / 2) / height;
          await observe(tracks, c, face, "person", "person", x, y, face.w / width, 0.35);
          const cloth = clothingBox(face, bodyForFace(face, bodies), width, height);
          if (cloth) await observe(tracks, c, cloth, "outfit", "outfit", (cloth.x + cloth.w / 2) / width, (cloth.y + cloth.h / 2) / height, Math.max(cloth.w / width, cloth.h / height), 0.34);
        }
      } else {
        for (const body of bodies) {
          if (body.w / width < 0.06) continue;
          const x = (body.x + body.w / 2) / width;
          const y = (body.y + body.h / 2) / height;
          await observe(tracks, c, body, "person", "person", x, y, body.w / width, 0.35);
          const cloth = clampBox({ x: body.x, y: body.y + body.h * 0.28, w: body.w, h: body.h * 0.62 }, width, height);
          if (cloth.h >= height * 0.05) await observe(tracks, c, cloth, "outfit", "outfit", x, (cloth.y + cloth.h / 2) / height, Math.max(cloth.w / width, cloth.h / height), 0.34);
        }
      }
      for (const thing of things) {
        const box = thing.box;
        const size = Math.max(box.w / width, box.h / height);
        await observe(tracks, c, box, "object", thing.what, (box.x + box.w / 2) / width, (box.y + box.h / 2) / height, size, 0.42);
      }
    }
    return finish(tracks);
  } catch {
    return null;
  } finally {
    v.onloadeddata = null;
    v.onerror = null;
    v.removeAttribute("src");
    v.load();
  }
}
