import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

async function readElementIds() {
  const app = await fs.readFile("public/app.js", "utf8");
  const start = app.indexOf("[", app.indexOf("const elements"));
  const end = app.indexOf("].map((id)", start);
  assert.ok(start >= 0 && end > start);
  return {
    app,
    ids: [...app.slice(start, end).matchAll(/"([A-Za-z][A-Za-z0-9]+)"/g)].map((match) => match[1])
  };
}

// elementsに無いキーへdotアクセスすると起動時にundefinedとなり画面全体が止まるため、
// 参照側と一覧側の食い違いをテストで防ぐ。
test("app.jsが参照するelementsのキーは一覧に登録されている", async () => {
  const { app, ids } = await readElementIds();
  const used = [...new Set([...app.matchAll(/elements\.([A-Za-z][A-Za-z0-9]*)/g)].map((match) => match[1]))];
  assert.deepEqual(used.filter((key) => !ids.includes(key)), []);
});

test("ブラウザコードが参照する要素IDをHTMLがすべて持つ", async () => {
  const [html, { ids }] = await Promise.all([
    fs.readFile("public/index.html", "utf8"),
    readElementIds()
  ]);
  assert.equal(new Set(ids).size, ids.length, "elements一覧に重複IDがある");

  const missing = ids.filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(missing, []);
  for (const id of [
    "inpaintModeButton", "inpaintBaseImage", "inpaintMaskCanvas",
    "maskPaintButton", "maskEraseButton", "maskUndoButton", "maskRedoButton",
    "maskClearButton", "inpaintDenoising", "maskBlur", "inpaintFullRes"
  ]) {
    assert.ok(ids.includes(id), `${id}がブラウザ要素一覧にない`);
  }
});
