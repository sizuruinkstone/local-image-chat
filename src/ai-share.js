import fs from "node:fs/promises";
import path from "node:path";
import { JsonStore } from "./json-store.js";

// AI（Grokなど）へ環境情報を渡すための共有データ生成。
// 方針:
// - 入力済みのタグ文字列（括弧・バックスラッシュ・綴り・順序）は絶対に加工しない
// - Trigger Wordsは「画面で手入力した値 > レジストリ/Civitai > 既存CSV > 空欄」の優先順
// - 生成に失敗しても通常のLoRA操作・画像生成は止めない（呼び出し側でbest-effort扱い）

export const AI_SHARE_CSV_COLUMNS = [
  "Name",
  "RelativePath",
  "Category",
  "TriggerWords",
  "RecommendedWeight",
  "RecommendedWeightMin",
  "RecommendedWeightMax",
  "BaseModel",
  "Notes"
];

export const AI_SHARE_CSV_FILENAME = "lora_list.csv";

// AIへ渡す運用ルール。プロンプトの壊れ方を防ぐための約束事。
export const AI_SHARE_RULES = [
  "CSVに無いLoRAを所有済みとして扱わないでください",
  "LoRA名とTrigger Wordsは1文字も変えずに使ってください（Nameをそのまま <lora:Name:Weight> へ書く）",
  "Trigger Wordsと「容姿・衣装」欄で同じ内容を重複させないでください",
  "LoRA構文・重み構文（(tag:1.2) など）・タグの並び順を壊さないでください",
  "分割入力の順番（キャラクター → 容姿・衣装 → ポーズ・構図 → シチュエーション・背景 → 画風・品質 → 追加プロンプト）を維持してください"
];

const DEFAULT_SETUP_DOC = [
  "- 生成環境: Stable Diffusion WebUI ReForge（API経由）",
  "- プロンプトは英語タグのカンマ区切り",
  "- 用途別（キャラクター / 容姿・衣装 / ポーズ・構図 / シチュエーション・背景 / 画風・品質 / 追加プロンプト）に分けて入力する"
].join("\n");

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  // 改行・カンマ・引用符を含む場合だけクォートする。中身の文字は変えない。
  const normalized = text.replace(/\r\n?/g, "\n");
  return /[",\n]/.test(normalized) ? `"${normalized.replaceAll('"', '""')}"` : normalized;
}

export function buildAiShareCsv(rows) {
  const lines = [AI_SHARE_CSV_COLUMNS.join(",")];
  for (const row of rows ?? []) {
    lines.push(AI_SHARE_CSV_COLUMNS.map((column) => csvCell(row?.[column])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

// 既存CSVを読み戻す（Trigger Wordsの優先順位3として使う）。
export function parseAiShareCsv(text) {
  const rows = [];
  const source = String(text ?? "").replace(/\r\n?/g, "\n");
  if (!source.trim()) return rows;

  const records = [];
  let field = "";
  let record = [];
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character !== '"') { field += character; continue; }
      if (source[index + 1] === '"') { field += '"'; index += 1; continue; }
      quoted = false;
      continue;
    }
    if (character === '"') { quoted = true; continue; }
    if (character === ",") { record.push(field); field = ""; continue; }
    if (character === "\n") { record.push(field); records.push(record); record = []; field = ""; continue; }
    field += character;
  }
  if (field || record.length) { record.push(field); records.push(record); }

  const [header, ...body] = records;
  if (!header) return rows;
  for (const values of body) {
    if (!values.length || values.every((value) => !value)) continue;
    const row = {};
    header.forEach((column, index) => { row[column.trim()] = values[index] ?? ""; });
    rows.push(row);
  }
  return rows;
}

function firstFilled(...values) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    if (value.trim()) return value;
  }
  return "";
}

function numberOrEmpty(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : "";
}

// Trigger Wordsの優先順: 手入力 > レジストリ(Civitai trainedWords) > 既存CSV > 空欄
export function buildAiShareRows({ loras = [], manualTriggerWords = {}, previousRows = [] } = {}) {
  const previousByName = new Map();
  for (const row of previousRows) {
    if (row?.Name) previousByName.set(String(row.Name).toLowerCase(), row);
  }

  return loras
    .filter((lora) => lora && typeof lora.name === "string" && lora.name)
    .map((lora) => {
      const registry = lora.registry ?? {};
      const previous = previousByName.get(lora.name.toLowerCase()) ?? {};
      const triggerWords = firstFilled(
        manualTriggerWords[lora.name],
        registry.triggerWords,
        previous.TriggerWords
      );
      return {
        Name: lora.name,
        RelativePath: firstFilled(registry.relativeName, lora.name),
        Category: firstFilled(registry.subcategory, registry.category, lora.category),
        TriggerWords: triggerWords,
        RecommendedWeight: numberOrEmpty(registry.recommendedWeight),
        RecommendedWeightMin: numberOrEmpty(registry.recommendedWeightMin),
        RecommendedWeightMax: numberOrEmpty(registry.recommendedWeightMax),
        BaseModel: firstFilled(registry.baseModel, previous.BaseModel),
        Notes: firstFilled(registry.note, previous.Notes)
      };
    });
}

export function countTriggerWords(rows) {
  return (rows ?? []).filter((row) => String(row?.TriggerWords ?? "").trim()).length;
}

// Grokへ貼り付けるMarkdown。CSVと同じ値をそのまま載せる。
export function buildGrokShareMarkdown({
  rows = [],
  csv = "",
  setupDoc = "",
  instructions = "",
  checkpoints = [],
  activeCheckpoint = "",
  version = ""
} = {}) {
  const blocks = [`# Stable Diffusion 環境共有${version ? `（Local Image Chat v${version}）` : ""}`];

  if (String(instructions).trim()) {
    blocks.push(`## プロンプト方針\n\n${String(instructions).trim()}`);
  }
  blocks.push(`## 環境（MY_SD_SETUP）\n\n${String(setupDoc).trim() || DEFAULT_SETUP_DOC}`);

  const checkpointLines = (checkpoints ?? [])
    .map((item) => (typeof item === "string" ? item : item?.title))
    .filter(Boolean)
    .map((title) => `- ${title}${title === activeCheckpoint ? "（使用中）" : ""}`);
  blocks.push(`## 使用可能Checkpoint\n\n${checkpointLines.length ? checkpointLines.join("\n") : "- 取得できませんでした"}`);

  blocks.push(`## 所有LoRA（${rows.length}件）\n\n\`\`\`csv\n${(csv || buildAiShareCsv(rows)).trim()}\n\`\`\``);
  blocks.push(`## 運用ルール\n\n${AI_SHARE_RULES.map((rule) => `- ${rule}`).join("\n")}`);
  return `${blocks.join("\n\n")}\n`;
}

export function createAiShareService(dataDir, { csvFilename = AI_SHARE_CSV_FILENAME } = {}) {
  const store = new JsonStore(path.join(dataDir, "ai-share.json"), {
    schemaVersion: 1,
    // 画面で手入力したTrigger Words。レジストリ（Civitai再解析）とは別に持つので、
    // 再取得しても手動値が消えない。
    triggerWords: {},
    generatedAt: null,
    rowCount: 0,
    triggerWordCount: 0
  });
  const csvPath = path.join(dataDir, csvFilename);

  async function readManualTriggerWords() {
    const data = await store.read();
    const stored = data.triggerWords;
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
    return stored;
  }

  async function readPreviousRows() {
    try {
      return parseAiShareCsv(await fs.readFile(csvPath, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") console.warn(`[AI共有] 既存CSVを読めません: ${error.message}`);
      return [];
    }
  }

  return {
    csvPath,

    async getState() {
      const data = await store.read();
      return {
        path: csvPath,
        generatedAt: data.generatedAt ?? null,
        rowCount: Number(data.rowCount) || 0,
        triggerWordCount: Number(data.triggerWordCount) || 0
      };
    },

    // 画面の手入力Trigger Wordsを保存する（空文字は削除扱い）。
    async saveManualTriggerWords(input) {
      if (!input || typeof input !== "object" || Array.isArray(input)) return {};
      const next = await store.update((data) => {
        const merged = { ...(data.triggerWords ?? {}) };
        for (const [name, value] of Object.entries(input)) {
          if (typeof name !== "string" || !name.trim()) continue;
          const text = typeof value === "string" ? value.slice(0, 600) : "";
          if (text.trim()) merged[name.slice(0, 300)] = text;
          else delete merged[name.slice(0, 300)];
        }
        data.triggerWords = merged;
        return data;
      });
      return next.triggerWords ?? {};
    },

    async buildRows(loras) {
      const [manualTriggerWords, previousRows] = await Promise.all([
        readManualTriggerWords(),
        readPreviousRows()
      ]);
      return buildAiShareRows({ loras, manualTriggerWords, previousRows });
    },

    // CSVを作り直して保存する。内容が同じならファイルへ書き込まない。
    async updateCsv(loras) {
      const rows = await this.buildRows(loras);
      const csv = buildAiShareCsv(rows);
      const previous = await fs.readFile(csvPath, "utf8").catch(() => "");
      const changed = previous !== csv;
      if (changed) await fs.writeFile(csvPath, csv, "utf8");
      const triggerWordCount = countTriggerWords(rows);
      const generatedAt = new Date().toISOString();
      await store.update((data) => {
        data.generatedAt = generatedAt;
        data.rowCount = rows.length;
        data.triggerWordCount = triggerWordCount;
        return data;
      });
      return { path: csvPath, csv, rows, rowCount: rows.length, triggerWordCount, changed, generatedAt };
    },

    async readCsv() {
      return fs.readFile(csvPath, "utf8").catch(() => "");
    }
  };
}
