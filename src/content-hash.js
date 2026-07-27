import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

// 画像内容のSHA-256。
//
// stable-diffusion-manager 側の generation.id と同じ値になるように、
// **ファイル全体のバイト列**をそのままハッシュする。
// ファイル名やパスは混ぜない（フォルダを整理しても同じ画像だと分かるため）。

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

// 64桁の小文字16進数だけを受け付ける。それ以外はnull。
export function normalizeContentSha256(value) {
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  return SHA256_PATTERN.test(text) ? text : null;
}

export function isContentSha256(value) {
  return normalizeContentSha256(value) !== null;
}

export function sha256OfBuffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

// outputs直下のファイル名として安全か。
// 履歴の生成画像はoutputs直下に置かれるので、区切り文字を含む名前は扱わない。
export function isSafeOutputFilename(filename) {
  if (typeof filename !== "string") return false;
  const text = filename.trim();
  if (!text || text === "." || text === "..") return false;
  if (text.includes("/") || text.includes("\\")) return false;
  if (/^[A-Za-z]:/.test(text)) return false;
  return path.basename(text) === text;
}

// outputDirの中に収まる絶対パスへ解決する。外を指すならnull。
export function resolveOutputPath(outputDir, filename) {
  if (!isSafeOutputFilename(filename)) return null;
  const target = path.resolve(outputDir, filename);
  const relative = path.relative(path.resolve(outputDir), target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return target;
}

// 出力画像のSHA-256を求める。
//
// 読めない・存在しない・outputDirの外・シンボリックリンクの場合はnull。
// リンクを辿らないのは、履歴のファイル名経由でoutputDirの外を読ませないため。
export async function hashOutputImage(outputDir, filename) {
  const target = resolveOutputPath(outputDir, filename);
  if (!target) return null;
  try {
    const stats = await fs.lstat(target);
    if (stats.isSymbolicLink() || !stats.isFile()) return null;
    return sha256OfBuffer(await fs.readFile(target));
  } catch {
    return null;
  }
}
