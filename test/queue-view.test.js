import assert from "node:assert/strict";
import test from "node:test";
import { formatComparisonProgress, queueStatusLabel, summarizeQueue } from "../public/queue-view.js";

function generationJob(overrides = {}) {
  return {
    id: "job-1",
    type: "generation",
    label: "新規生成・候補4枚",
    status: "running",
    progress: 58,
    message: "生成中",
    queuePosition: null,
    errorMessage: null,
    ...overrides
  };
}

function comparisonJob(overrides = {}) {
  return {
    id: "experiment-1",
    type: "comparison",
    name: "Model比較",
    subject: "CFG 4 / 5 / 6",
    status: "running",
    completedCases: 4,
    totalCases: 12,
    completedImages: 4,
    totalImages: 12,
    failedCases: 0,
    progress: 33,
    ...overrides
  };
}

test("実行中が1件なら状態と進捗率を出す", () => {
  const summary = summarizeQueue({ generation: [generationJob()], comparison: [] });
  assert.equal(summary.visible, true);
  assert.equal(summary.tone, "busy");
  assert.equal(summary.text, "生成中 58%");
  assert.equal(summary.activeCount, 1);
});

test("進捗率が取得できないときは偽のパーセントを出さない", () => {
  const queued = summarizeQueue({ generation: [generationJob({ status: "queued", progress: null })] });
  assert.equal(queued.text, "待機中");
  const running = summarizeQueue({ generation: [generationJob({ progress: null })] });
  assert.equal(running.text, "生成中");
  const saving = summarizeQueue({ generation: [generationJob({ status: "saving", progress: 99 })] });
  assert.equal(saving.text, "保存中", "保存中は進捗率を付けない");
});

test("通常生成と比較実験が混在すると件数をまとめる", () => {
  const summary = summarizeQueue({ generation: [generationJob()], comparison: [comparisonJob()] });
  assert.equal(summary.text, "処理中 2件");
  assert.equal(summary.activeCount, 2);
});

test("比較実験だけが動いているときは比較の進捗を出す", () => {
  const summary = summarizeQueue({ generation: [], comparison: [comparisonJob()] });
  assert.equal(summary.text, "比較実験 生成中 条件 4/12 33%");
});

test("完了・失敗を一時的に表示し、何も無ければ非表示にする", () => {
  assert.equal(summarizeQueue({ generation: [], comparison: [] }).visible, false);
  assert.equal(summarizeQueue({}).visible, false);
  const done = summarizeQueue({ generation: [generationJob({ status: "done", progress: 100 })] });
  assert.deepEqual([done.visible, done.tone, done.text], [true, "done", "生成完了"]);
  const failed = summarizeQueue({ generation: [generationJob({ status: "failed", progress: null })] });
  assert.deepEqual([failed.visible, failed.tone, failed.text], [true, "error", "生成に失敗しました"]);
  const finished = summarizeQueue({
    comparison: [comparisonJob({ status: "completed", completedCases: 12, progress: null })]
  });
  assert.equal(finished.text, "比較実験が完了しました");
});

test("一部失敗した比較実験は完了数と失敗数を分けて示す", () => {
  const entry = comparisonJob({ status: "completed", completedCases: 11, failedCases: 1, progress: null });
  assert.equal(formatComparisonProgress(entry), "条件 11/12・1件失敗");
  assert.equal(summarizeQueue({ comparison: [entry] }).text, "比較実験 条件 11/12・1件失敗");
});

test("1パターンで複数枚生成する場合は画像枚数も出す", () => {
  assert.equal(
    formatComparisonProgress({ completedCases: 4, totalCases: 12, completedImages: 14, totalImages: 48 }),
    "条件 4/12・画像 14/48"
  );
  assert.equal(
    formatComparisonProgress({ completedCases: 4, totalCases: 12, completedImages: 4, totalImages: 12 }),
    "条件 4/12",
    "同数なら重複表示しない"
  );
});

test("状態ラベルは日本語へ変換する", () => {
  assert.equal(queueStatusLabel("queued"), "待機中");
  assert.equal(queueStatusLabel("saving"), "保存中");
  assert.equal(queueStatusLabel("cancelled"), "中止");
  assert.equal(queueStatusLabel("unknown-state"), "unknown-state");
});
