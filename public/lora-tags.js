// プロンプト内のLoRAタグ <lora:NAME:WEIGHT> の解析と、UI選択との突き合わせ。
// 画面（public/app.js）とサーバー（src/server.js）の両方から使う唯一の実装。
// 正規表現や名前の照合をここ以外へ書かないこと。

// 名前は `:` `<` `>` を含まない。Weight部分は省略・複数指定（unet:te）どちらもあり得る。
const LORA_TAG_PATTERN = /<lora:([^:<>]+)((?::[^<>]*)?)>/gi;

export const MIN_LORA_WEIGHT = 0.05;
export const MAX_LORA_WEIGHT = 2;
export const DEFAULT_LORA_WEIGHT = 1;

// 大文字小文字・パス区切り・前後の空白だけを吸収する。似た名前の別LoRAは別物として扱う。
export function normalizeLoraName(name) {
  return String(name ?? "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();
}

export function loraBaseName(name) {
  const normalized = normalizeLoraName(name);
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

// 同じLoRAを指しているかの判定。
// 完全一致が基本で、片方だけフォルダ無しの場合に限りファイル名で一致とみなす。
// （`A/dup` と `B/dup` のような別LoRA同士は一致させない）
export function sameLoraName(left, right) {
  const a = normalizeLoraName(left);
  const b = normalizeLoraName(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes("/") && b.includes("/")) return false;
  return loraBaseName(a) === loraBaseName(b);
}

export function clampLoraWeight(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_LORA_WEIGHT;
  return Number(Math.min(MAX_LORA_WEIGHT, Math.max(MIN_LORA_WEIGHT, number)).toFixed(2));
}

// 0.65 → "0.65" / 1 → "1"。末尾の0は付けない。
export function formatLoraWeight(value) {
  return String(clampLoraWeight(value));
}

export function buildLoraTag(name, weight, extra = "") {
  return `<lora:${name}:${formatLoraWeight(weight)}${extra}>`;
}

function parseWeightPart(rest) {
  if (!rest) {
    // Weight省略タグ <lora:name> は 1.0 として扱う。
    return { weight: DEFAULT_LORA_WEIGHT, weightText: "", hasWeight: false, invalidWeight: false, clamped: false, extra: "" };
  }
  const body = rest.slice(1);
  const separator = body.indexOf(":");
  const first = separator < 0 ? body : body.slice(0, separator);
  const extra = separator < 0 ? "" : body.slice(separator);
  const number = Number(first.trim());
  if (!first.trim() || !Number.isFinite(number)) {
    return { weight: DEFAULT_LORA_WEIGHT, weightText: first, hasWeight: true, invalidWeight: true, clamped: false, extra };
  }
  const weight = clampLoraWeight(number);
  return { weight, weightText: first, hasWeight: true, invalidWeight: false, clamped: weight !== number, extra };
}

export function parseLoraTags(prompt) {
  const text = String(prompt ?? "");
  const tags = [];
  for (const match of text.matchAll(LORA_TAG_PATTERN)) {
    const name = match[1].trim();
    if (!name) continue;
    const parsed = parseWeightPart(match[2] ?? "");
    tags.push({
      raw: match[0],
      name,
      normalizedName: normalizeLoraName(name),
      weight: parsed.weight,
      weightText: parsed.weightText,
      hasWeight: parsed.hasWeight,
      invalidWeight: parsed.invalidWeight,
      clamped: parsed.clamped,
      extra: parsed.extra,
      start: match.index,
      end: match.index + match[0].length
    });
  }
  return tags;
}

export function hasLoraTag(prompt, loraName) {
  return parseLoraTags(prompt).some((tag) => sameLoraName(tag.name, loraName));
}

// 該当タグのWeight部分だけを書き換える。名前・区切り・位置・前後の文字は変えない。
export function replaceLoraWeight(prompt, loraName, weight) {
  const text = String(prompt ?? "");
  const tags = parseLoraTags(text).filter((tag) => sameLoraName(tag.name, loraName));
  if (!tags.length) return text;
  let result = text;
  // 後ろから置き換えて、前のタグの位置をずらさない。
  for (const tag of [...tags].reverse()) {
    result = result.slice(0, tag.start) + buildLoraTag(tag.name, weight, tag.extra) + result.slice(tag.end);
  }
  return result;
}

// タグを消したあとに残る区切りだけを整える（本文のタグ順・記法は触らない）。
function tidySeparators(text) {
  return text
    .replace(/[ \t]+,/g, ",")
    .replace(/,(?:[ \t]*,)+/g, ",")
    .replace(/^[ \t]*,[ \t]*/gm, "")
    .replace(/[ \t]*,[ \t]*$/gm, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[ \t]+|[ \t]+$/gm, "");
}

export function removeLoraTags(prompt, loraName) {
  const text = String(prompt ?? "");
  const tags = parseLoraTags(text).filter((tag) => sameLoraName(tag.name, loraName));
  if (!tags.length) return { text, removed: 0 };
  let result = text;
  for (const tag of [...tags].reverse()) result = result.slice(0, tag.start) + result.slice(tag.end);
  return { text: tidySeparators(result), removed: tags.length };
}

// 同じLoRAのタグが複数ある場合、最後の1つだけ残す。
// 元の入力欄は書き換えず、生成へ送るプロンプトを作るときだけ使う。
export function dedupeLoraTags(prompt) {
  const text = String(prompt ?? "");
  const groups = groupTagsByLora(parseLoraTags(text));
  const removals = groups.flatMap((group) => group.tags.slice(0, -1));
  if (!removals.length) return { text, duplicates: [] };

  let result = text;
  for (const tag of [...removals].reverse()) result = result.slice(0, tag.start) + result.slice(tag.end);
  return {
    text: tidySeparators(result),
    duplicates: groups
      .filter((group) => group.tags.length > 1)
      .map((group) => ({
        name: group.tags.at(-1).name,
        weights: group.tags.map((tag) => tag.weight),
        weight: group.tags.at(-1).weight
      }))
  };
}

// 表記ゆれ（大文字小文字・パス区切り・フォルダ省略）を吸収して同じLoRAごとにまとめる。
function groupTagsByLora(tags) {
  const groups = [];
  for (const tag of tags) {
    const group = groups.find((item) => sameLoraName(item.tags[0].name, tag.name));
    if (group) group.tags.push(tag);
    else groups.push({ tags: [tag] });
  }
  return groups;
}

// プロンプト内のタグを正としてLoRA一覧のWeightを揃える（履歴に実効値を残すため）。
export function applyPromptWeights(loras, prompt, { preserveExplicitZero = false } = {}) {
  const tags = parseLoraTags(prompt);
  if (!tags.length) return Array.isArray(loras) ? [...loras] : [];
  return (Array.isArray(loras) ? loras : []).map((lora) => {
    // 同じLoRAが複数書かれている場合は、最後に出てきたWeightが有効。
    const tag = [...tags].reverse().find((item) => sameLoraName(item.name, lora?.name));
    if (!tag) return lora;
    // The server may append a canonical selection with explicit zero weight.
    // Keep that value in history without changing legacy inline-tag parsing.
    if (preserveExplicitZero && lora.weight === 0 && !tag.invalidWeight && tag.hasWeight && Number(tag.weightText) === 0) return { ...lora, weight: 0 };
    return { ...lora, weight: tag.weight };
  });
}

// 導入済み一覧からタグ名を解決する。完全一致優先、次にファイル名一致。
// 一意に決まらない場合は選択せず、候補を返す。
export function resolveInstalledLora(name, installedLoras = []) {
  const target = normalizeLoraName(name);
  if (!target) return { match: null, candidates: [] };
  const installed = installedLoras.filter((item) => item && typeof item.name === "string" && item.name);
  const exact = installed.filter((item) => normalizeLoraName(item.name) === target);
  if (exact.length === 1) return { match: exact[0], candidates: exact };
  if (exact.length > 1) return { match: null, candidates: exact };

  const base = loraBaseName(target);
  const byBase = installed.filter((item) => loraBaseName(item.name) === base);
  if (byBase.length === 1) return { match: byBase[0], candidates: byBase };
  return { match: null, candidates: byBase };
}

// プロンプトのタグと、いまのUI選択を突き合わせる。
// - プロンプトに書かれたWeightを正としてUIへ反映する
// - プロンプト由来だけの選択は、タグが消えたら外す
// - UI由来の選択は、タグが無くても残す
export function reconcilePromptLoras(promptTags = [], selectedLoras = [], installedLoras = []) {
  const previous = new Map();
  for (const item of selectedLoras) {
    if (!item || typeof item.name !== "string" || !item.name) continue;
    previous.set(normalizeLoraName(item.name), {
      name: item.name,
      weight: clampLoraWeight(item.weight),
      source: ["ui", "prompt", "both"].includes(item.source) ? item.source : "ui"
    });
  }

  const resolved = new Map();
  const resolvedNameByTag = new Map();
  const unresolved = new Map();
  const ambiguous = new Map();
  const invalidWeights = [];
  const tagCounts = new Map();

  for (const tag of promptTags) {
    if (tag.invalidWeight) invalidWeights.push({ name: tag.name, weightText: tag.weightText });

    const { match, candidates } = resolveInstalledLora(tag.name, installedLoras);
    // 重複判定は解決後の名前で行う（`char` と `Characters/char` を同じ1つとして数える）。
    const groupKey = match ? normalizeLoraName(match.name) : tag.normalizedName;
    const seen = tagCounts.get(groupKey) ?? [];
    seen.push(tag);
    tagCounts.set(groupKey, seen);

    if (match) {
      // 同じLoRAが複数書かれている場合は、最後に出てきたWeightを有効にする。
      resolved.set(groupKey, { name: match.name, weight: tag.weight, tag });
      resolvedNameByTag.set(groupKey, match.name);
      continue;
    }
    if (candidates.length > 1) {
      ambiguous.set(tag.normalizedName, {
        name: tag.name,
        candidates: candidates.map((item) => item.name)
      });
      continue;
    }
    unresolved.set(tag.normalizedName, { name: tag.name, weight: tag.weight });
  }

  const selected = [];
  for (const [key, entry] of resolved) {
    const before = previous.get(key);
    selected.push({
      name: entry.name,
      weight: entry.weight,
      source: before && before.source !== "prompt" ? "both" : "prompt"
    });
  }
  for (const [key, before] of previous) {
    if (resolved.has(key)) continue;
    // プロンプト由来だけの選択は、タグが消えたら外す。
    if (before.source === "prompt") continue;
    selected.push({ name: before.name, weight: before.weight, source: "ui" });
  }

  const duplicates = [];
  for (const [key, tags] of tagCounts) {
    if (tags.length < 2) continue;
    duplicates.push({
      name: resolvedNameByTag.get(key) ?? tags[0].name,
      weights: tags.map((tag) => tag.weight),
      weight: tags.at(-1).weight
    });
  }

  const changed = !sameSelection(previous, selected);
  return {
    selected,
    duplicates,
    unresolved: [...unresolved.values()],
    ambiguous: [...ambiguous.values()],
    invalidWeights,
    changed
  };
}

function sameSelection(previous, selected) {
  if (previous.size !== selected.length) return false;
  return selected.every((item) => {
    const before = previous.get(normalizeLoraName(item.name));
    return before && before.weight === item.weight && before.source === item.source;
  });
}

// 画面へ出す警告文。件数が多くても1行にまとめる。
export function describeLoraNotices({ duplicates = [], unresolved = [], ambiguous = [], invalidWeights = [] } = {}) {
  const messages = [];
  for (const item of duplicates) {
    messages.push(`同じLoRAが複数記述されています: ${item.name}（${item.weights.join(" / ")} → ${item.weight}を使用）`);
  }
  for (const item of unresolved) {
    messages.push(`インストール済みLoRA一覧に見つかりません: ${item.name}`);
  }
  for (const item of ambiguous) {
    messages.push(`LoRAを特定できません: ${item.name}（候補: ${item.candidates.join(" / ")}）`);
  }
  for (const item of invalidWeights) {
    messages.push(`Weightを読み取れません: ${item.name}（${item.weightText || "空"} → 1を使用）`);
  }
  return messages;
}

// 履歴へ残す警告情報。表示用の文言ではなく、型の付いたデータで持つ。
export function buildLoraNotices({ duplicates = [], unresolved = [], ambiguous = [], invalidWeights = [] } = {}) {
  return [
    ...duplicates.map((item) => ({ type: "duplicate", name: item.name, weights: item.weights, weight: item.weight })),
    ...unresolved.map((item) => ({ type: "unresolved", name: item.name, weight: item.weight })),
    ...ambiguous.map((item) => ({ type: "ambiguous", name: item.name, candidates: item.candidates })),
    ...invalidWeights.map((item) => ({ type: "invalidWeight", name: item.name, weightText: item.weightText }))
  ];
}
