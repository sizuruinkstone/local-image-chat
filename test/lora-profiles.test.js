import assert from "node:assert/strict";
import test from "node:test";
import {
  LORA_PROFILES,
  createRegistryProfile,
  findProfileForLora,
  splitCharacterTriggerWords
} from "../public/lora-profiles.js";
import { listLoraOutfitChoices } from "../public/lora-outfit-selection.js";

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

test("手動プリセット構造はキャラクター特徴と衣装を混ぜずにプロフィール化する", () => {
  const profile = createRegistryProfile({
    name: "Characters/structured",
    registry: {
      category: "character",
      characterTriggerWords: "character_a, red hair, blue eyes",
      triggerWords: "legacy_character, base coat",
      outfitPresets: [
        { id: "base", name: "ベース衣装", triggerWords: "base coat, black boots" },
        { id: "coat-remove", name: "Coat remove", triggerWords: "white shirt, bare arms" }
      ]
    }
  });
  assert.equal(profile.presets[0].id, "identity");
  assert.equal(profile.presets[0].triggerWords, "character_a, red hair, blue eyes");
  assert.equal(profile.presets[0].negativeWords, "", "衣装タグを自動でNegativeへ混入させない");
  assert.deepEqual(profile.presets.slice(1).map((preset) => preset.name), ["ベース衣装", "Coat remove"]);
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

test("手動配置したシャニマス複合LoRAを28キャラ＋2衣装プロフィールへ接続する", () => {
  const profile = findProfileForLora({
    name: "Style/shanimas.il",
    displayName: "shanimas.il"
  });

  assert.equal(profile?.id, "shanimas-illustrious-v2");
  assert.equal(profile?.category, "direction");
  assert.equal(profile?.presets.length, 29);
  assert.equal(profile?.addons.length, 3);
  assert.equal(profile?.presets.find((preset) => preset.id === "fuyuko")?.triggerWords,
    "shanimas, fuyuko, 1girl, solo");
  assert.equal(profile?.addons.find((addon) => addon.id === "cosaaa")?.triggerWords, "cosaaa");
});

test("エンドフィールドOperators Collection v3を31キャラのキャラクター選択へ接続する", () => {
  const profile = findProfileForLora({
    name: "Anima/Character/Game/anima-base-1-arknights-endfield-v31.safetensors",
    displayName: "anima-base-1-arknights-endfield-v31",
    registry: {
      modelId: 2425904,
      versionId: 3049218
    }
  });

  assert.equal(profile?.id, "arknights-endfield-operators-anima-v3");
  assert.equal(profile?.category, "character");
  assert.equal(profile?.presets.length, 32, "キャラ31件＋キャラ指定なし");
  assert.deepEqual(profile?.presets.slice(1).map((preset) => preset.triggerWords), [
    "female endministrator \\(arknights\\)",
    "male endministrator \\(arknights\\)",
    "perlica \\(arknights\\)",
    "chen qianyu \\(arknights\\)",
    "akekuri \\(arknights\\)",
    "alesh \\(arknights\\)",
    "antal \\(arknights\\)",
    "arclight \\(arknights\\)",
    "ardelia \\(arknights\\)",
    "avywenna \\(arknights\\)",
    "catcher \\(arknights\\)",
    "da pan \\(arknights\\)",
    "estella \\(arknights\\)",
    "fluorite \\(arknights\\)",
    "gilberta \\(arknights\\)",
    "laevatain \\(arknights\\)",
    "last rite \\(arknights\\)",
    "lifeng \\(arknights\\)",
    "snowshine \\(arknights\\)",
    "wulfgard \\(arknights\\)",
    "xaihi \\(arknights\\)",
    "yvonne \\(arknights\\)",
    "mi fu \\(arknights\\)",
    "rossi \\(arknights\\)",
    "tangtang \\(arknights\\)",
    "zhuang fangyi \\(arknights\\)",
    "arcane \\(arknights\\)",
    "camille \\(arknights\\)",
    "feranmut proxy \\(arknights\\)",
    "ardashir \\(arknights\\)",
    "nefarith \\(arknights\\)"
  ]);
  assert.equal(profile?.presets.some((preset) => /pogranichnik|ember/i.test(preset.triggerWords)), false);
  const compositionChoices = listLoraOutfitChoices(profile);
  assert.equal(compositionChoices.length, 31, "新UIのComposition欄にはキャラ31件を出す");
  assert.equal(compositionChoices.find((choice) => choice.name.includes("イヴォンヌ"))?.prompt,
    "yvonne \\(arknights\\)");
});

test("手動配置した周防パトラLoRAを2衣装プロフィールへ接続する", () => {
  const profile = findProfileForLora({
    name: "Characters/patra.il",
    displayName: "patra.il"
  });

  assert.equal(profile?.id, "suou-patra-illustrious");
  assert.equal(profile?.presets[0].triggerWords, "patra, 1girl, solo, alternate costume");
  assert.deepEqual(profile?.addons.map((addon) => addon.id), ["none", "apt", "bpt"]);
  assert.equal(profile?.addons[1].clearNegativeWords, true);
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

test("Civitaiで検出した複数衣装をすべて独立プリセットにする", () => {
  const profile = createRegistryProfile({
    name: "Characters/multi-outfit-character",
    registry: {
      modelId: 123,
      versionId: 456,
      modelName: "Multi Outfit Character",
      category: "character",
      triggerWords: "CharDefault, CharUniform, CharSwimsuit",
      outfitPresets: [
        { id: "default", name: "標準衣装", triggerWords: "CharDefault, black dress, heels" },
        { id: "uniform", name: "制服", triggerWords: "CharUniform, school uniform, loafers" },
        { id: "swimsuit", name: "水着", triggerWords: "CharSwimsuit, bikini, sandals" }
      ]
    }
  });

  assert.deepEqual(profile?.presets.map((preset) => preset.id), [
    "identity", "default", "uniform", "swimsuit"
  ]);
  assert.match(profile?.presets[0].negativeWords, /black dress/);
  assert.match(profile?.presets[0].negativeWords, /school uniform/);
  assert.match(profile?.presets[0].negativeWords, /bikini/);
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
