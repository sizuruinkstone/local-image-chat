import fs from "node:fs/promises";
import path from "node:path";
import {
  REFERENCE_ASSET_MAX_RAW_BYTES,
  normalizeReferenceAssetMimeType
} from "../reference-assets.js";

export class AttachmentReaderError extends Error {
  constructor(code, message, statusCode = null, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "AttachmentReaderError";
    this.code = code;
    this.status = Number.isInteger(statusCode) ? statusCode : null;
  }
}

export function parseImportRoots(value, pathDelimiter = path.delimiter) {
  if (typeof value !== "string" || !value.trim()) return [];
  return [...new Set(value
    .split(pathDelimiter)
    .map((item) => item.trim())
    .filter((item) => item && path.isAbsolute(item))
    .map((item) => path.resolve(item)))];
}

export function createAttachmentReader({
  env = process.env,
  maxBytes = REFERENCE_ASSET_MAX_RAW_BYTES,
  pathDelimiter = path.delimiter
} = {}) {
  const configuredValue = typeof env?.LOCAL_IMAGE_CHAT_IMPORT_ROOTS === "string"
    ? env.LOCAL_IMAGE_CHAT_IMPORT_ROOTS
    : "";
  const roots = parseImportRoots(configuredValue, pathDelimiter);
  const configured = roots.length > 0;

  async function read(attachmentPath) {
    if (!configured) {
      throw new AttachmentReaderError(
        "ATTACHMENT_IMPORT_NOT_CONFIGURED",
        "ローカルattachment取り込みが設定されていません",
        503
      );
    }
    const target = validateAttachmentPath(attachmentPath);
    const candidates = roots.filter((root) => isSamePath(root, target) || isLexicallyInside(root, target));
    if (!candidates.length) {
      throw new AttachmentReaderError(
        "ATTACHMENT_PATH_NOT_ALLOWED",
        "指定されたattachment pathは許可された取り込み範囲外です",
        403
      );
    }

    let missing = false;
    for (const root of candidates) {
      const result = await tryReadFromRoot(root, target, maxBytes);
      if (result) return result;
      missing = true;
    }
    if (missing) {
      throw new AttachmentReaderError(
        "ATTACHMENT_NOT_FOUND",
        "指定されたattachmentが見つかりません",
        404
      );
    }
    throw new AttachmentReaderError(
      "ATTACHMENT_PATH_NOT_ALLOWED",
      "指定されたattachment pathは許可された取り込み範囲外です",
      403
    );
  }

  return {
    read,
    roots: Object.freeze([...roots])
  };
}

async function tryReadFromRoot(root, target, maxBytes) {
  let rootStats;
  try {
    rootStats = await fs.lstat(root);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new AttachmentReaderError(
      "ATTACHMENT_PATH_NOT_ALLOWED",
      "許可されたattachment取り込み範囲を確認できません",
      403
    );
  }
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) return null;

  const rootRealPath = await safeRealpath(root);
  if (!rootRealPath) return null;

  let targetStats;
  try {
    targetStats = await fs.lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new AttachmentReaderError(
      "ATTACHMENT_PATH_NOT_ALLOWED",
      "attachment pathを確認できません",
      403
    );
  }
  if (targetStats.isSymbolicLink()) {
    throw new AttachmentReaderError(
      "ATTACHMENT_PATH_NOT_ALLOWED",
      "symlink経由のattachmentは許可されていません",
      403
    );
  }
  if (!targetStats.isFile()) {
    throw new AttachmentReaderError(
      "ATTACHMENT_NOT_A_FILE",
      "指定されたattachmentは通常ファイルではありません",
      400
    );
  }

  const targetRealPath = await safeRealpath(target);
  if (!targetRealPath || !isLexicallyInside(rootRealPath, targetRealPath)) {
    throw new AttachmentReaderError(
      "ATTACHMENT_PATH_NOT_ALLOWED",
      "symlinkまたはjunction経由のattachmentは許可されていません",
      403
    );
  }
  if (await hasLinkInParentPath(root, target)) {
    throw new AttachmentReaderError(
      "ATTACHMENT_PATH_NOT_ALLOWED",
      "symlinkまたはjunction経由のattachmentは許可されていません",
      403
    );
  }
  if (targetStats.size > maxBytes) {
    throw new AttachmentReaderError(
      "ATTACHMENT_TOO_LARGE",
      "attachmentは12MiB以下にしてください",
      413
    );
  }

  let bytes;
  try {
    bytes = await fs.readFile(target);
  } catch {
    throw new AttachmentReaderError(
      "ATTACHMENT_NOT_FOUND",
      "指定されたattachmentが見つかりません",
      404
    );
  }
  if (bytes.length > maxBytes) {
    throw new AttachmentReaderError(
      "ATTACHMENT_TOO_LARGE",
      "attachmentは12MiB以下にしてください",
      413
    );
  }
  const mimeType = detectImageMimeType(bytes);
  if (!mimeType) {
    throw new AttachmentReaderError(
      "UNSUPPORTED_IMAGE_TYPE",
      "PNG・JPEG・WebPだけをattachmentとして利用できます",
      415
    );
  }
  return { bytes, mimeType };
}

function validateAttachmentPath(value) {
  if (typeof value !== "string" || !value || value.length > 4096
    || !path.isAbsolute(value) || isUncPath(value) || hasTraversal(value)) {
    throw new AttachmentReaderError(
      "ATTACHMENT_PATH_NOT_ALLOWED",
      "指定されたattachment pathは許可された取り込み範囲外です",
      403
    );
  }
  return path.resolve(value);
}

async function hasLinkInParentPath(root, target) {
  let current = path.dirname(target);
  for (;;) {
    if (isSamePath(current, root)) return false;
    if (!isLexicallyInside(root, current)) return true;
    try {
      const stats = await fs.lstat(current);
      if (stats.isSymbolicLink()) return true;
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      return true;
    }
    const parent = path.dirname(current);
    if (parent === current) return true;
    current = parent;
  }
}

async function safeRealpath(value) {
  try {
    return await fs.realpath(value);
  } catch {
    return null;
  }
}

function isLexicallyInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isSamePath(left, right) {
  return path.resolve(left) === path.resolve(right);
}

function isUncPath(value) {
  return value.startsWith("\\\\") || value.startsWith("//");
}

function hasTraversal(value) {
  return value.split(/[\\/]+/).some((segment) => segment === "..");
}

function detectImageMimeType(bytes) {
  if (isPng(bytes)) return "image/png";
  if (isJpeg(bytes)) return "image/jpeg";
  if (isWebp(bytes)) return "image/webp";
  return normalizeReferenceAssetMimeType("");
}

function isPng(bytes) {
  return bytes.length >= 8
    && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

function isJpeg(bytes) {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isWebp(bytes) {
  return bytes.length >= 12
    && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WEBP";
}
