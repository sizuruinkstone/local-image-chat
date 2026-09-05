import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { JsonStore } from "./json-store.js";

export const REFERENCE_ASSET_KIND = "reference-asset";
export const REFERENCE_ASSET_MAX_RAW_BYTES = 12 * 1024 * 1024;
export const REFERENCE_ASSET_MAX_SIDE = 8192;
export const REFERENCE_ASSET_MAX_PIXELS = 40_000_000;
export const REFERENCE_ASSET_THUMBNAIL_SIDE = 512;
export const REFERENCE_ASSET_MIME_TYPES = Object.freeze([
  "image/png",
  "image/jpeg",
  "image/webp"
]);

const MIME_TO_EXTENSION = Object.freeze({
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp"
});
const NORMALIZED_MIME_TYPE = "image/png";
const REGISTRY_SCHEMA_VERSION = 1;
const ASSET_DIRECTORY = ".reference-assets";
const ORIGINAL_DIRECTORY = "originals";
const THUMBNAIL_DIRECTORY = "thumbnails";
const SAFE_RELATIVE_PATH = /^\.reference-assets\/(?:originals|thumbnails)\/[A-Za-z0-9-]{8,80}\.(?:png|webp)$/;

export class ReferenceAssetError extends Error {
  constructor(code, message, statusCode = 400, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "ReferenceAssetError";
    this.code = code;
    this.apiCode = code;
    this.statusCode = statusCode;
  }
}

export function normalizeReferenceAssetMimeType(value) {
  if (typeof value !== "string") return "";
  return value.split(";", 1)[0].trim().toLowerCase();
}

export function isReferenceAssetId(value) {
  return typeof value === "string" && /^asset-[a-z0-9-]{8,80}$/i.test(value);
}

export function createReferenceAssetService({
  outputDir,
  dataDir,
  now = () => new Date(),
  randomUUID = () => crypto.randomUUID(),
  writeFileAtomicallyImpl = writeFileAtomically
}) {
  const resolvedOutputDir = path.resolve(outputDir);
  const resolvedDataDir = path.resolve(dataDir);
  const assetRoot = path.join(resolvedOutputDir, ASSET_DIRECTORY);
  const originalsDir = path.join(assetRoot, ORIGINAL_DIRECTORY);
  const thumbnailsDir = path.join(assetRoot, THUMBNAIL_DIRECTORY);
  const registryPath = path.join(resolvedDataDir, "reference-assets.json");
  const store = new JsonStore(registryPath, {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    assets: []
  });

  async function ensureStorage() {
    try {
      await ensureDirectory(resolvedOutputDir);
      await ensureDirectory(assetRoot);
      await ensureDirectory(originalsDir);
      await ensureDirectory(thumbnailsDir);
      await fs.mkdir(resolvedDataDir, { recursive: true });
      await ensureDirectory(resolvedDataDir);
    } catch (error) {
      if (error instanceof ReferenceAssetError) throw error;
      throw new ReferenceAssetError(
        "ASSET_SAVE_FAILED",
        "参照画像の保存先を準備できません",
        500,
        error
      );
    }
  }

  async function importBuffer(bytes, { mimeType } = {}) {
    const input = toBuffer(bytes);
    if (!input) {
      throw new ReferenceAssetError(
        "INVALID_REQUEST",
        "参照画像はraw image bytesで送信してください",
        400
      );
    }
    const normalizedMimeType = normalizeReferenceAssetMimeType(mimeType);
    if (!REFERENCE_ASSET_MIME_TYPES.includes(normalizedMimeType)) {
      throw new ReferenceAssetError(
        "UNSUPPORTED_IMAGE_TYPE",
        "PNG・JPEG・WebPだけを参照画像として利用できます",
        415
      );
    }
    if (input.length === 0) {
      throw new ReferenceAssetError("INVALID_IMAGE", "参照画像が空です", 400);
    }
    if (input.length > REFERENCE_ASSET_MAX_RAW_BYTES) {
      throw new ReferenceAssetError(
        "ASSET_TOO_LARGE",
        "参照画像は12MiB以下にしてください",
        413
      );
    }
    if (!matchesImageContainer(input, normalizedMimeType)) {
      throw new ReferenceAssetError("INVALID_IMAGE", "参照画像の形式を確認できません", 400);
    }

    const normalized = await normalizeImage(input);
    await ensureStorage();
    let result = null;
    const createdPaths = [];
    try {
      await store.update(async (data) => {
        const registry = normalizeRegistry(data);
        const existing = registry.assets.find((item) => item.contentSha256 === normalized.contentSha256);
        const record = existing ?? createRecord(normalized, randomUUID, now);
        const originalPath = resolveRegistryPath(record.originalPath, ORIGINAL_DIRECTORY);
        const thumbnailPath = resolveRegistryPath(record.thumbnailPath, THUMBNAIL_DIRECTORY);

        if (!await isRegularAssetFile(originalPath)) {
          const created = await writeFileAtomicallyImpl(originalPath, normalized.original);
          if (created) createdPaths.push(originalPath);
        }
        if (!await isRegularAssetFile(thumbnailPath)) {
          const created = await writeFileAtomicallyImpl(thumbnailPath, normalized.thumbnail);
          if (created) createdPaths.push(thumbnailPath);
        }

        if (!existing) registry.assets.push(record);
        result = toPublicAsset(record);
        return registry;
      });
    } catch (error) {
      await Promise.all(createdPaths.map((filePath) => fs.rm(filePath, { force: true }).catch(() => {})));
      await fs.rm(`${registryPath}.${process.pid}.tmp`, { force: true }).catch(() => {});
      if (error instanceof ReferenceAssetError) throw error;
      throw new ReferenceAssetError(
        "ASSET_SAVE_FAILED",
        "参照画像を保存できません",
        500,
        error
      );
    }
    return result;
  }

  async function getAsset(id) {
    const record = await loadRecord(id);
    return toPublicAsset(record);
  }

  async function resolveAssetPath(id, variant = "original") {
    const record = await loadRecord(id);
    const relativePath = variant === "thumbnail" ? record.thumbnailPath : record.originalPath;
    const expectedDirectory = variant === "thumbnail" ? THUMBNAIL_DIRECTORY : ORIGINAL_DIRECTORY;
    const resolved = resolveRegistryPath(relativePath, expectedDirectory);
    await assertRegularAssetFile(resolved);
    return resolved;
  }

  async function readOriginalBuffer(id) {
    return fs.readFile(await resolveAssetPath(id, "original"));
  }

  async function resolveReferenceImage(id) {
    const record = await loadRecord(id);
    const buffer = await fs.readFile(await resolveAssetPath(id, "original"));
    return {
      imageId: record.id,
      kind: REFERENCE_ASSET_KIND,
      mimeType: NORMALIZED_MIME_TYPE,
      extension: "png",
      buffer,
      imageUrl: `/api/images/${encodeURIComponent(record.id)}/original`,
      thumbnailUrl: `/api/images/${encodeURIComponent(record.id)}/thumbnail`,
      uploaded: false
    };
  }

  async function hasAsset(id) {
    try {
      await loadRecord(id);
      return true;
    } catch (error) {
      if (error?.code === "ASSET_NOT_FOUND") return false;
      throw error;
    }
  }

  return {
    ensureStorage,
    importBuffer,
    getAsset,
    hasAsset,
    resolveAssetPath,
    readOriginalBuffer,
    resolveReferenceImage,
    assetRoot,
    registryPath
  };

  async function loadRecord(id) {
    if (!isReferenceAssetId(id)) {
      throw new ReferenceAssetError("ASSET_NOT_FOUND", "参照画像が見つかりません", 404);
    }
    let data;
    try {
      data = normalizeRegistry(await store.read());
    } catch (error) {
      throw new ReferenceAssetError(
        "ASSET_SAVE_FAILED",
        "参照画像の台帳を読み込めません",
        500,
        error
      );
    }
    const record = data.assets.find((item) => item.id === id);
    if (!record) throw new ReferenceAssetError("ASSET_NOT_FOUND", "参照画像が見つかりません", 404);
    return record;
  }

  function resolveRegistryPath(relativePath, expectedDirectory) {
    if (typeof relativePath !== "string"
      || !SAFE_RELATIVE_PATH.test(relativePath)
      || !relativePath.startsWith(`${ASSET_DIRECTORY}/${expectedDirectory}/`)) {
      throw new ReferenceAssetError("ASSET_SAVE_FAILED", "参照画像の保存先情報が不正です", 500);
    }
    const resolved = path.resolve(resolvedOutputDir, ...relativePath.split("/"));
    const relative = path.relative(resolvedOutputDir, resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new ReferenceAssetError("ASSET_SAVE_FAILED", "参照画像の保存先情報が不正です", 500);
    }
    return resolved;
  }
}

export function createReferenceImageResolver({ history, referenceAssets, resolveOutputImagePath }) {
  if (!history || typeof history.getImage !== "function") {
    throw new Error("History resolverが不正です");
  }
  if (typeof resolveOutputImagePath !== "function") {
    throw new Error("Output image resolverが不正です");
  }

  return async function resolveReferenceImage(imageId) {
    const id = String(imageId ?? "");
    if (!/^[a-z0-9-]{8,80}$/i.test(id)) {
      throw new ReferenceAssetError("ASSET_NOT_FOUND", "参照画像が見つかりません", 404);
    }
    if (isReferenceAssetId(id)) {
      if (!referenceAssets || typeof referenceAssets.resolveReferenceImage !== "function") {
        throw new ReferenceAssetError("ASSET_NOT_FOUND", "参照画像が見つかりません", 404);
      }
      return referenceAssets.resolveReferenceImage(id);
    }

    const image = await history.getImage(id);
    const filename = String(image?.filename ?? "");
    if (!filename || path.basename(filename) !== filename || /[\r\n]/.test(filename)) {
      throw new Error("IP-Adapter参照画像の保存先が不正です");
    }
    const extension = path.extname(filename).slice(1).toLowerCase().replace("jpeg", "jpg");
    if (!Object.hasOwn(MIME_TO_EXTENSION, `image/${extension === "jpg" ? "jpeg" : extension}`)) {
      throw new Error("履歴の参照画像形式に対応していません");
    }
    const buffer = await fs.readFile(resolveOutputImagePath(filename));
    const mimeType = extension === "jpg" ? "image/jpeg" : `image/${extension}`;
    return {
      imageId: id,
      kind: "history-image",
      mimeType,
      extension,
      buffer,
      imageUrl: `/outputs/${filename}`,
      thumbnailUrl: `/api/images/${encodeURIComponent(id)}/thumbnail`,
      uploaded: false
    };
  };
}

function createRecord(normalized, randomUUID, now) {
  const id = `asset-${String(randomUUID())}`;
  if (!isReferenceAssetId(id)) {
    throw new ReferenceAssetError("ASSET_SAVE_FAILED", "参照画像IDを作成できません", 500);
  }
  return {
    id,
    contentSha256: normalized.contentSha256,
    mimeType: NORMALIZED_MIME_TYPE,
    width: normalized.width,
    height: normalized.height,
    byteLength: normalized.original.length,
    createdAt: new Date(now()).toISOString(),
    originalPath: `${ASSET_DIRECTORY}/${ORIGINAL_DIRECTORY}/${id}.png`,
    thumbnailPath: `${ASSET_DIRECTORY}/${THUMBNAIL_DIRECTORY}/${id}.webp`
  };
}

function toPublicAsset(record) {
  return {
    id: record.id,
    kind: REFERENCE_ASSET_KIND,
    mimeType: record.mimeType,
    width: record.width,
    height: record.height,
    byteLength: record.byteLength,
    createdAt: record.createdAt,
    originalUrl: `/api/images/${encodeURIComponent(record.id)}/original`,
    thumbnailUrl: `/api/images/${encodeURIComponent(record.id)}/thumbnail`
  };
}

function normalizeRegistry(value) {
  const assets = Array.isArray(value?.assets)
    ? value.assets.map(normalizeRecord).filter(Boolean)
    : [];
  return { schemaVersion: REGISTRY_SCHEMA_VERSION, assets };
}

function normalizeRecord(value) {
  if (!value || !isReferenceAssetId(value.id)
    || typeof value.contentSha256 !== "string"
    || !/^[a-f0-9]{64}$/i.test(value.contentSha256)
    || value.mimeType !== NORMALIZED_MIME_TYPE
    || !Number.isInteger(value.width) || value.width < 1 || value.width > REFERENCE_ASSET_MAX_SIDE
    || !Number.isInteger(value.height) || value.height < 1 || value.height > REFERENCE_ASSET_MAX_SIDE
    || !Number.isSafeInteger(value.byteLength) || value.byteLength < 1
    || typeof value.createdAt !== "string"
    || !SAFE_RELATIVE_PATH.test(value.originalPath)
    || !SAFE_RELATIVE_PATH.test(value.thumbnailPath)) return null;
  return {
    id: value.id,
    contentSha256: value.contentSha256.toLowerCase(),
    mimeType: NORMALIZED_MIME_TYPE,
    width: value.width,
    height: value.height,
    byteLength: value.byteLength,
    createdAt: value.createdAt,
    originalPath: value.originalPath.replaceAll("\\", "/"),
    thumbnailPath: value.thumbnailPath.replaceAll("\\", "/")
  };
}

async function normalizeImage(input) {
  try {
    const image = sharp(input, {
      animated: false,
      failOn: "error",
      limitInputPixels: REFERENCE_ASSET_MAX_PIXELS
    });
    const metadata = await image.metadata();
    validateDimensions(metadata);
    if ((metadata.pages ?? 1) > 1) {
      throw new ReferenceAssetError("IMAGE_DECODE_FAILED", "アニメーション画像は参照できません", 422);
    }

    const original = await image.rotate().png({ compressionLevel: 9 }).toBuffer();
    const normalizedMetadata = await sharp(original, { failOn: "error" }).metadata();
    validateDimensions(normalizedMetadata);
    const thumbnail = await sharp(original, { failOn: "error" })
      .resize({
        width: REFERENCE_ASSET_THUMBNAIL_SIDE,
        height: REFERENCE_ASSET_THUMBNAIL_SIDE,
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .webp({ quality: 82, alphaQuality: 82, effort: 4 })
      .toBuffer();
    return {
      original,
      thumbnail,
      width: normalizedMetadata.width,
      height: normalizedMetadata.height,
      contentSha256: crypto.createHash("sha256").update(original).digest("hex")
    };
  } catch (error) {
    if (error instanceof ReferenceAssetError) throw error;
    throw new ReferenceAssetError("IMAGE_DECODE_FAILED", "参照画像をデコードできません", 422, error);
  }
}

function validateDimensions(metadata) {
  const width = Number(metadata?.width);
  const height = Number(metadata?.height);
  if (!Number.isInteger(width) || !Number.isInteger(height)
    || width < 1 || height < 1
    || width > REFERENCE_ASSET_MAX_SIDE
    || height > REFERENCE_ASSET_MAX_SIDE
    || width * height > REFERENCE_ASSET_MAX_PIXELS) {
    throw new ReferenceAssetError("IMAGE_DECODE_FAILED", "参照画像のサイズが上限を超えています", 422);
  }
}

function matchesImageContainer(buffer, mimeType) {
  if (mimeType === "image/png") return isPngMagic(buffer) && !hasPngTrailingData(buffer);
  if (mimeType === "image/jpeg") return isJpegMagic(buffer) && !hasJpegTrailingData(buffer);
  if (mimeType === "image/webp") return isWebpMagic(buffer) && !hasWebpTrailingData(buffer);
  return false;
}

function isPngMagic(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return buffer.length >= signature.length && buffer.subarray(0, 8).equals(signature);
}

function hasPngTrailingData(buffer) {
  if (!isPngMagic(buffer)) return false;
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const end = offset + 12 + length;
    if (end > buffer.length) return false;
    if (type === "IEND") return end !== buffer.length;
    offset = end;
  }
  return false;
}

function isJpegMagic(buffer) {
  return buffer.length >= 3
    && buffer[0] === 0xff
    && buffer[1] === 0xd8
    && buffer[2] === 0xff;
}

function hasJpegTrailingData(buffer) {
  const eoi = Buffer.from([0xff, 0xd9]);
  const index = buffer.lastIndexOf(eoi);
  return index >= 0 && index + eoi.length < buffer.length;
}

function isWebpMagic(buffer) {
  return buffer.length >= 12
    && buffer.subarray(0, 4).toString("ascii") === "RIFF"
    && buffer.subarray(8, 12).toString("ascii") === "WEBP";
}

function hasWebpTrailingData(buffer) {
  return isWebpMagic(buffer) && buffer.readUInt32LE(4) < buffer.length - 8;
}

function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  return null;
}

async function ensureDirectory(directory) {
  let stats;
  try {
    stats = await fs.lstat(directory);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await fs.mkdir(directory, { recursive: true });
    stats = await fs.lstat(directory);
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new ReferenceAssetError("ASSET_SAVE_FAILED", "参照画像の保存先が利用できません", 500);
  }
}

async function assertRegularAssetFile(filePath) {
  let current = filePath;
  for (;;) {
    let stats;
    try {
      stats = await fs.lstat(current);
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new ReferenceAssetError("ASSET_NOT_FOUND", "参照画像が見つかりません", 404);
      }
      throw error;
    }
    if (stats.isSymbolicLink()) {
      throw new ReferenceAssetError("ASSET_NOT_FOUND", "参照画像が見つかりません", 404);
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const stats = await fs.lstat(filePath);
  if (!stats.isFile()) throw new ReferenceAssetError("ASSET_NOT_FOUND", "参照画像が見つかりません", 404);
}

async function isRegularAssetFile(filePath) {
  try {
    await assertRegularAssetFile(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ASSET_NOT_FOUND") return false;
    throw error;
  }
}

async function writeFileAtomically(destination, bytes) {
  await ensureDirectory(path.dirname(destination));
  const temporaryPath = path.join(
    path.dirname(destination),
    `.local-image-chat-reference-${process.pid}-${crypto.randomUUID()}.tmp`
  );
  let renamed = false;
  try {
    await fs.writeFile(temporaryPath, bytes, { flag: "wx" });
    if (await pathExists(destination)) {
      throw new Error("参照画像の保存先がすでに存在します");
    }
    await fs.rename(temporaryPath, destination);
    renamed = true;
    return true;
  } finally {
    if (!renamed) await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
}

async function pathExists(filePath) {
  try {
    await fs.lstat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
