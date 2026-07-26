import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  AI_SHARE_CSV_COLUMNS,
  AI_SHARE_RULES,
  buildAiShareCsv,
  buildAiShareRows,
  buildGrokShareMarkdown,
  countTriggerWords,
  createAiShareService,
  parseAiShareCsv
} from "../src/ai-share.js";

const LORAS = [
  {
    name: "Characters/saileach_IL",
    displayName: "saileach",
    category: "character",
    registry: {
      relativeName: "Characters/saileach_IL",
      subcategory: "character",
      triggerWords: "saileach, (special costume:1.2)",
      recommendedWeight: 0.8,
      recommendedWeightMin: 0.6,
      recommendedWeightMax: 1,
      baseModel: "Illustrious",
      note: "配布元のメモ, カンマ入り"
    }
  },
  { name: "Style/soft_style", displayName: "soft_style", category: "direction" }
];

test("CSVは指定の列で出力し、カンマや引用符を正しくクォートする", () => {
  const rows = buildAiShareRows({ loras: LORAS });
  const csv = buildAiShareCsv(rows);
  const lines = csv.trim().split("\n");
  assert.equal(lines[0], AI_SHARE_CSV_COLUMNS.join(","));
  assert.equal(
    lines[1],
    'Characters/saileach_IL,Characters/saileach_IL,character,"saileach, (special costume:1.2)",0.8,0.6,1,Illustrious,"配布元のメモ, カンマ入り"'
  );
  // レジストリが無いLoRAは空欄のまま出す
  assert.equal(lines[2], "Style/soft_style,Style/soft_style,direction,,,,,,");
});

test("括弧・バックスラッシュ・綴り・順序を書き換えない", () => {
  const triggerWords = "zzz_tag, (a:1.2), <lora:x:0.8>, C:\\path\\tag, aaa";
  const [row] = buildAiShareRows({
    loras: [{ name: "A/b", registry: { triggerWords } }]
  });
  assert.equal(row.TriggerWords, triggerWords);
  assert.equal(parseAiShareCsv(buildAiShareCsv([row]))[0].TriggerWords, triggerWords);
});

test("Trigger Wordsは手入力 > レジストリ > 既存CSV > 空欄の順で採用する", () => {
  const loras = [
    { name: "A/manual", registry: { triggerWords: "registry_value" } },
    { name: "B/registry", registry: { triggerWords: "registry_value" } },
    { name: "C/previous", registry: {} },
    { name: "D/empty", registry: {} }
  ];
  const rows = buildAiShareRows({
    loras,
    manualTriggerWords: { "A/manual": "manual_value" },
    previousRows: [
      { Name: "C/previous", TriggerWords: "previous_value" },
      { Name: "A/manual", TriggerWords: "previous_value" }
    ]
  });
  assert.deepEqual(rows.map((row) => row.TriggerWords), [
    "manual_value", "registry_value", "previous_value", ""
  ]);
  assert.equal(countTriggerWords(rows), 3);
});

test("CSVを読み戻して同じ値に戻る", () => {
  const rows = buildAiShareRows({ loras: LORAS });
  const parsed = parseAiShareCsv(buildAiShareCsv(rows));
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].Name, "Characters/saileach_IL");
  assert.equal(parsed[0].TriggerWords, "saileach, (special costume:1.2)");
  assert.equal(parsed[0].Notes, "配布元のメモ, カンマ入り");
  assert.equal(parsed[1].TriggerWords, "");
  // 引用符と改行入りも復元できる
  const tricky = parseAiShareCsv(buildAiShareCsv([{ Name: 'a"b', Notes: "1行目\n2行目" }]));
  assert.equal(tricky[0].Name, 'a"b');
  assert.equal(tricky[0].Notes, "1行目\n2行目");
  assert.deepEqual(parseAiShareCsv(""), []);
});

test("Grok用Markdownに環境・Checkpoint・LoRA・運用ルールを載せる", () => {
  const rows = buildAiShareRows({ loras: LORAS });
  const markdown = buildGrokShareMarkdown({
    rows,
    csv: buildAiShareCsv(rows),
    setupDoc: "GPU: RX 6700 XT",
    instructions: "見出し形式で返答してください",
    checkpoints: [{ title: "waiNSFW.safetensors" }, { title: "other.safetensors" }],
    activeCheckpoint: "waiNSFW.safetensors",
    version: "2.18.0"
  });
  assert.match(markdown, /^# Stable Diffusion 環境共有（Local Image Chat v2\.18\.0）/);
  assert.match(markdown, /## プロンプト方針\n\n見出し形式で返答してください/);
  assert.match(markdown, /## 環境（MY_SD_SETUP）\n\nGPU: RX 6700 XT/);
  assert.match(markdown, /- waiNSFW\.safetensors（使用中）/);
  assert.match(markdown, /## 所有LoRA（2件）/);
  assert.match(markdown, /```csv\nName,RelativePath/);
  assert.match(markdown, /saileach, \(special costume:1\.2\)/);
  for (const rule of AI_SHARE_RULES) assert.ok(markdown.includes(rule), rule);
});

test("環境情報が空でも既定の説明とCheckpoint未取得を出す", () => {
  const markdown = buildGrokShareMarkdown({ rows: [] });
  assert.match(markdown, /## 環境（MY_SD_SETUP）\n\n- 生成環境/);
  assert.match(markdown, /- 取得できませんでした/);
  assert.equal(markdown.includes("## プロンプト方針"), false);
});

test("CSVをファイルへ保存し、件数と出力先を返す", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "local-image-chat-ai-share-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const service = createAiShareService(directory);

  const first = await service.updateCsv(LORAS);
  assert.equal(first.rowCount, 2);
  assert.equal(first.triggerWordCount, 1);
  assert.equal(first.changed, true);
  assert.equal(first.path, path.join(directory, "lora_list.csv"));
  assert.equal((await fs.readFile(first.path, "utf8")).startsWith("Name,RelativePath"), true);

  // 内容が同じなら書き込まない
  const second = await service.updateCsv(LORAS);
  assert.equal(second.changed, false);

  const state = await service.getState();
  assert.equal(state.rowCount, 2);
  assert.ok(state.generatedAt);
});

test("手入力Trigger Wordsは保存され、Civitai再取得後も最優先で残る", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "local-image-chat-ai-share-manual-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const service = createAiShareService(directory);

  await service.saveManualTriggerWords({ "Characters/saileach_IL": "手入力の起動ワード", "  ": "無視" });
  const updated = await service.updateCsv(LORAS);
  assert.equal(updated.rows[0].TriggerWords, "手入力の起動ワード");

  // Civitaiから新しいtriggerWordsが来ても手入力が勝つ
  const refreshed = await service.updateCsv([
    { ...LORAS[0], registry: { ...LORAS[0].registry, triggerWords: "civitaiの新しい値" } }
  ]);
  assert.equal(refreshed.rows[0].TriggerWords, "手入力の起動ワード");

  // 空文字を送ると手入力を取り消し、レジストリの値へ戻る
  await service.saveManualTriggerWords({ "Characters/saileach_IL": "" });
  const cleared = await service.updateCsv(LORAS);
  assert.equal(cleared.rows[0].TriggerWords, "saileach, (special costume:1.2)");
});
