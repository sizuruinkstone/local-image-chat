import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCheckpoint, normalizeLora } from "../src/reforge.js";

test("ReForgeのCheckpoint情報をUI向けに正規化する", () => {
  assert.deepEqual(normalizeCheckpoint({
    title: "waiNSFWIllustrious_v170.safetensors [abc123]",
    model_name: "waiNSFWIllustrious_v170",
    filename: "C:\\AI\\models\\Stable-diffusion\\waiNSFWIllustrious_v170.safetensors",
    hash: "abc123"
  }), {
    title: "waiNSFWIllustrious_v170.safetensors [abc123]",
    modelName: "waiNSFWIllustrious_v170",
    filename: "C:\\AI\\models\\Stable-diffusion\\waiNSFWIllustrious_v170.safetensors",
    hash: "abc123",
    sha256: ""
  });
});

test("WindowsのCharacterフォルダをキャラクター分類する", () => {
  const result = normalizeLora({
    name: "Aizawa_Ema_IL_2.0",
    alias: "Aizawa Ema",
    path: "C:\\AI\\models\\Lora\\Characters\\Aizawa_Ema_IL_2.0.safetensors"
  });

  assert.equal(result.folder, "Characters");
  assert.equal(result.category, "character");
  assert.equal(result.displayName, "Aizawa Ema");
});

test("ReForgeの相対名に含まれるサブフォルダを優先する", () => {
  const result = normalizeLora({
    name: "キャラ\\Roxy\\roxy_v2",
    alias: "none",
    path: "C:\\AI\\models\\Lora\\キャラ\\Roxy\\roxy_v2.safetensors"
  });

  assert.equal(result.folder, "キャラ/Roxy");
  assert.equal(result.category, "character");
  assert.equal(result.displayName, "roxy_v2");
});

test("画風フォルダは方向性LoRAとして分類する", () => {
  const result = normalizeLora({
    name: "Style/Modern_anime_render",
    alias: "",
    path: "C:\\AI\\models\\Lora\\Style\\Modern_anime_render.safetensors"
  });

  assert.equal(result.folder, "Style");
  assert.equal(result.category, "direction");
  assert.equal(result.displayName, "Modern_anime_render");
});

test("ルート直下のLoRAは未分類の方向性LoRAにする", () => {
  const result = normalizeLora({
    name: "anime_shiny_skin",
    alias: "Anime Shiny Skin",
    path: "C:\\AI\\models\\Lora\\anime_shiny_skin.safetensors"
  });

  assert.equal(result.folder, "");
  assert.equal(result.category, "direction");
});
