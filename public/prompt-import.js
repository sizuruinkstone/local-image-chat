// AI（Grok・ChatGPTなど）が出力した分割プロンプトの取り込み。
// 方針:
// - 見出しが一致した部分だけを取り込む。意味の推測・再分類・翻訳はしない
// - タグ順、LoRA構文、重み構文には手を入れない（触るのは連結時の区切りだけ）
// - 認識できなかった見出し・行は捨てずに「取り込まなかったもの」として報告する

import {
  PROMPT_FIELDS,
  normalizeTriggerWeight,
  splitTriggerText,
  trimPromptEdges
} from "./structured-prompt.js";

// 見出しの表記ゆれ。normalizeHeadingで記号・空白を落とした形で比較する。
const HEADING_ALIASES = {
  character: ["キャラクター", "キャラ", "キャラクタープロンプト", "character", "characters", "characterprompt", "char"],
  appearance: [
    "容姿衣装", "容姿", "衣装", "外見", "容姿服装", "服装",
    "appearance", "appearanceclothing", "clothing", "clothes", "outfit", "costume", "appearanceoutfit"
  ],
  composition: [
    "ポーズ構図", "ポーズ", "構図", "ポーズカメラ",
    "posecomposition", "pose", "composition", "posing", "framing", "camera"
  ],
  situation: [
    "シチュエーション背景", "シチュエーション", "背景", "場面", "情景",
    "situationbackground", "situation", "background", "scene", "setting", "location"
  ],
  style: ["画風品質", "画風", "品質", "stylequality", "style", "quality", "artstyle", "rendering"],
  extra: [
    "追加プロンプト", "追加", "その他", "補足",
    "extraprompt", "extra", "additionalprompt", "additional", "others", "other", "misc"
  ],
  combined: [
    "結合結果", "結合プロンプト", "結合", "完成プロンプト", "最終プロンプト", "positiveprompt", "ポジティブプロンプト",
    "combinedprompt", "combined", "finalprompt", "final", "fullprompt", "prompt"
  ],
  negative: ["negativeprompt", "negative", "ネガティブプロンプト", "ネガティブ", "ネガティブ除外", "除外プロンプト"],
  trigger: [
    "loraトリガーワード", "トリガーワード", "loraトリガー", "起動ワード",
    "loratriggerwords", "loratriggerword", "triggerwords", "triggerword", "loratrigger", "trigger"
  ]
};

const HEADING_KEYS = new Map();
for (const [key, aliases] of Object.entries(HEADING_ALIASES)) {
  for (const alias of aliases) HEADING_KEYS.set(normalizeHeading(alias), key);
}

export function normalizeHeading(value) {
  return String(value ?? "")
    // 箇条書き・番号・Markdownの見出し記号を落とす
    .replace(/^[\s>#*・\-–—•]+/, "")
    .replace(/^\d+[.)]\s*/, "")
    .replace(/[*_`~【】「」\[\]（）()<>:：、。,，.]/g, "")
    .replace(/[\s/／・|｜]/g, "")
    .trim()
    .toLowerCase();
}

// Markdownの見出し・太字だけの行は「見出しのつもり」とみなす（未対応見出しの報告用）。
function looksLikeHeading(line) {
  return /^#{1,6}\s+\S/.test(line) || /^\*\*[^*]+\*\*[:：]?$/.test(line) || /^【[^】]+】$/.test(line);
}

function detectHeading(line) {
  const direct = HEADING_KEYS.get(normalizeHeading(line));
  if (direct) return { key: direct, inlineValue: "" };
  // 「見出し: 値」形式にも対応する。
  const separator = line.search(/[:：]/);
  if (separator > 0) {
    const key = HEADING_KEYS.get(normalizeHeading(line.slice(0, separator)));
    if (key) return { key, inlineValue: line.slice(separator + 1).trim() };
  }
  return null;
}

// 行はカンマ区切りのタグ列として連結する。連続カンマは作らない。
function joinLines(lines) {
  return lines
    .map((line) => trimPromptEdges(line))
    .filter(Boolean)
    .join(", ");
}

// `(word:1.2)` からWeightを読む。読めない形はそのままの文字列として扱う。
export function parseTriggerWordEntry(value) {
  const text = String(value ?? "").trim();
  const matched = text.match(/^\(\s*([^()]+?)\s*:\s*(\d+(?:\.\d+)?)\s*\)$/);
  if (!matched) return { text, weight: 1 };
  const inner = matched[1].trim();
  if (!inner) return { text, weight: 1 };
  return { text: inner, weight: normalizeTriggerWeight(matched[2]) };
}

export function parseAiPromptOutput(input) {
  const sections = Object.fromEntries(PROMPT_FIELDS.map((field) => [field, []]));
  const combined = [];
  const negative = [];
  const triggerLines = [];
  const unknownHeadings = [];
  const ignoredLines = [];

  let current = null;
  let currentField = "extra";
  let insideFence = false;

  for (const rawLine of String(input ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();
    // コードブロックの囲み行だけを捨て、中身は通常の行として読む。
    if (/^(```|~~~)/.test(line)) {
      insideFence = !insideFence;
      continue;
    }
    if (!line) continue;
    // 区切り線は無視する。
    if (/^([-*_]\s*){3,}$/.test(line)) continue;

    const heading = detectHeading(line);
    if (heading) {
      current = heading.key;
      if (PROMPT_FIELDS.includes(heading.key)) currentField = heading.key;
      if (heading.inlineValue) pushLine(heading.key, heading.inlineValue);
      continue;
    }

    if (looksLikeHeading(line)) {
      // 見出しに見えるが対応表に無い → 中身を勝手に分類せず、報告だけする。
      unknownHeadings.push(line.replace(/^#+\s*/, "").replace(/^\*\*|\*\*$/g, "").trim());
      current = null;
      continue;
    }

    if (!current) {
      ignoredLines.push(line);
      continue;
    }
    pushLine(current, line);
  }

  function pushLine(key, line) {
    if (key === "combined") return void combined.push(line);
    if (key === "negative") return void negative.push(line);
    if (key === "trigger") return void triggerLines.push({ field: currentField, line });
    sections[key].push(line);
  }

  const resolvedSections = Object.fromEntries(
    PROMPT_FIELDS.map((field) => [field, joinLines(sections[field])])
  );
  const hasSections = PROMPT_FIELDS.some((field) => resolvedSections[field]);
  const triggerWords = collectTriggerWords(triggerLines);
  const combinedText = joinLines(combined);
  const negativeText = joinLines(negative);

  return {
    sections: resolvedSections,
    combined: combinedText,
    negativePrompt: negativeText,
    triggerWords,
    unknownHeadings: [...new Set(unknownHeadings)],
    ignoredLines,
    hasSections,
    recognized: hasSections || Boolean(combinedText) || Boolean(negativeText) || triggerWords.length > 0
  };
}

function collectTriggerWords(triggerLines) {
  const seen = new Set();
  const result = [];
  for (const { field, line } of triggerLines) {
    for (const word of splitTriggerText(line)) {
      const parsed = parseTriggerWordEntry(word);
      if (!parsed.text) continue;
      const key = parsed.text.toLowerCase().replaceAll(/\s+/g, " ");
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ field, text: parsed.text, weight: parsed.weight });
    }
  }
  return result;
}

// 既存入力への反映。append時も連続カンマを作らず、中身の並びは変えない。
export function mergePromptValue(current, addition, mode = "replace") {
  const next = trimPromptEdges(addition);
  if (mode !== "append") return next;
  const base = trimPromptEdges(current);
  if (!base) return next;
  if (!next) return base;
  return `${base}, ${next}`;
}

// ---- Grokへ渡す指示テンプレート ----

export const DEFAULT_GROK_INSTRUCTIONS = `あなたは Stable Diffusion (Illustrious / NoobAI系) 用のプロンプト作成アシスタントです。
私の環境情報（MY_SD_SETUP.md）と導入済みLoRA一覧（lora_list.csv）を踏まえて、
これから伝える内容の画像プロンプトを作ってください。

出力は必ず次の見出しで、この順番どおりに書いてください。
見出し行には余計な記号や説明を付けず、各見出しの下にカンマ区切りの英語タグだけを書いてください。

キャラクター
容姿・衣装
ポーズ・構図
シチュエーション・背景
画風・品質
追加プロンプト
LoRAトリガーワード
結合結果
Negative prompt

ルール:
- 使わない項目は見出しごと省略してください（空欄で書かないでください）
- LoRAトリガーワードは、直前の見出しに対応するものを書いてください
- 強調は (tag:1.2) の形式で書いてください
- 結合結果は、上の項目を上から順にカンマでつないだ1行にしてください
- 説明文・箇条書き・番号は付けないでください`;

export function buildGrokRequestText({ instructions = "", setupDoc = "", loraCsv = "" } = {}) {
  const blocks = [];
  if (String(instructions).trim()) blocks.push(String(instructions).trim());
  if (String(setupDoc).trim()) blocks.push(`## MY_SD_SETUP.md\n\n${String(setupDoc).trim()}`);
  if (String(loraCsv).trim()) blocks.push(`## lora_list.csv\n\n\`\`\`csv\n${String(loraCsv).trim()}\n\`\`\``);
  return blocks.join("\n\n");
}
