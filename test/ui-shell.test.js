import assert from "node:assert/strict";
import test from "node:test";
import {
  APP_VIEWS,
  APP_VIEW_LABELS,
  hashForView,
  normalizeAppView,
  viewFromHash
} from "../public/view-router.js";
import {
  SAMPLER_PRESETS,
  buildOptionSections,
  describeSamplerPreset,
  isActivePreset,
  isFavoriteOption,
  matchesQuery,
  rememberRecentOption,
  toggleFavoriteOption
} from "../public/option-picker.js";
import {
  collectCheckpoints,
  collectLoras,
  describeGalleryFilter,
  filterGalleryEntries,
  resolveSince,
  toGalleryEntries
} from "../public/gallery-filter.js";

test("トップレベル画面は4つだけ", () => {
  assert.deepEqual(APP_VIEWS, ["generate", "gallery", "compare", "settings"]);
  assert.deepEqual(APP_VIEWS.map((view) => APP_VIEW_LABELS[view]), ["生成", "ギャラリー", "比較", "設定"]);
  assert.equal(normalizeAppView("gallery"), "gallery");
  assert.equal(normalizeAppView("unknown"), "generate");
  assert.equal(normalizeAppView(undefined, "settings"), "settings");
});

test("URLハッシュと画面名が往復する", () => {
  assert.equal(viewFromHash("#compare"), "compare");
  assert.equal(viewFromHash("compare"), "compare");
  assert.equal(viewFromHash("#unknown"), null);
  assert.equal(viewFromHash(""), null);
  assert.equal(hashForView("gallery"), "#gallery");
  assert.equal(hashForView("bad"), "#generate");
});

const SAMPLERS = ["DPM++ 2M SDE", "DPM++ 2M", "Euler a", "DDIM", "UniPC"];

test("候補一覧はお気に入り・最近使用・すべてに分かれる", () => {
  const sections = buildOptionSections({
    all: SAMPLERS,
    favorites: ["Euler a"],
    recent: ["DDIM", "Euler a"],
    current: "DPM++ 2M SDE"
  });
  assert.deepEqual(sections.map((section) => section.key), ["favorite", "recent", "all"]);
  assert.deepEqual(sections[0].items, ["Euler a"]);
  // お気に入りと重複する項目は「最近使用」から省く
  assert.deepEqual(sections[1].items, ["DDIM"]);
  assert.equal(sections[2].items.length, SAMPLERS.length);
});

test("検索で候補を絞り込む", () => {
  const sections = buildOptionSections({ all: SAMPLERS, favorites: ["Euler a"], query: "dpm" });
  assert.deepEqual(sections.map((section) => section.key), ["all"], "一致しないセクションは出さない");
  assert.deepEqual(sections[0].items, ["DPM++ 2M SDE", "DPM++ 2M"]);
  assert.equal(matchesQuery("Euler a", ""), true);
  assert.equal(matchesQuery("Euler a", "EULER"), true);
  assert.equal(matchesQuery("Euler a", "karras"), false);
});

test("一覧に無い現在値・お気に入りも候補へ残す", () => {
  const sections = buildOptionSections({ all: [], favorites: ["Restart"], current: "自作サンプラー" });
  const all = sections.find((section) => section.key === "all");
  assert.deepEqual(all.items.sort(), ["Restart", "自作サンプラー"].sort());
});

test("最近使用は先頭へ積み、重複と件数を整理する", () => {
  let recent = rememberRecentOption([], "Euler a");
  recent = rememberRecentOption(recent, "DDIM");
  recent = rememberRecentOption(recent, "Euler a");
  assert.deepEqual(recent, ["Euler a", "DDIM"]);
  const long = ["a", "b", "c", "d", "e"].reduce((list, item) => rememberRecentOption(list, item), []);
  assert.equal(long.length, 5);
  assert.deepEqual(rememberRecentOption(long, "f")[0], "f");
  assert.equal(rememberRecentOption(long, "f").length, 5);
  assert.deepEqual(rememberRecentOption(["a"], "  "), ["a"]);
});

test("お気に入りは追加と解除ができる", () => {
  const added = toggleFavoriteOption([], "Karras");
  assert.deepEqual(added, ["Karras"]);
  assert.equal(isFavoriteOption(added, "karras"), true);
  assert.deepEqual(toggleFavoriteOption(added, "Karras"), []);
});

test("Sampler/Schedulerのプリセット", () => {
  assert.equal(describeSamplerPreset(SAMPLER_PRESETS[0]), "DPM++ 2M SDE / Karras");
  assert.equal(isActivePreset(SAMPLER_PRESETS[0], "DPM++ 2M SDE", "Karras"), true);
  assert.equal(isActivePreset(SAMPLER_PRESETS[0], "DPM++ 2M SDE", "Automatic"), false);
});

const NOW = Date.parse("2026-07-27T12:00:00.000Z");
const GENERATIONS = [
  {
    id: "g1",
    createdAt: "2026-07-27T09:00:00.000Z",
    description: "夜の秋葉原",
    prompt: "1girl, neon",
    settings: { checkpoint: "waiNSFW.safetensors" },
    loras: [{ name: "Characters/saileach_IL" }],
    images: [{ id: "i1", seed: 111, favorite: true }, { id: "i2", seed: 112, favorite: false }]
  },
  {
    id: "g2",
    createdAt: "2026-07-20T09:00:00.000Z",
    experimentId: "exp-1",
    experimentName: "CFG比較",
    prompt: "1girl, forest",
    settings: { checkpoint: "obsession.safetensors" },
    loras: [],
    images: [{ id: "i3", seed: 113, favorite: false }]
  }
];

test("履歴を画像単位へ平坦化して絞り込む", () => {
  const entries = toGalleryEntries(GENERATIONS);
  assert.equal(entries.length, 3);
  assert.deepEqual(collectCheckpoints(entries), ["obsession.safetensors", "waiNSFW.safetensors"]);
  assert.deepEqual(collectLoras(entries), ["Characters/saileach_IL"]);

  const favorite = filterGalleryEntries(entries, { kind: "favorite" });
  assert.deepEqual(favorite.map((entry) => entry.image.id), ["i1"]);
  assert.deepEqual(filterGalleryEntries(entries, { kind: "experiment" }).map((e) => e.image.id), ["i3"]);
  assert.deepEqual(filterGalleryEntries(entries, { kind: "normal" }).map((e) => e.image.id), ["i1", "i2"]);
  assert.deepEqual(
    filterGalleryEntries(entries, { checkpoint: "waiNSFW.safetensors" }).map((e) => e.image.id),
    ["i1", "i2"]
  );
  assert.deepEqual(
    filterGalleryEntries(entries, { lora: "characters/saileach_il" }).map((e) => e.image.id),
    ["i1", "i2"]
  );
});

test("生成日時と検索で絞り込む", () => {
  const entries = toGalleryEntries(GENERATIONS);
  assert.deepEqual(filterGalleryEntries(entries, { period: "week", now: NOW }).map((e) => e.image.id), ["i1", "i2"]);
  assert.equal(filterGalleryEntries(entries, { period: "month", now: NOW }).length, 3);
  assert.equal(resolveSince("", NOW), null);
  // Prompt・説明文・Checkpoint・LoRA名・Seed・実験名が対象
  assert.deepEqual(filterGalleryEntries(entries, { query: "秋葉原" }).map((e) => e.image.id), ["i1", "i2"]);
  assert.deepEqual(filterGalleryEntries(entries, { query: "cfg比較" }).map((e) => e.image.id), ["i3"]);
  assert.deepEqual(filterGalleryEntries(entries, { query: "113" }).map((e) => e.image.id), ["i3"]);
  assert.deepEqual(filterGalleryEntries(entries, { query: "存在しない" }), []);
});

test("絞り込み条件を1行で説明する", () => {
  const text = describeGalleryFilter({ kind: "favorite", checkpoint: "wai", query: "夜" }, 10, 3);
  assert.equal(text, "3/10枚・Favorite・Checkpoint: wai・検索: 夜");
  assert.equal(describeGalleryFilter({ kind: "all" }, 5, 5), "5/5枚");
});
