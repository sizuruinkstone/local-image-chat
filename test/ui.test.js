import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("ブラウザコードが参照する要素IDをHTMLがすべて持つ", async () => {
  const [html, app] = await Promise.all([
    fs.readFile("public/index.html", "utf8"),
    fs.readFile("public/app.js", "utf8")
  ]);
  const start = app.indexOf("[", app.indexOf("const elements"));
  const end = app.indexOf("].map((id)", start);
  assert.ok(start >= 0 && end > start);

  const ids = [...app.slice(start, end).matchAll(/"([A-Za-z][A-Za-z0-9]+)"/g)]
    .map((match) => match[1]);
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
