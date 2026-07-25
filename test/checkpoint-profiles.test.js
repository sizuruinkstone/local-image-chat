import assert from "node:assert/strict";
import test from "node:test";
import {
  assessLoraCompatibility,
  inferCheckpointProfile,
  normalizeBaseModelFamily
} from "../public/checkpoint-profiles.js";

test("代表的なIllustrious Checkpointを個別プロフィールへ自動分類する", () => {
  assert.equal(inferCheckpointProfile({
    title: "waiNSFWIllustrious_v170.safetensors [abc123]"
  }).id, "wai-illustrious-v17");
  assert.equal(inferCheckpointProfile({
    filename: "C:\\Models\\Stable-diffusion\\oneObsession_v23.safetensors"
  }).id, "one-obsession-v23");
  assert.equal(inferCheckpointProfile({
    modelName: "novaAnimeXL_ilV19"
  }).id, "nova-anime-xl-v19");
});

test("Chosen-mix XL v4.1とRIN Flanimeを専用プロフィールへ自動分類する", () => {
  const chosen = inferCheckpointProfile({
    title: "chosen-mix_XLV4.1.safetensors [bc3d335767]"
  });
  assert.equal(chosen.id, "chosen-mix-xl-v41");
  assert.equal(chosen.family, "illustrious");
  assert.deepEqual(chosen.settings, {
    width: 896,
    height: 1152,
    steps: 32,
    cfgScale: 5,
    samplerName: "Euler",
    scheduler: "Automatic",
    noiseSchedule: "Automatic"
  });

  const rin = inferCheckpointProfile({
    filename: "C:\\Models\\Stable-diffusion\\RIN_Flanime_Illustrious_v1.0.safetensors"
  });
  assert.equal(rin.id, "rin-flanime-illustrious");
  assert.equal(rin.family, "illustrious");
  assert.deepEqual(rin.settings, {
    width: 896,
    height: 1152,
    steps: 30,
    cfgScale: 5,
    samplerName: "Euler a",
    scheduler: "Automatic",
    noiseSchedule: "Automatic"
  });
});

test("追加Checkpointをバージョン別プロフィールへ自動分類する", () => {
  const realSkin = inferCheckpointProfile({
    filename: "C:\\Models\\Stable-diffusion\\miaomiaoRealskin_epsV14.safetensors"
  });
  assert.equal(realSkin.id, "miaomiao-realskin-eps-v14");
  assert.equal(realSkin.family, "illustrious");
  assert.deepEqual(realSkin.settings, {
    width: 896,
    height: 1152,
    steps: 30,
    cfgScale: 5,
    samplerName: "Euler a",
    scheduler: "Exponential",
    noiseSchedule: "Automatic"
  });

  const noobai = inferCheckpointProfile({
    title: "noobai-xl-vpred-v1.0.safetensors [ea349eeae8]"
  });
  assert.equal(noobai.id, "noobai-vpred-v10");
  assert.equal(noobai.family, "noobai");
  assert.deepEqual(noobai.settings, {
    width: 832,
    height: 1216,
    steps: 30,
    cfgScale: 4.5,
    samplerName: "Euler",
    scheduler: "Automatic",
    noiseSchedule: "Zero Terminal SNR"
  });

  const obsession = inferCheckpointProfile({
    modelName: "Obsession_vPred-V2.0"
  });
  assert.equal(obsession.id, "obsession-vpred-v20");
  assert.equal(obsession.family, "noobai");
  assert.deepEqual(obsession.settings, {
    width: 768,
    height: 1280,
    steps: 30,
    cfgScale: 5,
    samplerName: "Euler a",
    scheduler: "SGM Uniform",
    noiseSchedule: "Zero Terminal SNR"
  });
});

test("V-Pred系プロフィールはnoiseScheduleがZero Terminal SNR、他はAutomatic", () => {
  assert.equal(inferCheckpointProfile({ title: "noobai-xl-vpred-v1.0.safetensors" }).settings.noiseSchedule, "Zero Terminal SNR");
  assert.equal(inferCheckpointProfile({ modelName: "Obsession_vPred-V2.0" }).settings.noiseSchedule, "Zero Terminal SNR");
  assert.equal(inferCheckpointProfile({ title: "waiNSFWIllustrious_v170.safetensors" }).settings.noiseSchedule, "Automatic");
  assert.equal(inferCheckpointProfile({ title: "my_custom_illustrious_mix.safetensors" }).settings.noiseSchedule, "Automatic");
});

test("個別登録がないIllustriousも汎用プロフィールへ分類する", () => {
  const profile = inferCheckpointProfile({
    title: "my_custom_illustrious_mix.safetensors"
  });
  assert.equal(profile.id, "generic-illustrious");
  assert.equal(profile.family, "illustrious");
});

test("Civitaiのベースモデル表記を互換性ファミリーへ正規化する", () => {
  assert.equal(normalizeBaseModelFamily("Illustrious"), "illustrious");
  assert.equal(normalizeBaseModelFamily("NoobAI-XL"), "noobai");
  assert.equal(normalizeBaseModelFamily("Pony"), "pony");
  assert.equal(normalizeBaseModelFamily("SD 1.5"), "sd15");
  assert.equal(normalizeBaseModelFamily("SDXL 1.0"), "sdxl");
});

test("同系統は対応、NoobAIは注意、Ponyは不一致として警告する", () => {
  const checkpoint = inferCheckpointProfile({ title: "WAI Illustrious v17" });
  assert.equal(assessLoraCompatibility(checkpoint, "Illustrious").level, "compatible");
  assert.equal(assessLoraCompatibility(checkpoint, "NoobAI-XL").level, "caution");
  assert.equal(assessLoraCompatibility(checkpoint, "Pony").level, "incompatible");
  assert.equal(assessLoraCompatibility(checkpoint, "").level, "unknown");
});
