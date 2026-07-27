// LoRA・キャラクター・衣装の選択一覧を、既存のLoRAデータから組み立てる。
// 方針:
// - 判定できないものを勝手に分類しない（迷ったら unknown のまま出す）
// - LoRAマスタ（registry）の値は読むだけ。ここでは書き換えない
// - トリガーワードの文字列は加工しない（表示用の切り出しだけ行う）

export const PRESET_CATEGORIES = [
  "character", "style", "clothing", "pose", "body", "expression", "concept", "utility", "unknown"
];

export const PRESET_CATEGORY_LABELS = {
  all: "すべて",
  character: "キャラクター",
  style: "画風",
  clothing: "衣装",
  pose: "ポーズ",
  body: "体型",
  expression: "表情",
  concept: "コンセプト",
  utility: "ユーティリティ",
  unknown: "未分類"
};

// registryのsubcategory（character/style/body/pose/utility/other）と、
// 手動で付けた detailCategory を、選択UIの区分へ寄せる。
const SUBCATEGORY_MAP = {
  character: "character",
  style: "style",
  body: "body",
  pose: "pose",
  utility: "utility",
  other: "unknown"
};

// 明示的に書かれている場合だけ拾う保守的なキーワード。
const DETAIL_KEYWORDS = [
  ["clothing", ["clothing", "clothes", "outfit", "costume", "dress", "uniform", "swimsuit", "衣装", "服", "コスチューム"]],
  ["expression", ["expression", "face", "emotion", "表情", "顔"]],
  ["concept", ["concept", "effect", "background", "scene", "コンセプト", "背景"]],
  ["pose", ["pose", "posing", "ポーズ", "構図"]]
];

function text(value) {
  return String(value ?? "").trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

export function splitTriggerPreview(triggerWords, limit = 3) {
  const tags = text(triggerWords)
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  return { tags: tags.slice(0, limit), rest: Math.max(0, tags.length - limit) };
}

export function resolvePresetCategory(lora) {
  const registry = lora?.registry ?? {};
  const detail = lower(registry.detailCategory);
  if (detail) {
    for (const [category, keywords] of DETAIL_KEYWORDS) {
      if (keywords.some((keyword) => detail.includes(keyword))) return category;
    }
  }
  const subcategory = lower(registry.subcategory);
  if (SUBCATEGORY_MAP[subcategory]) return SUBCATEGORY_MAP[subcategory];
  const folder = lower(lora?.folder);
  if (folder) {
    for (const [category, keywords] of DETAIL_KEYWORDS) {
      if (keywords.some((keyword) => folder.includes(keyword))) return category;
    }
  }
  if (lower(registry.category) === "character" || lower(lora?.category) === "character") return "character";
  return "unknown";
}

export function loraFolderKey(lora) {
  const folder = text(lora?.folder).replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  return folder || "(ルート)";
}

// LoRA選択UIの1件分。thumbnailUrlは呼び出し側（画面）が解決して渡す。
export function buildLoraCatalog(installedLoras = [], { resolveThumbnail = () => "" } = {}) {
  return installedLoras
    .filter((lora) => lora && typeof lora.name === "string" && lora.name)
    .map((lora) => ({
      id: lora.name,
      kind: "lora",
      name: lora.displayName || lora.name,
      loraName: lora.name,
      folder: loraFolderKey(lora),
      category: resolvePresetCategory(lora),
      triggerWords: text(lora.registry?.triggerWords),
      thumbnailUrl: resolveThumbnail(lora) || "",
      favorite: Boolean(lora.registry?.favorite),
      uid: lora.registry?.uid ?? "",
      baseModel: text(lora.registry?.baseModel),
      relatedLoraIds: [lora.name],
      promptTags: text(lora.registry?.triggerWords)
    }));
}

// キャラクター一覧。プロフィールに複数キャラが入っている場合は、その1つずつを候補にする。
export function buildCharacterPresets(installedLoras = [], {
  resolveProfile = () => null,
  resolveThumbnail = () => ""
} = {}) {
  const presets = [];
  for (const lora of installedLoras) {
    if (!lora || typeof lora.name !== "string" || !lora.name) continue;
    const profile = resolveProfile(lora);
    const thumbnailUrl = resolveThumbnail(lora) || "";
    const favorite = Boolean(lora.registry?.favorite);
    const category = resolvePresetCategory(lora);
    const profilePresets = (profile?.presets ?? []).filter((preset) => text(preset?.triggerWords));

    // プロフィールに複数のキャラが登録されているLoRA（作品まとめ系）は1件ずつ出す。
    if (profilePresets.length > 1) {
      for (const preset of profilePresets) {
        presets.push({
          id: `${lora.name}::${preset.id}`,
          kind: "character",
          name: preset.name || preset.id,
          loraName: lora.name,
          subtitle: lora.displayName || lora.name,
          folder: loraFolderKey(lora),
          category: "character",
          triggerWords: text(preset.triggerWords),
          promptTags: text(preset.triggerWords),
          relatedLoraIds: [lora.name],
          thumbnailUrl,
          favorite
        });
      }
      continue;
    }

    if (category !== "character") continue;
    const triggerWords = text(profilePresets[0]?.triggerWords) || text(lora.registry?.triggerWords);
    presets.push({
      id: lora.name,
      kind: "character",
      name: lora.displayName || lora.name,
      loraName: lora.name,
      subtitle: loraFolderKey(lora),
      folder: loraFolderKey(lora),
      category: "character",
      triggerWords,
      promptTags: triggerWords,
      relatedLoraIds: [lora.name],
      thumbnailUrl,
      favorite
    });
  }
  return presets;
}

// 衣装一覧。Civitai由来の衣装プリセットと、プロフィールの追加衣装、衣装系LoRAを集める。
export function buildOutfitPresets(installedLoras = [], {
  resolveProfile = () => null,
  resolveThumbnail = () => ""
} = {}) {
  const presets = [];
  const seen = new Set();
  const push = (preset) => {
    const key = `${preset.loraName}::${lower(preset.promptTags)}`;
    if (!preset.promptTags || seen.has(key)) return;
    seen.add(key);
    presets.push(preset);
  };

  for (const lora of installedLoras) {
    if (!lora || typeof lora.name !== "string" || !lora.name) continue;
    const thumbnailUrl = resolveThumbnail(lora) || "";
    const favorite = Boolean(lora.registry?.favorite);
    const profile = resolveProfile(lora);

    // 1) プロフィールの追加衣装（addons）
    for (const addon of profile?.addons ?? []) {
      push({
        id: `${lora.name}::addon::${addon.id}`,
        kind: "outfit",
        name: addon.name || addon.id,
        loraName: lora.name,
        subtitle: lora.displayName || lora.name,
        folder: loraFolderKey(lora),
        category: "clothing",
        triggerWords: text(addon.triggerWords),
        promptTags: text(addon.triggerWords),
        relatedLoraIds: [lora.name],
        thumbnailUrl,
        favorite
      });
    }

    // 2) Civitaiから取り込んだ衣装プリセット
    for (const outfit of lora.registry?.outfitPresets ?? []) {
      push({
        id: `${lora.name}::outfit::${outfit.id ?? outfit.name}`,
        kind: "outfit",
        name: outfit.name || outfit.id,
        loraName: lora.name,
        subtitle: lora.displayName || lora.name,
        folder: loraFolderKey(lora),
        category: "clothing",
        triggerWords: text(outfit.triggerWords),
        promptTags: text(outfit.triggerWords),
        relatedLoraIds: [lora.name],
        thumbnailUrl,
        favorite
      });
    }

    // 3) 衣装として分類されているLoRAそのもの
    if (resolvePresetCategory(lora) === "clothing") {
      push({
        id: lora.name,
        kind: "outfit",
        name: lora.displayName || lora.name,
        loraName: lora.name,
        subtitle: loraFolderKey(lora),
        folder: loraFolderKey(lora),
        category: "clothing",
        triggerWords: text(lora.registry?.triggerWords),
        promptTags: text(lora.registry?.triggerWords),
        relatedLoraIds: [lora.name],
        thumbnailUrl,
        favorite
      });
    }
  }
  return presets;
}

// フォルダ・分類の選択肢（件数付き）。
export function buildGroups(items = [], key = "folder") {
  const counts = new Map();
  for (const item of items) {
    const value = item?.[key] || "unknown";
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const groups = [...counts.entries()]
    .map(([value, count]) => ({
      value,
      count,
      label: key === "category" ? (PRESET_CATEGORY_LABELS[value] ?? value) : value
    }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "ja"));
  return [{ value: "", label: PRESET_CATEGORY_LABELS.all, count: items.length }, ...groups];
}

// 検索は 名前 / 表示名 / トリガーワード / フォルダ / 分類 を対象にする。
export function filterPresets(items = [], { query = "", folder = "", category = "", favoriteOnly = false } = {}) {
  const needle = lower(query);
  return items.filter((item) => {
    if (favoriteOnly && !item.favorite) return false;
    if (folder && item.folder !== folder) return false;
    if (category && item.category !== category) return false;
    if (!needle) return true;
    const haystack = [
      item.name, item.loraName, item.subtitle, item.triggerWords, item.folder,
      item.category, PRESET_CATEGORY_LABELS[item.category]
    ].map(lower).join(" ");
    return haystack.includes(needle);
  });
}

// 生成枚数（既存バックエンドの制限に合わせる）。
export const MIN_CANDIDATE_COUNT = 1;
export const MAX_CANDIDATE_COUNT = 4;

export function clampCandidateCount(value, fallback = MIN_CANDIDATE_COUNT) {
  const number = Math.trunc(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(MAX_CANDIDATE_COUNT, Math.max(MIN_CANDIDATE_COUNT, number));
}

export function isValidCandidateCount(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= MIN_CANDIDATE_COUNT && number <= MAX_CANDIDATE_COUNT;
}
