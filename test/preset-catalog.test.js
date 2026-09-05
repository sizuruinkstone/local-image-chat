import assert from "node:assert/strict";
import test from "node:test";
import {
  LORA_ROOT_FOLDER,
  MAX_CANDIDATE_COUNT,
  MIN_CANDIDATE_COUNT,
  buildLoraFolderTree,
  buildCharacterPresets,
  buildGroups,
  buildLoraCatalog,
  buildOutfitPresets,
  clampCandidateCount,
  filterItemsByFolder,
  filterPresets,
  formatLoraRelativeLocation,
  getFolderDescendantCount,
  isValidCandidateCount,
  loraFolderKey,
  resolvePresetCategory,
  splitTriggerPreview
} from "../public/preset-catalog.js";

const LORAS = [
  {
    name: "Characters/saileach_IL",
    displayName: "saileach",
    folder: "Characters",
    category: "character",
    registry: {
      uid: "u1", subcategory: "character", favorite: true, baseModel: "Illustrious",
      triggerWords: "saileach, twin braids, blue eyes, arknights",
      outfitPresets: [{ id: "o1", name: "制服", triggerWords: "school uniform, pleated skirt" }]
    }
  },
  {
    name: "Style/soft_style",
    displayName: "soft_style",
    folder: "Style",
    category: "direction",
    registry: { uid: "u2", subcategory: "style", triggerWords: "soft_render" }
  },
  {
    name: "Clothing/maid_dress",
    displayName: "maid_dress",
    folder: "Clothing",
    category: "direction",
    registry: { uid: "u3", subcategory: "other", detailCategory: "outfit", triggerWords: "maid dress, apron" }
  },
  { name: "Misc/mystery", displayName: "mystery", folder: "Misc", category: "direction", registry: {} }
];

const PROFILES = {
  "Characters/saileach_IL": {
    id: "p1",
    presets: [{ id: "identity", name: "衣装自由", triggerWords: "saileach, blue eyes" }],
    addons: [
      { id: "none", name: "衣装指定なし", triggerWords: "" },
      { id: "cos", name: "衣装A", triggerWords: "cosaaa" }
    ]
  },
  "Style/soft_style": {
    id: "p2",
    presets: [
      { id: "amana", name: "大崎甘奈", triggerWords: "shanimas, amana, 1girl" },
      { id: "asahi", name: "芹沢あさひ", triggerWords: "shanimas, asahi, 1girl" }
    ]
  }
};

const options = {
  resolveProfile: (lora) => PROFILES[lora.name] ?? null,
  resolveThumbnail: (lora) => (lora.name.startsWith("Characters") ? "/previews/a.png" : "")
};

test("LoRA一覧をフォルダ・分類・トリガーワード付きで組み立てる", () => {
  const catalog = buildLoraCatalog(LORAS, options);
  assert.equal(catalog.length, 4);
  assert.deepEqual(catalog[0], {
    id: "Characters/saileach_IL",
    kind: "lora",
    name: "saileach",
    loraName: "Characters/saileach_IL",
    folder: "Characters",
    category: "character",
    triggerWords: "saileach, twin braids, blue eyes, arknights",
    thumbnailUrl: "/previews/a.png",
    favorite: true,
    uid: "u1",
    baseModel: "Illustrious",
    relatedLoraIds: ["Characters/saileach_IL"],
    promptTags: "saileach, twin braids, blue eyes, arknights"
  });
  // サムネイルが無いLoRAは空文字（画面側でプレースホルダーを出す）
  assert.equal(catalog[1].thumbnailUrl, "");
});

test("分類は明示された情報だけで決め、判断できなければunknown", () => {
  assert.equal(resolvePresetCategory(LORAS[0]), "character");
  assert.equal(resolvePresetCategory(LORAS[1]), "style");
  // detailCategory: outfit → clothing
  assert.equal(resolvePresetCategory(LORAS[2]), "clothing");
  // 手掛かりが無ければ推測しない
  assert.equal(resolvePresetCategory(LORAS[3]), "unknown");
  assert.equal(loraFolderKey({ folder: "A\\B\\" }), "A/B");
  assert.equal(loraFolderKey({}), "(ルート)");
});

test("フォルダ・分類の選択肢を件数付きで作る", () => {
  const catalog = buildLoraCatalog(LORAS, options);
  const folders = buildGroups(catalog, "folder");
  assert.deepEqual(folders[0], { value: "", label: "すべて", count: 4 });
  assert.deepEqual(folders.slice(1).map((group) => [group.value, group.count]).sort(), [
    ["Characters", 1], ["Clothing", 1], ["Misc", 1], ["Style", 1]
  ]);
  const categories = buildGroups(catalog, "category");
  assert.equal(categories.find((group) => group.value === "clothing").label, "衣装");
});

test("LoRAフォルダツリーは親子件数とルートを正しく集計する", () => {
  const items = [
    { name: "a", folder: "Anima\\Character" },
    { name: "b", folder: "Anima/Character" },
    { name: "c", folder: "Anima/Style" },
    { name: "d", folder: "Other" },
    { name: "e", folder: "" }
  ];
  const tree = buildLoraFolderTree(items);
  assert.deepEqual(tree.children.map((node) => node.value), ["Anima", "Other"]);
  assert.equal(tree.directCount, 1);
  assert.equal(getFolderDescendantCount(tree), 5);

  const anima = tree.children[0];
  assert.equal(getFolderDescendantCount(anima), 3);
  assert.deepEqual(anima.children.map((node) => [node.value, node.directCount]), [
    ["Anima/Character", 2], ["Anima/Style", 1]
  ]);
  assert.equal(getFolderDescendantCount(anima.children[0]), 2);
  assert.equal(tree.label, LORA_ROOT_FOLDER);
});

test("LoRAフォルダ絞り込みは配下を含み、相対保存場所だけを表示する", () => {
  const items = [
    { name: "Anima/Character/a", folder: "Anima/Character" },
    { name: "Anima/Character/Sub/b", folder: "Anima/Character/Sub" },
    { name: "Other/c", folder: "Other" },
    { name: "root", folder: "" }
  ];
  assert.deepEqual(
    filterItemsByFolder(items, "Anima/Character").map((item) => item.name),
    ["Anima/Character/a", "Anima/Character/Sub/b"]
  );
  assert.deepEqual(filterItemsByFolder(items, LORA_ROOT_FOLDER).map((item) => item.name), ["root"]);
  assert.equal(filterItemsByFolder(items).length, 4);
  assert.equal(formatLoraRelativeLocation(items[0]), "Anima/Character/a");
  assert.equal(formatLoraRelativeLocation({ name: "style", folder: "Anima/Style" }), "Anima/Style/style");
  assert.equal(formatLoraRelativeLocation({ relativeName: "C:\\private\\secret.safetensors", name: "Safe/model", folder: "Safe" }), "Safe/model");
  assert.equal(formatLoraRelativeLocation({ name: "C:\\private\\secret.safetensors" }), LORA_ROOT_FOLDER);
});

test("検索は名前・トリガーワード・フォルダ・分類を対象にする", () => {
  const catalog = buildLoraCatalog(LORAS, options);
  assert.deepEqual(filterPresets(catalog, { query: "braids" }).map((item) => item.name), ["saileach"]);
  assert.deepEqual(filterPresets(catalog, { query: "clothing" }).map((item) => item.name), ["maid_dress"]);
  assert.deepEqual(filterPresets(catalog, { query: "画風" }).map((item) => item.name), ["soft_style"]);
  // フォルダ内だけの検索
  assert.deepEqual(filterPresets(catalog, { folder: "Characters", query: "sai" }).map((i) => i.name), ["saileach"]);
  assert.deepEqual(filterPresets(catalog, { folder: "Style", query: "sai" }), []);
  // Favorite絞り込み
  assert.deepEqual(filterPresets(catalog, { favoriteOnly: true }).map((item) => item.name), ["saileach"]);
});

test("キャラクター一覧はキャラLoRAと複数キャラのプロフィールから作る", () => {
  const characters = buildCharacterPresets(LORAS, options);
  // 複数キャラ入りのプロフィールは1キャラずつ
  assert.deepEqual(characters.map((item) => item.name), ["saileach", "大崎甘奈", "芹沢あさひ"]);
  const amana = characters[1];
  assert.equal(amana.loraName, "Style/soft_style");
  assert.equal(amana.promptTags, "shanimas, amana, 1girl");
  assert.deepEqual(amana.relatedLoraIds, ["Style/soft_style"]);
  // キャラLoRA単体はプロフィールのpresets（衣装自由）を使う
  const saileach = characters[0];
  assert.equal(saileach.promptTags, "saileach, blue eyes");
  assert.equal(saileach.thumbnailUrl, "/previews/a.png");
  assert.equal(saileach.favorite, true);
  // 画風・未分類LoRAはキャラ候補に出さない
  assert.equal(characters.some((item) => item.name === "mystery"), false);
});

test("衣装一覧は追加衣装・Civitai衣装・衣装LoRAから作る", () => {
  const outfits = buildOutfitPresets(LORAS, options);
  assert.deepEqual(outfits.map((item) => item.name), ["衣装A", "制服", "maid_dress"]);
  assert.equal(outfits[0].promptTags, "cosaaa");
  assert.equal(outfits[1].promptTags, "school uniform, pleated skirt");
  assert.deepEqual(outfits[2].relatedLoraIds, ["Clothing/maid_dress"]);
  // タグが空の「衣装指定なし」は候補に入れない
  assert.equal(outfits.some((item) => item.name === "衣装指定なし"), false);
});

test("トリガーワードは先頭数件だけ表示用に切り出す", () => {
  assert.deepEqual(splitTriggerPreview("a, b, c, d, e"), { tags: ["a", "b", "c"], rest: 2 });
  assert.deepEqual(splitTriggerPreview("a", 3), { tags: ["a"], rest: 0 });
  assert.deepEqual(splitTriggerPreview(""), { tags: [], rest: 0 });
});

test("生成枚数はバックエンドの制限（1〜4）に合わせる", () => {
  assert.equal(MIN_CANDIDATE_COUNT, 1);
  assert.equal(MAX_CANDIDATE_COUNT, 4);
  assert.equal(clampCandidateCount(0), 1);
  assert.equal(clampCandidateCount(9), 4);
  assert.equal(clampCandidateCount("3"), 3);
  assert.equal(clampCandidateCount("abc", 2), 2);
  assert.equal(clampCandidateCount(2.7), 2);
  assert.equal(isValidCandidateCount(1), true);
  assert.equal(isValidCandidateCount(4), true);
  assert.equal(isValidCandidateCount(0), false);
  assert.equal(isValidCandidateCount(5), false);
  assert.equal(isValidCandidateCount("2"), true);
  assert.equal(isValidCandidateCount("abc"), false);
  assert.equal(isValidCandidateCount(1.5), false);
});
