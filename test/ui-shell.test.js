import assert from "node:assert/strict";
import fs from "node:fs/promises";
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
  collectPromptTags,
  describeGalleryFilter,
  filterGalleryEntries,
  promptTagsForEntry,
  resolveSince,
  sortGalleryEntries,
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

test("v3.0のバージョン契約は4箇所で一致する", async () => {
  const packageJson = JSON.parse(await fs.readFile("package.json", "utf8"));
  const packageLock = JSON.parse(await fs.readFile("package-lock.json", "utf8"));
  const staticVersion = JSON.parse(await fs.readFile("public/version.json", "utf8"));
  const versions = [
    packageJson.version,
    packageLock.version,
    packageLock.packages[""].version,
    staticVersion.version
  ];

  assert.deepEqual(versions, ["3.0.0", "3.0.0", "3.0.0", "3.0.0"]);
});

test("設定画面は静的版とサーバー版の不一致を再起動案内へ表示する", async () => {
  const html = await fs.readFile("public/index.html", "utf8");
  const app = await fs.readFile("public/app.js", "utf8");

  assert.equal((html.match(/id="versionContractStatus"/g) ?? []).length, 1);
  assert.match(html, /id="versionContractStatus"[^>]*aria-live="polite"/);
  assert.match(app, /async function loadVersionContract\(serverVersion, runtime\)/);
  assert.match(app, /loadVersionContract\(version, runtime\)/);
  assert.match(app, /fetch\("\/version\.json",\s*\{\s*cache:\s*"no-cache"\s*\}\)/);
  assert.match(app, /diskVersion === runtimeVersion/);
  assert.match(app, /更新を反映するにはサーバーを再起動してください/);
  assert.match(app, /function describeRuntime\(runtime\)/);
  assert.match(app, /PID \$\{pid\}/);
  assert.match(app, /起動 \$\{startedAt\}/);
  assert.match(app, /runtime\.binding\?\.host/);
  assert.match(app, /Number\.isFinite\(date\.getTime\(\)\)/);
  assert.match(app, /if \(!runtime \|\| typeof runtime !== "object"\) return ""/);
  assert.match(app, /catch \{[\s\S]*?画面バージョンを確認できません。/);
});

test("画像比較の導線は既存候補Stateと比較表示を再利用する", async () => {
  const html = await fs.readFile("public/index.html", "utf8");
  const app = await fs.readFile("public/app.js", "utf8");
  const css = await fs.readFile("public/style.css", "utf8");

  for (const id of [
    "compareSelectionBadge", "compareTray", "compareTrayCount", "compareTrayOpenButton",
    "compareTrayClearButton", "compareTrayItems", "imageCompareMessage",
    "imageCompareGalleryButton", "imageCompareStartButton"
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} should exist`);
  }
  assert.match(html, /id="studioMainCompareButton"[^>]*>比較に追加<\/button>/);
  assert.match(html, /id="studioCompareButton"[^>]*>比較に追加<\/button>/);
  assert.match(html, /id="imageCompareMessage"[^>]*>比較する画像がありません<\/p>/);

  assert.match(app, /const compareSelection = new Map\(\)/);
  assert.match(app, /function toggleCompareSelection\([\s\S]*?compareSelection\.size >= 4/);
  assert.match(app, /function compareCurrentSelection\([\s\S]*?void openComparison\(entries\)/);
  assert.match(app, /async function openComparison\([\s\S]*?openCompareView\(\{/);
  assert.match(app, /function renderCompareTray\([\s\S]*?entries\.slice\(0, 4\)/);
  const compareTray = app.match(/function renderCompareTray\([\s\S]*?\n\}\n\nfunction renderImageCompareEntry/)?.[0] ?? "";
  assert.match(compareTray, /const title = generationTitle\(entry\.generation\)/);
  assert.doesNotMatch(compareTray, /entry\.generation\?\.description/);
  assert.match(app, /function renderImageCompareEntry\([\s\S]*?比較する画像がありません[\s\S]*?あと1枚追加すると比較できます/);
  assert.match(app, /elements\.compareTrayOpenButton\.disabled = entries\.length < 2/);
  assert.match(app, /elements\.imageCompareStartButton\.classList\.toggle\("hidden", count < 2\)/);
  assert.match(app, /compareSelection\.clear\(\)/);

  const card = app.match(/function createHistoryCard\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(card, /card\.addEventListener\("click",[\s\S]*?openImageModal/);
  assert.match(card, /compare\.addEventListener\("click",[\s\S]*?toggleCompareSelection/);
  assert.match(css, /\.navBadge\s*\{/);
  assert.match(css, /\.compareTrayItems\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4/);
});

test("一般カテゴリの画像保存場所はplan確認後だけ移行を予約できる", async () => {
  const html = await fs.readFile("public/index.html", "utf8");
  const app = await fs.readFile("public/app.js", "utf8");

  assert.equal((html.match(/id="storageSettingsDetails"/g) ?? []).length, 1);
  for (const id of [
    "storageCurrentOutputDir", "storageOutputSource", "storageFavoritesFollow", "storagePendingOutputDir",
    "storageTargetOutputDir", "storagePlanButton", "storageReserveButton", "storageCancelButton",
    "storagePlanSummary", "storageStatus", "storageLastMigration"
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} should exist`);
  }
  assert.match(html, /id="storageStatus"[^>]*aria-live="polite"/);
  assert.match(html, /id="storagePlanSummary"[^>]*aria-live="polite"/);
  assert.match(app, /async function loadStorageSettings\(\)/);
  assert.match(app, /postJson\("\/api\/storage\/plan"/);
  assert.match(app, /patchJson\("\/api\/storage\/settings"/);
  assert.match(app, /confirmModal\(\s*"次回サーバー起動時に/);
  assert.match(app, /storageMigrationPlan = null/);
  assert.match(app, /入力を変更しました。もう一度「変更内容を確認」してください。/);
  assert.match(app, /!storageMigrationPlan\?\.valid/);
  assert.match(app, /settings\.source === "env"/);
  assert.match(app, /LOCAL_IMAGE_CHAT_OUTPUT_DIRを変更して再起動してください/);
  assert.match(app, /保存先設定の取得失敗で、他の設定画面の初期化を止めない/);
  assert.match(app, /loadShareState\(\), loadSamplerOptions\(\), loadStorageSettings\(\)/);
  assert.match(app, /旧保存先は削除せず残します/);
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
    contentRating: "nsfw",
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
  assert.deepEqual(filterGalleryEntries(entries, { rating: "nsfw" }).map((e) => e.image.id), ["i1", "i2"]);
  assert.deepEqual(filterGalleryEntries(entries, { rating: "unrated" }).map((e) => e.image.id), ["i3"]);
  assert.deepEqual(
    filterGalleryEntries(entries, { kind: "favorite", rating: "nsfw" }).map((e) => e.image.id),
    ["i1"]
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

test("ギャラリーのタグ候補は構造化Promptを優先し、複合タグを壊さない", () => {
  const entries = toGalleryEntries([
    {
      id: "structured",
      prompt: "fallback, ignored",
      effectivePrompt: "also ignored",
      structuredPrompt: {
        character: "1girl, (blue eyes:1.2)",
        appearance: "short hair",
        composition: ""
      },
      images: [{ id: "structured-image" }]
    },
    {
      id: "fallback",
      effectivePrompt: "1girl, <lora:sample:0.8>, city night",
      images: [{ id: "fallback-image" }]
    }
  ]);

  assert.deepEqual(promptTagsForEntry(entries[0]), ["1girl", "(blue eyes:1.2)", "short hair"]);
  assert.deepEqual(promptTagsForEntry(entries[1]), ["1girl", "<lora:sample:0.8>", "city night"]);
  assert.deepEqual(collectPromptTags(entries), ["(blue eyes:1.2)", "<lora:sample:0.8>", "1girl", "city night", "short hair"]);
  assert.deepEqual(
    filterGalleryEntries(entries, { tags: ["1girl", "short hair"] }).map((entry) => entry.image.id),
    ["structured-image"]
  );
  assert.equal(describeGalleryFilter({ tags: ["1girl", "short hair"] }, 4, 1), "1/4枚・タグ: 1girl + short hair");
});

test("ギャラリーの新旧順は取得順を同時刻の安定順として維持する", () => {
  const entries = toGalleryEntries([
    { id: "old", createdAt: "2026-07-20T00:00:00.000Z", images: [{ id: "old-image" }] },
    { id: "new-a", createdAt: "2026-07-27T00:00:00.000Z", images: [{ id: "new-a-image" }] },
    { id: "new-b", createdAt: "2026-07-27T00:00:00.000Z", images: [{ id: "new-b-image" }] }
  ]);

  assert.deepEqual(sortGalleryEntries(entries, "newest").map((entry) => entry.image.id), ["new-a-image", "new-b-image", "old-image"]);
  assert.deepEqual(sortGalleryEntries(entries, "oldest").map((entry) => entry.image.id), ["old-image", "new-a-image", "new-b-image"]);
});

test("ギャラリーは画像を主役にし、詳細・操作・比較を既存処理へ接続する", async () => {
  const html = await fs.readFile("public/index.html", "utf8");
  const app = await fs.readFile("public/app.js", "utf8");
  const css = await fs.readFile("public/style.css", "utf8");
  const gallery = html.match(/<section id="viewGallery"[\s\S]*?(?=<section id="viewCompare")/)?.[0] ?? "";
  const card = app.match(/function createHistoryCard\([\s\S]*?\n\}/)?.[0] ?? "";

  assert.match(gallery, /class="[^"]*galleryPage/);
  assert.match(gallery, /id="galleryToolbar"|class="galleryToolbar"/);
  assert.match(gallery, /id="galleryFilterDialog"[^>]*>/);
  assert.match(gallery, /id="galleryCompareModeBar"[^>]*class="[^"]*hidden/);
  assert.match(gallery, /id="galleryTagOptions"/);
  assert.match(gallery, /id="galleryCompareModeButton"/);
  assert.doesNotMatch(gallery, /id="galleryFilters"/);

  assert.match(css, /\.historyGrid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(auto-fill, minmax\(280px, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 1080px\)[\s\S]*?\.historyGrid\s*\{[\s\S]*?minmax\(230px, 1fr\)/);
  assert.match(css, /\.historyCardPreview \.historyCardImage\s*\{[\s\S]*?aspect-ratio:\s*4 \/ 3;[\s\S]*?object-fit:\s*contain/);
  assert.match(css, /\.historyCardMenu\s*\{[\s\S]*?margin:\s*0;[\s\S]*?padding:\s*0;[\s\S]*?border:\s*0;[\s\S]*?border-radius:\s*0;[\s\S]*?background:\s*transparent/);
  assert.match(css, /\.detailImage\s*\{[\s\S]*?max-width:\s*100%;[\s\S]*?max-height:[\s\S]*?object-fit:\s*contain/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.historyGrid\s*\{\s*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 420px\)[\s\S]*?\.historyGrid\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\);?\s*\}/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.galleryToolbar\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/);

  assert.match(app, /filterGalleryEntries\(allEntries, galleryFilter\)/);
  assert.match(app, /sortGalleryEntries\(filterGalleryEntries\(allEntries, galleryFilter\), gallerySort\)/);
  assert.match(app, /collectPromptTags\(entries\)/);
  assert.match(app, /elements\.galleryFilterDialog\.showModal\(\)/);
  assert.match(app, /configureThumbnailImage\(preview, image/);
  assert.match(card, /card\.addEventListener\("click"[\s\S]*?openImageModal/);
  assert.match(card, /historyCardMenu/);
  assert.match(card, /activateCompositionLock\(generation, image\)/);
  assert.match(card, /openHistoryDetail\(generation, image\)/);
  assert.match(card, /deleteHistoryImage\(image, button\)/);
  assert.match(card, /toggleCompareSelection\(image, generation\)/);
  const detail = app.match(/function openHistoryDetail\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(detail, /className\s*=\s*"detailImage"/);
  assert.match(detail, /detailImage\.src\s*=\s*originalImageUrl\(image\)/);
  assert.match(detail, /detailImage\.alt\s*=\s*generationTitle\(generation\)/);
  assert.match(detail, /openImageModal\(detailImage\.src, detailImage\.alt\)/);
  assert.match(app, /function setGalleryCompareMode\(active\)/);
  assert.match(app, /compareSelection\.size/);
});

test("絞り込み条件を1行で説明する", () => {
  const text = describeGalleryFilter({ kind: "favorite", checkpoint: "wai", query: "夜" }, 10, 3);
  assert.equal(text, "3/10枚・Favorite・Checkpoint: wai・検索: 夜");
  assert.equal(describeGalleryFilter({ kind: "all" }, 5, 5), "5/5枚");
  assert.equal(describeGalleryFilter({ rating: "nsfw" }, 5, 2), "2/5枚・NSFW");
});

test("生成分類UIとギャラリー分類UIはHistory APIへ明示値を接続する", async () => {
  const html = await fs.readFile("public/index.html", "utf8");
  const app = await fs.readFile("public/app.js", "utf8");
  assert.match(html, /id="contentRatingGeneral"[^>]*value="general"[^>]*checked/);
  assert.match(html, /id="contentRatingNsfw"[^>]*value="nsfw"/);
  assert.match(html, /data-gallery-rating="general"/);
  assert.match(html, /data-gallery-rating="nsfw"/);
  assert.match(html, /data-gallery-rating="unrated"/);
  assert.match(app, /contentRating:\s*selectedContentRating\(\)/);
  assert.match(app, /localImageChat\.contentRating/);
  assert.match(app, /rating=\$\{encodeURIComponent\(galleryFilter\.rating\)\}/);
  assert.match(app, /\/content-rating`, \{ contentRating \}/);
});

test("生成画面はプロンプト・キャンバス・履歴の3カラム構造を持つ", async () => {
  const html = await fs.readFile("public/index.html", "utf8");
  const app = await fs.readFile("public/app.js", "utf8");
  assert.match(html, /class="generateLayout studioWorkspace"/);
  assert.match(html, /class="panel controls generateMain studioPromptColumn"/);
  assert.match(html, /class="panel result generateResult studioCanvasColumn"/);
  assert.match(html, /class="panel studioInspector"/);
  assert.match(html, /id="studioRecentList"/);
  assert.match(html, /id="studioMetadataContent"/);
  assert.match(app, /document\.body\.dataset\.currentView = currentView/);
});

test("v3生成画面へ旧ヘッダー・縦ナビ・生成設定を同時レンダリングしない", async () => {
  const html = await fs.readFile("public/index.html", "utf8");
  const app = await fs.readFile("public/app.js", "utf8");
  const css = await fs.readFile("public/style.css", "utf8");

  assert.match(html, /<header class="v3AppHeader">/);
  assert.doesNotMatch(html, /LOCAL GENERATION|class="shareBar"|<h1>/);
  assert.doesNotMatch(html, /class="generationMode"/);
  assert.match(html, /id="txt2imgModeButton"[\s\S]*?>\s*TXT\s*<\/button>/);
  assert.doesNotMatch(html, /CANDIDATES|HISTORY \/ DATA|>インスペクター</);
  assert.match(app, /studioGenerationSettingsMount\.append\(elements\.promptPartsDetails\)/);
  assert.doesNotMatch(app, /studioGenerationSettingsMount\.append\(elements\.generationSettingsDetails/);
  assert.doesNotMatch(app, /candidateCardActions/);
  assert.doesNotMatch(css, /grid-template-columns:\s*132px|\.shareBar|\.headerActions|\.candidateCardActions|\.finishBar/);
  for (const id of [
    "mainNav", "generateButton", "checkpointSelect", "samplerName", "seed",
    "usedLoraList", "studioRecentList", "studioMetadataContent", "studioMainPreview"
  ]) {
    assert.equal((html.match(new RegExp(`id="${id}"`, "g")) ?? []).length, 1, `${id} must be unique`);
  }
});

test("分割プロンプト7項目とLoRAを左カラムのアコーディオンとして維持する", async () => {
  const html = await fs.readFile("public/index.html", "utf8");
  for (const field of ["character", "appearance", "composition", "situation", "style", "extra", "negative"]) {
    assert.match(html, new RegExp(`<details class="promptFieldBlock" data-prompt-field="${field}"`));
  }
  assert.match(html, /id="loraUseDetails" class="genSection studioLoraSection"/);
  assert.match(html, /id="addLoraButton"/);
  assert.match(html, /id="openLoraManagementButton"[^>]*>LoRA管理<\/button>/);
  assert.match(html, /id="settingsLoraDetails"/);
  const generationLoraMarkup = html.match(/<details id="loraUseDetails"[\s\S]*?<\/details>/)?.[0] ?? "";
  assert.doesNotMatch(generationLoraMarkup, /Civitai URLから追加/);

  const app = await fs.readFile("public/app.js", "utf8");
  assert.match(app, /elements\.addLoraButton\.addEventListener\("click", \(\) => void openLoraPicker\(\)\)/);
  assert.match(app, /elements\.openLoraManagementButton\.addEventListener\("click"[\s\S]*?activateSettingsCategory\("lora",\s*\{\s*targetId:\s*"settingsLoraDetails",\s*focus:\s*true\s*\}\)/);
  assert.match(app, /async function openLoraPicker\(\)/);
  assert.match(app, /resolveThumbnail: loraThumbnail/);
});

test("生成バーはモバイル固定・safe-area対応で、軽量アニメーションを抑制できる", async () => {
  const html = await fs.readFile("public/index.html", "utf8");
  const css = await fs.readFile("public/style.css", "utf8");
  assert.match(css, /\.studioWorkspace\s*\{[\s\S]*?grid-template-columns:/);
  assert.match(html, /class="[^"]*studioPromptColumn[^"]*"[\s\S]*?class="studioPromptScroll"[\s\S]*?id="generateActions"/);
  assert.match(css, /\.studioPromptColumn\s*\{[\s\S]*?grid-template-rows:\s*minmax\(0,\s*1fr\)\s+auto;[\s\S]*?overflow:\s*hidden/);
  assert.match(css, /\.studioPromptScroll\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?overflow-y:\s*auto/);
  assert.match(css, /\.generateActions\s*\{[\s\S]*?position:\s*static/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.generateActions\s*\{[\s\S]*?position: fixed/);
  assert.match(css, /bottom: calc\(var\(--mobile-nav-height\) \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("v3生成画面はviewport全幅・中央優先の3カラムを使う", async () => {
  const html = await fs.readFile("public/index.html", "utf8");
  const css = await fs.readFile("public/style.css", "utf8");
  const app = await fs.readFile("public/app.js", "utf8");

  assert.match(css, /\.shell\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*none/);
  assert.match(css, /\.studioWorkspace\s*\{[\s\S]*?minmax\(340px,\s*350px\)[\s\S]*?minmax\(0,\s*1fr\)[\s\S]*?minmax\(280px,\s*300px\)/);
  assert.match(css, /body\s*\{[\s\S]*?font-size:\s*14px/);
  assert.match(css, /\.promptFieldBlock textarea\s*\{[\s\S]*?min-height:\s*84px/);
  assert.match(css, /\.studioRecentCard img\s*\{[\s\S]*?width:\s*76px;[\s\S]*?height:\s*88px/);
  assert.match(html, /<details class="studioInspectorSection studioMetadataSection" open>/);
  assert.match(html, /id="studioMetaDetailsTab"[\s\S]*?id="studioMetaParametersTab"[\s\S]*?id="studioMetaPromptTab"/);
  assert.match(app, /setStudioInspection\(generation, image, \{ showOnCanvas: true \}\)/);
  assert.match(app, /if \(showOnCanvas\)[\s\S]*?studioMainImage\.src = originalImageUrl\(image\)/);
});

test("生成画面のメイン画像は残余行を使い、操作・Seed・バリエーションを統合する", async () => {
  const html = await fs.readFile("public/index.html", "utf8");
  const app = await fs.readFile("public/app.js", "utf8");
  const css = await fs.readFile("public/style.css", "utf8");

  assert.doesNotMatch(html, /studioMainDownload/);
  assert.doesNotMatch(app, /studioMainDownload/);
  assert.match(html, /id="downloadLink" class="downloadButton" download/);
  assert.match(app, /elements\.downloadLink\.href = originalImageUrl\(finished\)/);
  assert.match(
    html,
    /id="studioMainImage"[\s\S]*?class="studioMainActions"[\s\S]*?id="candidateSection"/
  );
  assert.doesNotMatch(html, /selectedSeedText/);
  assert.doesNotMatch(app, /selectedSeedText/);
  assert.doesNotMatch(css, /studioSelectionStatus/);
  assert.doesNotMatch(css, /#studioMainImage,\s*#resultImage/);
  assert.match(
    css,
    /@media \(min-width: 901px\)[\s\S]*?\.studioCanvasColumn\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-rows:\s*auto minmax\(0, 1fr\)/
  );
  assert.match(
    css,
    /#resultContent:not\(\.hidden\):has\(\.studioMainPreview:not\(\.hidden\)\)\s*\{[\s\S]*?grid-template-rows:\s*minmax\(0, 1fr\) auto auto/
  );
  assert.match(
    css,
    /#resultContent:not\(\.hidden\):has\(\.studioMainPreview:not\(\.hidden\)\) #studioMainImage\s*\{[\s\S]*?height:\s*100%;[\s\S]*?max-height:\s*none;[\s\S]*?object-fit:\s*contain/
  );
  assert.match(
    css,
    /\.studioWorkspace \.studioMainActions\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?grid-template-columns:\s*repeat\(6, minmax\(0, 1fr\)\)[\s\S]*?width:\s*min\(520px, calc\(100% - 16px\)\)[\s\S]*?height:\s*40px/
  );
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.studioMainActions > \* \{\s*flex:\s*1 1 calc\(50% - 6px\);/);
  assert.doesNotMatch(css, /grid-template-columns:\s*repeat\(7, minmax\(0, 1fr\)/);
  assert.match(css, /block-size:\s*clamp\(128px, 18dvh, 164px\)/);
  assert.match(app, /function syncStudioOutputStats\([\s\S]*?elements\.studioSeed\.textContent/);
  assert.match(app, /elements\.finishButton\.title = finishLabel/);
});

test("中央メイン画像は既存モーダルをクリック・Enter・Spaceで開く", async () => {
  const html = await fs.readFile("public/index.html", "utf8");
  const app = await fs.readFile("public/app.js", "utf8");
  const css = await fs.readFile("public/style.css", "utf8");

  assert.match(
    html,
    /<img\s+id="studioMainImage"[\s\S]*?tabindex="0"[\s\S]*?role="button"[\s\S]*?aria-label="選択画像を拡大"/
  );
  assert.match(app, /elements\.studioMainImage\.addEventListener\("click", openStudioInspectionImage\)/);
  assert.match(app, /elements\.studioMainImage\.addEventListener\("keydown", handleStudioMainImageKey\)/);
  assert.match(
    app,
    /function handleStudioMainImageKey\(event\)\s*\{[\s\S]*?event\.key !== "Enter"[\s\S]*?isSpace[\s\S]*?event\.preventDefault\(\)[\s\S]*?event\.repeat[\s\S]*?openStudioInspectionImage\(\)/
  );
  assert.match(
    app,
    /function openStudioInspectionImage\(\)[\s\S]*?originalImageUrl\(image\)[\s\S]*?generationTitle\(generation\)[\s\S]*?openImageModal/
  );
  assert.doesNotMatch(html, /id="studioMainZoomButton"/);
  assert.doesNotMatch(app, /studioMainZoomButton/);
  assert.doesNotMatch(css, /studioMainZoomButton/);
  assert.match(app, /overlay\.addEventListener\("click", \(event\) => \{[\s\S]*?event\.target === overlay[\s\S]*?closeImageModal\(\)/);
  assert.match(app, /function handleImageModalKey\(event\)\s*\{\s*if \(event\.key === "Escape"\) closeImageModal\(\);/);
  assert.match(app, /image\.addEventListener\("click", \(\) => selectCandidate\(candidate, card\)\)/);
});

test("右カラムは履歴リストだけをスクロールし、詳細パネルと通常フローで分離する", async () => {
  const html = await fs.readFile("public/index.html", "utf8");
  const css = await fs.readFile("public/style.css", "utf8");
  assert.match(html, /class="studioInspectorSection studioHistorySection"[\s\S]*?class="studioHistoryHeader"[\s\S]*?id="studioRecentList"/);
  assert.match(css, /\.studioInspector\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-rows:\s*minmax\(0,\s*1fr\)\s*clamp\(300px,\s*38%,\s*340px\)/);
  assert.match(css, /\.studioHistorySection\s*\{[\s\S]*?grid-template-rows:\s*auto auto minmax\(0,\s*1fr\)/);
  assert.match(css, /\.studioRecentList\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?overflow-y:\s*auto/);
  assert.match(css, /\.studioMetadataSection\s*\{[\s\S]*?min-height:\s*300px;[\s\S]*?overflow:\s*hidden/);
  assert.match(css, /\.studioMetadataPanels\s*\{[\s\S]*?overflow-y:\s*auto;[\s\S]*?scrollbar-gutter:\s*stable/);
});

test("LoRA見出しは名称を含めず、件数だけを1行で固定する", async () => {
  const html = await fs.readFile("public/index.html", "utf8");
  const css = await fs.readFile("public/style.css", "utf8");
  const loraMarkup = html.match(/<details id="loraUseDetails"[\s\S]*?<\/details>/)?.[0] ?? "";
  const summaryMarkup = loraMarkup.match(/<summary>[\s\S]*?<\/summary>/)?.[0] ?? "";
  assert.doesNotMatch(summaryMarkup, /loraUseSummary/);
  assert.match(summaryMarkup, /<span>LoRA<\/span>[\s\S]*?id="loraUseCount"/);
  assert.match(loraMarkup, /<\/summary>[\s\S]*?id="loraUseSummary"/);
  assert.match(css, /\.studioLoraSection > summary\s*\{[\s\S]*?height:\s*44px;[\s\S]*?flex-wrap:\s*nowrap/);
  assert.match(css, /\.studioLoraSection > summary \.summaryCount\s*\{[\s\S]*?white-space:\s*nowrap/);
  assert.match(css, /\.usedLoraName\s*\{[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap/);
});

test("生成設定は左カラムだけで編集し、1行要約と中央ショートカットを持つ", async () => {
  const html = await fs.readFile("public/index.html", "utf8");
  const app = await fs.readFile("public/app.js", "utf8");
  const css = await fs.readFile("public/style.css", "utf8");

  const loraIndex = html.indexOf('id="loraUseDetails"');
  const settingsIndex = html.indexOf('id="generationSettingsDetails"');
  const actionsIndex = html.indexOf('class="generateActions"');
  assert.ok(loraIndex < settingsIndex && settingsIndex < actionsIndex);
  assert.match(html, /id="generationSettingsSummary"/);
  assert.match(html, /id="resolutionPreset"/);
  assert.match(html, /id="randomizeSeedButton"/);
  assert.match(html, /id="seedFixedToggle"/);
  assert.match(css, /\.generationSettingsSummary\s*\{[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap/);
  assert.match(app, /function syncGenerationSettingsSummary\(\)/);
  assert.match(app, /function focusGenerationSetting\(targetId\)/);
  assert.match(app, /generationSettingsDetails\.open = true/);

  const stats = html.match(/id="studioOutputStats"[\s\S]*?<\/div>/)?.[0] ?? "";
  for (const id of ["studioGenerationStatus", "studioResolution", "studioSeed", "studioSampler", "studioCfg", "studioSteps"]) {
    assert.ok(stats.includes(`id="${id}"`), `${id} should be in the center readout`);
  }
  assert.match(stats, /data-generation-setting-target="width"/);
  assert.match(stats, /data-generation-setting-target="seed"/);
  assert.match(stats, /data-generation-setting-target="samplerPickerButton"/);
});

test("右Detailsは生成済み画像の実績値を読み取り専用で表示する", async () => {
  const html = await fs.readFile("public/index.html", "utf8");
  const app = await fs.readFile("public/app.js", "utf8");
  const detailsPanel = html.match(/data-studio-meta-panel="details"[\s\S]*?<\/section>/)?.[0] ?? "";
  const parametersPanel = html.match(/data-studio-meta-panel="parameters"[\s\S]*?<\/section>/)?.[0] ?? "";

  for (const id of [
    "studioMetaResolution", "studioMetaSampler", "studioMetaSteps", "studioMetaCfg",
    "studioMetaSeed", "studioMetaModel", "studioMetaLoraCount", "studioMetaCreated", "studioMetaVram"
  ]) {
    assert.ok(detailsPanel.includes(`id="${id}"`), `${id} should be a Details value`);
  }
  const detailsValues = detailsPanel.match(/<dl class="studioMetadataGrid">[\s\S]*?<\/dl>/)?.[0] ?? "";
  assert.doesNotMatch(detailsValues, /<(input|select|button)\b/);
  for (const id of [
    "studioMetaCheckpoint", "studioMetaModelHash", "studioMetaParameterSampler",
    "studioMetaScheduler", "studioMetaParameterSteps", "studioMetaParameterCfg",
    "studioMetaParameterSeed", "studioMetaWidth", "studioMetaHeight", "studioMetaBatchCount",
    "studioMetaBatchSize", "studioMetaHires", "studioMetaDenoising", "studioMetaVae",
    "studioMetaClipSkip", "studioMetaLoras"
  ]) {
    assert.ok(parametersPanel.includes(`id="${id}"`), `${id} should be a Parameters value`);
  }
  assert.match(app, /setStudioMetadataValue\(elements\.studioMetaScheduler,\s*settings\.scheduler\)/);
});

test("右Promptは全文を折り返し、既存コピー形式を再利用する", async () => {
  const html = await fs.readFile("public/index.html", "utf8");
  const app = await fs.readFile("public/app.js", "utf8");
  const css = await fs.readFile("public/style.css", "utf8");
  const promptPanel = html.match(/data-studio-meta-panel="prompt"[\s\S]*?<\/section>/)?.[0] ?? "";

  assert.match(promptPanel, /id="studioMetaPositive"/);
  assert.match(promptPanel, /id="studioMetaNegative"/);
  assert.match(promptPanel, /id="studioCopyPromptButton"/);
  assert.match(promptPanel, /id="studioCopyNegativeButton"/);
  assert.match(promptPanel, /id="studioCopyMetadataButton"/);
  assert.match(app, /buildPromptText\(generation\)/);
  assert.match(app, /buildMetadataText\(generation,\s*image\)/);
  assert.match(css, /\.studioPromptReadout p\s*\{[\s\S]*?overflow-wrap:\s*anywhere;[\s\S]*?white-space:\s*pre-wrap/);
  assert.match(css, /\.studioMetadataGrid dd\s*\{[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap/);
});

test("生成画面は中央画像・履歴・フィルターで共通Favoriteを使う", async () => {
  const html = await fs.readFile("public/index.html", "utf8");
  const app = await fs.readFile("public/app.js", "utf8");

  assert.match(html, /id="studioMainFavoriteButton"[\s\S]*?aria-label="お気に入りに追加"/);
  assert.match(html, /id="studioHistoryAllButton"[\s\S]*?id="studioHistoryFavoriteButton"/);
  assert.match(app, /createFavoriteButton\(image,\s*\{\s*className:\s*"studioRecentFavorite"\s*\}\)/);
  assert.match(app, /event\.stopPropagation\(\)/);
  assert.match(app, /button\.setAttribute\("aria-label",\s*accessibleLabel\)/);
  assert.match(app, /favorites=1/);
  assert.match(app, /お気に入りの画像はまだありません/);
});

test("LoRAの基本Triggerと衣装プリセットを分離し、衣装は明示選択だけで送る", async () => {
  const app = await fs.readFile("public/app.js", "utf8");
  const editor = await fs.readFile("public/lora-editor.js", "utf8");

  assert.match(editor, /"キャラクター特徴のみ"/);
  assert.match(editor, /衣装プリセット/);
  assert.match(editor, /"プリセット追加"/);
  assert.match(editor, /"プリセット名"/);
  assert.match(editor, /"プリセット用プロンプト"/);
  assert.match(editor, /movePresetRow/);
  assert.match(editor, /characterTriggerWords:\s*fields\.characterTriggerWords\.value/);
  assert.match(editor, /outfitPresets:\s*collectOutfitPresets/);
  assert.match(app, /new Option\("衣装を指定しない",\s*""\)/);
  assert.match(app, /hasStructuredLoraPresets\(name\)[\s\S]*?\?\s*""/);
  assert.match(app, /基本セット: キャラクター特徴のみ/);
  assert.match(app, /targetField:\s*profile\?\.category === "direction" \? undefined : "character"/);
  assert.match(app, /appendTriggersToRawPrompt\(elements\.prompt\.value,\s*automaticRawLoraTriggers\(\)\)/);
  assert.match(app, /buildFinalPrompt\(readStructuredSections\(\),\s*activeAppliedTriggerWords\(\)\)/);
  assert.match(app, /enabled:\s*!disabledLoras\.has\(name\)/);
  assert.match(app, /characterTriggerWords:\s*resolveLoraBaseTriggerWords/);
  assert.match(app, /outfitChoiceId/);
  assert.match(app, /outfitTriggerWords/);
});

test("AI出力Importは編集中の内容を背景操作で閉じない", async () => {
  const app = await fs.readFile("public/app.js", "utf8");
  const uiKit = await fs.readFile("public/ui-kit.js", "utf8");
  const importModal = app.match(/function openAiPromptImport\(\)\s*\{[\s\S]*?\n\}/)?.[0] ?? "";

  assert.match(importModal, /openModal\(\{[\s\S]*?closeOnBackdrop:\s*false/);
  assert.match(uiKit, /closeOnBackdrop\s*=\s*true/);
  assert.match(uiKit, /if\s*\(closeOnBackdrop\)\s*\{[\s\S]*?event\.target\s*===\s*overlay/);
});

test("設定画面は既存設定をカテゴリ別の2カラムへ整理する", async () => {
  const html = await fs.readFile("public/index.html", "utf8");
  const app = await fs.readFile("public/app.js", "utf8");
  const css = await fs.readFile("public/style.css", "utf8");

  assert.match(css, /\.settingsLayout\s*\{[\s\S]*?grid-template-columns:\s*220px minmax\(0, 1fr\)[\s\S]*?min-width:\s*0/);
  assert.match(css, /\.settingsContent\s*\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*860px;[\s\S]*?min-width:\s*0/);
  assert.match(css, /@media \(max-width: 860px\)[\s\S]*?\.settingsCategoryNav\s*\{\s*display:\s*none;\s*\}[\s\S]*?\.settingsCategorySelectLabel\s*\{\s*display:\s*grid;\s*\}/);

  for (const category of ["general", "prompt", "model", "lora", "history", "discord", "connection", "details", "appInfo"]) {
    assert.match(html, new RegExp(`data-settings-category="${category}"`));
  }
  assert.doesNotMatch(html, /data-settings-category="appearance"/);
  assert.match(html, /id="settingsSearch"[^>]*type="search"/);
  assert.match(html, /id="settingsSearchResults"[^>]*hidden/);
  assert.match(html, /id="settingsCategorySelect"/);
  assert.match(html, /id="settingsReforgeStatus"[\s\S]*?id="settingsDiscordStatus"[\s\S]*?id="settingsUpdateStatus"/);

  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => id);
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  assert.deepEqual(duplicateIds, [], "all HTML ids must be unique");
  assert.match(html, /id="loraSyncNotice"/);
  assert.match(html, /id="settingsLoraSyncNotice"/);

  for (const id of [
    "titleGenerationDetails", "appManagementDetails", "checkpointDetails", "settingsLoraDetails",
    "civitaiDetails", "promptTemplateDetails", "discordDetails", "mobileAccessDetails", "updateDetails",
    "studioGenerationSettingsMount", "promptPartsDetails"
  ]) {
    assert.equal((html.match(new RegExp(`id="${id}"`, "g")) ?? []).length, 1, `${id} must be unique`);
  }
  const loraPanel = html.match(/<section id="settingsPanelLora"[\s\S]*?<\/section>/)?.[0] ?? "";
  assert.match(loraPanel, /id="settingsLoraDetails"/);
  assert.match(loraPanel, /id="civitaiDetails"/);

  assert.match(app, /function activateSettingsCategory\(categoryId[\s\S]*?panel\.hidden = !selected/);
  assert.match(app, /settingsCategoryNav\.addEventListener\("click"[\s\S]*?activateSettingsCategory/);
  assert.match(app, /settingsCategorySelect\.addEventListener\("change"[\s\S]*?activateSettingsCategory/);
  assert.match(app, /settingsSearchResults\.addEventListener\("click"[\s\S]*?targetId:\s*button\.dataset\.settingsSearchTarget/);
  assert.match(app, /function renderLoraSyncNotice\(messages\)[\s\S]*?elements\.loraSyncNotice[\s\S]*?elements\.settingsLoraSyncNotice/);
  assert.match(app, /SETTINGS_SEARCH_INDEX[\s\S]*?Checkpoint[\s\S]*?Webhook[\s\S]*?Tailscale[\s\S]*?衣装/);
  assert.match(app, /一致する設定がありません/);
  assert.match(app, /elements\.studioGenerationSettingsMount\.append\(elements\.promptPartsDetails\)/);

  for (const id of [
    "appManagementDetails", "promptPartsDetails", "checkpointDetails", "settingsLoraDetails",
    "titleGenerationDetails", "discordDetails", "mobileAccessDetails"
  ]) {
    assert.match(html, new RegExp(`id="${id}"[^>]*\\bopen(?:\\s|>)`), `${id} should be open on category entry`);
  }
  for (const id of ["civitaiDetails", "promptTemplateDetails", "updateDetails"]) {
    assert.doesNotMatch(html, new RegExp(`id="${id}"[^>]*\\bopen(?:\\s|>)`), `${id} should remain collapsible`);
  }
});

test("設定画面はTask 04/05の保存方式と既存イベントを維持する", async () => {
  const app = await fs.readFile("public/app.js", "utf8");
  const html = await fs.readFile("public/index.html", "utf8");

  assert.match(app, /localStorage\.getItem\(TITLE_STORAGE_KEYS\.mode/);
  assert.match(app, /localStorage\.setItem\(TITLE_STORAGE_KEYS\.mode/);
  assert.match(app, /localStorage\.setItem\(TITLE_STORAGE_KEYS\.template/);
  assert.match(app, /getJson\("\/api\/discord\/settings"\)/);
  assert.match(app, /patchJson\("\/api\/discord\/settings"/);
  assert.match(app, /postJson\("\/api\/discord\/test"/);
  assert.match(app, /elements\.saveDiscordSettingsButton\.addEventListener\("click", saveDiscordSettings\)/);
  assert.match(app, /elements\.sendDiscordTestButton\.addEventListener\("click", sendDiscordTestNotification\)/);
  assert.match(app, /activateSettingsCategory\("lora",\s*\{\s*targetId:\s*"settingsLoraDetails"/);
  assert.match(html, /id="discordDetails"[\s\S]*?id="discordGenerationAutoSend"[\s\S]*?id="saveDiscordSettingsButton"/);
  assert.match(html, /id="titleGenerationDetails"[\s\S]*?id="titleGenerationMode"[\s\S]*?id="titleTemplate"/);
});

test("Task25のLoRAブラウザーは共有ツリー・相対場所・狭幅導線を持つ", async () => {
  const html = await fs.readFile("public/index.html", "utf8");
  const app = await fs.readFile("public/app.js", "utf8");
  const css = await fs.readFile("public/style.css", "utf8");
  const catalog = await fs.readFile("public/preset-catalog.js", "utf8");

  const folderPane = html.match(/<aside id="loraFolderPane"[\s\S]*?id="loraFolderTree"[\s\S]*?\/aside>/)?.[0] ?? "";
  assert.match(folderPane, /id="openLoraRootButton"/);
  assert.match(folderPane, /role="tree"/);
  for (const id of ["loraFolderButton", "loraListBreadcrumb", "loraListCount"]) {
    assert.match(html, new RegExp(`id="${id}"`), `${id} should exist`);
  }
  assert.match(catalog, /export function buildLoraFolderTree\(items = \[\]\)/);
  assert.match(catalog, /export function filterItemsByFolder\(items = \[\], selectedFolder = ""\)/);
  assert.match(catalog, /export function formatLoraRelativeLocation\(item\)/);
  assert.match(app, /function renderLoraFolderTree\(container, items/);
  assert.match(app, /filterItemsByFolder\(installedLoras, selectedLoraFolder\)/);
  assert.match(app, /formatLoraRelativeLocation\(lora\)/);
  assert.match(app, /folderBrowser:\s*true/);
  assert.match(app, /function shouldUseLoraDetailModal\(\)/);
  assert.match(css, /\.loraWorkspace\s*\{[\s\S]*?minmax\(180px, 220px\)[\s\S]*?minmax\(280px, 1fr\)[\s\S]*?minmax\(280px, 1fr\)/);
  assert.match(css, /\.loraPickerBody \.pickerThumb img\s*\{\s*object-fit:\s*contain/);
  assert.match(css, /@media \(max-width: 1099px\)[\s\S]*?\.loraFolderPane,[\s\S]*?\.loraPreview\s*\{\s*display:\s*none/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.loraToolbar\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
});
