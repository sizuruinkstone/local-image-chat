import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export const THUMBNAIL_LONG_EDGE = 384;
export const THUMBNAIL_QUALITY = 76;

const SUPPORTED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export function createThumbnailService({
  outputDir,
  thumbnailDir = path.join(outputDir, "thumbnails"),
  longEdge = THUMBNAIL_LONG_EDGE,
  quality = THUMBNAIL_QUALITY
}) {
  const resolvedOutputDir = path.resolve(outputDir);
  const resolvedThumbnailDir = path.resolve(thumbnailDir);
  const pending = new Map();

  function pathsFor(image) {
    const id = requireSafeId(image?.id);
    const filename = requireSafeFilename(image?.filename);
    const sourcePath = path.resolve(resolvedOutputDir, filename);
    if (path.dirname(sourcePath) !== resolvedOutputDir) throw new Error("原画像の保存先が不正です");
    return {
      sourcePath,
      thumbnailPath: path.join(resolvedThumbnailDir, `${id}.webp`),
      thumbnailFilename: `${id}.webp`
    };
  }

  async function ensure(image) {
    const paths = pathsFor(image);
    if (await isUsableWebp(paths.thumbnailPath)) return { ...paths, created: false };

    const key = paths.thumbnailPath;
    if (pending.has(key)) return pending.get(key);

    const task = (async () => {
      await fs.mkdir(resolvedThumbnailDir, { recursive: true });
      if (await isUsableWebp(paths.thumbnailPath)) return { ...paths, created: false };
      // 0バイトや途中書き込みなどの壊れたキャッシュは原画像から作り直す。
      await fs.rm(paths.thumbnailPath, { force: true });
      // Sharpのmissing-fileエラーにはcodeが付かないため、APIで404を判定できるよう先に確認する。
      await fs.access(paths.sourcePath);

      const temporaryPath = `${paths.thumbnailPath}.${process.pid}-${crypto.randomUUID()}.tmp`;
      try {
        const input = sharp(paths.sourcePath, { animated: false, failOn: "error" });
        const metadata = await input.metadata();
        if ((metadata.pages ?? 1) > 1) throw new Error("アニメーション画像のサムネイルには対応していません");

        await input
          .rotate()
          .resize({
            width: longEdge,
            height: longEdge,
            fit: "inside",
            withoutEnlargement: true
          })
          .webp({
            quality,
            alphaQuality: quality,
            effort: 4
          })
          .toFile(temporaryPath);
        await fs.rename(temporaryPath, paths.thumbnailPath);
        return { ...paths, created: true };
      } finally {
        await fs.rm(temporaryPath, { force: true }).catch(() => {});
      }
    })().finally(() => pending.delete(key));

    pending.set(key, task);
    return task;
  }

  async function remove(image) {
    const { thumbnailPath } = pathsFor(image);
    await fs.rm(thumbnailPath, { force: true });
  }

  return {
    ensure,
    remove,
    pathsFor,
    thumbnailDir: resolvedThumbnailDir
  };
}

function requireSafeId(value) {
  const id = String(value ?? "");
  if (!/^[a-z0-9-]{8,80}$/i.test(id)) throw new Error("画像IDが不正です");
  return id;
}

function requireSafeFilename(value) {
  const filename = String(value ?? "");
  if (!filename || path.basename(filename) !== filename || !SUPPORTED_EXTENSIONS.has(path.extname(filename).toLowerCase())) {
    throw new Error("原画像のファイル名が不正です");
  }
  return filename;
}

async function isUsableWebp(filePath) {
  let handle;
  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile() || stats.size < 12) return false;
    handle = await fs.open(filePath, "r");
    const header = Buffer.alloc(12);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    return bytesRead === 12
      && header.subarray(0, 4).toString("ascii") === "RIFF"
      && header.subarray(8, 12).toString("ascii") === "WEBP";
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => {});
  }
}
