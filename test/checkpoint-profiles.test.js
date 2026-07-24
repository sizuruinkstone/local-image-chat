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
