import assert from "node:assert/strict";
import test from "node:test";
import {
  LORA_COMPATIBILITY_FILTERS,
  compatibilityFilterAllows,
  hasLoraPreview,
  isCompatibilityFilter,
  resolveLoraPreviewUrl
} from "../public/lora-preview.js";

test("registry.previewUrlをプレビュー画像として保持する", () => {
  const lora = { name: "a", registry: { previewUrl: "https://img.example/a.png" } };
  assert.equal(resolveLoraPreviewUrl(lora), "https://img.example/a.png");
  assert.equal(hasLoraPreview(lora), true);
});

test("previewUrlがないLoRAでも壊れず空文字を返す", () => {
  assert.equal(resolveLoraPreviewUrl({ name: "a" }), "");
  assert.equal(resolveLoraPreviewUrl({ name: "a", registry: {} }), "");
  assert.equal(resolveLoraPreviewUrl(null), "");
  assert.equal(hasLoraPreview({ name: "a" }), false);
});

test("空白だけのpreviewUrlは無効として扱う", () => {
  assert.equal(resolveLoraPreviewUrl({ registry: { previewUrl: "   " } }), "");
});

test("将来のローカル画像・キャッシュがregistry.previewUrlより優先される", () => {
  const lora = {
    localPreviewUrl: "/loras/a.preview.png",
    registry: { cachedPreviewUrl: "/cache/a.png", previewUrl: "https://img.example/a.png" }
  };
  assert.equal(resolveLoraPreviewUrl(lora), "/loras/a.preview.png");
  assert.equal(resolveLoraPreviewUrl({ registry: { cachedPreviewUrl: "/cache/a.png", previewUrl: "https://img/a" } }), "/cache/a.png");
});

test("互換性フィルターが対応・近縁・非対応・不明を正しく分類する", () => {
  const cases = [
    ["all", "incompatible", false, true],
    ["compatible", "compatible", true, true],
    ["compatible", "caution", true, false],
    ["compatible", "unknown", true, false],
    ["compatible-caution", "caution", false, true],
    ["compatible-caution", "incompatible", true, false],
    ["hide-incompatible", "unknown", false, true],
    ["hide-incompatible", "incompatible", true, false],
    ["has-preview", "incompatible", true, true],
    ["has-preview", "compatible", false, false]
  ];
  for (const [filter, level, hasPreview, expected] of cases) {
    assert.equal(
      compatibilityFilterAllows(filter, { level, hasPreview }),
      expected,
      `${filter} / ${level} / preview=${hasPreview}`
    );
  }
});

test("未知のフィルター値はすべて通す（allと同等）", () => {
  assert.equal(compatibilityFilterAllows("bogus", { level: "incompatible", hasPreview: false }), true);
  assert.equal(compatibilityFilterAllows(undefined, { level: "incompatible" }), true);
});

test("isCompatibilityFilterは既知IDだけ真", () => {
  assert.equal(isCompatibilityFilter("hide-incompatible"), true);
  assert.equal(isCompatibilityFilter("bogus"), false);
  assert.deepEqual(
    LORA_COMPATIBILITY_FILTERS.map((item) => item.id),
    ["all", "compatible", "compatible-caution", "hide-incompatible", "has-preview"]
  );
});
