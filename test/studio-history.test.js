import test from "node:test";
import assert from "node:assert/strict";

import {
  STUDIO_HISTORY_FILTERS,
  filterStudioHistoryEntries,
  normalizeStudioHistoryFilter
} from "../public/studio-history.js";

const entries = [
  { image: { id: "first", favorite: false } },
  { image: { id: "second", favorite: true } },
  { image: { id: "third", favorite: true } }
];

test("生成画面の履歴は元の順序を維持してFavoriteだけを絞り込む", () => {
  assert.deepEqual(
    filterStudioHistoryEntries(entries, STUDIO_HISTORY_FILTERS.favorite).map((entry) => entry.image.id),
    ["second", "third"]
  );
  assert.deepEqual(
    filterStudioHistoryEntries(entries, STUDIO_HISTORY_FILTERS.all).map((entry) => entry.image.id),
    ["first", "second", "third"]
  );
});

test("未知のフィルターと不正な入力は安全にすべて表示へ戻す", () => {
  assert.equal(normalizeStudioHistoryFilter("broken"), STUDIO_HISTORY_FILTERS.all);
  assert.deepEqual(filterStudioHistoryEntries(null, "favorite"), []);
  assert.deepEqual(filterStudioHistoryEntries(entries, "broken"), entries);
});

test("Favoriteが0件なら空配列を返す", () => {
  assert.deepEqual(
    filterStudioHistoryEntries(
      [{ image: { id: "only", favorite: false } }],
      STUDIO_HISTORY_FILTERS.favorite
    ),
    []
  );
});
