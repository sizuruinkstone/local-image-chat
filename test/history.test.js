import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createHistoryService } from "../src/history.js";
import { buildGenerationTitle, generationTitle } from "../public/history-title.js";

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
    userNegativePrompt: "manual negative",
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
  assert.equal(recipe.negativePrompt, "low quality");
  assert.equal(recipe.userNegativePrompt, "manual negative");
  assert.equal((await history.list({ favoritesOnly: true }))[0].images.length, 1);
});

test("構造化プロンプトとトリガーワードを保存し、古い履歴とも両立する", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "local-image-chat-history-structured-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const history = createHistoryService(directory);

  const stored = await history.addGeneration({
    description: "教室の女の子",
    prompt: "1girl, (character_name:1.2), classroom",
    negativePrompt: "low quality",
    effectivePrompt: "1girl, (character_name:1.2), classroom, <lora:char:0.8>",
    structuredPrompt: { character: "1girl", situation: "classroom", extra: "" },
    rawPromptOverride: false,
    rawPrompt: "",
    appliedTriggerWords: [
      { id: "trigger:character_name", sourceLoraId: "char", sourceLoraIds: ["char"], text: "character_name", weight: 1.2, targetField: "character", enabled: true },
      { text: "dropped", weight: 5, targetField: "見知らぬ項目", enabled: false },
      { text: "   " }
    ],
    settings: { width: 512, height: 512 },
    loras: [{ name: "char", weight: 0.8 }],
    images: [{ filename: "one.png", imageUrl: "/outputs/one.png", seed: 7 }]
  });

  assert.deepEqual(stored.structuredPrompt, {
    character: "1girl", appearance: "", composition: "", situation: "classroom", style: "", extra: ""
  });
  assert.equal(stored.rawPromptOverride, false);
  assert.equal(stored.appliedTriggerWords.length, 2);
  assert.equal(stored.appliedTriggerWords[0].weight, 1.2);
  // 未知の反映先はextraへ寄せ、Weightは上限で丸める。LoRA本体のweightは触らない。
  assert.equal(stored.appliedTriggerWords[1].targetField, "extra");
  assert.equal(stored.appliedTriggerWords[1].weight, 2);
  assert.equal(stored.appliedTriggerWords[1].enabled, false);
  assert.equal(stored.loras[0].weight, 0.8);

  // 古い形式（構造化プロンプト無し）はnull・空配列として読める
  const legacy = await history.addGeneration({
    description: "旧履歴",
    prompt: "1girl, masterpiece",
    settings: {},
    images: [{ filename: "old.png", imageUrl: "/outputs/old.png", seed: 1 }]
  });
  assert.equal(legacy.structuredPrompt, null);
  assert.equal(legacy.rawPromptOverride, false);
  assert.deepEqual(legacy.appliedTriggerWords, []);

  const recipe = await history.getRecipe(stored.images[0].id);
  assert.equal(recipe.structuredPrompt.situation, "classroom");
  assert.equal(recipe.appliedTriggerWords[0].text, "character_name");
});

test("LoRAの実効Weightと選択元・警告を履歴へ残す", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "local-image-chat-history-lora-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const history = createHistoryService(directory);

  const stored = await history.addGeneration({
    description: "LoRAタグ同期",
    prompt: "1girl, <lora:Characters/saileach_IL:0.65>",
    effectivePrompt: "1girl, <lora:Characters/saileach_IL:0.65>, <lora:Style/soft:0.7>",
    settings: {},
    loras: [
      { name: "Characters/saileach_IL", weight: 0.65, source: "prompt" },
      { name: "Style/soft", weight: 0.7 }
    ],
    loraNotices: [{ type: "unresolved", name: "unknown_lora", weight: 0.7 }],
    images: [{ filename: "a.png", imageUrl: "/outputs/a.png", seed: 1 }]
  });

  assert.equal(stored.loras[0].weight, 0.65, "実効Weightを保存する");
  assert.equal(stored.loras[0].source, "prompt");
  // sourceが無い古い形式は "ui" として読む
  assert.equal(stored.loras[1].source, "ui");
  assert.deepEqual(stored.loraNotices, [{ type: "unresolved", name: "unknown_lora", weight: 0.7 }]);

  const recipe = await history.getRecipe(stored.images[0].id);
  assert.equal(recipe.loras[0].weight, 0.65);
  assert.equal(recipe.effectivePrompt.includes("<lora:Characters/saileach_IL:0.65>"), true);

  const legacy = await history.addGeneration({
    description: "旧履歴",
    prompt: "1girl",
    settings: {},
    loras: [{ name: "Characters/saileach_IL", weight: 1 }],
    images: [{ filename: "b.png", imageUrl: "/outputs/b.png", seed: 2 }]
  });
  assert.equal(legacy.loras[0].source, "ui");
  assert.deepEqual(legacy.loraNotices, []);
});

test("説明文が無い生成は「無題」として履歴へ残る", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "local-image-chat-history-untitled-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const history = createHistoryService(directory);

  const untitled = await history.addGeneration({
    prompt: "1girl, masterpiece",
    settings: {},
    images: [{ filename: "a.png", imageUrl: "/outputs/a.png", seed: 1 }]
  });
  assert.equal(untitled.description, "無題");

  const blank = await history.addGeneration({
    description: "   ",
    prompt: "1girl",
    settings: {},
    images: [{ filename: "b.png", imageUrl: "/outputs/b.png", seed: 2 }]
  });
  assert.equal(blank.description, "無題");

  const titled = await history.addGeneration({
    description: " 夜の秋葉原 ",
    prompt: "1girl",
    settings: {},
    images: [{ filename: "c.png", imageUrl: "/outputs/c.png", seed: 3 }]
  });
  assert.equal(titled.description, "夜の秋葉原");
});

test("新規履歴のtitleを確定し、旧履歴の表示fallbackを維持する", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "local-image-chat-history-title-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const history = createHistoryService(directory);

  const stored = await history.addGeneration({
    title: " 手動タイトル ",
    description: "Prompt生成用の説明文",
    images: [{ filename: "manual.png", imageUrl: "/outputs/manual.png", seed: 10 }]
  });
  assert.equal(stored.title, "手動タイトル");
  assert.equal(stored.description, "Prompt生成用の説明文");

  assert.equal(generationTitle({ title: "新しいタイトル", description: "旧説明" }), "新しいタイトル");
  assert.equal(generationTitle({ description: "旧説明" }), "旧説明");
  assert.equal(generationTitle({}), "無題");
});

test("タイトル自動生成はdescriptionを参照せず、実Seedと未知変数を安全に扱う", () => {
  const base = {
    createdAt: "2026-08-05T12:34:00.000Z",
    structuredPrompt: {
      character: "1girl, solo, character_name",
      appearance: " , sailor uniform"
    },
    settings: { checkpointModelName: "model-name" },
    images: [{ seed: 987654 }]
  };

  assert.equal(buildGenerationTitle({ ...base, title: "  手動  ", description: "使わない説明" }), "手動");
  assert.match(buildGenerationTitle({ ...base, titleMode: "date" }), /^2026\/08\/05 \d{2}:\d{2}$/);
  assert.equal(buildGenerationTitle({ ...base, titleMode: "character" }), "character_name");
  assert.equal(buildGenerationTitle({ ...base, titleMode: "model" }), "model-name");
  assert.equal(buildGenerationTitle({ ...base, titleMode: "character-date" }).startsWith("character_name · "), true);
  assert.equal(buildGenerationTitle({ ...base, titleMode: "character-outfit" }), "character_name · sailor uniform");
  const localDate = new Date(base.createdAt);
  const dateText = `${localDate.getFullYear()}/${String(localDate.getMonth() + 1).padStart(2, "0")}/${String(localDate.getDate()).padStart(2, "0")}`;
  const timeText = `${String(localDate.getHours()).padStart(2, "0")}:${String(localDate.getMinutes()).padStart(2, "0")}`;
  assert.equal(
    buildGenerationTitle({ ...base, titleMode: "template", titleTemplate: "{character} / {unknown} / {seed} / {date} {time}" }),
    `character_name / / 987654 / ${dateText} ${timeText}`
  );
  assert.match(
    buildGenerationTitle({ titleMode: "character", createdAt: "2026-08-05T12:34:00.000Z", description: "使わない説明" }),
    /^2026\/08\/05 \d{2}:\d{2}$/
  );
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

test("履歴を画像単位で20件ずつページングし、重複なく最後で停止する", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "local-image-chat-history-page-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const history = createHistoryService(directory);

  for (let generationIndex = 0; generationIndex < 7; generationIndex += 1) {
    await history.addGeneration({
      id: `generation-${generationIndex}`,
      description: `generation ${generationIndex}`,
      images: Array.from({ length: 4 }, (_, imageIndex) => ({
        id: `image-${generationIndex}-${imageIndex}`,
        filename: `${generationIndex}-${imageIndex}.png`,
        imageUrl: `/outputs/${generationIndex}-${imageIndex}.png`,
        seed: generationIndex * 10 + imageIndex,
        favorite: imageIndex === 0
      }))
    });
  }

  const first = await history.listPage({ limit: 20 });
  assert.equal(first.generations.flatMap((item) => item.images).length, 20);
  assert.equal(first.total, 28);
  assert.equal(first.nextCursor, first.generations.at(-1).images.at(-1).id);
  assert.equal(first.hasMore, true);

  // 1ページ目の後に新規生成が先頭へ追加されても、カーソル以降はずれない。
  await history.addGeneration({
    id: "generation-new",
    images: Array.from({ length: 4 }, (_, index) => ({
      id: `image-new-${index}`,
      filename: `new-${index}.png`,
      imageUrl: `/outputs/new-${index}.png`,
      seed: 100 + index
    }))
  });
  const last = await history.listPage({ limit: 20, cursor: first.nextCursor });
  assert.equal(last.generations.flatMap((item) => item.images).length, 8);
  assert.equal(last.nextCursor, null);
  assert.equal(last.hasMore, false);
  const ids = [...first.generations, ...last.generations].flatMap((item) => item.images.map((image) => image.id));
  assert.equal(new Set(ids).size, 28);

  const favorites = await history.listPage({ favoritesOnly: true, limit: 20 });
  assert.equal(favorites.total, 7);
  assert.equal(favorites.generations.flatMap((item) => item.images).every((image) => image.favorite), true);
  await assert.rejects(() => history.listPage({ cursor: "../20" }), /カーソルが不正/);
});

test("contentRatingをgeneration単位で保存・分類し、絞り込み後に正しくページングする", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "local-image-chat-history-rating-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const history = createHistoryService(directory);

  const general = await history.addGeneration({
    id: "generation-general",
    contentRating: "general",
    images: [
      { id: "image-general-1", filename: "g1.png", imageUrl: "/outputs/g1.png", seed: 1, favorite: true },
      { id: "image-general-2", filename: "g2.png", imageUrl: "/outputs/g2.png", seed: 2 }
    ]
  });
  const nsfw = await history.addGeneration({
    id: "generation-nsfw",
    contentRating: "nsfw",
    images: [
      { id: "image-nsfw-1", filename: "n1.png", imageUrl: "/outputs/n1.png", seed: 3, favorite: true },
      { id: "image-nsfw-2", filename: "n2.png", imageUrl: "/outputs/n2.png", seed: 4 }
    ]
  });
  assert.equal(general.contentRating, "general");
  assert.equal(nsfw.contentRating, "nsfw");

  const first = await history.listPage({ contentRating: "nsfw", limit: 1 });
  assert.equal(first.total, 2);
  assert.equal(first.generations[0].images[0].id, "image-nsfw-1");
  assert.equal(first.hasMore, true);
  const second = await history.listPage({ contentRating: "nsfw", limit: 1, cursor: first.nextCursor });
  assert.equal(second.generations[0].images[0].id, "image-nsfw-2");
  assert.equal(second.hasMore, false);

  const favoriteNsfw = await history.listPage({ favoritesOnly: true, contentRating: "nsfw" });
  assert.equal(favoriteNsfw.total, 1);
  assert.equal(favoriteNsfw.generations[0].images[0].id, "image-nsfw-1");

  const changed = await history.setContentRating("image-general-2", "nsfw");
  assert.equal(changed.generationId, "generation-general");
  assert.deepEqual(changed.imageIds, ["image-general-1", "image-general-2"]);
  assert.equal((await history.getGeneration("generation-general")).contentRating, "nsfw");
  assert.equal((await history.getGeneration("generation-nsfw")).contentRating, "nsfw", "他generationは変更しない");
  await assert.rejects(() => history.setContentRating("image-general-1", "unrated"), /contentRatingが不正/);
  await assert.rejects(() => history.listPage({ contentRating: "broken" }), /ratingが不正/);
});

test("古い履歴のcontentRating欠落・不明値はunratedとして読み、新規省略時はgeneralになる", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "local-image-chat-history-unrated-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const history = createHistoryService(directory);
  const created = await history.addGeneration({
    id: "generation-default",
    images: [{ id: "image-default-1", filename: "default.png", imageUrl: "/outputs/default.png", seed: 1 }]
  });
  assert.equal(created.contentRating, "general");

  const file = path.join(directory, "history.json");
  const data = JSON.parse(await fs.readFile(file, "utf8"));
  data.generations.unshift(
    {
      id: "generation-legacy",
      images: [{ id: "image-legacy-1", filename: "legacy.png", imageUrl: "/outputs/legacy.png", seed: 2 }]
    },
    {
      id: "generation-broken",
      contentRating: "adult-ish",
      images: [{ id: "image-broken-1", filename: "broken.png", imageUrl: "/outputs/broken.png", seed: 3 }]
    }
  );
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");

  const unrated = await history.listPage({ contentRating: "unrated" });
  assert.equal(unrated.total, 2);
  assert.deepEqual(unrated.generations.map((item) => item.contentRating), ["unrated", "unrated"]);
});

test('section profile snapshots survive stored history and image recipe reads',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lic-section-profile-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const history=createHistoryService(dir);
 const profiles={appearance:{id:'old-id',name:'Summer',text:'white dress, summer hat',enabled:true,disabledTriggerKeys:['summer hat']}};
 const normalized={appearance:{...profiles.appearance,contentRating:'general'}};
 const record=await history.addGeneration({prompt:'white dress',sectionProfiles:profiles,images:[{filename:'one.png',imageUrl:'/outputs/one.png',seed:1}]});
 assert.deepEqual(record.sectionProfiles,normalized);
 const fresh=createHistoryService(dir);const result=await fresh.getRecipe(record.images[0].id);
 assert.deepEqual(result.sectionProfiles,normalized);
});
