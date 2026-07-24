import assert from "node:assert/strict";
import test from "node:test";
import {
  LORA_COMPATIBILITY_FILTERS,
  compatibilityFilterAllows,
  getRecommendedWeight,
  hasLoraPreview,
  isCompatibilityFilter,
  resolveLoraPreviewUrl,
  shouldApplyRecommendedWeight
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

test("getRecommendedWeightは単一値をバッジ化する", () => {
  const r = getRecommendedWeight({ recommendedWeight: 0.8, recommendedWeightSource: "civitai-description" });
  assert.equal(r.weight, 0.8);
  assert.equal(r.badge, "推奨 0.80");
  assert.equal(r.min, null);
});

test("getRecommendedWeightは範囲をラベル化する", () => {
  const r = getRecommendedWeight({
    recommendedWeight: 0.85,
    recommendedWeightMin: 0.7,
    recommendedWeightMax: 1.0,
    recommendedWeightLabel: "0.70～1.00",
    recommendedWeightSource: "civitai-version-name"
  });
  assert.equal(r.badge, "推奨 0.70～1.00");
  assert.equal(r.min, 0.7);
  assert.equal(r.max, 1.0);
});

test("fallbackや旧エントリは推奨扱いしない（null）", () => {
  assert.equal(getRecommendedWeight({ recommendedWeight: 0.75, recommendedWeightSource: "fallback" }), null);
  assert.equal(getRecommendedWeight({ recommendedWeight: 0.7 }), null); // sourceなし旧エントリ
  assert.equal(getRecommendedWeight(null), null);
});

test("shouldApplyRecommendedWeight: 未設定は適用・保存済みは維持", () => {
  assert.equal(shouldApplyRecommendedWeight(false, 0.8), true);  // 未設定→初期適用
  assert.equal(shouldApplyRecommendedWeight(true, 0.8), false);  // ユーザー保存済み→上書きしない（再解析でも維持）
  assert.equal(shouldApplyRecommendedWeight(false, NaN), false); // 有効値なし→適用しない
});

test("isCompatibilityFilterは既知IDだけ真", () => {
  assert.equal(isCompatibilityFilter("hide-incompatible"), true);
  assert.equal(isCompatibilityFilter("bogus"), false);
  assert.deepEqual(
    LORA_COMPATIBILITY_FILTERS.map((item) => item.id),
    ["all", "compatible", "compatible-caution", "hide-incompatible", "has-preview"]
  );
});
