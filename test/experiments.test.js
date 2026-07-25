import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyExperimentValue,
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
