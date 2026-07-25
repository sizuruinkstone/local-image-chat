import crypto from "node:crypto";

// data/lora-registry.json のエントリを扱う純粋関数群。
// ユーザーの手動編集（manualFields）は、Civitai再解析で上書きしない。

export const LORA_CATEGORIES = ["character", "style", "body", "pose", "utility", "other"];

// 既存データは category: "character" | "direction" の2値。
// 新しい内部分類（subcategory）と相互変換して後方互換を保つ。
export function toLegacyCategory(subcategory) {
  return subcategory === "character" ? "character" : "direction";
}

export function normalizeSubcategory(value, fallback = "other") {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (LORA_CATEGORIES.includes(normalized)) return normalized;
  if (normalized === "direction") return "style";
  return fallback;
}

export function ensureEntryUid(entry) {
  if (!entry || typeof entry !== "object") return entry;
  if (typeof entry.uid === "string" && entry.uid) return entry;
  return { ...entry, uid: crypto.randomUUID() };
}

// Civitai由来の更新を既存エントリへ反映する。手動編集済みフィールドは保持する。
export function mergeRegistryEntry(existing, incoming) {
  if (!existing) return ensureEntryUid({ manualFields: [], ...incoming });
  const manualFields = Array.isArray(existing.manualFields) ? [...new Set(existing.manualFields)] : [];
  const merged = { ...existing, ...incoming, uid: existing.uid ?? crypto.randomUUID(), manualFields };
  for (const field of manualFields) {
    if (field in existing) merged[field] = existing[field];
  }
  return merged;
}

// 手動編集で受け付けるフィールドと、その正規化。
const TEXT_LIMIT = 600;

export const EDITABLE_FIELDS = [
  "displayName", "subcategory", "detailCategory", "triggerWords", "negativeWords",
  "recommendedWeight", "recommendedWeightMin", "recommendedWeightMax",
  "checkpointFamilies", "note", "favorite", "previewUrl"
];

export function normalizeEditableFields(input = {}) {
  const patch = {};
  if (typeof input.displayName === "string") patch.displayName = trimText(input.displayName, 200);
  if (input.subcategory !== undefined) patch.subcategory = normalizeSubcategory(input.subcategory);
  if (typeof input.detailCategory === "string") patch.detailCategory = trimText(input.detailCategory, 80);
  if (typeof input.triggerWords === "string") patch.triggerWords = normalizeTagList(input.triggerWords);
  if (typeof input.negativeWords === "string") patch.negativeWords = normalizeTagList(input.negativeWords);
  if (input.recommendedWeight !== undefined) patch.recommendedWeight = boundedWeight(input.recommendedWeight);
  if (input.recommendedWeightMin !== undefined) patch.recommendedWeightMin = boundedWeight(input.recommendedWeightMin);
  if (input.recommendedWeightMax !== undefined) patch.recommendedWeightMax = boundedWeight(input.recommendedWeightMax);
  if (input.checkpointFamilies !== undefined) patch.checkpointFamilies = normalizeFamilies(input.checkpointFamilies);
  if (typeof input.note === "string") patch.note = trimText(input.note, TEXT_LIMIT);
  if (input.favorite !== undefined) patch.favorite = input.favorite === true || input.favorite === "true";
  if (typeof input.previewUrl === "string") patch.previewUrl = normalizePreviewUrl(input.previewUrl);

  // 範囲指定は最小 <= 最大 に整える。
  if (patch.recommendedWeightMin != null && patch.recommendedWeightMax != null
    && patch.recommendedWeightMin > patch.recommendedWeightMax) {
    const min = patch.recommendedWeightMax;
    patch.recommendedWeightMax = patch.recommendedWeightMin;
    patch.recommendedWeightMin = min;
  }
  return patch;
}

// 編集されたフィールドだけをmanualFieldsへ記録し、再解析で消えないようにする。
// 値が変わっていない項目は記録しない（1回編集しただけで全項目が固定されるのを防ぐ）。
export function applyManualEdit(entry, patch) {
  const base = ensureEntryUid(entry ?? {});
  const manualFields = new Set(Array.isArray(base.manualFields) ? base.manualFields : []);
  const next = { ...base };
  let changedSubcategory = false;
  for (const [key, value] of Object.entries(patch)) {
    if (isSameFieldValue(base[key], value)) continue;
    next[key] = value;
    manualFields.add(key);
    if (key === "subcategory") changedSubcategory = true;
  }
  if (changedSubcategory) {
    // 旧形式のcategoryも同時に更新して互換を保つ。
    next.category = toLegacyCategory(next.subcategory);
    manualFields.add("category");
  }
  next.manualFields = [...manualFields];
  next.metadataEditedAt = new Date().toISOString();
  return next;
}

function isSameFieldValue(current, next) {
  const normalize = (value) => {
    // 未設定・空文字・false（チェックを入れていないお気に入り）は同じ扱いにする。
    if (value === undefined || value === null || value === "" || value === false) return "";
    if (Array.isArray(value)) return value.join(",");
    return String(value);
  };
  return normalize(current) === normalize(next);
}

function trimText(value, limit) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, limit);
}

function normalizeTagList(value) {
  return String(value ?? "")
    .replace(/[<>]/g, "")
    .replace(/[\r\n]+/g, ", ")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 80)
    .join(", ")
    .slice(0, TEXT_LIMIT);
}

function boundedWeight(value) {
  if (value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Number(Math.min(2, Math.max(0.05, number)).toFixed(2));
}

function normalizeFamilies(value) {
  const list = Array.isArray(value)
    ? value
    : String(value ?? "").split(",");
  return [...new Set(list
    .map((item) => String(item ?? "").trim().toLowerCase())
    .filter(Boolean))]
    .slice(0, 8);
}

function normalizePreviewUrl(value) {
  const url = String(value ?? "").trim().slice(0, 500);
  if (!url) return "";
  // http(s) と、アプリが配信するローカルパスだけ許可する。
  if (/^https?:\/\//i.test(url) || url.startsWith("/")) return url;
  return "";
}
