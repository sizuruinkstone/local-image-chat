import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_RETRY_COUNT,
  buildRecoveryPlan,
  buildRetryInfo,
  classifyGenerationError,
  describeRecoveryPlan
} from "../src/recovery.js";

const HEAVY = {
  width: 1024, height: 1536, steps: 25, cfgScale: 6, candidateCount: 4,
  hiresEnabled: true, hiresScale: 1.8, hiresSteps: 20, hiresDenoising: 0.4
};

test("CUDA out of memoryをVRAM不足として検出する", () => {
  for (const message of [
    "ReForge HTTP 500: torch.cuda.OutOfMemoryError: CUDA out of memory",
    "HIP out of memory. Tried to allocate 2.00 GiB",
    "VRAMが足りません"
  ]) {
    const classification = classifyGenerationError(new Error(message));
    assert.equal(classification.kind, "oom", message);
    assert.equal(classification.retryable, true);
  }
});

test("タイムアウト・接続断・HTTP 500を再試行対象にする", () => {
  assert.equal(classifyGenerationError({ name: "TimeoutError", message: "x" }).kind, "timeout");
  assert.equal(classifyGenerationError(new Error("ReForgeの画像生成がタイムアウトしました")).kind, "timeout");
  assert.equal(classifyGenerationError(new Error("fetch failed")).kind, "network");
  assert.equal(classifyGenerationError(new Error("ReForge HTTP 500: internal")).kind, "server");
  assert.equal(classifyGenerationError(new Error("ReForge HTTP 500: hires pass failed")).kind, "hires");
});

test("中止と未知のエラーは再試行しない", () => {
  assert.equal(classifyGenerationError({ name: "AbortError", message: "" }).retryable, false);
  assert.equal(classifyGenerationError(new Error("ユーザーが生成を中止しました")).retryable, false);
  assert.equal(classifyGenerationError(new Error("プロンプトが不正です")).retryable, false);
});

test("OOM時は候補枚数・Hires倍率・Hires Stepsを下げる", () => {
  const plan = buildRecoveryPlan(HEAVY, "oom");
  assert.deepEqual(plan.settings.candidateCount, 1);
  assert.equal(plan.settings.hiresScale, 1.6);
  assert.equal(plan.settings.hiresSteps, 12);
  const labels = plan.changes.map((change) => `${change.label}: ${change.from} → ${change.to}`);
  assert.deepEqual(labels, [
    "候補枚数: 4 → 1",
    "Hires倍率: 1.8 → 1.6",
    "Hires Steps: 20 → 12"
  ]);
  assert.equal(HEAVY.hiresScale, 1.8, "元の設定は変更しない");
});

test("これ以上Hiresを下げられない場合はHiresを無効化する", () => {
  const plan = buildRecoveryPlan(
    { ...HEAVY, candidateCount: 1, hiresScale: 1.1, hiresSteps: 12 },
    "oom"
  );
  assert.equal(plan.settings.hiresEnabled, false);
});

test("Hiresを使っていない場合は解像度を64単位で縮小する", () => {
  const plan = buildRecoveryPlan(
    { width: 1024, height: 1536, candidateCount: 1, hiresEnabled: false },
    "oom"
  );
  assert.equal(plan.settings.width, 960);
  assert.equal(plan.settings.height, 1472);
});

test("下げる余地がなければ再試行しない", () => {
  assert.equal(buildRecoveryPlan({ width: 512, height: 512, candidateCount: 1, hiresEnabled: false }, "oom"), null);
  assert.equal(buildRecoveryPlan(HEAVY, "unknown"), null);
});

test("タイムアウトは同じ設定のまま再試行する", () => {
  const plan = buildRecoveryPlan(HEAVY, "timeout");
  assert.deepEqual(plan.changes, []);
  assert.equal(plan.settings.hiresScale, 1.8);
});

test("再試行は1回までで無限ループしない", () => {
  assert.equal(MAX_RETRY_COUNT, 1);
  const classification = classifyGenerationError(new Error("CUDA out of memory"));
  const plan = buildRecoveryPlan(HEAVY, classification.kind);
  const info = buildRetryInfo({
    originalSettings: HEAVY,
    retrySettings: plan.settings,
    classification,
    previousCount: 0
  });
  assert.equal(info.retryCount, 1);
  assert.equal(info.retryReason, "oom");
  assert.equal(info.originalSettings.hiresScale, 1.8);
  assert.equal(info.retrySettings.hiresScale, 1.6);
  // 2回目は上限に達しているので呼び出し側が打ち切る
  assert.ok(info.retryCount >= MAX_RETRY_COUNT);
});

test("UIへ渡す提案は文字列化した変更点を持つ", () => {
  const classification = classifyGenerationError(new Error("CUDA out of memory"));
  const description = describeRecoveryPlan(classification, buildRecoveryPlan(HEAVY, "oom"));
  assert.equal(description.kind, "oom");
  assert.equal(description.label, "VRAM不足");
  assert.deepEqual(description.changes[1], {
    key: "hiresScale", label: "Hires倍率", from: "1.8", to: "1.6"
  });
});
