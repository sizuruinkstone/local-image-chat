import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyExperimentValue,
  isActiveExperiment,
  createExperimentService,
  validateExperimentValues
} from "../src/experiments.js";
import { createJobManager } from "../src/job-manager.js";

const BASE_REQUEST = {
  mode: "txt2img",
  description: "テスト",
  prompt: "1girl",
  negativePrompt: "low quality",
  loras: [
    { name: "Style/FlatPainting", weight: 0.7, triggerWords: "flat", negativeWords: "" },
    { name: "Char/Ema", weight: 0.85, triggerWords: "ema", negativeWords: "" }
  ],
  settings: { width: 896, height: 1152, steps: 25, cfgScale: 6, seed: -1, candidateCount: 4 }
};

test("weight 0.5/0.6/0.7/0.8を対象LoRAだけへ適用する", () => {
  const values = validateExperimentValues("loraWeight", "0.5, 0.6, 0.7, 0.8");
  assert.deepEqual(values, [0.5, 0.6, 0.7, 0.8]);

  const request = applyExperimentValue(BASE_REQUEST, {
    parameter: "loraWeight",
    target: "Style/FlatPainting",
    value: 0.6,
    fixedSeed: 1753486420
  });
  assert.equal(request.loras[0].weight, 0.6);
  assert.equal(request.loras[1].weight, 0.85, "他のLoRAは変えない");
  assert.equal(request.settings.seed, 1753486420, "Seedを固定する");
  assert.equal(request.settings.candidateCount, 1, "比較は1枚ずつ");
  assert.equal(BASE_REQUEST.loras[0].weight, 0.7, "元のリクエストは変更しない");
});

test("対象LoRAが選択されていなければエラーにする", () => {
  assert.throws(() => applyExperimentValue(BASE_REQUEST, {
    parameter: "loraWeight", target: "Missing/Lora", value: 0.5
  }), /対象のLoRA/);
});

test("パラメータごとに正しい設定へ反映する", () => {
  assert.equal(applyExperimentValue(BASE_REQUEST, { parameter: "cfgScale", value: 8 }).settings.cfgScale, 8);
  assert.equal(applyExperimentValue(BASE_REQUEST, { parameter: "steps", value: 30 }).settings.steps, 30);
  assert.equal(applyExperimentValue(BASE_REQUEST, { parameter: "seed", value: 42 }).settings.seed, 42);
  assert.equal(
    applyExperimentValue(BASE_REQUEST, { parameter: "samplerName", value: "DPM++ 2M" }).settings.samplerName,
    "DPM++ 2M"
  );
  assert.equal(
    applyExperimentValue({ ...BASE_REQUEST, mode: "img2img" }, { parameter: "denoising", value: 0.35 })
      .settings.img2imgDenoising,
    0.35
  );
  assert.equal(
    applyExperimentValue({ ...BASE_REQUEST, mode: "inpaint" }, { parameter: "denoising", value: 0.6 })
      .settings.inpaintDenoising,
    0.6
  );
});

test("最大枚数・重複・範囲外を弾く", () => {
  assert.throws(() => validateExperimentValues("loraWeight", "0.5"), /2つ以上/);
  assert.deepEqual(validateExperimentValues("loraWeight", "0.5, 0.5, 0.6"), [0.5, 0.6]);
  assert.throws(
    () => validateExperimentValues("cfgScale", "1,2,3,4,5,6,7,8,9", { maxImages: 8 }),
    /最大8枚/
  );
  assert.throws(() => validateExperimentValues("cfgScale", "1, 99"), /1〜20/);
  assert.deepEqual(validateExperimentValues("cfgScale", "1,2,3,4,5,6,7,8,9,10,11,12", { maxImages: 12 }).length, 12);
});

test("比較生成が実験としてまとまり、順番にジョブへ積まれる", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "lic-exp-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const executed = [];
  const jobs = createJobManager(async (payload) => {
    executed.push(payload);
    return { ok: true };
  });
  const service = createExperimentService(dataDir, { jobs, maxImages: 8 });

  const experiment = await service.create({
    baseRequest: BASE_REQUEST,
    parameter: "loraWeight",
    target: "Style/FlatPainting",
    values: [0.5, 0.6, 0.7, 0.8],
    fixedSeed: 1753486420
  });
  assert.equal(experiment.total, 4);
  assert.equal(experiment.name, "Style/FlatPainting LoRA weight test");
  assert.equal(experiment.fixedSeed, 1753486420);

  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(executed.length, 4, "4枚が直列で実行される");
  assert.deepEqual(executed.map((item) => item.loras[0].weight), [0.5, 0.6, 0.7, 0.8]);
  assert.deepEqual(executed.map((item) => item.experiment.value), [0.5, 0.6, 0.7, 0.8]);
  assert.ok(executed.every((item) => item.settings.seed === 1753486420));

  await service.recordRun(experiment.id, 0.5, { generationId: "gen-1", imageIds: ["img-1"] });
  const fetched = await service.get(experiment.id);
  assert.equal(fetched.runs[0].generationId, "gen-1");
  assert.deepEqual(fetched.runs[0].imageIds, ["img-1"]);
});

test("キャンセルしても完了済みの結果は残る", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "lic-exp-cancel-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  let release = () => {};
  const jobs = createJobManager(async () => {
    await new Promise((resolve) => { release = resolve; });
    return { ok: true };
  });
  const service = createExperimentService(dataDir, { jobs });
  const experiment = await service.create({
    baseRequest: BASE_REQUEST,
    parameter: "cfgScale",
    values: [5, 6, 7]
  });
  await service.recordRun(experiment.id, 5, { generationId: "gen-a", imageIds: ["img-a"] });

  const cancelled = await service.cancel(experiment.id);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.runs[0].generationId, "gen-a", "完了済みの記録は残る");
  assert.equal(cancelled.runs[0].status, "done");
  release();
});

test("実験名の変更・最良画像の記録・削除ができる", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "lic-exp-crud-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const jobs = createJobManager(async () => ({ ok: true }));
  const service = createExperimentService(dataDir, { jobs });
  const experiment = await service.create({
    baseRequest: BASE_REQUEST, parameter: "steps", values: [20, 30]
  });

  const renamed = await service.patch(experiment.id, { name: "Steps比較", bestImageId: "img-x" });
  assert.equal(renamed.name, "Steps比較");
  assert.equal(renamed.bestImageId, "img-x");
  assert.equal((await service.list()).length, 1);

  await service.remove(experiment.id);
  assert.equal((await service.list()).length, 0);
  await assert.rejects(() => service.get(experiment.id), /見つかりません/);
});

// ---- v2.12.1: run状態の永続化まわりの回帰テスト ----

// JobManagerの保持期間切れ・サーバー再起動を再現するため、ジョブを「見えなく」できるようにする。
function createForgettableJobs(execute) {
  const inner = createJobManager(execute);
  let forgotten = false;
  return {
    create: (payload) => inner.create(payload),
    get: (id) => {
      if (forgotten) throw new Error("生成ジョブが見つかりません");
      return inner.get(id);
    },
    list: () => inner.list(),
    cancel: (id) => inner.cancel(id),
    subscribe: (listener) => inner.subscribe(listener),
    forget: () => { forgotten = true; }
  };
}

// 中止されるまで終わらない生成。中止シグナルは必ず尊重する。
function blockingExecute(executed) {
  return (payload, { signal }) => new Promise((_resolve, reject) => {
    executed.push(payload);
    if (signal.aborted) return reject(signal.reason ?? new Error("中止しました"));
    signal.addEventListener("abort", () => reject(signal.reason ?? new Error("中止しました")), { once: true });
  });
}

async function waitUntil(check, message) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(message);
}

function readStore(dataDir) {
  return fs.readFile(path.join(dataDir, "experiments.json"), "utf8").then(JSON.parse);
}

test("失敗したrunはfailedとして永続化され、ジョブが消えても戻らない", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "lic-exp-failed-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const jobs = createForgettableJobs(async (payload) => {
    if (payload?.experiment?.value === 6) throw new Error("CUDA out of memory");
    return { ok: true };
  });
  const service = createExperimentService(dataDir, { jobs });
  const experiment = await service.create({
    baseRequest: BASE_REQUEST, parameter: "cfgScale", values: [5, 6, 7]
  });

  const settled = await waitUntil(
    async () => {
      const current = await service.get(experiment.id);
      return current.status !== "running" ? current : null;
    },
    "実験が終わらない"
  );
  assert.equal(settled.runs[1].status, "failed");
  assert.match(settled.runs[1].error, /CUDA out of memory/);

  const stored = await readStore(dataDir);
  assert.equal(stored.experiments[0].runs[1].status, "failed", "experiments.jsonへ保存される");
  assert.match(stored.experiments[0].runs[1].error, /CUDA out of memory/);

  // JobManagerから対象ジョブが消えても、失敗は失敗のまま。
  jobs.forget();
  const afterCleanup = await service.get(experiment.id);
  assert.equal(afterCleanup.runs[1].status, "failed");
  assert.match(afterCleanup.runs[1].error, /CUDA out of memory/);
  assert.equal(afterCleanup.runs[0].status, "done");
  assert.equal(afterCleanup.runs[2].status, "done");
  assert.notEqual(afterCleanup.status, "running", "時間が経っても実験がrunningへ戻らない");
});

test("中断したrunはcancelledとして永続化され、完了済みrunは残る", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "lic-exp-cancelled-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const executed = [];
  const jobs = createForgettableJobs(blockingExecute(executed));
  const service = createExperimentService(dataDir, { jobs });
  const experiment = await service.create({
    baseRequest: BASE_REQUEST, parameter: "cfgScale", values: [5, 6, 7]
  });
  await service.recordRunCompleted(experiment.id, 5, { generationId: "gen-a", imageIds: ["img-a"] });

  const cancelled = await service.cancel(experiment.id);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.runs[0].status, "done");
  assert.equal(cancelled.runs[1].status, "cancelled");
  assert.equal(cancelled.runs[2].status, "cancelled");

  const stored = await readStore(dataDir);
  assert.deepEqual(
    stored.experiments[0].runs.map((run) => run.status),
    ["done", "cancelled", "cancelled"],
    "experiments.jsonへ保存される"
  );

  jobs.forget();
  const afterCleanup = await service.get(experiment.id);
  assert.deepEqual(afterCleanup.runs.map((run) => run.status), ["done", "cancelled", "cancelled"]);
  assert.equal(afterCleanup.runs[0].generationId, "gen-a");
  assert.equal(afterCleanup.status, "cancelled");
});

test("実行中の実験を削除すると関連ジョブが停止する", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "lic-exp-remove-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const executed = [];
  const jobs = createForgettableJobs(blockingExecute(executed));
  const service = createExperimentService(dataDir, { jobs });
  const experiment = await service.create({
    baseRequest: BASE_REQUEST, parameter: "cfgScale", values: [5, 6, 7]
  });
  await waitUntil(() => executed.length >= 1, "1枚目が始まらない");

  await service.remove(experiment.id);
  assert.ok(
    jobs.list().every((job) => ["done", "failed", "cancelled"].includes(job.status)),
    "関連ジョブが全件終端状態になる"
  );

  const startedBefore = executed.length;
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(executed.length, startedBefore, "削除後に新しい生成が始まらない");
  await assert.rejects(() => service.get(experiment.id), /見つかりません/);
  assert.equal((await service.list()).length, 0);
});

test("未完了の実験があるうちは2本目を開始できない", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "lic-exp-single-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const executed = [];
  const jobs = createForgettableJobs(blockingExecute(executed));
  const service = createExperimentService(dataDir, { jobs });
  const first = await service.create({
    baseRequest: BASE_REQUEST, parameter: "cfgScale", values: [5, 6]
  });

  await assert.rejects(
    () => service.create({ baseRequest: BASE_REQUEST, parameter: "steps", values: [20, 30] }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.match(error.message, /別の比較実験が実行中です/);
      return true;
    }
  );
  assert.equal(jobs.list().length, 2, "拒否した実験のジョブは作られない");
  assert.equal((await service.list()).length, 1);

  // 1本目を中断すれば2本目を開始できる。
  await service.cancel(first.id);
  const second = await service.create({
    baseRequest: BASE_REQUEST, parameter: "steps", values: [20, 30]
  });
  assert.equal(second.total, 2);
  assert.equal((await service.list()).length, 2);
  await service.cancel(second.id);
});

test("実験データを保存できなければ作成済みジョブを全てキャンセルする", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "lic-exp-orphan-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  // 読み込みは成功し、書き込み（一時ファイル作成）だけが失敗する状態を作る。
  await fs.writeFile(
    path.join(dataDir, "experiments.json"),
    JSON.stringify({ schemaVersion: 1, experiments: [], comparisons: [] })
  );
  await fs.mkdir(path.join(dataDir, `experiments.json.${process.pid}.tmp`));

  const executed = [];
  const jobs = createForgettableJobs(blockingExecute(executed));
  const service = createExperimentService(dataDir, { jobs });

  await assert.rejects(() => service.create({
    baseRequest: BASE_REQUEST, parameter: "cfgScale", values: [5, 6, 7]
  }), /EISDIR|illegal operation/i);

  await waitUntil(
    () => jobs.list().length === 3 && jobs.list().every((job) => job.status === "cancelled"),
    "孤児ジョブが残っている"
  );
  const startedBefore = executed.length;
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(executed.length, startedBefore, "保存失敗後に生成が続かない");
  assert.equal((await service.list()).length, 0, "実験データが残らない");
});

test("サーバー再起動でジョブが消えた実験は中断として正規化される", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "lic-exp-restart-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const experimentId = "restart-experiment-0001";
  // v2.12.0が書いた形（recovered/retryInfoなどが無い）をそのまま読み込ませる。
  await fs.writeFile(path.join(dataDir, "experiments.json"), JSON.stringify({
    schemaVersion: 1,
    experiments: [{
      id: experimentId,
      name: "再起動テスト",
      type: "parameter",
      parameter: "cfgScale",
      target: "",
      values: [5, 6],
      fixedSeed: null,
      baseSeed: -1,
      createdAt: "2026-07-25T00:00:00.000Z",
      status: "running",
      bestImageId: null,
      note: "",
      runs: [
        { value: 5, index: 1, jobId: "lost-job-a", generationId: "gen-a", imageIds: ["img-a"], status: "done", error: null },
        { value: 6, index: 2, jobId: "lost-job-b", generationId: null, imageIds: [], status: "queued", error: null }
      ]
    }],
    comparisons: []
  }));

  // 再起動直後のJobManagerには該当ジョブが存在しない。
  const jobs = createJobManager(async () => ({ ok: true }));
  const service = createExperimentService(dataDir, { jobs });

  const experiment = await service.get(experimentId);
  assert.notEqual(experiment.status, "running", "永遠にrunningにならない");
  assert.equal(experiment.status, "cancelled");
  assert.equal(experiment.runs[0].status, "done", "完了済みrunは残る");
  assert.equal(experiment.runs[0].generationId, "gen-a");
  assert.equal(experiment.runs[1].status, "cancelled");
  assert.match(experiment.runs[1].error, /サーバー再起動またはジョブ消失/);

  const stored = await readStore(dataDir);
  assert.equal(stored.experiments[0].status, "cancelled", "正規化結果が永続化される");
  assert.equal(stored.experiments[0].runs[1].status, "cancelled");
  assert.equal((await service.list())[0].status, "cancelled");
  assert.equal(await service.findActive(), null, "中断済みなので新しい実験を開始できる");
});

test("自動リカバリされたrunはrecoveredとして記録される", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "lic-exp-recovered-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const jobs = createJobManager(async () => ({ ok: true }));
  const service = createExperimentService(dataDir, { jobs });
  const experiment = await service.create({
    baseRequest: BASE_REQUEST, parameter: "cfgScale", values: [5, 6]
  });

  await service.recordRunCompleted(experiment.id, 6, {
    generationId: "gen-b",
    imageIds: ["img-b"],
    retryInfo: {
      retryReason: "oom",
      retryReasonLabel: "VRAM不足",
      retryCount: 1,
      originalSettings: { width: 896, candidateCount: 4 },
      retrySettings: { width: 832, candidateCount: 1 }
    }
  });
  const fetched = await service.get(experiment.id);
  assert.equal(fetched.runs[1].recovered, true);
  assert.equal(fetched.runs[1].retryInfo.retryReasonLabel, "VRAM不足");
  assert.equal(fetched.runs[0].recovered, false, "通常のrunはfalseのまま");
});

test("A/B比較の投票を保存する", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "lic-exp-vote-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const service = createExperimentService(dataDir, { jobs: createJobManager(async () => ({})) });
  const comparison = await service.addComparison({
    imageIds: ["img-a", "img-b"],
    winnerImageId: "img-b",
    result: "b",
    parameter: "loraWeight"
  });
  assert.equal(comparison.winnerImageId, "img-b");
  assert.equal(comparison.result, "b");
  const stored = await service.listComparisons({});
  assert.equal(stored.length, 1);
  assert.equal(stored[0].parameter, "loraWeight");
});

test("terminal runs supersede a stale running aggregate without releasing a live experiment", () => {
  assert.equal(isActiveExperiment({status:"running",runs:[{status:"done"},{status:"failed"}]}),false);
  assert.equal(isActiveExperiment({status:"done",runs:[{status:"running"}]}),true);
  assert.equal(isActiveExperiment({status:"running",runs:[]}),true);
});
