import assert from "node:assert/strict";
import test from "node:test";
import { findProfileForLora } from "../public/lora-profiles.js";

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
