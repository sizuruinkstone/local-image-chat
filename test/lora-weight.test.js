import assert from "node:assert/strict";
import test from "node:test";
import {
  clampWeight,
  parseRecommendedWeight,
  stripHtml
} from "../src/lora-weight.js";

test("Weight: 0.8 の単一値を抽出する", () => {
  const r = parseRecommendedWeight("Weight: 0.8 for best results");
  assert.equal(r.recommendedWeight, 0.8);
  assert.equal(r.recommendedWeightLabel, null);
  assert.equal(r.recommendedWeightSource, "civitai-description");
});

test("Weight 0.7-1.0 の範囲を抽出する", () => {
  const r = parseRecommendedWeight("Recommended Weight 0.7-1.0");
  assert.equal(r.recommendedWeightMin, 0.7);
  assert.equal(r.recommendedWeightMax, 1.0);
  assert.equal(r.recommendedWeightLabel, "0.70～1.00");
});

test("全角チルダ 0.7 ～ 1.0 の範囲を抽出する", () => {
  const r = parseRecommendedWeight("strength 0.7 ～ 1.0");
  assert.equal(r.recommendedWeightMin, 0.7);
  assert.equal(r.recommendedWeightMax, 1.0);
});

test("0.7 to 1.0 の範囲を抽出する", () => {
  const r = parseRecommendedWeight("weight 0.7 to 1.0");
  assert.equal(r.recommendedWeightMin, 0.7);
  assert.equal(r.recommendedWeightMax, 1.0);
});

test("推奨強度 0.6〜0.8 を範囲として抽出する", () => {
  const r = parseRecommendedWeight("推奨強度 0.6〜0.8 くらい");
  assert.equal(r.recommendedWeightMin, 0.6);
  assert.equal(r.recommendedWeightMax, 0.8);
});

test("建议权重 0.7-1.0（中国語）を範囲として抽出する", () => {
  const r = parseRecommendedWeight("建议权重 0.7-1.0");
  assert.equal(r.recommendedWeightMin, 0.7);
  assert.equal(r.recommendedWeightMax, 1.0);
});

test("範囲の代表値は中央値になる", () => {
  assert.equal(parseRecommendedWeight("weight 0.7-1.0").recommendedWeight, 0.85);
  assert.equal(parseRecommendedWeight("weight 0.6-0.8").recommendedWeight, 0.7);
});

test("推奨付き単一値は範囲より優先される", () => {
  const r = parseRecommendedWeight("Recommended weight: 0.9. Others use weight 0.3-0.5.");
  assert.equal(r.recommendedWeight, 0.9);
  assert.equal(r.recommendedWeightLabel, null);
});

test("値は0.05〜1.5へクランプし小数第2位に丸める", () => {
  assert.equal(clampWeight(3.0), 1.5);
  assert.equal(clampWeight(0.01), 0.05);
  assert.equal(clampWeight(0.756), 0.76);
  assert.equal(parseRecommendedWeight("strength 3.0").recommendedWeight, 1.5);
});

test("強度：0.75 のような全角コロンでも抽出する", () => {
  const r = parseRecommendedWeight("強度：0.75");
  assert.equal(r.recommendedWeight, 0.75);
  assert.equal(r.recommendedWeightSource, "civitai-description");
});

test("説明文になければバージョン名から抽出する", () => {
  const r = parseRecommendedWeight("no hint here", "MyLora weight 0.65");
  assert.equal(r.recommendedWeight, 0.65);
  assert.equal(r.recommendedWeightSource, "civitai-version-name");
});

test("HTMLタグを除去してから解析する", () => {
  assert.equal(stripHtml("<p>Weight: <b>0.8</b></p>"), "Weight: 0.8");
  assert.equal(parseRecommendedWeight("<p>Weight: <b>0.8</b></p>").recommendedWeight, 0.8);
});

test("推奨表記がなければfallback 0.75 を source=fallback で返す", () => {
  const r = parseRecommendedWeight("A beautiful anime style lora with lots of detail.");
  assert.equal(r.recommendedWeight, 0.75);
  assert.equal(r.recommendedWeightSource, "fallback");
  assert.equal(r.recommendedWeightLabel, null);
});
