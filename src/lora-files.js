import fsp from "node:fs/promises";
import path from "node:path";

// LoRA本体と一緒に扱う関連ファイル。存在するものだけを対象にする。
export const LORA_SIDECAR_SUFFIXES = [
  ".safetensors", ".ckpt", ".pt",
  ".preview.png", ".preview.jpg", ".preview.jpeg", ".preview.webp",
  ".png", ".jpg", ".jpeg", ".webp",
  ".json", ".civitai.info", ".txt", ".yaml"
];

export function stripLoraExtension(filename) {
  return String(filename ?? "").replace(/\.(?:safetensors|ckpt|pt)$/i, "");
}

// 指定ディレクトリから baseName に属するファイル（本体＋関連）を集める。
export async function collectLoraFileSet(directory, baseName) {
  const base = stripLoraExtension(baseName);
  if (!base) return [];
  let entries;
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const matches = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const suffix = matchSuffix(entry.name, base);
    if (suffix === null) continue;
    matches.push({ name: entry.name, suffix });
  }
  return matches.sort((left, right) => left.name.localeCompare(right.name));
}

function matchSuffix(filename, base) {
  if (!filename.toLowerCase().startsWith(base.toLowerCase())) return null;
  const rest = filename.slice(base.length);
  const suffix = LORA_SIDECAR_SUFFIXES.find((candidate) => candidate.toLowerCase() === rest.toLowerCase());
  return suffix ?? null;
}

// LoRA一式を移動する。上書きは行わず、衝突があれば何も動かさずに失敗させる。
export async function moveLoraFileSet({ sourceDir, baseName, destinationDir, newBaseName }) {
  const base = stripLoraExtension(baseName);
  const nextBase = stripLoraExtension(newBaseName || base);
  const files = await collectLoraFileSet(sourceDir, base);
  if (!files.length) throw new Error("移動対象のLoRAファイルが見つかりません");
  if (path.resolve(sourceDir) === path.resolve(destinationDir) && base === nextBase) {
    return { moved: [], skipped: true };
  }

  await fsp.mkdir(destinationDir, { recursive: true });
  const planned = files.map((file) => ({
    from: path.join(sourceDir, file.name),
    to: path.join(destinationDir, `${nextBase}${file.suffix}`)
  }));
  for (const item of planned) {
    if (await exists(item.to)) {
      throw new Error(`移動先に同名ファイルがあります: ${path.basename(item.to)}`);
    }
  }

  const moved = [];
  try {
    for (const item of planned) {
      await fsp.rename(item.from, item.to);
      moved.push(item);
    }
  } catch (error) {
    // 途中失敗時は移動済みのファイルを元へ戻す。
    for (const item of moved.reverse()) {
      await fsp.rename(item.to, item.from).catch(() => {});
    }
    throw error;
  }
  return { moved: moved.map((item) => path.basename(item.to)), skipped: false };
}

// 同名衝突を避ける代替ファイル名を作る。バージョン名があれば優先して使う。
export function suggestAlternateFilename(filename, { versionName = "", taken = [] } = {}) {
  const extensionMatch = String(filename ?? "").match(/\.(?:safetensors|ckpt|pt)$/i);
  const extension = extensionMatch ? extensionMatch[0] : ".safetensors";
  const base = stripLoraExtension(filename) || "lora";
  const takenSet = new Set(taken.map((value) => String(value).toLowerCase()));
  const versionSlug = slugifyVersion(versionName);

  const candidates = [];
  if (versionSlug && !base.toLowerCase().includes(versionSlug.toLowerCase())) {
    candidates.push(`${base}-${versionSlug}`);
  }
  for (let index = 2; index <= 99; index += 1) candidates.push(`${base}-${index}`);

  for (const candidate of candidates) {
    if (!takenSet.has(`${candidate}${extension}`.toLowerCase())) return `${candidate}${extension}`;
  }
  return `${base}-${Date.now()}${extension}`;
}

function slugifyVersion(versionName) {
  const value = String(versionName ?? "").trim();
  if (!value) return "";
  return value
    .replace(/[^A-Za-z0-9.\-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

async function exists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}
