import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCivitaiService } from "../src/civitai.js";
import { collectLoraFileSet, moveLoraFileSet, suggestAlternateFilename } from "../src/lora-files.js";

const METADATA = {
  modelId: 1, versionId: 2, modelName: "Flat Painting", versionName: "v1.1", modelType: "LORA",
  baseModel: "Illustrious", sourceUrl: "https://civitai.com/models/1?modelVersionId=2",
  trainedWords: [], outfitPresets: [], recommendedWeight: 0.75, recommendedWeightMin: null,
  recommendedWeightMax: null, recommendedWeightLabel: null, recommendedWeightSource: "fallback",
  previewUrl: "", file: { name: "FlatPainting.safetensors", sizeKB: 1, downloadUrl: "https://download/models/2" }
};

async function setup(t, { loras = [], entries = [] } = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "lic-dup-data-"));
  const loraRoot = await fs.mkdtemp(path.join(os.tmpdir(), "lic-dup-root-"));
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
    return Promise.all([
      fs.rm(dataDir, { recursive: true, force: true }),
      fs.rm(loraRoot, { recursive: true, force: true })
    ]);
  });
  await fs.writeFile(path.join(dataDir, "lora-registry.json"), JSON.stringify({ schemaVersion: 1, entries }));
  global.fetch = async (url) => {
    const target = String(url);
    if (target.includes("/sdapi/v1/loras")) {
      return new Response(JSON.stringify(loras), { headers: { "content-type": "application/json" } });
    }
    if (target.includes("download")) return new Response("fake-lora-bytes");
    return new Response("not found", { status: 404 });
  };
  const service = createCivitaiService({
    dataDir,
    loraConfig: { installDir: loraRoot },
    reforgeConfig: { url: "http://reforge.test" },
    inspectCivitai: async () => METADATA
  });
  return { service, dataDir, loraRoot };
}

test("同一modelId/versionIdの登録を検出する", async (t) => {
  const { service } = await setup(t, {
    entries: [{
      id: "1:2", modelId: 1, versionId: 2, modelName: "Flat Painting", versionName: "v1.0",
      relativeName: "Anime/Style/FlatPainting", filename: "FlatPainting.safetensors"
    }]
  });
  const result = await service.checkDuplicate({ url: METADATA.sourceUrl, category: "style", folder: "Anime/Style" });
  assert.equal(result.duplicate, true);
  assert.equal(result.registeredVersion.versionName, "v1.0");
  assert.equal(result.metadata.versionName, "v1.1");
});

test("別フォルダの同名ファイルを検出し、勝手に移動しない", async (t) => {
  const { service, loraRoot } = await setup(t, {
    loras: [{ name: "Anime/Style/FlatPainting" }]
  });
  await fs.mkdir(path.join(loraRoot, "Anime", "Style"), { recursive: true });
  await fs.writeFile(path.join(loraRoot, "Anime", "Style", "FlatPainting.safetensors"), "x");

  const result = await service.checkDuplicate({ url: METADATA.sourceUrl, category: "style", folder: "Illustrious/Style" });
  assert.equal(result.duplicate, true);
  assert.deepEqual(result.installedElsewhere.map((item) => item.folder), ["Anime/Style"]);
  assert.ok(result.movableSource);

  const installed = await service.install({
    url: METADATA.sourceUrl, category: "style", folder: "Illustrious/Style", mode: "reuse"
  });
  assert.equal(installed.reusedExisting, true);
  assert.equal(installed.existingInOtherFolder, "Anime/Style");
  // 元ファイルはそのまま
  await fs.access(path.join(loraRoot, "Anime", "Style", "FlatPainting.safetensors"));
  assert.equal(await exists(path.join(loraRoot, "Illustrious", "Style", "FlatPainting.safetensors")), false);
});

test("保存先に同名ファイルがあれば重複として報告する", async (t) => {
  const { service, loraRoot } = await setup(t);
  await fs.mkdir(path.join(loraRoot, "Anime", "Style"), { recursive: true });
  await fs.writeFile(path.join(loraRoot, "Anime", "Style", "FlatPainting.safetensors"), "x");
  const result = await service.checkDuplicate({ url: METADATA.sourceUrl, category: "style", folder: "Anime/Style" });
  assert.equal(result.targetExists, true);
  assert.equal(result.duplicate, true);
});

test("別名で保存すると新しいファイル名でダウンロードする", async (t) => {
  const { service, loraRoot } = await setup(t);
  await fs.mkdir(path.join(loraRoot, "Anime", "Style"), { recursive: true });
  await fs.writeFile(path.join(loraRoot, "Anime", "Style", "FlatPainting.safetensors"), "x");
  const result = await service.install({
    url: METADATA.sourceUrl, category: "style", folder: "Anime/Style",
    mode: "rename", filename: "FlatPainting-v1.1.safetensors"
  });
  assert.equal(result.reusedExisting, false);
  assert.equal(result.entry.relativeName, "Anime/Style/FlatPainting-v1.1");
  await fs.access(path.join(loraRoot, "Anime", "Style", "FlatPainting-v1.1.safetensors"));
});

test("確認なしの移動は拒否し、確認付きなら関連ファイルごと移動する", async (t) => {
  const sourceRelative = path.join("Anime", "Style");
  const { service, loraRoot } = await setup(t, {
    loras: [{
      name: "Anime/Style/FlatPainting",
      path: path.join("PLACEHOLDER")
    }]
  });
  await fs.mkdir(path.join(loraRoot, sourceRelative), { recursive: true });
  await fs.writeFile(path.join(loraRoot, sourceRelative, "FlatPainting.safetensors"), "x");
  await fs.writeFile(path.join(loraRoot, sourceRelative, "FlatPainting.preview.png"), "p");
  await fs.writeFile(path.join(loraRoot, sourceRelative, "FlatPainting.json"), "{}");

  await assert.rejects(() => service.install({
    url: METADATA.sourceUrl, category: "style", folder: "Illustrious/Style", mode: "move"
  }), /確認が必要/);

  const moved = await service.install({
    url: METADATA.sourceUrl, category: "style", folder: "Illustrious/Style", mode: "move", confirmMove: true
  });
  assert.equal(moved.movedFiles.length, 3);
  await fs.access(path.join(loraRoot, "Illustrious", "Style", "FlatPainting.safetensors"));
  await fs.access(path.join(loraRoot, "Illustrious", "Style", "FlatPainting.preview.png"));
  assert.equal(await exists(path.join(loraRoot, sourceRelative, "FlatPainting.safetensors")), false);
});

test("メタデータだけ更新モードはファイルをダウンロードしない", async (t) => {
  const { service, loraRoot } = await setup(t, {
    entries: [{
      id: "1:2", modelId: 1, versionId: 2, modelName: "旧名", versionName: "v1.0",
      relativeName: "Anime/Style/FlatPainting", filename: "FlatPainting.safetensors"
    }]
  });
  const result = await service.install({
    url: METADATA.sourceUrl, category: "style", folder: "Anime/Style", mode: "metadata"
  });
  assert.equal(result.reusedExisting, true);
  assert.equal(result.entry.modelName, "Flat Painting");
  assert.equal(await exists(path.join(loraRoot, "Anime", "Style", "FlatPainting.safetensors")), false);
});

test("代替ファイル名はバージョン名を優先し、衝突を避ける", () => {
  assert.equal(
    suggestAlternateFilename("FlatPainting.safetensors", { versionName: "v1.1", taken: [] }),
    "FlatPainting-v1.1.safetensors"
  );
  assert.equal(
    suggestAlternateFilename("FlatPainting.safetensors", { versionName: "v1.1", taken: ["FlatPainting-v1.1.safetensors"] }),
    "FlatPainting-2.safetensors"
  );
  assert.equal(
    suggestAlternateFilename("FlatPainting.safetensors", { taken: ["FlatPainting-2.safetensors"] }),
    "FlatPainting-3.safetensors"
  );
});

test("移動先に同名ファイルがあれば移動せず失敗する", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lic-move-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "from"), { recursive: true });
  await fs.mkdir(path.join(root, "to"), { recursive: true });
  await fs.writeFile(path.join(root, "from", "A.safetensors"), "a");
  await fs.writeFile(path.join(root, "to", "A.safetensors"), "b");

  await assert.rejects(() => moveLoraFileSet({
    sourceDir: path.join(root, "from"),
    baseName: "A.safetensors",
    destinationDir: path.join(root, "to")
  }), /同名ファイル/);
  await fs.access(path.join(root, "from", "A.safetensors"));

  const files = await collectLoraFileSet(path.join(root, "from"), "A");
  assert.deepEqual(files.map((file) => file.suffix), [".safetensors"]);
});

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
