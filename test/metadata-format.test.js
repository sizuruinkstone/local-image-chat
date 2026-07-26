import assert from "node:assert/strict";
import test from "node:test";
import { buildMetadataText, buildPromptText } from "../public/metadata-format.js";

const GENERATION = {
  id: "generation-1234",
  mode: "txt2img",
  description: "銀髪の女の子",
  prompt: "anime screencap, solo, 1girl, smile",
  negativePrompt: "worst quality, low quality, bad anatomy",
  effectivePrompt: "anime screencap, solo, 1girl, smile, <lora:Style/Flat:0.7>",
  effectiveNegativePrompt: "worst quality, low quality, bad anatomy",
  loras: [{ name: "Style/Flat", weight: 0.7 }],
  settings: {
    steps: 20,
    samplerName: "DPM++ 2M SDE",
    scheduler: "Karras",
    noiseSchedule: "Automatic",
    cfgScale: 5,
    seed: -1,
    width: 1120,
    height: 1440,
    checkpoint: "waiNSFWIllustrious_v90.safetensors",
    checkpointModelName: "waiNSFWIllustrious_v90",
    checkpointHash: "abc123",
    hiresEnabled: false
  }
};

const IMAGE = { id: "image-9999", seed: 2123974969, width: 1120, height: 1440, filename: "20260726_hires.png" };

test("Copy Promptは実際に生成へ送ったeffectivePromptを返す", () => {
  const text = buildPromptText(GENERATION);
  // LoRAタグ込みの実効プロンプト。UIの値ではなく生成に使った内容をコピーする。
  assert.equal(text, "anime screencap, solo, 1girl, smile, <lora:Style/Flat:0.7>");
  assert.equal(/worst quality/.test(text), false, "Negativeを含めない");
  assert.equal(/Steps|Seed|Sampler|CFG|Model/.test(text), false, "生成設定を含めない");
  // effectivePromptが無い古い履歴はpromptで代用する
  assert.equal(buildPromptText({ prompt: "1girl, smile" }), "1girl, smile");
  assert.equal(buildPromptText({}), "");
  assert.equal(buildPromptText(null), "");
});

test("Copy All MetadataはPNG Info形式で必要な設定を並べる", () => {
  const text = buildMetadataText(GENERATION, IMAGE);
  const [positive, negative, parameters] = text.split("\n\n");
  assert.equal(positive, "anime screencap, solo, 1girl, smile, <lora:Style/Flat:0.7>");
  assert.equal(negative, "Negative prompt: worst quality, low quality, bad anatomy");
  assert.match(parameters, /Steps: 20/);
  assert.match(parameters, /Sampler: DPM\+\+ 2M SDE/);
  assert.match(parameters, /Schedule type: Karras/);
  assert.match(parameters, /CFG scale: 5/);
  assert.match(parameters, /Seed: 2123974969/);
  assert.match(parameters, /Size: 1120x1440/);
  assert.match(parameters, /Model: waiNSFWIllustrious_v90/);
  assert.match(parameters, /Model hash: abc123/);
  assert.match(parameters, /LoRA: Style\/Flat:0\.7/);
  assert.equal(/Noise schedule/.test(parameters), false, "Automaticは出さない");
});

test("undefined・null・NaNをコピー内容へ含めない", () => {
  const text = buildMetadataText({
    prompt: "1girl",
    negativePrompt: null,
    loras: [],
    settings: {
      steps: undefined,
      samplerName: null,
      scheduler: "",
      cfgScale: Number("むり"),
      width: 512,
      height: null,
      checkpoint: "undefined",
      clipSkip: "NaN"
    }
  }, { seed: 42 });
  assert.equal(/undefined/i.test(text), false);
  assert.equal(/null/i.test(text), false);
  assert.equal(/NaN/i.test(text), false);
  assert.equal(/Negative prompt/.test(text), false, "空のNegativeは行ごと出さない");
  assert.equal(/Size/.test(text), false, "幅と高さが揃わなければ出さない");
  assert.match(text, /Seed: 42/);
});

test("内部ID・ファイル名・認証情報はコピーされない", () => {
  const text = buildMetadataText({
    ...GENERATION,
    settings: {
      ...GENERATION.settings,
      civitaiToken: "secret-token-value",
      githubToken: "github_pat_dummy",
      outputPath: "C:/local-image-chat/outputs/x.png"
    }
  }, IMAGE);
  assert.equal(text.includes("generation-1234"), false);
  assert.equal(text.includes("image-9999"), false);
  assert.equal(text.includes("20260726_hires.png"), false);
  assert.equal(text.includes("secret-token-value"), false);
  assert.equal(text.includes("github_pat_dummy"), false);
  assert.equal(text.includes("C:/local-image-chat"), false);
});

test("Hires仕上げとimg2imgでDenoising strengthを出し分ける", () => {
  const hires = buildMetadataText({
    ...GENERATION,
    settings: { ...GENERATION.settings, hiresEnabled: true, hiresScale: 1.5, hiresSteps: 12, hiresDenoising: 0.28, hiresUpscaler: "R-ESRGAN 4x+ Anime6B", img2imgDenoising: 0.45 }
  }, IMAGE);
  assert.match(hires, /Denoising strength: 0\.28/);
  assert.match(hires, /Hires upscale: 1\.5/);
  assert.match(hires, /Hires steps: 12/);
  assert.match(hires, /Hires upscaler: R-ESRGAN 4x\+ Anime6B/);

  const img2img = buildMetadataText({
    ...GENERATION,
    mode: "img2img",
    settings: { ...GENERATION.settings, img2imgDenoising: 0.45 }
  }, IMAGE);
  assert.match(img2img, /Denoising strength: 0\.45/);
  assert.equal(/Hires upscale/.test(img2img), false);
});
