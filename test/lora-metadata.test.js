import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCivitaiService } from "../src/civitai.js";
import { applyManualEdit, mergeRegistryEntry, normalizeEditableFields } from "../src/lora-registry.js";
import { migrateDataFiles } from "../src/migrations.js";

async function setup(t, entries = []) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "lic-meta-data-"));
  const loraRoot = await fs.mkdtemp(path.join(os.tmpdir(), "lic-meta-root-"));
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
    return Promise.all([
      fs.rm(dataDir, { recursive: true, force: true }),
      fs.rm(loraRoot, { recursive: true, force: true })
    ]);
  });
  await fs.writeFile(path.join(dataDir, "lora-registry.json"), JSON.stringify({ schemaVersion: 2, entries }));
  global.fetch = async (url) => {
    if (String(url).includes("/sdapi/v1/loras")) {
      return new Response("[]", { headers: { "content-type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  };
  const service = createCivitaiService({
    dataDir,
    loraConfig: { installDir: loraRoot },
    reforgeConfig: { url: "http://reforge.test" },
    inspectCivitai: async () => ({})
  });
  return { service, dataDir, loraRoot };
}

test("Trigger Words・weight・分類を編集して保存する", async (t) => {
  const { service } = await setup(t);
  const entry = await service.ensureEntry({ relativeName: "Anime/Style/FlatPainting" });
  assert.match(entry.uid, /^[0-9a-f-]{36}$/);

  const updated = await service.updateEntry(entry.uid, {
    displayName: "フラット画風",
    subcategory: "style",
    triggerWords: " flat painting ,, soft shading ",
    recommendedWeight: 0.85,
    recommendedWeightMin: 0.9,
    recommendedWeightMax: 0.6,
    checkpointFamilies: "Illustrious, NoobAI",
    favorite: true,
    note: "背景に強い"
  });
  assert.equal(updated.displayName, "フラット画風");
  assert.equal(updated.triggerWords, "flat painting, soft shading");
  assert.equal(updated.recommendedWeight, 0.85);
  // 最小 > 最大 は入れ替えて整える
  assert.equal(updated.recommendedWeightMin, 0.6);
  assert.equal(updated.recommendedWeightMax, 0.9);
  assert.deepEqual(updated.checkpointFamilies, ["illustrious", "noobai"]);
  assert.equal(updated.favorite, true);
  // 旧形式のcategoryも同時更新される
  assert.equal(updated.category, "direction");
  assert.equal(updated.subcategory, "style");
});

test("手動編集がCivitai再解析で消えない", async (t) => {
  const { service, dataDir } = await setup(t, [{
    id: "100:101",
    uid: "11111111-1111-4111-8111-111111111111",
    modelId: 100,
    versionId: 101,
    modelName: "元の名前",
    sourceUrl: "https://civitai.com/models/100?modelVersionId=101",
    relativeName: "Anime/Style/Example",
    filename: "Example.safetensors",
    triggerWords: "oldTrigger",
    manualFields: []
  }]);
  await service.updateEntry("11111111-1111-4111-8111-111111111111", {
    triggerWords: "myTrigger",
    recommendedWeight: 0.42
  });

  const refreshed = createCivitaiService({
    dataDir,
    loraConfig: {},
    reforgeConfig: {},
    inspectCivitai: async (url) => ({
      modelId: 100, versionId: 101, modelName: "新しい名前", versionName: "v2", baseModel: "Illustrious",
      sourceUrl: url, trainedWords: ["civitaiTrigger"], outfitPresets: [],
      recommendedWeight: 0.9, recommendedWeightMin: null, recommendedWeightMax: null,
      recommendedWeightLabel: null, recommendedWeightSource: "description", previewUrl: ""
    })
  });
  const result = await refreshed.refreshRegistrations("");
  assert.equal(result.updated, 1);

  const stored = JSON.parse(await fs.readFile(path.join(dataDir, "lora-registry.json"), "utf8"));
  assert.equal(stored.entries[0].modelName, "新しい名前", "Civitai由来の項目は更新される");
  assert.equal(stored.entries[0].triggerWords, "myTrigger", "手動編集は保持される");
  assert.equal(stored.entries[0].recommendedWeight, 0.42, "手動編集は保持される");
});

test("保存先移動は確認必須で、関連ファイルごと移動しregistryを更新する", async (t) => {
  const { service, loraRoot } = await setup(t);
  await fs.mkdir(path.join(loraRoot, "Anime", "Style"), { recursive: true });
  await fs.writeFile(path.join(loraRoot, "Anime", "Style", "FlatPainting.safetensors"), "x");
  await fs.writeFile(path.join(loraRoot, "Anime", "Style", "FlatPainting.preview.png"), "p");
  const entry = await service.ensureEntry({ relativeName: "Anime/Style/FlatPainting" });

  await assert.rejects(() => service.moveEntry(entry.uid, { folder: "Illustrious/Style" }), /確認が必要/);
  const moved = await service.moveEntry(entry.uid, { folder: "Illustrious/Style", confirm: true });
  assert.equal(moved.moved.length, 2);
  assert.equal(moved.entry.relativeName, "Illustrious/Style/FlatPainting");
  await fs.access(path.join(loraRoot, "Illustrious", "Style", "FlatPainting.preview.png"));
});

test("保存先移動でパストラバーサルを拒否する", async (t) => {
  const { service, loraRoot } = await setup(t);
  await fs.mkdir(path.join(loraRoot, "Anime"), { recursive: true });
  await fs.writeFile(path.join(loraRoot, "Anime", "X.safetensors"), "x");
  const entry = await service.ensureEntry({ relativeName: "Anime/X" });
  for (const folder of ["../escape", "..\\escape", "C:\\Windows", "/etc", "\\\\server\\share"]) {
    await assert.rejects(
      () => service.moveEntry(entry.uid, { folder, confirm: true }),
      /ルート外|使用できない/,
      `${folder} は拒否されるべき`
    );
  }
});

test("registry登録名のパストラバーサルを拒否する", async (t) => {
  const { service } = await setup(t);
  for (const name of ["../secret", "C:\\abs\\path", "  ../../x  "]) {
    await assert.rejects(() => service.ensureEntry({ relativeName: name }), /不正/);
  }
});

test("既存registryをschemaVersion 2へ移行しバックアップを残す", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "lic-migrate-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dataDir, "lora-registry.json"), JSON.stringify({
    schemaVersion: 1,
    entries: [{ id: "1:2", relativeName: "Anime/A", category: "character" }]
  }));
  await fs.writeFile(path.join(dataDir, "history.json"), JSON.stringify({
    schemaVersion: 1,
    generations: [{ id: "abc", images: [] }]
  }));

  const results = await migrateDataFiles(dataDir);
  assert.equal(results.length, 2);
  const registry = JSON.parse(await fs.readFile(path.join(dataDir, "lora-registry.json"), "utf8"));
  assert.equal(registry.schemaVersion, 2);
  assert.match(registry.entries[0].uid, /^[0-9a-f-]{36}$/);
  assert.equal(registry.entries[0].subcategory, "character");
  const history = JSON.parse(await fs.readFile(path.join(dataDir, "history.json"), "utf8"));
  assert.equal(history.schemaVersion, 2);
  assert.equal(history.generations[0].experimentId, null);
  const backups = await fs.readdir(path.join(dataDir, "backups"));
  assert.equal(backups.length, 2);

  // 2回目の移行は何もしない
  assert.deepEqual(await migrateDataFiles(dataDir), []);
});

test("編集フィールドの正規化と手動編集記録", () => {
  const patch = normalizeEditableFields({
    displayName: "  名前  ",
    triggerWords: "a,,b, <script>",
    previewUrl: "javascript:alert(1)",
    recommendedWeight: 99
  });
  assert.equal(patch.displayName, "名前");
  assert.equal(patch.triggerWords, "a, b, script");
  assert.equal(patch.previewUrl, "");
  assert.equal(patch.recommendedWeight, 2);

  const edited = applyManualEdit({ uid: "x", triggerWords: "old" }, patch);
  assert.ok(edited.manualFields.includes("triggerWords"));
  const merged = mergeRegistryEntry(edited, { triggerWords: "fromCivitai", modelName: "new" });
  assert.equal(merged.triggerWords, "a, b, script");
  assert.equal(merged.modelName, "new");
});
