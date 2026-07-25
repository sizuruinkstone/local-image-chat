import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCheckpointSetService, normalizeSetInput, sameCheckpoint } from "../src/checkpoint-sets.js";

const BASE = {
  name: "NoobAI 基本セット",
  checkpoint: "noobaiXLVpred_v10.safetensors",
  loras: [{ name: "Style/Flat", weight: 0.7, triggerWords: "flat" }],
  settings: {
    samplerName: "Euler a", scheduler: "Automatic", noiseSchedule: "Zero Terminal SNR",
    steps: 28, cfgScale: 5.5, width: 896, height: 1152,
    hiresScale: 1.5, hiresSteps: 20, hiresDenoising: 0.4, hiresUpscaler: "R-ESRGAN 4x+ Anime6B"
  },
  prompt: "1girl",
  negativePrompt: "low quality"
};

async function setup(t) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "lic-sets-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  return createCheckpointSetService(dataDir);
}

test("現在の設定をセットとして保存し読み込める", async (t) => {
  const service = await setup(t);
  const set = await service.create(BASE);
  assert.match(set.id, /^[0-9a-f-]{36}$/);
  assert.equal(set.name, "NoobAI 基本セット");
  assert.equal(set.settings.noiseSchedule, "Zero Terminal SNR");
  assert.equal(set.loras[0].weight, 0.7);

  const list = await service.list();
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].settings, set.settings);
});

test("自動適用はCheckpointごとに1つだけ有効になる", async (t) => {
  const service = await setup(t);
  const first = await service.create({ ...BASE, name: "A", autoApply: true });
  const second = await service.create({ ...BASE, name: "B", autoApply: true });
  const sets = await service.list();
  assert.equal(sets.find((item) => item.id === first.id).autoApply, false);
  assert.equal(sets.find((item) => item.id === second.id).autoApply, true);
  assert.equal((await service.findAutoApply("noobaiXLVpred_v10.safetensors")).name, "B");
  assert.equal(await service.findAutoApply("other.safetensors"), null);
});

test("名前変更・複製・削除ができる", async (t) => {
  const service = await setup(t);
  const set = await service.create(BASE);
  const renamed = await service.patch(set.id, { name: "改名後" });
  assert.equal(renamed.name, "改名後");
  assert.equal(renamed.loras.length, 1, "指定しない項目は保持される");

  const copy = await service.duplicate(set.id);
  assert.equal(copy.name, "改名後 のコピー");
  assert.equal(copy.autoApply, false);
  assert.equal((await service.list()).length, 2);

  await service.remove(set.id);
  assert.equal((await service.list()).length, 1);
  await assert.rejects(() => service.remove(set.id), /見つかりません/);
});

test("不正な入力を弾き、値を範囲内へ丸める", () => {
  assert.throws(() => normalizeSetInput({ checkpoint: "a" }), /セット名/);
  assert.throws(() => normalizeSetInput({ name: "a" }), /Checkpoint/);
  const normalized = normalizeSetInput({
    ...BASE,
    settings: { steps: 999, cfgScale: -5, width: 99999, hiresScale: 9 },
    loras: Array.from({ length: 20 }, (_, index) => ({ name: `L${index}`, weight: 99 }))
  });
  assert.equal(normalized.settings.steps, 80);
  assert.equal(normalized.settings.cfgScale, 1);
  assert.equal(normalized.settings.width, 1536);
  assert.equal(normalized.settings.hiresScale, 2);
  assert.equal(normalized.loras.length, 8, "LoRAは8個までに制限する");
  assert.equal(normalized.loras[0].weight, 2);
});

test("Checkpoint名はハッシュ・拡張子・パスを無視して比較する", () => {
  assert.equal(sameCheckpoint("noobai_v10.safetensors", "C:\\Models\\noobai_v10.safetensors [abc1234]"), true);
  assert.equal(sameCheckpoint("noobai_v10", "other"), false);
  assert.equal(sameCheckpoint("", ""), false);
});

test("既存のCheckpointプロフィール・LoRAプロフィールとは別ファイルへ保存する", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "lic-sets-file-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const service = createCheckpointSetService(dataDir);
  await service.create(BASE);
  const files = await fs.readdir(dataDir);
  assert.deepEqual(files, ["checkpoint-lora-sets.json"]);
  const stored = JSON.parse(await fs.readFile(path.join(dataDir, "checkpoint-lora-sets.json"), "utf8"));
  assert.equal(stored.schemaVersion, 1);
  assert.equal(stored.sets.length, 1);
});
