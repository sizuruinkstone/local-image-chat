// Civitaiの説明文・バージョン名から推奨Weightを抽出する純粋関数。
// 単一値と範囲の両方に対応し、抽出できない場合はfallback(0.75)を返す。

const WEIGHT_KW = "weights?|strength|強度|ウェイト|重み|权重|權重";
const REC_KW = "recommended|recommend|default|推奨|推荐|建议";
const SEP = "[-–—~〜～]|\\bto\\b";
const NUM = "\\d*\\.?\\d+";

// 推奨語＋Weight語＋単一値（範囲でないこと）。例: Recommended weight: 0.6 / 推奨強度 0.6 / 建议权重 0.7
const REC_SINGLE_RE = new RegExp(
  `(?:${REC_KW})\\s*(?:${WEIGHT_KW})\\s*[:：]?\\s*(${NUM})(?!\\d)(?!\\.\\d)(?!\\s*(?:${SEP})\\s*\\d)`,
  "i"
);
// Weight語＋範囲。例: Weight 0.7-1.0 / Weight 0.7 ～ 1.0 / 推奨強度 0.6〜0.8 / 建议权重 0.7-1.0
const RANGE_RE = new RegExp(
  `(?:${WEIGHT_KW})\\s*[:：]?\\s*(${NUM})\\s*(?:${SEP})\\s*(${NUM})`,
  "i"
);
// Weight語＋単一値。例: Weight: 0.8 / Strength 0.7 / 強度：0.75
const SINGLE_RE = new RegExp(`(?:${WEIGHT_KW})\\s*[:：]?\\s*(${NUM})`, "i");

export function stripHtml(text) {
  return String(text ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function clampWeight(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Number(Math.max(0.05, Math.min(1.5, number)).toFixed(2));
}

// テキストから推奨Weightを抽出する。優先: 推奨付き単一値 > 範囲(中央値) > 単一値。
function extractWeight(text) {
  const value = String(text ?? "");
  const rec = value.match(REC_SINGLE_RE);
  if (rec) return { representative: Number(rec[1]), min: null, max: null };
  const range = value.match(RANGE_RE);
  if (range) {
    const lo = Math.min(Number(range[1]), Number(range[2]));
    const hi = Math.max(Number(range[1]), Number(range[2]));
    return { representative: (lo + hi) / 2, min: lo, max: hi };
  }
  const single = value.match(SINGLE_RE);
  if (single) return { representative: Number(single[1]), min: null, max: null };
  return null;
}

function finalize(parsed, source) {
  const weight = clampWeight(parsed.representative);
  const min = parsed.min != null ? clampWeight(parsed.min) : null;
  const max = parsed.max != null ? clampWeight(parsed.max) : null;
  const hasRange = min != null && max != null && min !== max;
  return {
    recommendedWeight: weight,
    recommendedWeightMin: hasRange ? min : null,
    recommendedWeightMax: hasRange ? max : null,
    recommendedWeightLabel: hasRange ? `${min.toFixed(2)}～${max.toFixed(2)}` : null,
    recommendedWeightSource: source
  };
}

export const FALLBACK_RECOMMENDED_WEIGHT = Object.freeze({
  recommendedWeight: 0.75,
  recommendedWeightMin: null,
  recommendedWeightMax: null,
  recommendedWeightLabel: null,
  recommendedWeightSource: "fallback"
});

export function parseRecommendedWeight(description, versionName = "") {
  const fromDescription = extractWeight(stripHtml(description));
  if (fromDescription) return finalize(fromDescription, "civitai-description");
  const fromVersion = extractWeight(String(versionName ?? ""));
  if (fromVersion) return finalize(fromVersion, "civitai-version-name");
  return { ...FALLBACK_RECOMMENDED_WEIGHT };
}
