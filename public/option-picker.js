// Sampler / Scheduler のような「候補から1つ選ぶ」UIの並べ替えロジック。
// お気に入り・最近使用・検索の扱いをここへ集約し、画面側は表示だけを行う。

export const MAX_RECENT_OPTIONS = 5;

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

// 検索は前方一致・部分一致のどちらでも拾う。入力そのものは加工しない。
export function matchesQuery(option, query) {
  const text = normalize(query);
  if (!text) return true;
  return normalize(option).includes(text);
}

export function rememberRecentOption(recent, value, limit = MAX_RECENT_OPTIONS) {
  const picked = String(value ?? "").trim();
  if (!picked) return [...(recent ?? [])];
  const rest = (recent ?? []).filter((item) => normalize(item) !== normalize(picked));
  return [picked, ...rest].slice(0, Math.max(1, limit));
}

export function toggleFavoriteOption(favorites, value) {
  const picked = String(value ?? "").trim();
  if (!picked) return [...(favorites ?? [])];
  const list = favorites ?? [];
  return list.some((item) => normalize(item) === normalize(picked))
    ? list.filter((item) => normalize(item) !== normalize(picked))
    : [...list, picked];
}

export function isFavoriteOption(favorites, value) {
  return (favorites ?? []).some((item) => normalize(item) === normalize(value));
}

// 表示用のセクション。空のセクションは返さない。
// 「すべて」には、お気に入り・最近使用と重複する項目もそのまま残す（探す場所を固定するため）。
export function buildOptionSections({
  all = [],
  favorites = [],
  recent = [],
  query = "",
  current = ""
} = {}) {
  const available = [...new Set([...all, ...favorites, ...recent, current]
    .map((item) => String(item ?? "").trim())
    .filter(Boolean))];
  const known = new Map(available.map((item) => [normalize(item), item]));
  const pick = (values) => values
    .map((item) => known.get(normalize(item)))
    .filter(Boolean)
    .filter((item) => matchesQuery(item, query));

  const sections = [
    { key: "favorite", label: "★ お気に入り", items: pick(favorites) },
    { key: "recent", label: "最近使用", items: pick(recent).filter((item) => !isFavoriteOption(favorites, item)) },
    { key: "all", label: "すべて", items: available.filter((item) => matchesQuery(item, query)) }
  ];
  return sections.filter((section) => section.items.length);
}

// Sampler / Scheduler のよく使う組み合わせ。片方だけ変えたときは相手を触らない。
export const SAMPLER_PRESETS = [
  { sampler: "DPM++ 2M SDE", scheduler: "Karras" },
  { sampler: "DPM++ 2M", scheduler: "Karras" },
  { sampler: "Euler a", scheduler: "Automatic" }
];

export function describeSamplerPreset(preset) {
  return `${preset.sampler} / ${preset.scheduler}`;
}

export function isActivePreset(preset, sampler, scheduler) {
  return normalize(preset?.sampler) === normalize(sampler)
    && normalize(preset?.scheduler) === normalize(scheduler);
}
