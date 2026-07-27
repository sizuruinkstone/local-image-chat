// ギャラリー（完成画像＋生成履歴）の絞り込み。
// 履歴データの形を変えずに、表示だけを絞る純粋関数として持つ。

export const GALLERY_KINDS = ["all", "favorite", "normal", "experiment"];

export const GALLERY_KIND_LABELS = {
  all: "すべて",
  favorite: "Favorite",
  normal: "通常生成",
  experiment: "比較実験"
};

function text(value) {
  return String(value ?? "").trim().toLowerCase();
}

// 履歴の世代→画像の一覧へ平坦化する（表示順は履歴の並びのまま）。
export function toGalleryEntries(generations = []) {
  return generations.flatMap((generation) =>
    (generation.images ?? []).map((image) => ({ generation, image }))
  );
}

export function collectCheckpoints(entries = []) {
  const names = entries
    .map((entry) => entry.generation?.settings?.checkpoint)
    .filter((name) => typeof name === "string" && name.trim());
  return [...new Set(names)].sort((left, right) => left.localeCompare(right, "ja"));
}

export function collectLoras(entries = []) {
  const names = entries
    .flatMap((entry) => entry.generation?.loras ?? [])
    .map((lora) => lora?.name)
    .filter((name) => typeof name === "string" && name.trim());
  return [...new Set(names)].sort((left, right) => left.localeCompare(right, "ja"));
}

function matchesKind(entry, kind) {
  if (kind === "favorite") return Boolean(entry.image?.favorite);
  if (kind === "experiment") return Boolean(entry.generation?.experimentId);
  if (kind === "normal") return !entry.generation?.experimentId;
  return true;
}

function matchesSince(entry, since) {
  if (!since) return true;
  const createdAt = Date.parse(entry.generation?.createdAt ?? "");
  if (!Number.isFinite(createdAt)) return false;
  return createdAt >= since;
}

// 「今日 / 7日 / 30日」のような相対指定を境界時刻へ直す。
export function resolveSince(period, now = Date.now()) {
  const days = { today: 1, week: 7, month: 30 }[period];
  if (!days) return null;
  if (period === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return start.getTime();
  }
  return now - days * 24 * 60 * 60 * 1000;
}

function matchesQuery(entry, query) {
  const needle = text(query);
  if (!needle) return true;
  const generation = entry.generation ?? {};
  const haystack = [
    generation.description,
    generation.prompt,
    generation.effectivePrompt,
    generation.negativePrompt,
    generation.settings?.checkpoint,
    generation.experimentName,
    String(entry.image?.seed ?? ""),
    ...(generation.loras ?? []).map((lora) => lora?.name)
  ].map(text).join(" ");
  return haystack.includes(needle);
}

export function filterGalleryEntries(entries = [], {
  kind = "all",
  checkpoint = "",
  lora = "",
  period = "",
  query = "",
  now = Date.now()
} = {}) {
  const since = resolveSince(period, now);
  return entries.filter((entry) => {
    if (!matchesKind(entry, kind)) return false;
    if (checkpoint && text(entry.generation?.settings?.checkpoint) !== text(checkpoint)) return false;
    if (lora && !(entry.generation?.loras ?? []).some((item) => text(item?.name) === text(lora))) return false;
    if (!matchesSince(entry, since)) return false;
    if (!matchesQuery(entry, query)) return false;
    return true;
  });
}

export function describeGalleryFilter(filter = {}, total = 0, shown = 0) {
  const parts = [`${shown}/${total}枚`];
  if (filter.kind && filter.kind !== "all") parts.push(GALLERY_KIND_LABELS[filter.kind] ?? filter.kind);
  if (filter.checkpoint) parts.push(`Checkpoint: ${filter.checkpoint}`);
  if (filter.lora) parts.push(`LoRA: ${filter.lora}`);
  if (filter.period) parts.push({ today: "今日", week: "7日以内", month: "30日以内" }[filter.period] ?? filter.period);
  if (filter.query) parts.push(`検索: ${filter.query}`);
  return parts.join("・");
}
