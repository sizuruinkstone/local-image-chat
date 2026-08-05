import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import {
  THUMBNAIL_LONG_EDGE,
  THUMBNAIL_QUALITY,
  createThumbnailService
} from "../src/thumbnails.js";

test("WebPサムネイルを384px・アスペクト比維持で生成する", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lic-thumbnails-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const source = path.join(directory, "wide.png");
  await sharp({
    create: { width: 1200, height: 600, channels: 4, background: { r: 20, g: 40, b: 80, alpha: 0.5 } }
  }).png().toFile(source);

  const service = createThumbnailService({ outputDir: directory });
  const generated = await service.ensure({ id: "image-0001", filename: "wide.png" });
  const metadata = await sharp(await fs.readFile(generated.thumbnailPath)).metadata();

  assert.equal(THUMBNAIL_LONG_EDGE, 384);
  assert.equal(THUMBNAIL_QUALITY, 76);
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 384);
  assert.equal(metadata.height, 192);
  assert.equal(metadata.hasAlpha, true);
});

test("既存サムネイルを再生成せず、同時要求を1ファイルへ集約する", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lic-thumbnails-cache-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  await sharp({
    create: { width: 800, height: 1200, channels: 3, background: "#884422" }
  }).png().toFile(path.join(directory, "portrait.png"));
  const service = createThumbnailService({ outputDir: directory });
  const image = { id: "image-0002", filename: "portrait.png" };

  const results = await Promise.all(Array.from({ length: 8 }, () => service.ensure(image)));
  assert.equal(new Set(results.map((item) => item.thumbnailPath)).size, 1);
  assert.equal((await fs.readdir(path.join(directory, "thumbnails"))).length, 1);
  const before = await fs.stat(results[0].thumbnailPath);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const cached = await service.ensure(image);
  const after = await fs.stat(cached.thumbnailPath);
  assert.equal(cached.created, false);
  assert.equal(after.mtimeMs, before.mtimeMs);
});

test("0バイトまたはWebPでないキャッシュは原画像から再生成する", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lic-thumbnails-repair-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const source = path.join(directory, "repair.png");
  await sharp({
    create: { width: 640, height: 320, channels: 3, background: "#336699" }
  }).png().toFile(source);

  const service = createThumbnailService({ outputDir: directory });
  for (const [index, invalidContent] of [Buffer.alloc(0), Buffer.from("not a webp")].entries()) {
    const image = { id: `image-repair-${String(index).padStart(4, "0")}`, filename: "repair.png" };
    const { thumbnailPath } = service.pathsFor(image);
    await fs.mkdir(path.dirname(thumbnailPath), { recursive: true });
    await fs.writeFile(thumbnailPath, invalidContent);
    const generated = await service.ensure(image);
    assert.equal(generated.created, true);
    const metadata = await sharp(await fs.readFile(generated.thumbnailPath)).metadata();
    assert.equal(metadata.format, "webp");
    assert.ok((await fs.stat(generated.thumbnailPath)).size > 12);
  }
});

test("日本語・空白・括弧・#・%・長い名前と異なる拡張子を扱える", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lic-thumbnails-names-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const service = createThumbnailService({ outputDir: directory });
  const filenames = [
    "日本語 画像 (sample) #100%.png",
    `${"長い名前".repeat(30)}.jpg`,
    "spaced sample.jpeg"
  ];

  for (const [index, filename] of filenames.entries()) {
    const source = path.join(directory, filename);
    const pipeline = sharp({
      create: { width: 320 + index, height: 200, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 0.5 } }
    });
    if ([".jpg", ".jpeg"].includes(path.extname(filename))) await pipeline.jpeg().toFile(source);
    else await pipeline.png().toFile(source);

    const generated = await service.ensure({
      id: `image-special-${String(index).padStart(4, "0")}`,
      filename
    });
    const metadata = await sharp(await fs.readFile(generated.thumbnailPath)).metadata();
    assert.equal(metadata.format, "webp");
    assert.ok(metadata.width <= 384);
    assert.ok(metadata.height <= 384);
  }
});

test("原画像なし・破損画像・不正パスを拒否する", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lic-thumbnails-errors-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const service = createThumbnailService({ outputDir: directory });
  await fs.writeFile(path.join(directory, "broken.png"), "not an image");

  await assert.rejects(
    () => service.ensure({ id: "image-0003", filename: "missing.png" }),
    (error) => error?.code === "ENOENT"
  );
  await assert.rejects(() => service.ensure({ id: "image-0004", filename: "broken.png" }));
  await assert.rejects(
    () => service.ensure({ id: "image-0005", filename: "../secret.png" }),
    /ファイル名が不正/
  );
  await assert.rejects(
    () => service.ensure({ id: "image-0006", filename: "vector.svg" }),
    /ファイル名が不正/
  );
});
