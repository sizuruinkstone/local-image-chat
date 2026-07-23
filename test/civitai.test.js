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

test("全部入りTrigger Wordsを衣装ごとのプリセットとして保持する", () => {
  assert.deepEqual(deriveCivitaiOutfitPresets([
    "mari_\\(blue_archive\\), blue eyes, orange hair, nun, white dress",
    "mari_\\(idol\\)_\\(blue_archive\\), blue eyes, orange hair, top hat, frilled dress"
  ], `
    <h3>Default:</h3><p>Trigger Words:</p><pre><code>mari_\\(blue_archive\\),</code></pre>
    <h3>Idol:</h3><p>Trigger Words:</p><pre><code>mari_\\(idol\\)_\\(blue_archive\\),</code></pre>
  `), [
    {
      id: "civitai-outfit-mari-blue-archive",
      name: "Default",
      triggerWords: "mari_\\(blue_archive\\), blue eyes, orange hair, nun, white dress"
    },
    {
      id: "civitai-outfit-mari-idol-blue-archive",
      name: "Idol",
      triggerWords: "mari_\\(idol\\)_\\(blue_archive\\), blue eyes, orange hair, top hat, frilled dress"
    }
  ]);
});

test("同じキャラトリガーの複数外見を別プリセットとして残す", () => {
  const presets = deriveCivitaiOutfitPresets([
    "dfblth, dark blue hair, blue eyes, black armor",
    "dfblth, light green hair, green eyes, black armor"
  ]);
  assert.equal(presets.length, 2);
  assert.equal(presets[0].id, "civitai-outfit-dfblth");
  assert.equal(presets[1].id, "civitai-outfit-dfblth-2");
  assert.equal(presets[1].name, "dfblth (2)");
  assert.match(presets[1].triggerWords, /light green hair/);
});

test("APIのtrainedWordsにない説明文の追加衣装を補完する", () => {
  const presets = deriveCivitaiOutfitPresets([
    "AkariUniform, twintails, white sailor shirt, plaid skirt"
  ], `
    <h3>School uniform:</h3>
    <p>Trigger Words:</p><pre><code>AkariUniform,</code></pre>
    <p>Hair:</p><pre><code>twintails, hair ribbon,</code></pre>
    <p>Clothing:</p><pre><code>white sailor shirt, plaid skirt,</code></pre>
    <h3>Military uniform:</h3>
    <p>Trigger Words:</p><pre><code>AkariMilitary,</code></pre>
    <p>Hair:</p><pre><code>long hair, single earring,</code></pre>
    <p>or</p><pre><code>short hair, single earring,</code></pre>
    <p>Clothing:</p><pre><code>off-shoulder shirt, side capelet, layered skirt,</code></pre>
  `);

  assert.equal(presets.length, 2);
  assert.deepEqual(presets[1], {
    id: "civitai-outfit-akarimilitary",
    name: "Military uniform",
    triggerWords: "AkariMilitary, long hair, single earring, off-shoulder shirt, side capelet, layered skirt"
  });
});
