import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createHistoryService } from "../src/history.js";

test("生成レシピを保存し、画像単位の👍から傾向を集計できる", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "local-image-chat-history-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const history = createHistoryService(directory);

  const generation = await history.addGeneration({
    mode: "inpaint",
    sourceImageId: "source-image-id",
    sourceImageUrl: "/outputs/source.png",
    maskImageUrl: "/outputs/mask.png",
    description: "夜の秋葉原に立つ女の子",
    prompt: "masterpiece, 1girl, black hair, neon lighting, dynamic angle",
    negativePrompt: "low quality",
    settings: { width: 896, height: 1152, samplerName: "Euler a", steps: 25 },
    loras: [{ name: "Characters/test", weight: 0.7 }],
    images: [
      { filename: "one.png", imageUrl: "/outputs/one.png", seed: 123 },
      { filename: "two.png", imageUrl: "/outputs/two.png", seed: 124 }
    ]
  });

  assert.equal(generation.images.length, 2);
  await history.setFavorite(generation.images[0].id, true);
  const preferences = await history.getPreferences();
  assert.equal(preferences.favoriteCount, 1);
  assert.deepEqual(preferences.topTags.slice(0, 3).map((item) => item.name), [
    "black hair", "dynamic angle", "neon lighting"
  ]);
  assert.equal(preferences.topLoras[0].name, "Characters/test");

  const recipe = await history.getRecipe(generation.images[0].id);
  assert.equal(recipe.selectedImage.seed, 123);
  assert.equal(recipe.mode, "inpaint");
  assert.equal(recipe.sourceImageId, "source-image-id");
  assert.equal(recipe.maskImageUrl, "/outputs/mask.png");
  assert.equal((await history.list({ favoritesOnly: true }))[0].images.length, 1);
});

test("複数画像から1枚だけ削除でき、最後の1枚で世代ごと消える", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "local-image-chat-history-del-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const history = createHistoryService(directory);

  const generation = await history.addGeneration({
    description: "テスト",
    prompt: "1girl",
    settings: { width: 512, height: 512, checkpoint: "noobai-xl-vpred-v1.0" },
    loras: [{ name: "Characters/test", weight: 0.8 }],
    images: [
      { filename: "one.png", imageUrl: "/outputs/one.png", seed: 1 },
      { filename: "two.png", imageUrl: "/outputs/two.png", seed: 2 }
    ]
  });
  const [first, second] = generation.images;

  // 未知IDは失敗
  await assert.rejects(() => history.deleteImage("does-not-exist"));

  // 1枚目を削除 → 世代は残り、返り値にファイル名
  const removed = await history.deleteImage(first.id);
  assert.equal(removed.filename, "one.png");
  const afterOne = await history.list();
  assert.equal(afterOne.length, 1);
  assert.equal(afterOne[0].images.length, 1);
  assert.equal(afterOne[0].images[0].id, second.id);

  // Checkpoint情報がsettingsへ保存されている（後方互換の描画用）
  assert.equal(afterOne[0].settings.checkpoint, "noobai-xl-vpred-v1.0");

  // 最後の1枚を削除 → 世代ごと消える
  await history.deleteImage(second.id);
  assert.equal((await history.list()).length, 0);
});
