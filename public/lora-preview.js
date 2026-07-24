// LoRA選択画面のプレビュー関連の純粋関数。
// DOMやブラウザAPIに依存させず、Node.js標準テストから検証できるようにする。

// プレビュー画像の取得元は優先順に評価する。
// 将来的にローカル同名画像やCivitaiキャッシュを差し込めるよう、
// 解決処理を順序付きのソース配列として保持する。
const PREVIEW_SOURCES = [
  // 1. LoRAと同じフォルダにある同名ローカル画像（将来対応）
  (lora) => lora?.localPreviewUrl,
  // 2. Civitai画像のローカルキャッシュ（将来対応）
  (lora) => lora?.registry?.cachedPreviewUrl,
  // 3. registry.previewUrl（現在利用可能）
  (lora) => lora?.registry?.previewUrl
];

export function resolveLoraPreviewUrl(lora) {
  for (const source of PREVIEW_SOURCES) {
    const url = source(lora);
    if (typeof url === "string" && url.trim()) return url.trim();
  }
  return "";
}

export function hasLoraPreview(lora) {
  return Boolean(resolveLoraPreviewUrl(lora));
}

// 互換性フィルターの選択肢。UIのプルダウンとフィルター判定で共有する。
export const LORA_COMPATIBILITY_FILTERS = [
  { id: "all", label: "すべて" },
  { id: "compatible", label: "対応のみ" },
  { id: "compatible-caution", label: "対応・近縁" },
  { id: "hide-incompatible", label: "非対応を隠す" },
  { id: "has-preview", label: "プレビューありのみ" }
];

const COMPATIBILITY_FILTER_IDS = new Set(LORA_COMPATIBILITY_FILTERS.map((item) => item.id));

export function isCompatibilityFilter(value) {
  return COMPATIBILITY_FILTER_IDS.has(value);
}

// 互換性フィルターの判定。levelは既存のassessLoraCompatibilityの結果
// （compatible / caution / incompatible / unknown）を再利用する。
export function compatibilityFilterAllows(filter, { level, hasPreview } = {}) {
  switch (filter) {
    case "compatible":
      return level === "compatible";
    case "compatible-caution":
      return level === "compatible" || level === "caution";
    case "hide-incompatible":
      return level !== "incompatible";
    case "has-preview":
      return Boolean(hasPreview);
    case "all":
    default:
      return true;
  }
}
