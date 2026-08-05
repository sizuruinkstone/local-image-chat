import assert from "node:assert/strict";
import test from "node:test";
import {
  PROMPT_FIELDS,
  activeTriggersForSources,
  appendTriggersToRawPrompt,
  buildFinalPrompt,
  classifyTriggerField,
  formatTriggerWord,
  hasSectionContent,
  joinPromptSections,
  normalizeAppliedTriggerWords,
  normalizeSections,
  normalizeTriggerWeight,
  pendingTriggerWords,
  removeTriggersForLora,
  splitTriggerText,
  syncTriggerWords
} from "../public/structured-prompt.js";

const sections = {
  character: "1girl, character_name",
  appearance: "blue eyes, sailor uniform",
  composition: "upper body",
  situation: "classroom",
  style: "masterpiece",
  extra: "(depth of field:1.1)"
};

test("用途別の項目を指定順で結合する", () => {
  assert.equal(
    joinPromptSections(sections),
    "1girl, character_name, blue eyes, sailor uniform, upper body, classroom, masterpiece, (depth of field:1.1)"
  );
});

test("空欄は無視し、入力順は変えない", () => {
  assert.equal(
    joinPromptSections({ style: "best quality", character: "1girl", appearance: "   " }),
    "1girl, best quality"
  );
});

test("端のカンマがあっても連続カンマを作らない", () => {
  assert.equal(joinPromptSections({ character: "1girl, ", appearance: ", blue eyes" }), "1girl, blue eyes");
});

test("重複タグは勝手に削除しない", () => {
  assert.equal(joinPromptSections({ character: "1girl, 1girl", style: "1girl" }), "1girl, 1girl, 1girl");
});

test("LoRA構文・重み構文はそのまま残す", () => {
  const value = "<lora:style_a:0.8>, (detailed face:1.3)";
  assert.equal(joinPromptSections({ extra: value }), value);
});

test("normalizeSectionsは6項目を文字列で埋める", () => {
  const normalized = normalizeSections({ character: "1girl", style: 42 });
  assert.deepEqual(Object.keys(normalized), PROMPT_FIELDS);
  assert.equal(normalized.character, "1girl");
  assert.equal(normalized.style, "");
  assert.equal(hasSectionContent(normalized), true);
  assert.equal(hasSectionContent({}), false);
});

test("Weightが1.0ならそのまま、それ以外は括弧付きにする", () => {
  assert.equal(formatTriggerWord({ text: "character_name", weight: 1, enabled: true }), "character_name");
  assert.equal(formatTriggerWord({ text: "character_name", weight: 1.2, enabled: true }), "(character_name:1.2)");
  assert.equal(formatTriggerWord({ text: "character_name", weight: 0.8, enabled: true }), "(character_name:0.8)");
  assert.equal(formatTriggerWord({ text: "character_name", weight: 1.2, enabled: false }), "");
});

test("Weightは0.05〜2.0へ収め、既定は1.0", () => {
  assert.equal(normalizeTriggerWeight(undefined), 1);
  assert.equal(normalizeTriggerWeight("abc"), 1);
  assert.equal(normalizeTriggerWeight(5), 2);
  assert.equal(normalizeTriggerWeight(0), 0.05);
  assert.equal(normalizeTriggerWeight(1.234), 1.23);
});

test("括弧の内側のカンマでは分割しない", () => {
  assert.deepEqual(splitTriggerText("a, (b, c:1.2), <lora:x:1>"), ["a", "(b, c:1.2)", "<lora:x:1>"]);
});

test("LoRA分類からトリガーワードの反映先を決める", () => {
  assert.equal(classifyTriggerField({ subcategory: "character" }, "character_name"), "character");
  assert.equal(classifyTriggerField({ subcategory: "style" }, "modern_render"), "style");
  assert.equal(classifyTriggerField({ subcategory: "body" }, "curvy"), "appearance");
  assert.equal(classifyTriggerField({ subcategory: "pose" }, "sitting"), "composition");
  assert.equal(classifyTriggerField({ category: "character" }, "character_name"), "character");
});

test("分類できないLoRAはキーワード判定、それでも不明なら追加プロンプト", () => {
  assert.equal(classifyTriggerField({ subcategory: "other" }, "detailed background"), "situation");
  assert.equal(classifyTriggerField({ category: "direction" }, "from behind"), "composition");
  assert.equal(classifyTriggerField({ subcategory: "utility" }, "watercolor"), "style");
  assert.equal(classifyTriggerField({ subcategory: "utility" }, "school uniform"), "appearance");
  assert.equal(classifyTriggerField({ subcategory: "utility" }, "zzz_token_01"), "extra");
  assert.equal(classifyTriggerField({ category: "direction" }, "qwerty"), "extra");
});

test("LoRA追加でトリガーワード枠が作られ、初期Weightは1.0", () => {
  const { triggers, added } = syncTriggerWords([], [
    { id: "char.safetensors", subcategory: "character", triggerWords: "character_name, special_costume" }
  ]);
  assert.equal(triggers.length, 2);
  assert.equal(added.length, 2);
  assert.deepEqual(triggers.map((item) => item.text), ["character_name", "special_costume"]);
  assert.deepEqual(triggers.map((item) => item.weight), [1, 1]);
  assert.deepEqual(triggers.map((item) => item.targetField), ["character", "character"]);
  assert.deepEqual(triggers.map((item) => item.enabled), [true, true]);
  assert.deepEqual(triggers[0].sourceLoraIds, ["char.safetensors"]);
});

test("同じLoRAを再同期しても重複せず、Weightと無効化を保持する", () => {
  const sources = [{ id: "char", subcategory: "character", triggerWords: "character_name, special_costume" }];
  const first = syncTriggerWords([], sources).triggers;
  first[0].weight = 1.2;
  first[1].enabled = false;
  const second = syncTriggerWords(first, sources);
  assert.equal(second.triggers.length, 2);
  assert.equal(second.added.length, 0);
  assert.equal(second.triggers[0].weight, 1.2);
  assert.equal(second.triggers[1].enabled, false);
});

test("同じトリガーワードを複数LoRAが共有する場合は1枠にまとめる", () => {
  const { triggers } = syncTriggerWords([], [
    { id: "a", subcategory: "character", triggerWords: "shared_word" },
    { id: "b", subcategory: "style", triggerWords: "shared_word, style_word" }
  ]);
  assert.equal(triggers.length, 2);
  assert.deepEqual(triggers[0].sourceLoraIds, ["a", "b"]);
  assert.equal(triggers[0].targetField, "character");
});

test("LoRAを外すとそのLoRA由来の枠だけ消え、共有中の枠は残る", () => {
  const before = syncTriggerWords([], [
    { id: "a", subcategory: "character", triggerWords: "shared_word, only_a" },
    { id: "b", subcategory: "style", triggerWords: "shared_word" }
  ]).triggers;
  const after = syncTriggerWords(before, [{ id: "b", subcategory: "style", triggerWords: "shared_word" }]);
  assert.deepEqual(after.triggers.map((item) => item.text), ["shared_word"]);
  assert.deepEqual(after.triggers[0].sourceLoraIds, ["b"]);
  assert.deepEqual(after.removed.map((item) => item.text), ["only_a"]);
});

test("removeTriggersForLoraは他LoRAが使う枠を残す", () => {
  const triggers = [
    { id: "1", sourceLoraIds: ["a", "b"], text: "shared", weight: 1, targetField: "character", enabled: true },
    { id: "2", sourceLoraIds: ["a"], text: "only_a", weight: 1, targetField: "character", enabled: true }
  ];
  const result = removeTriggersForLora(triggers, "a");
  assert.deepEqual(result.map((item) => item.text), ["shared"]);
  assert.deepEqual(result[0].sourceLoraIds, ["b"]);
  assert.equal(result[0].sourceLoraId, "b");
});

test("最終プロンプトは各項目の直後にその項目のトリガーワードを置く", () => {
  const triggers = [
    { id: "1", sourceLoraIds: ["a"], text: "character_name", weight: 1.2, targetField: "character", enabled: true },
    { id: "2", sourceLoraIds: ["a"], text: "special_costume", weight: 0.8, targetField: "character", enabled: true },
    { id: "3", sourceLoraIds: ["b"], text: "modern_render", weight: 1, targetField: "style", enabled: true }
  ];
  assert.equal(
    buildFinalPrompt({ character: "1girl", style: "masterpiece" }, triggers),
    "1girl, (character_name:1.2), (special_costume:0.8), masterpiece, modern_render"
  );
});

test("入力欄に同じ由来タグがある場合は最終プロンプトへ重複追加しない", () => {
  const triggers = [
    {
      id: "1",
      sourceLoraIds: ["ray"],
      text: "ray_\\(arknights\\)",
      weight: 1,
      targetField: "character",
      enabled: true
    },
    {
      id: "2",
      sourceLoraIds: ["ray"],
      text: "rabbit ears",
      weight: 1,
      targetField: "character",
      enabled: true
    }
  ];
  assert.equal(
    buildFinalPrompt({ character: "1girl, ray_\\(arknights\\), purple eyes" }, triggers),
    "1girl, ray_\\(arknights\\), purple eyes, rabbit ears"
  );
});

test("無効にしたトリガーワードは最終プロンプトへ入らない", () => {
  const triggers = [
    { id: "1", sourceLoraIds: ["a"], text: "character_name", weight: 1, targetField: "character", enabled: false },
    { id: "2", sourceLoraIds: ["a"], text: "kept", weight: 1, targetField: "character", enabled: true }
  ];
  assert.equal(buildFinalPrompt({ character: "1girl" }, triggers), "1girl, kept");
});

test("LoRAをOFFにしても由来情報を保持し最終Promptだけから除外する", () => {
  const triggers = [
    { id: "1", sourceLoraIds: ["ray"], text: "ray_\\(arknights\\)", weight: 1, targetField: "character", enabled: true },
    { id: "2", sourceLoraIds: ["outfit-choice:ray::dream"], text: "ray_\\(dreaming_high\\)", weight: 1, targetField: "appearance", enabled: true },
    { id: "3", sourceLoraIds: ["other"], text: "shared_style", weight: 1, targetField: "style", enabled: true }
  ];
  const disabled = activeTriggersForSources(triggers, (sourceId) =>
    !sourceId.includes("ray")
  );
  assert.deepEqual(disabled.map((trigger) => trigger.text), ["shared_style"]);
  assert.equal(triggers.length, 3, "元の由来情報は削除しない");

  const enabled = activeTriggersForSources(triggers, () => true);
  assert.deepEqual(enabled.map((trigger) => trigger.text), [
    "ray_\\(arknights\\)",
    "ray_\\(dreaming_high\\)",
    "shared_style"
  ]);
});

test("入力欄が空でもトリガーワードだけで結合できる", () => {
  const triggers = [
    { id: "1", sourceLoraIds: ["a"], text: "style_word", weight: 1, targetField: "style", enabled: true }
  ];
  assert.equal(buildFinalPrompt({}, triggers), "style_word");
});

test("Raw Promptへの追加は既に入っている語を重複させない", () => {
  const triggers = [
    { id: "1", sourceLoraIds: ["a"], text: "character_name", weight: 1.2, targetField: "character", enabled: true },
    { id: "2", sourceLoraIds: ["a"], text: "already", weight: 1, targetField: "character", enabled: true }
  ];
  assert.equal(
    appendTriggersToRawPrompt("1girl, already,", triggers),
    "1girl, already, (character_name:1.2)"
  );
  assert.deepEqual(
    pendingTriggerWords("1girl, already", triggers).map((item) => item.text),
    ["character_name"]
  );
  assert.equal(appendTriggersToRawPrompt("1girl, (character_name:1.2), already", triggers), "1girl, (character_name:1.2), already");
});

test("履歴から読み戻したトリガーワードを正規化する", () => {
  const restored = normalizeAppliedTriggerWords([
    { text: " character_name ", weight: "1.2", targetField: "character", sourceLoraId: "a" },
    { text: "character_name", weight: 1, targetField: "character", sourceLoraId: "b" },
    { text: "", weight: 1 },
    { text: "unknown_field", weight: 9, targetField: "nope", sourceLoraIds: ["c", "c"], enabled: false },
    "not an object"
  ]);
  assert.deepEqual(restored.map((item) => item.text), ["character_name", "unknown_field"]);
  assert.equal(restored[0].weight, 1.2);
  assert.deepEqual(restored[0].sourceLoraIds, ["a"]);
  assert.equal(restored[1].targetField, "extra");
  assert.equal(restored[1].weight, 2);
  assert.equal(restored[1].enabled, false);
  assert.deepEqual(restored[1].sourceLoraIds, ["c"]);
});
