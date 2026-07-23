import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveCivitaiOutfitPresets,
  parseCivitaiUrl,
  resolveLoraInstallRoot
} from "../src/civitai.js";

test("CivitaiモデルURLからモデルIDとバージョンIDを取得する", () => {
  assert.deepEqual(
    parseCivitaiUrl("https://civitai.com/models/1327407/example?modelVersionId=2439947"),
    { modelId: 1327407, versionId: 2439947 }
  );
  assert.throws(() => parseCivitaiUrl("https://example.com/models/1"), /civitai\.com/);
});

test("ReForgeの既存LoRAパスからWindowsのLoRAルートを推定する", () => {
  const root = resolveLoraInstallRoot("", [{
    name: "Characters/example",
    path: "C:\\AI\\Models\\Lora\\Characters\\example.safetensors"
  }]);
  assert.equal(root, "C:\\AI\\Models\\Lora");
});

test("Civitai説明文の専用トリガーを衣装ごとのプリセットへ分ける", () => {
  assert.deepEqual(deriveCivitaiOutfitPresets(
    ["EmaDefault", "EmaMilitary", "EmaRoomwear"],
    `
      <p>EmaDefault: long hair, black dress, black heels</p>
      <p>EmaMilitary: hairband, military uniform, white coat, boots</p>
      <p>EmaRoomwear: twin braids, striped hoodie, black shorts, slippers</p>
    `
  ), [
    {
      id: "civitai-outfit-emadefault",
      name: "Ema Default",
      triggerWords: "EmaDefault, long hair, black dress, black heels"
    },
    {
      id: "civitai-outfit-emamilitary",
      name: "Ema Military",
      triggerWords: "EmaMilitary, hairband, military uniform, white coat, boots"
    },
    {
      id: "civitai-outfit-emaroomwear",
      name: "Ema Roomwear",
      triggerWords: "EmaRoomwear, twin braids, striped hoodie, black shorts, slippers"
    }
  ]);
});

test("一般的な服タグを別々の衣装プリセットと誤判定しない", () => {
  assert.deepEqual(
    deriveCivitaiOutfitPresets(["march7th", "choker", "jacket", "skirt"], ""),
    [{
      id: "civitai-outfit-march7th",
      name: "march7th",
      triggerWords: "march7th"
    }]
  );
});
