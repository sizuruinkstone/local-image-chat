import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import test from "node:test";
import {
  REFERENCE_ASSET_MAX_PIXELS,
  REFERENCE_ASSET_MAX_RAW_BYTES,
  createReferenceAssetService
} from "../src/reference-assets.js";
import { createAttachmentReader } from "../src/mcp/attachment-reader.js";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

test("Reference Asset Serviceは画像を正規化し、dedupeと安全なregistryを維持する", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "local-image-chat-reference-assets-"));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const outputDir = path.join(workspace, "outputs");
  const dataDir = path.join(workspace, "data");
  let uuidIndex = 0;
  const service = createReferenceAssetService({
    outputDir,
    dataDir,
    now: () => new Date("2026-08-11T00:00:00.000Z"),
    randomUUID: () => [
      "12345678-1234-4234-8234-123456789012",
      "22345678-1234-4234-8234-123456789012",
      "32345678-1234-4234-8234-123456789012"
    ][uuidIndex++] ?? "42345678-1234-4234-8234-123456789012"
  });
  const sourcePng = await sharp({
    create: { width: 3, height: 2, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } }
  }).png().toBuffer();
  const sourceJpeg = await sharp({
    create: { width: 4, height: 3, channels: 3, background: { r: 0, g: 255, b: 0 } }
  }).jpeg().toBuffer();
  const sourceWebp = await sharp({
    create: { width: 5, height: 4, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } }
  }).webp().toBuffer();

  const [png, jpeg, webp] = await Promise.all([
    service.importBuffer(sourcePng, { mimeType: "image/png" }),
    service.importBuffer(sourceJpeg, { mimeType: "image/jpeg" }),
    service.importBuffer(sourceWebp, { mimeType: "image/webp" })
  ]);
  assert.equal(png.kind, "reference-asset");
  assert.equal(png.mimeType, "image/png");
  assert.deepEqual([png.width, png.height], [3, 2]);
  assert.match(png.id, /^asset-[a-z0-9-]+$/);
  assert.notEqual(png.id, jpeg.id);
  assert.notEqual(jpeg.id, webp.id);

  const originalMetadata = await sharp(await fs.readFile(await service.resolveAssetPath(png.id))).metadata();
  const thumbnailMetadata = await sharp(await fs.readFile(await service.resolveAssetPath(png.id, "thumbnail"))).metadata();
  assert.equal(originalMetadata.format, "png");
  assert.deepEqual([originalMetadata.width, originalMetadata.height], [3, 2]);
  assert.equal(thumbnailMetadata.format, "webp");
  assert.ok(thumbnailMetadata.width <= 512 && thumbnailMetadata.height <= 512);
  assert.equal((await service.importBuffer(sourcePng, { mimeType: "image/png" })).id, png.id);

  const registryPath = path.join(dataDir, "reference-assets.json");
  const registryText = await fs.readFile(registryPath, "utf8");
  assert.match(registryText, /\.reference-assets[\\/]originals/);
  assert.doesNotMatch(registryText, /sourcePng|C:\\|base64|attachmentPath/);
  assert.equal(await hasTemporaryFiles(outputDir), false);
});

test("Reference Asset Serviceはdedupe時に既存保存物を再書込せず、新規保存失敗だけrollbackする", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "local-image-chat-reference-rollback-"));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const outputDir = path.join(workspace, "outputs");
  const dataDir = path.join(workspace, "data");
  const source = await sharp({
    create: { width: 2, height: 2, channels: 4, background: { r: 100, g: 140, b: 180, alpha: 1 } }
  }).png().toBuffer();
  const initial = createReferenceAssetService({ outputDir, dataDir });
  const imported = await initial.importBuffer(source, { mimeType: "image/png" });
  const originalPath = await initial.resolveAssetPath(imported.id, "original");
  const thumbnailPath = await initial.resolveAssetPath(imported.id, "thumbnail");
  const originalBefore = await fs.readFile(originalPath);
  const thumbnailBefore = await fs.readFile(thumbnailPath);
  const registryBefore = await fs.readFile(path.join(dataDir, "reference-assets.json"), "utf8");

  const reusedWithFailingWriter = createReferenceAssetService({
    outputDir,
    dataDir,
    writeFileAtomicallyImpl: async () => {
      throw new Error("既存Assetのdedupeでは保存処理を呼ばない");
    }
  });
  const reused = await reusedWithFailingWriter.importBuffer(source, { mimeType: "image/png" });
  assert.equal(reused.id, imported.id);
  assert.deepEqual(await fs.readFile(originalPath), originalBefore);
  assert.deepEqual(await fs.readFile(thumbnailPath), thumbnailBefore);
  assert.equal(await fs.readFile(path.join(dataDir, "reference-assets.json"), "utf8"), registryBefore);

  const failedWorkspace = path.join(workspace, "failed");
  const failingWriter = createFailureInjectingAtomicWriter(2);
  const failingService = createReferenceAssetService({
    outputDir: path.join(failedWorkspace, "outputs"),
    dataDir: path.join(failedWorkspace, "data"),
    writeFileAtomicallyImpl: failingWriter.write
  });
  await assert.rejects(
    failingService.importBuffer(source, { mimeType: "image/png" }),
    (error) => error.code === "ASSET_SAVE_FAILED"
  );
  assert.equal(failingWriter.calls(), 2);
  assert.equal(await hasTemporaryFiles(path.join(failedWorkspace, "outputs")), false);
  assert.equal(await fileExists(path.join(failedWorkspace, "outputs", ".reference-assets", "originals")), true);
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(failedWorkspace, "data", "reference-assets.json"), "utf8")),
    { schemaVersion: 1, assets: [] }
  );
  const failedOriginals = await fs.readdir(
    path.join(failedWorkspace, "outputs", ".reference-assets", "originals")
  );
  const failedThumbnails = await fs.readdir(
    path.join(failedWorkspace, "outputs", ".reference-assets", "thumbnails")
  );
  assert.deepEqual(failedOriginals, []);
  assert.deepEqual(failedThumbnails, []);
});

test("Reference Asset ServiceはEXIF orientation、境界値、magic mismatch、polyglotを拒否する", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "local-image-chat-reference-boundary-"));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const service = createReferenceAssetService({
    outputDir: path.join(workspace, "outputs"),
    dataDir: path.join(workspace, "data")
  });
  const oriented = await sharp({
    create: { width: 2, height: 3, channels: 3, background: { r: 20, g: 40, b: 60 } }
  }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const orientedAsset = await service.importBuffer(oriented, { mimeType: "image/jpeg" });
  assert.deepEqual([orientedAsset.width, orientedAsset.height], [3, 2]);

  await assert.rejects(
    service.importBuffer(Buffer.alloc(0), { mimeType: "image/png" }),
    (error) => error.code === "INVALID_IMAGE"
  );
  await assert.rejects(
    service.importBuffer(ONE_PIXEL_PNG, { mimeType: "image/jpeg" }),
    (error) => error.code === "INVALID_IMAGE"
  );
  await assert.rejects(
    service.importBuffer(Buffer.from("<svg><script>alert(1)</script></svg>"), { mimeType: "image/svg+xml" }),
    (error) => error.code === "UNSUPPORTED_IMAGE_TYPE"
  );
  await assert.rejects(
    service.importBuffer(Buffer.concat([ONE_PIXEL_PNG, Buffer.from("<html>polyglot</html>")]), { mimeType: "image/png" }),
    (error) => error.code === "INVALID_IMAGE"
  );
  await assert.rejects(
    service.importBuffer(Buffer.alloc(REFERENCE_ASSET_MAX_RAW_BYTES + 1), { mimeType: "image/png" }),
    (error) => error.code === "ASSET_TOO_LARGE"
  );

  const tooWide = await sharp({
    create: { width: 8193, height: 1, channels: 3, background: { r: 0, g: 0, b: 0 } }
  }).png().toBuffer();
  await assert.rejects(
    service.importBuffer(tooWide, { mimeType: "image/png" }),
    (error) => error.code === "IMAGE_DECODE_FAILED"
  );
  const tooManyPixels = await sharp({
    create: { width: 7000, height: 6000, channels: 3, background: { r: 0, g: 0, b: 0 } }
  }).png().toBuffer();
  assert.ok(7000 * 6000 > REFERENCE_ASSET_MAX_PIXELS);
  await assert.rejects(
    service.importBuffer(tooManyPixels, { mimeType: "image/png" }),
    (error) => error.code === "IMAGE_DECODE_FAILED"
  );
});

test("MCP attachment readerは明示allowlist、canonical path、通常ファイル、magic bytesだけを許可する", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "local-image-chat-attachment-reader-"));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const allowed = path.join(workspace, "allowed");
  const other = path.join(workspace, "other");
  await Promise.all([fs.mkdir(allowed), fs.mkdir(other)]);
  const imagePath = path.join(allowed, "attached.png");
  await fs.writeFile(imagePath, ONE_PIXEL_PNG);
  const reader = createAttachmentReader({
    env: { LOCAL_IMAGE_CHAT_IMPORT_ROOTS: allowed }
  });
  const attachment = await reader.read(imagePath);
  assert.equal(attachment.mimeType, "image/png");
  assert.deepEqual(attachment.bytes, ONE_PIXEL_PNG);

  await assert.rejects(
    reader.read(path.join(other, "outside.png")),
    (error) => error.code === "ATTACHMENT_PATH_NOT_ALLOWED"
      && !error.message.includes(allowed)
      && !error.message.includes(imagePath)
  );
  await assert.rejects(
    reader.read(path.join(allowed, "..", "other", "outside.png")),
    (error) => error.code === "ATTACHMENT_PATH_NOT_ALLOWED"
  );
  await assert.rejects(
    reader.read(path.join(allowed, "missing.png")),
    (error) => error.code === "ATTACHMENT_NOT_FOUND"
  );
  await assert.rejects(
    reader.read(allowed),
    (error) => error.code === "ATTACHMENT_NOT_A_FILE"
  );

  const secondReader = createAttachmentReader({
    env: { LOCAL_IMAGE_CHAT_IMPORT_ROOTS: `${other}${path.delimiter}${allowed}` }
  });
  assert.equal((await secondReader.read(imagePath)).mimeType, "image/png");
  await assert.rejects(
    createAttachmentReader({ env: {} }).read(imagePath),
    (error) => error.code === "ATTACHMENT_IMPORT_NOT_CONFIGURED"
  );
  await assert.rejects(
    createAttachmentReader({ env: { LOCAL_IMAGE_CHAT_IMPORT_ROOTS: "relative-only" } }).read(imagePath),
    (error) => error.code === "ATTACHMENT_IMPORT_NOT_CONFIGURED"
  );

  const unsupportedPath = path.join(allowed, "not-image.bin");
  await fs.writeFile(unsupportedPath, Buffer.from("MZ-not-an-image"));
  await assert.rejects(
    reader.read(unsupportedPath),
    (error) => error.code === "UNSUPPORTED_IMAGE_TYPE"
  );

  const symlinkPath = path.join(allowed, "link.png");
  try {
    await fs.symlink(imagePath, symlinkPath, "file");
    await assert.rejects(
      reader.read(symlinkPath),
      (error) => error.code === "ATTACHMENT_PATH_NOT_ALLOWED"
    );
  } catch (error) {
    assert.ok(["EPERM", "EACCES", "ENOTSUP"].includes(error?.code), `unexpected symlink setup error: ${error?.code}`);
  }
});

async function hasTemporaryFiles(root) {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.name.endsWith(".tmp")) return true;
    if (entry.isDirectory() && await hasTemporaryFiles(fullPath)) return true;
  }
  return false;
}

function createFailureInjectingAtomicWriter(failAt) {
  let calls = 0;
  return {
    calls: () => calls,
    async write(destination, bytes) {
      calls += 1;
      const temporaryPath = `${destination}.test-${calls}.tmp`;
      let renamed = false;
      try {
        await fs.writeFile(temporaryPath, bytes, { flag: "wx" });
        if (calls === failAt) throw new Error("injected asset save failure");
        await fs.rename(temporaryPath, destination);
        renamed = true;
        return true;
      } finally {
        if (!renamed) await fs.rm(temporaryPath, { force: true }).catch(() => {});
      }
    }
  };
}

async function fileExists(filePath) {
  try {
    await fs.lstat(filePath);
    return true;
  } catch {
    return false;
  }
}
