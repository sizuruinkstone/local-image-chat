import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_GROK_INSTRUCTIONS,
  buildGrokRequestText,
  buildLoraCsv,
  mergePromptValue,
  normalizeHeading,
  parseAiPromptOutput,
  parseTriggerWordEntry
} from "../public/prompt-import.js";

const SAMPLE = `キャラクター
1girl, character_name

容姿・衣装
long hair, blue eyes, white dress

ポーズ・構図
standing, looking at viewer, cowboy shot

シチュエーション・背景
bedroom, nighttime

画風・品質
polished anime illustration, soft cel shading

追加プロンプト
(detailed eyes:1.2)

結合結果
1girl, character_name, long hair, blue eyes

Negative prompt
worst quality, bad anatomy`;

test("見出しごとに各項目へ振り分ける", () => {
  const parsed = parseAiPromptOutput(SAMPLE);
  assert.deepEqual(parsed.sections, {
    character: "1girl, character_name",
    appearance: "long hair, blue eyes, white dress",
    composition: "standing, looking at viewer, cowboy shot",
    situation: "bedroom, nighttime",
    style: "polished anime illustration, soft cel shading",
    extra: "(detailed eyes:1.2)"
  });
  assert.equal(parsed.combined, "1girl, character_name, long hair, blue eyes");
  assert.equal(parsed.negativePrompt, "worst quality, bad anatomy");
  assert.equal(parsed.hasSections, true);
  assert.equal(parsed.recognized, true);
});

test("Markdown見出し・太字・コードブロックを含む出力も解析する", () => {
  const parsed = parseAiPromptOutput(`## キャラクター
1girl, solo

**容姿・衣装**
\`\`\`
long hair, blue eyes
\`\`\`

### Negative Prompt
worst quality`);
  assert.equal(parsed.sections.character, "1girl, solo");
  assert.equal(parsed.sections.appearance, "long hair, blue eyes");
  assert.equal(parsed.negativePrompt, "worst quality");
  assert.deepEqual(parsed.unknownHeadings, []);
});

test("英語見出しにも対応する", () => {
  const parsed = parseAiPromptOutput(`Character
1girl

Appearance / Clothing
white dress

Pose / Composition
standing

Situation / Background
bedroom

Style / Quality
best quality

Extra Prompt
(depth of field:1.1)

Final Prompt
1girl, white dress

Negative Prompt
low quality`);
  assert.equal(parsed.sections.character, "1girl");
  assert.equal(parsed.sections.appearance, "white dress");
  assert.equal(parsed.sections.composition, "standing");
  assert.equal(parsed.sections.situation, "bedroom");
  assert.equal(parsed.sections.style, "best quality");
  assert.equal(parsed.sections.extra, "(depth of field:1.1)");
  assert.equal(parsed.combined, "1girl, white dress");
  assert.equal(parsed.negativePrompt, "low quality");
});

test("「見出し: 値」形式と複数行をまとめる", () => {
  const parsed = parseAiPromptOutput(`キャラクター: 1girl, solo
容姿・衣装
long hair,
blue eyes`);
  assert.equal(parsed.sections.character, "1girl, solo");
  // 行をまたいでも連続カンマを作らない
  assert.equal(parsed.sections.appearance, "long hair, blue eyes");
});

test("タグ順・重み構文・LoRA構文を変更しない", () => {
  const value = "(masterpiece:1.3), 1girl, <lora:style_a:0.8>, zzz, aaa";
  const parsed = parseAiPromptOutput(`追加プロンプト\n${value}`);
  assert.equal(parsed.sections.extra, value);
});

test("見出しが無ければ何も分類しない", () => {
  const parsed = parseAiPromptOutput("1girl, blue eyes, masterpiece");
  assert.equal(parsed.recognized, false);
  assert.equal(parsed.hasSections, false);
  assert.deepEqual(parsed.ignoredLines, ["1girl, blue eyes, masterpiece"]);
});

test("未対応の見出しは取り込まず、そのまま報告する", () => {
  const parsed = parseAiPromptOutput(`## 解説
このプロンプトはこういう狙いです

## キャラクター
1girl`);
  assert.deepEqual(parsed.unknownHeadings, ["解説"]);
  assert.equal(parsed.sections.character, "1girl");
  // 未対応見出しの中身は、直前・直後の項目へ混ぜない
  assert.equal(parsed.ignoredLines.includes("このプロンプトはこういう狙いです"), true);
  assert.equal(Object.values(parsed.sections).join(" ").includes("狙い"), false);
});

test("結合結果だけの出力も認識する", () => {
  const parsed = parseAiPromptOutput("結合結果\n1girl, blue eyes\n\nNegative prompt\nlow quality");
  assert.equal(parsed.hasSections, false);
  assert.equal(parsed.recognized, true);
  assert.equal(parsed.combined, "1girl, blue eyes");
  assert.equal(parsed.negativePrompt, "low quality");
});

test("LoRAトリガーワードは直前の項目に属し、Weightを読み取る", () => {
  const parsed = parseAiPromptOutput(`キャラクター
1girl

LoRAトリガーワード
character_name, (special_costume:1.2)

画風・品質
best quality

LoRAトリガーワード
soft_render`);
  assert.deepEqual(parsed.triggerWords, [
    { field: "character", text: "character_name", weight: 1 },
    { field: "character", text: "special_costume", weight: 1.2 },
    { field: "style", text: "soft_render", weight: 1 }
  ]);
});

test("Weightを読めない重み構文は文字列を壊さず1.0で扱う", () => {
  assert.deepEqual(parseTriggerWordEntry("character_name"), { text: "character_name", weight: 1 });
  assert.deepEqual(parseTriggerWordEntry("(character_name:1.2)"), { text: "character_name", weight: 1.2 });
  assert.deepEqual(parseTriggerWordEntry("((a:1.1):0.8)"), { text: "((a:1.1):0.8)", weight: 1 });
  assert.deepEqual(parseTriggerWordEntry("(a:high)"), { text: "(a:high)", weight: 1 });
  assert.deepEqual(parseTriggerWordEntry("<lora:x:0.8>"), { text: "<lora:x:0.8>", weight: 1 });
});

test("トリガーワードの見出しが先に来た場合は追加プロンプト扱い", () => {
  const parsed = parseAiPromptOutput("LoRAトリガーワード\nfoo_bar");
  assert.deepEqual(parsed.triggerWords, [{ field: "extra", text: "foo_bar", weight: 1 }]);
  assert.equal(parsed.recognized, true);
});

test("置き換えと末尾追加を選べる", () => {
  assert.equal(mergePromptValue("1girl", "blue eyes", "replace"), "blue eyes");
  assert.equal(mergePromptValue("1girl", "blue eyes", "append"), "1girl, blue eyes");
  // 端のカンマがあっても連続カンマにしない
  assert.equal(mergePromptValue("1girl, ", ", blue eyes", "append"), "1girl, blue eyes");
  assert.equal(mergePromptValue("", "blue eyes", "append"), "blue eyes");
  assert.equal(mergePromptValue("1girl", "", "append"), "1girl");
  // 中身の順序・重み構文はそのまま
  assert.equal(
    mergePromptValue("(a:1.2), b", "<lora:x:0.8>, c", "append"),
    "(a:1.2), b, <lora:x:0.8>, c"
  );
});

test("見出しの表記ゆれを正規化する", () => {
  assert.equal(normalizeHeading("## キャラクター"), "キャラクター");
  assert.equal(normalizeHeading("**容姿・衣装**"), "容姿衣装");
  assert.equal(normalizeHeading("1. Pose / Composition:"), "posecomposition");
  assert.equal(normalizeHeading("【Negative Prompt】"), "negativeprompt");
});

test("Grokへ渡す全文を組み立てる", () => {
  const text = buildGrokRequestText({
    instructions: "指示文",
    setupDoc: "GPU: RX 6700 XT",
    loraCsv: "name,displayName\nchar,Char"
  });
  assert.equal(text, [
    "指示文",
    "",
    "## MY_SD_SETUP.md",
    "",
    "GPU: RX 6700 XT",
    "",
    "## lora_list.csv",
    "",
    "```csv",
    "name,displayName",
    "char,Char",
    "```"
  ].join("\n"));
  // 空の項目は見出しごと省く
  assert.equal(buildGrokRequestText({ instructions: "指示文" }), "指示文");
  assert.equal(buildGrokRequestText({}), "");
  assert.ok(DEFAULT_GROK_INSTRUCTIONS.includes("結合結果"));
});

test("導入済みLoRAからCSVを作る", () => {
  const csv = buildLoraCsv([
    {
      name: "Character/char_a",
      displayName: "char_a",
      registry: { subcategory: "character", baseModel: "Illustrious", recommendedWeight: 0.8, triggerWords: "char_a, costume" }
    },
    { name: "Style/style_b", displayName: "style_b", category: "direction" },
    { name: "", displayName: "無視される" }
  ]);
  assert.deepEqual(csv.split("\n"), [
    "name,displayName,category,baseModel,recommendedWeight,triggerWords",
    'Character/char_a,char_a,character,Illustrious,0.8,"char_a, costume"',
    "Style/style_b,style_b,direction,,,"
  ]);
});
