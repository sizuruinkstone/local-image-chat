import assert from "node:assert/strict";
import test from "node:test";
import {
  LORA_PROFILES,
  createRegistryProfile,
  findProfileForLora,
  splitCharacterTriggerWords
} from "../public/lora-profiles.js";

test("Civitai経由のLoRAをファイル名に依存せずmodelIdから衣装プロフィールへ接続する", () => {
  const profile = findProfileForLora({
    name: "Characters/downloaded-name-that-changed",
    displayName: "downloaded-name-that-changed",
    registry: {
      modelId: 1327407,
      versionId: 2439947
    }
  });

  assert.equal(profile?.id, "aizawa-ema-il-v2");
  assert.ok(profile.presets.length > 2);
  assert.equal(profile.defaultPreset, "identity");
});

test("同じCivitaiモデルの別バージョンもmodelIdで既知プロフィールへ接続する", () => {
  const profile = findProfileForLora({
    name: "Characters/new-version",
    registry: {
      modelId: 2478293,
      versionId: 9999999
    }
  });

  assert.equal(profile?.id, "last-rite-illustrious");
});

test("未登録のCivitaiキャラもTrigger Wordsから衣装プリセットを自動作成する", () => {
  const profile = createRegistryProfile({
    name: "Characters/new-character",
    displayName: "new-character",
    registry: {
      modelId: 999,
      versionId: 1001,
      modelName: "New Character",
      baseModel: "Illustrious",
      category: "character",
      triggerWords: "new_character, default outfit, blue jacket",
      recommendedWeight: 0.8,
      sourceUrl: "https://civitai.com/models/999?modelVersionId=1001"
    }
  });

  assert.equal(profile?.id, "civitai-999-1001");
  assert.equal(profile?.defaultPreset, "identity");
  assert.equal(profile?.presets[0].name, "衣装自由（服タグなし）");
  assert.equal(profile?.presets[0].triggerWords, "new_character, 1girl, solo, alternate costume");
  assert.equal(profile?.presets[0].negativeWords, "default outfit, blue jacket");
  assert.equal(profile?.presets[1].name, "Civitai登録衣装");
  assert.equal(profile?.presets[1].triggerWords, "new_character, default outfit, blue jacket");
});

test("画風LoRAには衣装プリセットを自動作成しない", () => {
  assert.equal(createRegistryProfile({
    registry: {
      category: "direction",
      triggerWords: "new_style"
    }
  }), null);
});

test("衣装タグをキャラ特徴から分離する", () => {
  assert.deepEqual(
    splitCharacterTriggerWords("heroine_x, 1girl, blue eyes, long hair, school uniform, red skirt, black boots"),
    {
      identityWords: "heroine_x, 1girl, blue eyes, long hair, solo, alternate costume",
      outfitWords: "school uniform, red skirt, black boots"
    }
  );
});

test("登録済みキャラには必ず衣装自由プリセットがある", () => {
  for (const profile of LORA_PROFILES) {
    const identity = profile.presets.find((preset) => preset.id === "identity");
    assert.ok(identity, `${profile.name}にidentityがありません`);
    assert.equal(profile.defaultPreset, "identity");
    assert.match(identity.triggerWords, /alternate costume/i);
  }
});
