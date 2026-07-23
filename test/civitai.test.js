import assert from "node:assert/strict";
import test from "node:test";
import { parseCivitaiUrl, resolveLoraInstallRoot } from "../src/civitai.js";

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
