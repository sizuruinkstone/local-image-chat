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
  if (!existing) return structureCharacterTriggerPresets(
    ensureEntryUid({ manualFields: [], ...incoming })
  );
  const manualFields = Array.isArray(existing.manualFields) ? [...new Set(existing.manualFields)] : [];
  const merged = { ...existing, ...incoming, uid: existing.uid ?? crypto.randomUUID(), manualFields };
  for (const field of manualFields) {
    if (field in existing) merged[field] = existing[field];
  }
  return structureCharacterTriggerPresets(merged);
}

// 手動編集で受け付けるフィールドと、その正規化。
const TEXT_LIMIT = 600;

export const EDITABLE_FIELDS = [
  "displayName", "subcategory", "detailCategory", "triggerWords", "characterTriggerWords",
  "outfitPresets", "negativeWords",
  "recommendedWeight", "recommendedWeightMin", "recommendedWeightMax",
  "checkpointFamilies", "note", "favorite", "previewUrl"
];

export function normalizeEditableFields(input = {}) {
  const patch = {};
  if (typeof input.displayName === "string") patch.displayName = trimText(input.displayName, 200);
  if (input.subcategory !== undefined) patch.subcategory = normalizeSubcategory(input.subcategory);
  if (typeof input.detailCategory === "string") patch.detailCategory = trimText(input.detailCategory, 80);
  if (typeof input.triggerWords === "string") patch.triggerWords = normalizeTagList(input.triggerWords);
  if (typeof input.characterTriggerWords === "string") {
    patch.characterTriggerWords = normalizeTagList(input.characterTriggerWords);
  }
  if (Array.isArray(input.outfitPresets)) patch.outfitPresets = normalizeOutfitPresets(input.outfitPresets);
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
    if (Array.isArray(value)) return JSON.stringify(value);
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

export function normalizeOutfitPresets(value) {
  if (!Array.isArray(value)) return [];
  const usedIds = new Set();
  return value
    .filter((preset) => preset && typeof preset === "object")
    .slice(0, 24)
    .map((preset, index) => {
      const name = trimText(preset.name, 100);
      const triggerWords = normalizeTagList(preset.triggerWords ?? preset.prompt ?? "");
      if (!name && !triggerWords) return null;
      let id = String(preset.id ?? "")
        .trim()
        .slice(0, 100)
        .replace(/[^a-zA-Z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "");
      if (!id || usedIds.has(id)) id = `outfit-${index + 1}`;
      while (usedIds.has(id)) id = `${id}-${index + 1}`;
      usedIds.add(id);
      return {
        id,
        name: name || `衣装${index + 1}`,
        triggerWords
      };
    })
    .filter(Boolean);
}

export function structureCharacterTriggerPresets(entry) {
  if (!entry || (entry.category !== "character" && entry.subcategory !== "character")) return entry;
  const manualFields = new Set(Array.isArray(entry.manualFields) ? entry.manualFields : []);
  const preserveCharacterWords = manualFields.has("characterTriggerWords");
  const preserveOutfits = manualFields.has("outfitPresets");
  if (preserveCharacterWords && preserveOutfits) return entry;

  const sourceWords = splitTagList(entry.triggerWords ?? entry.characterTriggerWords);
  const presets = normalizeOutfitPresets(entry.outfitPresets)
    .map((preset) => ({ ...preset, words: splitTagList(preset.triggerWords).filter(isUsablePromptTag) }))
    .filter((preset) => preset.words.length);

  let baseWords = [];
  let outfitCandidates = presets;

  if (presets.length > 1) {
    const firstIsIdentity = presets[0].words.length <= 4
      && presets[0].words.every((word) => !isOutfitTag(word));
    if (firstIsIdentity) {
      baseWords = presets[0].words;
      outfitCandidates = presets.slice(1);
    } else {
      const commonKeys = intersectPresetKeys(presets);
      baseWords = presets[0].words.filter((word) =>
        commonKeys.has(tagKey(word)) && !isOutfitTag(word)
      );
      const canonicalMarker = commonVariantIdentityMarker(presets);
      if (!baseWords.length) {
        baseWords = canonicalMarker
          ? [canonicalMarker]
          : presets[0].words.filter((word) => !isOutfitTag(word));
      } else if (canonicalMarker) {
        baseWords.unshift(canonicalMarker);
      }
    }
  } else {
    const reference = presets[0]?.words.length ? presets[0].words : sourceWords;
    baseWords = reference.filter((word) => !isOutfitTag(word) && isUsablePromptTag(word));
  }

  // Civitai解析が衣装側へ載せなかった汎用タグ（1girl/solo等）は基本セットへ残す。
  const presetKeys = new Set(presets.flatMap((preset) => preset.words.map(tagKey)));
  for (const word of sourceWords) {
    if (!isUsablePromptTag(word) || isOutfitTag(word)) continue;
    if (!presetKeys.has(tagKey(word)) || isGenericCharacterTag(word)) baseWords.push(word);
  }
  baseWords = uniqueTagWords(baseWords);
  const baseKeys = new Set(baseWords.map(tagKey));

  const outfits = outfitCandidates
    .map((preset) => ({
      id: preset.id,
      name: preset.name,
      triggerWords: uniqueTagWords(preset.words.filter((word) => !baseKeys.has(tagKey(word)))).join(", ")
    }))
    .filter((preset) => preset.triggerWords);

  if (presets.length <= 1) {
    const reference = presets[0]?.words.length ? presets[0].words : sourceWords;
    const outfitWords = uniqueTagWords(reference.filter((word) => isOutfitTag(word)));
    if (outfitWords.length) {
      outfits.splice(0, outfits.length, {
        id: presets[0]?.id || "base-outfit",
        name: presets[0]?.name || "ベース衣装",
        triggerWords: outfitWords.join(", ")
      });
    } else {
      outfits.splice(0);
    }
  }

  const characterTriggerWords = preserveCharacterWords
    ? uniqueTagWords(splitTagList(entry.characterTriggerWords)).join(", ")
    : baseWords.join(", ");
  const nextOutfits = preserveOutfits
    ? normalizeOutfitPresets(entry.outfitPresets)
    : normalizeOutfitPresets(outfits);
  return {
    ...entry,
    triggerWords: characterTriggerWords,
    characterTriggerWords,
    outfitPresets: nextOutfits,
    presetStructureVersion: 1,
    presetStructuredAt: new Date().toISOString()
  };
}

function splitTagList(value) {
  return String(value ?? "")
    .replace(/[\r\n]+/g, ",")
    .split(",")
    .map((word) => word.trim())
    .filter(Boolean);
}

function intersectPresetKeys(presets) {
  const [first, ...rest] = presets;
  const keys = new Set(first?.words.map(tagKey) ?? []);
  for (const preset of rest) {
    const current = new Set(preset.words.map(tagKey));
    for (const key of keys) {
      if (!current.has(key)) keys.delete(key);
    }
  }
  return keys;
}

// ray_\(arknights\) / ray_\(dreaming_high\) のように衣装ごとに
// 接尾辞だけ変わる固有Triggerは、最初のものをキャラクター識別子として残す。
function commonVariantIdentityMarker(presets) {
  const firstWords = presets.map((preset) => preset.words[0]).filter(Boolean);
  if (firstWords.length !== presets.length) return "";
  const families = firstWords.map(identityMarkerFamily);
  if (!families[0] || !families.every((family) => family === families[0])) return "";
  const marker = firstWords[0];
  return !isOutfitTag(marker) && !isGenericCharacterTag(marker) ? marker : "";
}

function identityMarkerFamily(value) {
  const normalized = tagKey(value).replaceAll("\\", "");
  const variant = normalized.match(/^(.+?)[_ ]*\([^)]*\)$/);
  return variant?.[1]?.replace(/[_ ]+$/, "") ?? "";
}

function uniqueTagWords(words) {
  const seen = new Set();
  return words.filter((word) => {
    const key = tagKey(word);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function tagKey(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function isGenericCharacterTag(word) {
  return /^(?:1girl|1boy|solo|female|male)$/i.test(String(word).trim());
}

function isUsablePromptTag(word) {
  const value = String(word ?? "").trim();
  return value && !/(?:&lt;|<)\s*lora:|^lora:/i.test(value);
}

function isOutfitTag(word) {
  const value = String(word ?? "").replaceAll("_", " ");
  return /\b(?:apron|armor|armour|belt|bikini|blazer|bodysuit|boot|bra|cape|capelet|cardigan|choker|cloak|coat|collar|costume|dress|footwear|garter|glove|gown|hat|headgear|heel|hood|hoodie|jacket|jeans|kimono|leotard|lingerie|loafer|necktie|nightgown|obi|outfit|pauldron|panties|pants|pantyhose|pajama|robe|sandal|shirt|shoe|shorts|skirt|sleeve|sneaker|sock|stocking|suit|sweater|swimsuit|thighhigh|tie|top|tracksuit|trousers|t-shirt|uniform|vest|yukata)s?\b/i.test(value)
    || /\b(?:clothing|clothes|dressed|off[- ]shoulder|strapless|sleeveless|high-leg|crop top|detached sleeves|wrist cuffs|bare arms|bare shoulders|midriff|sideboob|underboob)\b/i.test(value)
    || /(?:costume|outfit|uniform|swimsuit|bikini|dress|coat|jacket|shirt|skirt|pants|shorts|thighhigh|pantyhose|footwear|boots?)$/i.test(value);
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
