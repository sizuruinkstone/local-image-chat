import {
  joinPromptSections,
  normalizeSections
} from "../../public/structured-prompt.js";

// Backendからも画面と同じ6項目・同じ順序でPromptを解決する。
export function resolvePrompt(input = {}) {
  const structured = normalizeSections(input?.structured);
  const negative = typeof input?.negative === "string" ? input.negative.trim() : "";
  const rawOverride = input?.rawOverride;

  if (rawOverride !== null && rawOverride !== undefined) {
    if (typeof rawOverride !== "string") {
      throw new Error("rawOverrideは文字列またはnullで指定してください");
    }
    return {
      structured,
      rawOverride,
      positive: rawOverride.trim(),
      negative,
      mode: "raw"
    };
  }

  return {
    structured,
    rawOverride: null,
    positive: joinPromptSections(structured),
    negative,
    mode: "structured"
  };
}

// 既存の /api/prompt と生成Runtimeが共有する、末尾タグの最小正規化。
export function normalizePromptBoosts(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((value) => typeof value === "string")
    .flatMap(splitTags)
    .map((value) => value.replace(/[<>]/g, "").slice(0, 120))
    .filter(Boolean)
    .slice(0, 40);
}

export function appendUniqueTags(prompt, additions = []) {
  const baseWords = [];
  const seen = new Set();
  for (const tag of splitTags(prompt)) {
    const normalized = normalizeTag(tag);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    baseWords.push(tag);
  }
  for (const tag of additions.flatMap((value) => splitTags(value))) {
    const normalized = normalizeTag(tag);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    baseWords.push(tag);
  }
  return baseWords.join(", ");
}

function splitTags(value) {
  if (typeof value !== "string") return [];
  return value.split(",").map((tag) => tag.trim()).filter(Boolean);
}

function normalizeTag(value) {
  return value.toLowerCase().replaceAll(/\s+/g, " ");
}
