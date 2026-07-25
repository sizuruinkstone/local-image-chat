import assert from "node:assert/strict";
import test from "node:test";
import {
  AMBIGUOUS_ROOT_MESSAGE,
  detectLoraRootFromPath,
  isForbiddenRootName,
  resolveLoraRoot
} from "../src/lora-root.js";

test("config指定があれば必ずそれをLoRAルートにする", () => {
  const result = resolveLoraRoot({
    installDir: "C:\\StableDiffusion\\ReForge\\models\\Lora",
    reforgeLoraDir: "D:\\other\\Lora",
    rawLoras: [{ name: "Anime/foo", path: "E:\\somewhere\\models\\Lora\\Anime\\foo.safetensors" }]
  });
  assert.equal(result.root, "C:\\StableDiffusion\\ReForge\\models\\Lora");
  assert.equal(result.source, "config");
  assert.equal(result.label, "設定済み");
});

test("models/LoraをLoRAルートとして検出する", () => {
  assert.equal(
    detectLoraRootFromPath("C:\\AI\\Data\\Models\\Lora\\Anime\\foo.safetensors"),
    "C:\\AI\\Data\\Models\\Lora"
  );
  assert.equal(
    detectLoraRootFromPath("/home/user/stable-diffusion/models/Loras/style/bar.safetensors"),
    "/home/user/stable-diffusion/models/Loras"
  );
  assert.equal(
    detectLoraRootFromPath("C:\\AI\\models\\LyCORIS\\foo.safetensors"),
    "C:\\AI\\models\\LyCORIS"
  );
});

test("name階層が浅くてもAnimeをルートと誤認しない", () => {
  // ReForgeがname="foo"（サブフォルダなし）で返す壊れたケース
  const result = resolveLoraRoot({
    rawLoras: [{ name: "foo", path: "C:\\AI\\models\\Lora\\Anime\\foo.safetensors" }]
  });
  assert.equal(result.root, "C:\\AI\\models\\Lora");
  assert.equal(result.source, "detected");
  assert.equal(result.label, "自動検出");
});

test("Charactersをルートと誤認しない", () => {
  const result = resolveLoraRoot({
    rawLoras: [
      { name: "example", path: "C:\\AI\\models\\Lora\\Characters\\example.safetensors" },
      { name: "other", path: "C:\\AI\\models\\Lora\\Characters\\Blue Archive\\other.safetensors" }
    ]
  });
  assert.equal(result.root, "C:\\AI\\models\\Lora");
});

test("整理用サブフォルダ名はルート候補として拒否する", () => {
  for (const name of ["Anime", "Character", "Characters", "Style", "Styles", "Body", "Pose", "Illustrious", "NoobAI", "SDXL", "Pony"]) {
    assert.equal(isForbiddenRootName(name), true, `${name} は拒否されるべき`);
  }
  assert.equal(isForbiddenRootName("Lora"), false);
});

test("既知ディレクトリが無ければ特定不可として停止させる", () => {
  const result = resolveLoraRoot({
    rawLoras: [{ name: "foo", path: "C:\\AI\\weird\\place\\foo.safetensors" }]
  });
  assert.equal(result.root, "");
  assert.equal(result.source, "");
  assert.equal(result.warning, AMBIGUOUS_ROOT_MESSAGE);
});

test("ReForge設定APIのlora_dirを2番目の優先度で使う", () => {
  const result = resolveLoraRoot({
    installDir: "",
    reforgeLoraDir: "C:\\ReForge\\models\\Lora",
    rawLoras: [{ name: "foo", path: "D:\\elsewhere\\models\\Lora\\foo.safetensors" }]
  });
  assert.equal(result.root, "C:\\ReForge\\models\\Lora");
  assert.equal(result.source, "reforge");
});

test("ReForge設定APIが分類フォルダを返しても採用しない", () => {
  const result = resolveLoraRoot({
    reforgeLoraDir: "C:\\ReForge\\models\\Lora\\Anime",
    rawLoras: [{ name: "foo", path: "C:\\ReForge\\models\\Lora\\Anime\\foo.safetensors" }]
  });
  assert.equal(result.root, "C:\\ReForge\\models\\Lora");
  assert.equal(result.source, "detected");
});

test("多数派のLoRAルートを採用し外れ値のパスに引きずられない", () => {
  const result = resolveLoraRoot({
    rawLoras: [
      { name: "a", path: "C:\\main\\models\\Lora\\a.safetensors" },
      { name: "b", path: "C:\\main\\models\\Lora\\Anime\\b.safetensors" },
      { name: "c", path: "D:\\backup\\models\\Lora\\c.safetensors" }
    ]
  });
  assert.equal(result.root, "C:\\main\\models\\Lora");
});
