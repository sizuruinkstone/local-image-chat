import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("ギャラリーは20件ページング・サムネイル・遅延読込を使う", async () => {
  const [app, compare, html] = await Promise.all([
    fs.readFile("public/app.js", "utf8"),
    fs.readFile("public/compare-view.js", "utf8"),
    fs.readFile("public/index.html", "utf8")
  ]);

  assert.match(app, /const HISTORY_PAGE_SIZE = 20/);
  assert.doesNotMatch(app, /\/api\/history\?limit=200/);
  const delivery = await fs.readFile("public/image-delivery.js", "utf8");
  assert.match(app, /configureThumbnailImage\(preview, image/);
  assert.match(delivery, /imageElement\.loading = eager \? "eager" : "lazy"/);
  assert.match(delivery, /imageElement\.decoding = "async"/);
  assert.match(delivery, /const thumbnailUrl = thumbnailImageUrl\(image\)/);
  assert.match(app, /openImageModal\(originalImageUrl\(image\)/);
  assert.doesNotMatch(app, /imageUrl\}\?t=\$\{Date\.now\(\)\}/);
  assert.match(html, /id="historyLoadMoreButton"/);

  assert.match(compare, /configureThumbnailImage\(image, entry\.image\)/);
  assert.match(compare, /原寸で比較/);
  assert.match(compare, /for \(const pane of panes\)/, "原寸は選択画像を順番に読み込む");
});

test("サムネイル失敗時は原寸へ1回だけフォールバックする", async () => {
  const delivery = await fs.readFile("public/image-delivery.js", "utf8");
  assert.match(delivery, /stage === "thumbnail"/);
  assert.match(delivery, /originalFallback = "true"/);
  assert.match(delivery, /stage === "placeholder"/);
  assert.match(delivery, /image-placeholder\.svg/);
});
