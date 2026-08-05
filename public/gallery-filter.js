// ギャラリー（完成画像＋生成履歴）の絞り込み。
// 履歴データの形を変えずに、表示だけを絞る純粋関数として持つ。

export const GALLERY_KINDS = ["all", "favorite", "normal", "experiment"];

export const GALLERY_KIND_LABELS = {
  all: "すべて",
  favorite: "Favorite",
  normal: "通常生成",
  experiment: "比較実験"
};

const STRUCTURED_POSITIVE_FIELDS = [
  "character", "appearance", "composition", "situation", "style", "extra"
];

function text(value) {
  return String(value ?? "").trim().toLowerCase();
}

function splitPromptTags(value) {
  const tags = [];
  let start = 0;
  let depth = 0;
  let escaped = false;
  const source = String(value ?? "");
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if ("([{\u3008".includes(character)) depth += 1;
    else if (")]}".includes(character)) depth = Math.max(0, depth - 1);
    else if (character === "," && depth === 0) {
      const tag = source.slice(start, index).trim();
      if (tag) tags.push(tag);
      start = index + 1;
    }
  }
  const last = source.slice(start).trim();
  if (last) tags.push(last);
  return tags;
}

function positivePromptText(entry) {
  const structured = entry.generation?.structuredPrompt;
  const structuredValues = STRUCTURED_POSITIVE_FIELDS
    .map((field) => structured?.[field])
    .filter((value) => typeof value === "string" && value.trim());
  if (structuredValues.length) return structuredValues.join(", ");
  const generation = entry.generation ?? {};
  return generation.effectivePrompt || generation.prompt || "";
}

export function promptTagsForEntry(entry) {
  const seen = new Set();
  return splitPromptTags(positivePromptText(entry)).filter((tag) => {
    const key = text(tag);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function collectPromptTags(entries = []) {
  const tags = new Map();
  for (const entry of entries) {
    for (const tag of promptTagsForEntry(entry)) {
      const key = text(tag);
      if (key && !tags.has(key)) tags.set(key, tag);
    }
  }
  return [...tags.values()].sort((left, right) => left.localeCompare(right, "ja"));
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
  tags = [],
  now = Date.now()
} = {}) {
  const since = resolveSince(period, now);
  const selectedTags = Array.isArray(tags) ? tags.filter((tag) => text(tag)) : [];
  return entries.filter((entry) => {
    if (!matchesKind(entry, kind)) return false;
    if (checkpoint && text(entry.generation?.settings?.checkpoint) !== text(checkpoint)) return false;
    if (lora && !(entry.generation?.loras ?? []).some((item) => text(item?.name) === text(lora))) return false;
    if (!matchesSince(entry, since)) return false;
    if (!matchesQuery(entry, query)) return false;
    if (!selectedTags.every((tag) => promptTagsForEntry(entry).some((item) => text(item) === text(tag)))) return false;
    return true;
  });
}

export function sortGalleryEntries(entries = [], sort = "newest") {
  const direction = sort === "oldest" ? 1 : -1;
  return entries
    .map((entry, index) => ({ entry, index, time: Date.parse(entry.generation?.createdAt ?? "") }))
    .sort((left, right) => {
      const leftValid = Number.isFinite(left.time);
      const rightValid = Number.isFinite(right.time);
      if (leftValid && !rightValid) return -1;
      if (!leftValid && rightValid) return 1;
      if (leftValid && rightValid && left.time !== right.time) return (left.time - right.time) * direction;
      return left.index - right.index;
    })
    .map(({ entry }) => entry);
}

export function describeGalleryFilter(filter = {}, total = 0, shown = 0) {
  const parts = [`${shown}/${total}枚`];
  if (filter.kind && filter.kind !== "all") parts.push(GALLERY_KIND_LABELS[filter.kind] ?? filter.kind);
  if (filter.checkpoint) parts.push(`Checkpoint: ${filter.checkpoint}`);
  if (filter.lora) parts.push(`LoRA: ${filter.lora}`);
  if (filter.period) parts.push({ today: "今日", week: "7日以内", month: "30日以内" }[filter.period] ?? filter.period);
  if (filter.query) parts.push(`検索: ${filter.query}`);
  if (filter.tags?.length) parts.push(`タグ: ${filter.tags.join(" + ")}`);
  return parts.join("・");
}
