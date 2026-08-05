import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultLoraOutfitChoice,
  listLoraOutfitChoices,
  outfitStateSourceId,
  parseOutfitStateSourceId,
  resolveLoraBaseTriggerWords,
  resolveLoraOutfitPrompt
} from "../public/lora-outfit-selection.js";

const characterProfile = {
  defaultPreset: "identity",
  presets: [
    { id: "identity", name: "衣装自由", triggerWords: "alice, 1girl, solo" },
    { id: "default", name: "デフォルト衣装", triggerWords: "alice, 1girl, solo, blue dress, black boots" },
    { id: "swim", name: "水着", triggerWords: "alice, 1girl, solo, red swimsuit" }
  ]
};

test("キャラクター共通タグを除き、設定済み衣装候補だけを生成画面用に返す", () => {
  const choices = listLoraOutfitChoices(characterProfile);
  assert.deepEqual(choices.map((choice) => choice.name), ["デフォルト衣装", "水着"]);
  assert.equal(choices[0].prompt, "blue dress, black boots");
  assert.equal(resolveLoraBaseTriggerWords(characterProfile, "default"), "alice, 1girl, solo");
});

test("衣装変更は選択IDから新しいプロンプトだけを解決し、指定なしは空になる", () => {
  assert.equal(resolveLoraOutfitPrompt(characterProfile, "preset:default"), "blue dress, black boots");
  assert.equal(resolveLoraOutfitPrompt(characterProfile, "preset:swim"), "red swimsuit");
  assert.equal(resolveLoraOutfitPrompt(characterProfile, ""), "");
});

test("生成画面では既定衣装を自動選択せず、明示選択まで指定なしにする", () => {
  assert.equal(defaultLoraOutfitChoice(characterProfile, "swim"), "");
  assert.equal(defaultLoraOutfitChoice(characterProfile, "identity"), "");
});

test("複合LoRAはキャラクタープリセットを維持し、addon衣装だけを候補にする", () => {
  const profile = {
    category: "direction",
    defaultPreset: "char-a",
    defaultAddon: "casual",
    presets: [{ id: "char-a", name: "キャラA", triggerWords: "character_a, 1girl" }],
    addons: [
      { id: "casual", name: "私服", triggerWords: "hoodie, jeans" },
      { id: "battle", name: "戦闘衣装", triggerWords: "armor, cape" }
    ]
  };
  assert.deepEqual(listLoraOutfitChoices(profile).map((choice) => choice.name), ["私服", "戦闘衣装"]);
  assert.equal(resolveLoraBaseTriggerWords(profile, "char-a"), "character_a, 1girl");
  assert.equal(defaultLoraOutfitChoice(profile, "char-a", "battle"), "");
});

test("日本語や記号を含むLoRA名と衣装IDを履歴用の由来IDから安全に復元する", () => {
  const sourceId = outfitStateSourceId("衣装 LoRA #1", "preset:水着 100%");
  assert.deepEqual(parseOutfitStateSourceId(sourceId), {
    loraName: "衣装 LoRA #1",
    choiceId: "preset:水着 100%"
  });
  assert.equal(parseOutfitStateSourceId("other"), null);
});
