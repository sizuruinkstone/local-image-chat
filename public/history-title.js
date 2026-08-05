export const TITLE_MAX_LENGTH = 160;
export const DEFAULT_TITLE_MODE = "character-date";

export const TITLE_MODES = Object.freeze([
  "date",
  "character",
  "model",
  "character-date",
  "character-outfit",
  "template"
]);

const GENERIC_CHARACTER_TAGS = new Set([
  "1boy",
  "1girl",
  "1other",
  "2boys",
  "2girls",
  "3girls",
  "female",
  "male",
  "multiple girls",
  "multiple boys",
  "person",
  "people",
  "solo"
]);

export function normalizeTitleMode(value) {
  return TITLE_MODES.includes(value) ? value : DEFAULT_TITLE_MODE;
}

export function normalizeManualTitle(value) {
  return typeof value === "string" ? value.trim().slice(0, TITLE_MAX_LENGTH) : "";
}

export function normalizeTitleTemplate(value) {
  return typeof value === "string" ? value.slice(0, TITLE_MAX_LENGTH) : "";
}

// 履歴表示名の共通fallback。旧履歴にはtitleが無いため、descriptionを残して使う。
export function generationTitle(generation) {
  const title = String(generation?.title ?? "").trim();
  if (title) return title;
  const description = String(generation?.description ?? "").trim();
  return description || "無題";
}

export function buildGenerationTitle({
  title = "",
  titleMode = DEFAULT_TITLE_MODE,
  titleTemplate = "",
  structuredPrompt = null,
  settings = {},
  images = [],
  createdAt = new Date().toISOString()
} = {}) {
  const manual = normalizeManualTitle(title);
  if (manual) return manual;

  const mode = normalizeTitleMode(titleMode);
  const parts = titleDateParts(createdAt);
  const character = firstMeaningfulTag(structuredPrompt?.character);
  const outfit = firstMeaningfulTag(structuredPrompt?.appearance)
    || firstMeaningfulTag(structuredPrompt?.outfit);
  const model = [
    settings?.modelName,
    settings?.checkpointModelName,
    settings?.model,
    settings?.checkpoint
  ].map(displayModelName).find(Boolean) ?? "";
  const seed = firstImageSeed(images);
  const fallback = parts.datetime;
  let value;

  switch (mode) {
    case "date":
      value = fallback;
      break;
    case "character":
      value = character || fallback;
      break;
    case "model":
      value = model || fallback;
      break;
    case "character-date":
      value = character ? `${character} · ${fallback}` : fallback;
      break;
    case "character-outfit":
      value = character ? [character, outfit].filter(Boolean).join(" · ") : fallback;
      break;
    case "template":
      value = applyTitleTemplate(titleTemplate, { character, outfit, model, seed, ...parts });
      break;
    default:
      value = fallback;
      break;
  }

  const cleaned = cleanGeneratedTitle(value);
  return cleaned.slice(0, TITLE_MAX_LENGTH) || fallback;
}

function applyTitleTemplate(template, values) {
  const source = normalizeTitleTemplate(template);
  return source.replace(/\{([^{}]+)\}/g, (_match, key) => values[String(key).trim().toLowerCase()] ?? "");
}

function titleDateParts(value) {
  const date = new Date(value);
  const safeDate = Number.isFinite(date.getTime()) ? date : new Date();
  const dateText = [safeDate.getFullYear(), safeDate.getMonth() + 1, safeDate.getDate()]
    .map((part, index) => index === 0 ? String(part).padStart(4, "0") : String(part).padStart(2, "0"))
    .join("/");
  const timeText = [safeDate.getHours(), safeDate.getMinutes()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
  return { date: dateText, time: timeText, datetime: `${dateText} ${timeText}` };
}

function firstImageSeed(images) {
  const seed = images?.[0]?.seed;
  return seed === null || seed === undefined || seed === "" ? "" : String(seed);
}

function firstMeaningfulTag(value) {
  const tags = String(value ?? "")
    .split(/[,，\n]/)
    .map((tag) => cleanTag(tag))
    .filter(Boolean);
  return tags.find((tag) => {
    const normalized = tag.toLowerCase().replaceAll(/[_-]+/g, " ").replaceAll(/\s+/g, " ").trim();
    return !GENERIC_CHARACTER_TAGS.has(normalized) && !/^<lora:/i.test(tag);
  }) ?? "";
}

function cleanTag(value) {
  let tag = String(value ?? "").replace(/[\u0000-\u001f]+/g, " ").trim();
  const weighted = tag.match(/^\((.*):\s*\d+(?:\.\d+)?\)$/);
  if (weighted) tag = weighted[1].trim();
  tag = tag.replace(/^\(+|\)+$/g, "");
  return tag.replaceAll(/\s+/g, " ").trim().slice(0, 80);
}

function displayModelName(value) {
  const model = String(value ?? "").replace(/[\\/]+/g, "/").split("/").pop()?.trim() ?? "";
  return model.replace(/\.safetensors$/i, "").replaceAll(/\s+/g, " ").slice(0, 80);
}

function cleanGeneratedTitle(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f]+/g, " ")
    .replaceAll(/\s+/g, " ")
    .replaceAll(/\s*,\s*,+\s*/g, ", ")
    .replaceAll(/,\s*/g, ", ")
    .trim();
}
