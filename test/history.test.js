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
  assert.equal((await history.list({ favoritesOnly: true }))[0].images.length, 1);
});
