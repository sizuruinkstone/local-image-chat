// 用途別（構造化）Positive Promptと、LoRAトリガーワードの純粋ロジック。
// DOMへ触らないので node --test から直接検証できる。
// 方針: ユーザー入力は補正・翻訳・並べ替え・重複削除をしない。
//       触るのは「連結時の区切り」と「トリガーワードの重み構文」だけ。

export const PROMPT_FIELDS = ["character", "appearance", "composition", "situation", "style", "extra"];

export const PROMPT_FIELD_LABELS = {
  character: "キャラクター",
  appearance: "容姿・衣装",
  composition: "ポーズ・構図",
  situation: "シチュエーション・背景",
  style: "画風・品質",
  extra: "追加プロンプト"
};

const MIN_TRIGGER_WEIGHT = 0.05;
const MAX_TRIGGER_WEIGHT = 2;

// LoRAの内部分類から、トリガーワードの反映先を決める。
// 迷う分類（utility / other / 旧形式のdirection）はここに載せない。
const SUBCATEGORY_FIELDS = {
  character: "character",
  style: "style",
  body: "appearance",
  pose: "composition"
};

// LoRA分類だけでは決められないときの、安全側のキーワード判定。
// 判定できなければ追加プロンプト（extra）へ落とす。
const KEYWORD_FIELDS = [
  ["situation", [
    "background", "backgrounds", "scenery", "landscape", "cityscape", "indoors", "outdoors",
    "street", "classroom", "bedroom", "forest", "beach", "sky", "night", "sunset", "rain", "snow",
    "背景", "風景", "室内", "屋外"
  ]],
  ["composition", [
    "pose", "posing", "sitting", "standing", "lying", "kneeling", "squatting", "from behind",
    "from above", "from below", "close-up", "full body", "upper body", "cowboy shot",
    "dynamic angle", "dutch angle", "構図", "ポーズ"
  ]],
  ["style", [
    "style", "artstyle", "art style", "watercolor", "lineart", "line art", "sketch",
    "oil painting", "painting", "flat color", "cel shading", "画風", "作画"
  ]],
  ["appearance", [
    "outfit", "costume", "dress", "uniform", "swimsuit", "bikini", "clothes", "clothing",
    "armor", "hair", "eyes", "衣装", "服装"
  ]]
];

export function isPromptField(value) {
  return PROMPT_FIELDS.includes(value);
}

// 6項目すべてを文字列として持つ形へ整える（欠けている項目は空文字）。
export function normalizeSections(input) {
  const sections = {};
  for (const field of PROMPT_FIELDS) {
    const value = input?.[field];
    sections[field] = typeof value === "string" ? value : "";
  }
  return sections;
}

export function hasSectionContent(sections) {
  return PROMPT_FIELDS.some((field) => trimSection(sections?.[field]));
}

// 前後の空白と、連結時に二重カンマになる端のカンマだけを落とす。
// 中身のタグ順・重複・記法には手を入れない。
export function trimPromptEdges(value) {
  return String(value ?? "").trim().replace(/^[\s,]+/, "").replace(/[\s,]+$/, "");
}

const trimSection = trimPromptEdges;

// 指定順に結合する。空欄は無視し、余計なカンマは作らない。
export function joinPromptSections(sections) {
  return PROMPT_FIELDS
    .map((field) => trimSection(sections?.[field]))
    .filter(Boolean)
    .join(", ");
}

export function normalizeTriggerWeight(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  const bounded = Math.min(MAX_TRIGGER_WEIGHT, Math.max(MIN_TRIGGER_WEIGHT, number));
  return Number(bounded.toFixed(2));
}

// Weightが1.0ならそのまま、それ以外は (word:weight) 形式にする。
export function formatTriggerWord(trigger) {
  if (!trigger || trigger.enabled === false) return "";
  const text = String(trigger.text ?? "").trim();
  if (!text) return "";
  const weight = normalizeTriggerWeight(trigger.weight);
  if (weight === 1) return text;
  return `(${text}:${weight})`;
}

// カンマ区切りを分解する。( ) や < > の内側のカンマでは切らない
// （既存の重み構文・LoRA構文を壊さないため）。
export function splitTriggerText(value) {
  const text = String(value ?? "");
  const parts = [];
  let current = "";
  let depth = 0;
  for (const character of text) {
    if (character === "(" || character === "[" || character === "<") depth += 1;
    else if (character === ")" || character === "]" || character === ">") depth = Math.max(0, depth - 1);
    if (character === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  parts.push(current);
  return parts.map((part) => part.replace(/[\r\n]+/g, " ").trim()).filter(Boolean);
}

export function triggerKey(value) {
  return String(value ?? "").toLowerCase().replaceAll(/\s+/g, " ").trim();
}

function matchesKeyword(text, keyword) {
  // 英数字のキーワードだけ語境界を見る（日本語は境界が無いので部分一致）。
  if (!/^[a-z0-9 .'-]+$/.test(keyword)) return text.includes(keyword);
  const escaped = keyword.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(text);
}

// LoRA分類 → キーワード の順で反映先を決める。決められなければextra。
export function classifyTriggerField(source, word = "") {
  const subcategory = String(source?.subcategory ?? "").trim().toLowerCase();
  if (SUBCATEGORY_FIELDS[subcategory]) return SUBCATEGORY_FIELDS[subcategory];
  // 旧形式のcategoryは character / direction の2値。directionは中身が特定できない。
  if (String(source?.category ?? "").trim().toLowerCase() === "character") return "character";

  const text = triggerKey(word);
  if (!text) return "extra";
  for (const [field, keywords] of KEYWORD_FIELDS) {
    if (keywords.some((keyword) => matchesKeyword(text, keyword))) return field;
  }
  return "extra";
}

function normalizeAppliedTrigger(item) {
  if (!item || typeof item !== "object") return null;
  const text = String(item.text ?? "").trim();
  if (!text) return null;
  const ids = Array.isArray(item.sourceLoraIds)
    ? [...new Set(item.sourceLoraIds.filter((value) => typeof value === "string" && value))]
    : [];
  const primary = typeof item.sourceLoraId === "string" && item.sourceLoraId ? item.sourceLoraId : ids[0] ?? "";
  const sourceLoraIds = ids.length ? ids : (primary ? [primary] : []);
  return {
    id: typeof item.id === "string" && item.id ? item.id : `trigger:${triggerKey(text)}`,
    sourceLoraId: primary || sourceLoraIds[0] || "",
    sourceLoraIds,
    text,
    weight: normalizeTriggerWeight(item.weight),
    targetField: isPromptField(item.targetField) ? item.targetField : "extra",
    enabled: item.enabled !== false
  };
}

export function normalizeAppliedTriggerWords(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const result = [];
  for (const item of input) {
    const normalized = normalizeAppliedTrigger(item);
    if (!normalized) continue;
    const key = triggerKey(normalized.text);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

// 選択中LoRA（sources）から、あるべきトリガーワード一覧を作り直す。
// - 既にある枠のWeight・有効/無効・反映先はユーザーの操作として保持する
// - 同じ文字列は1枠にまとめ、由来LoRAをsourceLoraIdsへ積む
// - どのLoRAからも参照されなくなった枠だけを削除する
export function syncTriggerWords(existing = [], sources = []) {
  const desired = new Map();
  for (const source of sources) {
    const sourceId = String(source?.id ?? "");
    if (!sourceId) continue;
    // words を持つ供給元（AI出力のインポートなど）は、反映先とWeightを自分で決める。
    const words = Array.isArray(source?.words) && source.words.length
      ? source.words
      : splitTriggerText(source?.triggerWords).map((text) => ({ text }));
    for (const word of words) {
      const text = String(word?.text ?? "").trim();
      const key = triggerKey(text);
      if (!key) continue;
      const entry = desired.get(key) ?? {
        text,
        targetField: isPromptField(word?.targetField)
          ? word.targetField
          : isPromptField(source?.targetField)
            ? source.targetField
            : classifyTriggerField(source, text),
        weight: normalizeTriggerWeight(word?.weight ?? 1),
        sourceLoraIds: []
      };
      if (!entry.sourceLoraIds.includes(sourceId)) entry.sourceLoraIds.push(sourceId);
      desired.set(key, entry);
    }
  }

  const previous = new Map();
  for (const item of normalizeAppliedTriggerWords(existing)) {
    previous.set(triggerKey(item.text), item);
  }

  const triggers = [];
  const added = [];
  for (const [key, entry] of desired) {
    const before = previous.get(key);
    if (before) {
      triggers.push({
        ...before,
        sourceLoraId: entry.sourceLoraIds[0],
        sourceLoraIds: entry.sourceLoraIds
      });
      continue;
    }
    const created = {
      id: `trigger:${key}`,
      sourceLoraId: entry.sourceLoraIds[0],
      sourceLoraIds: entry.sourceLoraIds,
      text: entry.text,
      weight: entry.weight ?? 1,
      targetField: entry.targetField,
      enabled: true
    };
    triggers.push(created);
    added.push(created);
  }

  const removed = [...previous.entries()]
    .filter(([key]) => !desired.has(key))
    .map(([, item]) => item);

  return { triggers, added, removed };
}

// 指定LoRA由来の枠だけを外す。他のLoRAが同じ語を使っていれば残す。
export function removeTriggersForLora(triggers, loraId) {
  const result = [];
  for (const item of normalizeAppliedTriggerWords(triggers)) {
    const sourceLoraIds = item.sourceLoraIds.filter((id) => id !== loraId);
    if (!sourceLoraIds.length) continue;
    result.push({ ...item, sourceLoraIds, sourceLoraId: sourceLoraIds[0] });
  }
  return result;
}

export function triggersForField(triggers, field) {
  return (Array.isArray(triggers) ? triggers : []).filter((item) => item?.targetField === field);
}

// LoRA本体のON/OFFを、由来情報を消さず最終Promptだけへ反映する。
// 共有タグは供給元が1つでも有効なら残し、個別のenabled=falseも尊重する。
export function activeTriggersForSources(triggers, isSourceActive) {
  return normalizeAppliedTriggerWords(triggers).filter((trigger) => {
    if (!trigger.enabled) return false;
    if (!trigger.sourceLoraIds.length || typeof isSourceActive !== "function") return true;
    return trigger.sourceLoraIds.some((sourceId) => isSourceActive(sourceId));
  });
}

// 最終Positive Prompt。各項目の直後に、その項目へ割り当てたトリガーワードを置く。
export function buildFinalPrompt(sections, triggers = []) {
  const normalized = normalizeSections(sections);
  const parts = [];
  for (const field of PROMPT_FIELDS) {
    const value = trimSection(normalized[field]);
    if (value) parts.push(value);
    const existing = new Set(splitTriggerText(value).map((word) => triggerKey(word)));
    for (const trigger of triggersForField(triggers, field)) {
      const text = formatTriggerWord(trigger);
      if (!text) continue;
      if (existing.has(triggerKey(text)) || existing.has(triggerKey(trigger.text))) continue;
      parts.push(text);
      existing.add(triggerKey(text));
      existing.add(triggerKey(trigger.text));
    }
  }
  return parts.join(", ");
}

// Raw Promptへまだ入っていないトリガーワードを返す（追加ボタンの表示判定に使う）。
export function pendingTriggerWords(rawPrompt, triggers = []) {
  const existing = new Set(splitTriggerText(rawPrompt).map((word) => triggerKey(word)));
  const pending = [];
  for (const trigger of triggers) {
    const formatted = formatTriggerWord(trigger);
    if (!formatted) continue;
    if (existing.has(triggerKey(formatted)) || existing.has(triggerKey(trigger.text))) continue;
    pending.push(trigger);
  }
  return pending;
}

// Raw Promptの末尾へ追記する。既に入っている語は足さない。
export function appendTriggersToRawPrompt(rawPrompt, triggers = []) {
  const base = String(rawPrompt ?? "").trim().replace(/[\s,]+$/, "");
  const additions = pendingTriggerWords(base, triggers).map((trigger) => formatTriggerWord(trigger));
  if (!additions.length) return base;
  return base ? `${base}, ${additions.join(", ")}` : additions.join(", ");
}
