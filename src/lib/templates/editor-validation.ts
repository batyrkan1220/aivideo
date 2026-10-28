import type { TemplateInput } from "./admin-schema";

/**
 * Field-level validation for the admin template editor. Mirrors the server schema
 * (templateInputSchema) and publish rules (publishProblems) so errors show next to
 * the exact field before anything is sent. The server re-validates regardless.
 *
 * Keys are stable field ids used for anchors: "titleKk", "cover", "quality.0.labelKk", …
 */
export type FieldErrors = Record<string, string>;

export const M = {
  required: "Обязательное поле.",
  titleShort: "Название — минимум 2 символа.",
  titleLong: "Название — не больше 120 символов.",
  descLong: "Описание — не больше 1000 символов.",
  previewMissing: "Для публикации загрузите видео.",
  keyFormat: "Только строчные латинские буквы, цифры и «_».",
  keyDuplicate: "Такой ключ уже есть.",
  noAvailableQuality: "Нужно хотя бы одно доступное качество.",
  nonNegative: "Не может быть отрицательным.",
  wholeNumber: "Введите целое число.",
  percentMax: "Процент не может быть больше 100.",
  discountEnds: "Окончание должно быть позже начала.",
  maxBelowMin: "Максимальная цена не может быть меньше минимальной.",
  includedFacesMin: "Минимум 1.",
  providerMissing: "Выберите провайдера.",
  jsonInvalid: "Ошибка в настройках провайдера.",
  uploadSize: "От 1 до 10 МБ.",
  promptLong: "Текст — не больше 1500 символов.",
} as const;

const KEY_RE = /^[a-z0-9_]+$/;
const isInt = (v: unknown) => typeof v === "number" && Number.isInteger(v);

/** Parses the provider JSON; returns null when invalid. */
export function parseConfig(text: string): Record<string, unknown> | null {
  if (!text.trim()) return {};
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

export function validateTemplateForm(t: TemplateInput, configText: string, forPublish: boolean): FieldErrors {
  const e: FieldErrors = {};
  const title = t.titleKk.trim();
  if (!title) e.titleKk = M.required;
  else if (title.length < 2) e.titleKk = M.titleShort;
  else if (title.length > 120) e.titleKk = M.titleLong;
  if (t.descriptionKk.length > 1000) e.descriptionKk = M.descLong;

  if (forPublish && !t.previewVideoPath) e.preview = M.previewMissing;

  const keys = new Map<string, number>();
  t.qualities.forEach((q, i) => {
    if (!q.labelKk.trim()) e[`quality.${i}.labelKk`] = M.required;
    if (!q.key) e[`quality.${i}.key`] = M.required;
    else if (!KEY_RE.test(q.key)) e[`quality.${i}.key`] = M.keyFormat;
    else if (keys.has(q.key)) e[`quality.${i}.key`] = M.keyDuplicate;
    else keys.set(q.key, i);
    if (!q.providerQuality.trim()) e[`quality.${i}.providerQuality`] = M.required;
    if (!isInt(q.surchargeKzt)) e[`quality.${i}.surchargeKzt`] = M.wholeNumber;
    else if (q.surchargeKzt < 0) e[`quality.${i}.surchargeKzt`] = M.nonNegative;
    if (q.fps !== undefined && (!isInt(q.fps) || q.fps <= 0)) e[`quality.${i}.fps`] = M.wholeNumber;
  });
  if (!t.qualities.some((q) => q.available)) e.qualities = M.noAvailableQuality;

  const p = t.pricing;
  const money = (k: string, v: number | undefined, required = true) => {
    if (v === undefined || Number.isNaN(v)) { if (required) e[k] = M.required; return; }
    if (!isInt(v)) e[k] = M.wholeNumber;
    else if (v < 0) e[k] = M.nonNegative;
  };
  money("pricing.basePriceKzt", p.basePriceKzt);
  money("pricing.platformFeeKzt", p.platformFeeKzt);
  money("pricing.minPriceKzt", p.minPriceKzt);
  if (p.maxPriceKzt !== undefined) {
    money("pricing.maxPriceKzt", p.maxPriceKzt);
    if (!e["pricing.maxPriceKzt"] && p.maxPriceKzt < p.minPriceKzt) e["pricing.maxPriceKzt"] = M.maxBelowMin;
  }
  if (p.chargeExtraFaces) {
    money("pricing.extraFacePriceKzt", p.extraFacePriceKzt);
    if (!isInt(p.includedFaces) || p.includedFaces < 1) e["pricing.includedFaces"] = M.includedFacesMin;
  }
  if (p.discount) {
    const v = p.discount.value;
    if (v === undefined || Number.isNaN(v)) e["pricing.discount.value"] = M.required;
    else if (v < 0) e["pricing.discount.value"] = M.nonNegative;
    else if (p.discount.type === "percent" && v > 100) e["pricing.discount.value"] = M.percentMax;
    if (p.discount.startsAt && p.discount.endsAt && new Date(p.discount.endsAt) <= new Date(p.discount.startsAt)) {
      e["pricing.discount.endsAt"] = M.discountEnds;
    }
  }

  const mb = t.maxUploadBytes / 1024 / 1024;
  if (!(mb >= 1 && mb <= 10)) e.maxUploadBytes = M.uploadSize;

  if (forPublish && !t.providerKey) e.providerKey = M.providerMissing;
  const cfg = parseConfig(configText);
  if (!cfg) e.providerConfig = M.jsonInvalid;

  if (t.providerKey === "seedance" && cfg && typeof cfg.prompt === "string" && cfg.prompt.trim().length > 1500) {
    e["seedance.prompt"] = M.promptLong;
  }
  return e;
}

/** Visual order of fields, so "go to first error" lands on the top-most one. */
export function firstErrorKey(errors: FieldErrors): string | null {
  const order = [
    "titleKk", "descriptionKk", "preview", "providerKey", "maxUploadBytes", "seedance.prompt", "qualities",
    ...Object.keys(errors).filter((k) => k.startsWith("quality.")).sort(),
    "pricing.basePriceKzt", "pricing.platformFeeKzt", "pricing.includedFaces", "pricing.extraFacePriceKzt",
    "pricing.discount.value", "pricing.discount.endsAt", "pricing.minPriceKzt", "pricing.maxPriceKzt",
    "providerConfig",
  ];
  return order.find((k) => errors[k]) ?? Object.keys(errors)[0] ?? null;
}
