import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPromptWeights,
  buildLoraNotices,
  dedupeLoraTags,
  describeLoraNotices,
  formatLoraWeight,
  hasLoraTag,
  normalizeLoraName,
  parseLoraTags,
  reconcilePromptLoras,
  removeLoraTags,
  replaceLoraWeight,
  resolveInstalledLora
} from "../public/lora-tags.js";

const INSTALLED = [
  { name: "Characters/saileach_IL" },
  { name: "Style/soft_style" },
  { name: "Characters/other_IL" }
];

const selection = (name, weight, source) => ({ name, weight, source });

test("LoRAタグを解析して名前とWeightを取り出す", () => {
  const tags = parseLoraTags("1girl, <lora:saileach_IL:0.65>, blue eyes");
  assert.equal(tags.length, 1);
  assert.equal(tags[0].name, "saileach_IL");
  assert.equal(tags[0].weight, 0.65);
  assert.equal(tags[0].raw, "<lora:saileach_IL:0.65>");
  assert.equal(tags[0].hasWeight, true);
  assert.equal(tags[0].start, 7);
});

test("Weight省略タグは1.0として扱う", () => {
  const [tag] = parseLoraTags("<lora:saileach_IL>");
  assert.equal(tag.weight, 1);
  assert.equal(tag.hasWeight, false);
  assert.equal(tag.invalidWeight, false);
});

test("Weightの下限・上限・不正値を扱う", () => {
  assert.equal(parseLoraTags("<lora:a:0.05>")[0].weight, 0.05);
  assert.equal(parseLoraTags("<lora:a:1>")[0].weight, 1);
  assert.equal(parseLoraTags("<lora:a:2>")[0].weight, 2);
  assert.equal(parseLoraTags("<lora:a:5>")[0].weight, 2, "上限で丸める");
  assert.equal(parseLoraTags("<lora:a:5>")[0].clamped, true);
  assert.equal(parseLoraTags("<lora:a:0>")[0].weight, 0.05, "下限で丸める");
  const invalid = parseLoraTags("<lora:a:strong>")[0];
  assert.equal(invalid.weight, 1);
  assert.equal(invalid.invalidWeight, true);
  assert.equal(invalid.weightText, "strong");
});

test("unet/te個別指定は先頭のWeightだけ読み、残りは保持する", () => {
  const [tag] = parseLoraTags("<lora:a:0.8:0.6>");
  assert.equal(tag.weight, 0.8);
  assert.equal(tag.extra, ":0.6");
  assert.equal(replaceLoraWeight("<lora:a:0.8:0.6>", "a", 0.4), "<lora:a:0.4:0.6>");
});

test("名前の正規化は大文字小文字とパス区切りだけ吸収する", () => {
  assert.equal(normalizeLoraName("Characters\\saileach_IL"), "characters/saileach_il");
  assert.equal(normalizeLoraName(" Characters/saileach_IL "), "characters/saileach_il");
  assert.notEqual(normalizeLoraName("saileach_IL2"), normalizeLoraName("saileach_IL"));
});

test("完全一致を優先し、決められない場合は選択しない", () => {
  assert.equal(resolveInstalledLora("Characters\\saileach_IL", INSTALLED).match.name, "Characters/saileach_IL");
  assert.equal(resolveInstalledLora("characters/SAILEACH_il", INSTALLED).match.name, "Characters/saileach_IL");
  // フォルダ無しでもファイル名が一意なら解決する
  assert.equal(resolveInstalledLora("saileach_IL", INSTALLED).match.name, "Characters/saileach_IL");
  // 同名ファイルが複数あるときは選ばない
  const duplicated = [{ name: "A/dup" }, { name: "B/dup" }];
  const ambiguous = resolveInstalledLora("dup", duplicated);
  assert.equal(ambiguous.match, null);
  assert.deepEqual(ambiguous.candidates.map((item) => item.name), ["A/dup", "B/dup"]);
  // 似ているだけの別LoRAは選ばない
  assert.equal(resolveInstalledLora("saileach", INSTALLED).match, null);
});

test("プロンプトのタグでUIが選択され、Weightも反映される", () => {
  const tags = parseLoraTags("1girl, <lora:saileach_IL:0.65>");
  const result = reconcilePromptLoras(tags, [], INSTALLED);
  assert.deepEqual(result.selected, [
    { name: "Characters/saileach_IL", weight: 0.65, source: "prompt" }
  ]);
  assert.equal(result.changed, true);
});

test("プロンプトのWeightがUIの値より優先される", () => {
  const tags = parseLoraTags("<lora:Characters/saileach_IL:0.65>");
  const result = reconcilePromptLoras(tags, [selection("Characters/saileach_IL", 1, "ui")], INSTALLED);
  assert.deepEqual(result.selected, [
    { name: "Characters/saileach_IL", weight: 0.65, source: "both" }
  ]);
});

test("UIのWeight変更は既存タグだけを書き換え、重複追加しない", () => {
  const prompt = "1girl,\n<lora:Characters\\saileach_IL:0.65>, blue eyes, (detail:1.2)";
  const next = replaceLoraWeight(prompt, "characters/saileach_il", 0.8);
  assert.equal(next, "1girl,\n<lora:Characters\\saileach_IL:0.8>, blue eyes, (detail:1.2)");
  // 名前・区切り・位置・他の重み構文・改行がそのまま残る
  assert.equal(parseLoraTags(next).length, 1);
  assert.equal(next.includes("Characters\\saileach_IL"), true);
  // 該当タグが無ければ何もしない（末尾へ足さない）
  assert.equal(replaceLoraWeight("1girl", "saileach_IL", 0.8), "1girl");
});

test("同じLoRAが複数記述された場合は最後のWeightを有効にして警告する", () => {
  const tags = parseLoraTags("<lora:saileach_IL:0.6>, 1girl, <lora:saileach_IL:0.9>");
  const result = reconcilePromptLoras(tags, [], INSTALLED);
  assert.deepEqual(result.selected, [
    { name: "Characters/saileach_IL", weight: 0.9, source: "prompt" }
  ]);
  assert.deepEqual(result.duplicates, [
    { name: "Characters/saileach_IL", weights: [0.6, 0.9], weight: 0.9 }
  ]);
  assert.match(describeLoraNotices(result)[0], /同じLoRAが複数記述されています/);
});

test("表記ゆれで書かれた同じLoRAも重複として扱う", () => {
  const prompt = "<lora:Characters\\CHAR:0.6>, 1girl, <lora:char:0.9>";
  const installed = [{ name: "Characters/char" }];
  const result = reconcilePromptLoras(parseLoraTags(prompt), [], installed);
  assert.deepEqual(result.selected, [{ name: "Characters/char", weight: 0.9, source: "prompt" }]);
  assert.deepEqual(result.duplicates, [
    { name: "Characters/char", weights: [0.6, 0.9], weight: 0.9 }
  ]);
  assert.equal(dedupeLoraTags(prompt).text, "1girl, <lora:char:0.9>");
  // フォルダ違いの別LoRAはまとめない
  assert.equal(dedupeLoraTags("<lora:A/dup:0.6>, <lora:B/dup:0.9>").duplicates.length, 0);
});

test("生成へ送るプロンプトでは同一LoRAを1つだけにする", () => {
  const { text, duplicates } = dedupeLoraTags("<lora:a:0.6>, 1girl, <lora:a:0.9>, blue eyes");
  assert.equal(text, "1girl, <lora:a:0.9>, blue eyes");
  assert.deepEqual(duplicates, [{ name: "a", weights: [0.6, 0.9], weight: 0.9 }]);
  // 重複が無ければ入力そのまま
  assert.equal(dedupeLoraTags("1girl, <lora:a:0.6>").text, "1girl, <lora:a:0.6>");
});

test("未インストールのLoRAは選択せず、プロンプトからも消さない", () => {
  const prompt = "1girl, <lora:unknown_lora:0.7>";
  const result = reconcilePromptLoras(parseLoraTags(prompt), [], INSTALLED);
  assert.deepEqual(result.selected, []);
  assert.deepEqual(result.unresolved, [{ name: "unknown_lora", weight: 0.7 }]);
  assert.match(describeLoraNotices(result)[0], /インストール済みLoRA一覧に見つかりません/);
  assert.deepEqual(buildLoraNotices(result)[0], { type: "unresolved", name: "unknown_lora", weight: 0.7 });
});

test("プロンプト由来の選択はタグを消すと外れる", () => {
  const before = reconcilePromptLoras(parseLoraTags("<lora:saileach_IL:0.65>"), [], INSTALLED);
  const after = reconcilePromptLoras([], before.selected, INSTALLED);
  assert.deepEqual(after.selected, []);
  assert.equal(after.changed, true);
});

test("UI由来の選択はタグを消しても残る", () => {
  const both = reconcilePromptLoras(
    parseLoraTags("<lora:saileach_IL:0.65>"),
    [selection("Characters/saileach_IL", 1, "ui")],
    INSTALLED
  );
  assert.equal(both.selected[0].source, "both");
  const after = reconcilePromptLoras([], both.selected, INSTALLED);
  assert.deepEqual(after.selected, [
    { name: "Characters/saileach_IL", weight: 0.65, source: "ui" }
  ]);
});

test("UI選択だけのLoRAは同期で消えない", () => {
  const result = reconcilePromptLoras([], [selection("Style/soft_style", 0.7, "ui")], INSTALLED);
  assert.deepEqual(result.selected, [{ name: "Style/soft_style", weight: 0.7, source: "ui" }]);
  assert.equal(result.changed, false);
});

test("実効プロンプトのWeightを履歴用のLoRA一覧へ反映する", () => {
  const loras = [
    { name: "Characters/saileach_IL", weight: 1, source: "both" },
    { name: "Style/soft_style", weight: 0.7, source: "ui" }
  ];
  const applied = applyPromptWeights(loras, "1girl, <lora:Characters/saileach_IL:0.65>, <lora:Style/soft_style:0.7>");
  assert.deepEqual(applied.map((item) => [item.name, item.weight]), [
    ["Characters/saileach_IL", 0.65],
    ["Style/soft_style", 0.7]
  ]);
});

test("タグの削除は本文を壊さず余分なカンマも残さない", () => {
  const removed = removeLoraTags("1girl, <lora:saileach_IL:0.65>, blue eyes", "Characters/saileach_IL");
  assert.equal(removed.text, "1girl, blue eyes");
  assert.equal(removed.removed, 1);
  assert.equal(removeLoraTags("1girl", "saileach_IL").removed, 0);
  assert.equal(hasLoraTag("1girl, <lora:a:1>", "A"), true);
});

test("Weightの表記は小数点以下の0を付けない", () => {
  assert.equal(formatLoraWeight(1), "1");
  assert.equal(formatLoraWeight(0.65), "0.65");
  assert.equal(formatLoraWeight(0.8), "0.8");
  assert.equal(formatLoraWeight("abc"), "1");
});
