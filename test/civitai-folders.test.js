import assert from "node:assert/strict";
import test from "node:test";
import {
  NEW_FOLDER_VALUE,
  buildFolderGroups,
  isFavoriteFolder,
  normalizeFolderMemory,
  pickInitialFolder,
  rememberRecentFolder,
  toggleFavoriteFolder
} from "../public/civitai-folders.js";

const FOLDERS = ["Anime", "Anime/Character", "Anime/Style", "Illustrious/Character"];
const RECOMMENDED = {
  character: { folder: "Anime/Character", exists: true },
  style: { folder: "Anime/Style", exists: true },
  body: { folder: "Body", exists: false },
  pose: { folder: "Pose", exists: false }
};

function groupLabels(groups) {
  return groups.map((group) => group.label);
}

function allOptions(groups) {
  return groups.flatMap((group) => group.options);
}

test("実在しないCharactersが既存フォルダ一覧へ混ざらない", () => {
  const groups = buildFolderGroups({
    folders: FOLDERS,
    recommended: { character: { folder: "Characters", exists: false } },
    category: "character"
  });
  const existing = groups.find((group) => group.label === "既存フォルダ");
  assert.deepEqual(existing.options.map((option) => option.value), FOLDERS);
  const recommended = groups.find((group) => group.label === "推奨保存先");
  assert.equal(recommended.options[0].value, "Characters");
  assert.equal(recommended.options[0].label, "推奨: Characters（新規作成）");
});

test("推奨保存先が実在すれば新規作成と表示しない", () => {
  const groups = buildFolderGroups({ folders: FOLDERS, recommended: RECOMMENDED, category: "style" });
  const recommended = groups.find((group) => group.label === "推奨保存先");
  assert.equal(recommended.options[0].label, "推奨: Anime/Style");
  // 推奨に昇格したフォルダは既存フォルダ側へ重複表示しない
  const existing = groups.find((group) => group.label === "既存フォルダ");
  assert.equal(existing.options.some((option) => option.value === "Anime/Style"), false);
});

test("グループ順は前回使用・お気に入り・推奨・既存・新規作成", () => {
  const groups = buildFolderGroups({
    folders: FOLDERS,
    recommended: RECOMMENDED,
    recent: ["Illustrious/Character"],
    favorites: ["Anime/Style"],
    category: "character"
  });
  assert.deepEqual(groupLabels(groups), [
    "前回使用した保存先", "お気に入り保存先", "推奨保存先", "既存フォルダ", "その他"
  ]);
  // 同じフォルダは上位グループへ1回だけ出す（selectで重複させない）
  assert.equal(allOptions(groups).filter((option) => option.value === "Anime/Style").length, 1);
  assert.equal(allOptions(groups).at(-1).value, NEW_FOLDER_VALUE);
});

test("character / style / body / pose すべてで推奨保存先を選べる", () => {
  for (const category of ["character", "style", "body", "pose"]) {
    const groups = buildFolderGroups({ folders: FOLDERS, recommended: RECOMMENDED, category });
    const recommended = groups.find((group) => group.label === "推奨保存先");
    assert.ok(recommended?.options.length, `${category}の推奨保存先がない`);
  }
});

test("前回使用した保存先を復元する", () => {
  const remembered = rememberRecentFolder({}, "character", "Anime/Character");
  assert.deepEqual(remembered.character, ["Anime/Character"]);
  const initial = pickInitialFolder({
    folders: FOLDERS,
    recommended: RECOMMENDED,
    recent: remembered.character,
    category: "character"
  });
  assert.equal(initial, "Anime/Character");
});

test("最近使った保存先は分類ごとに3件までで新しい順", () => {
  let memory = {};
  for (const folder of ["A/1", "A/2", "A/3", "A/4"]) {
    memory = rememberRecentFolder(memory, "style", folder);
  }
  assert.deepEqual(memory.style, ["A/4", "A/3", "A/2"]);
  memory = rememberRecentFolder(memory, "style", "A/3");
  assert.deepEqual(memory.style, ["A/3", "A/4", "A/2"]);
});

test("壊れた保存先履歴を安全に正規化する", () => {
  const memory = normalizeFolderMemory({ character: ["  Anime\\Character  ", "", null], junk: 1 });
  assert.deepEqual(memory.character, ["Anime/Character"]);
  assert.deepEqual(memory.style, []);
  assert.equal("junk" in memory, false);
});

test("お気に入り保存先を登録・解除して復元する", () => {
  let favorites = toggleFavoriteFolder([], "Anime/Style");
  assert.deepEqual(favorites, ["Anime/Style"]);
  assert.equal(isFavoriteFolder(favorites, "anime/style"), true);
  const groups = buildFolderGroups({ folders: FOLDERS, recommended: RECOMMENDED, favorites, category: "character" });
  assert.equal(groups.find((group) => group.label === "お気に入り保存先").options[0].value, "Anime/Style");
  favorites = toggleFavoriteFolder(favorites, "Anime/Style");
  assert.deepEqual(favorites, []);
});

test("新しいフォルダを作成の選択肢が常に存在する", () => {
  const groups = buildFolderGroups({ folders: [], recommended: {}, category: "pose" });
  assert.equal(allOptions(groups).some((option) => option.value === NEW_FOLDER_VALUE), true);
});
