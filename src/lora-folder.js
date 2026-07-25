import path from "node:path";

// LoRA保存先の相対フォルダを正規化・検証する純粋関数群。
// クライアント/サーバー両方から使い、サーバー側で最終防衛線とする。

// Windowsで使用できない文字 < > : " | ? *（スペースやハイフンは名前中では許可）。
const FORBIDDEN_CHARS = /[<>:"|?*]/;
// Windows予約デバイス名（CON, PRN, AUX, NUL, COM1〜9, LPT1〜9）。拡張子付きも予約。
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

function hasControlChar(value) {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) < 32) return true; // null byteや制御文字
  }
  return false;
}

export function normalizeInstallFolder(input) {
  const raw = String(input ?? "");
  if (hasControlChar(raw)) throw new Error("使用できないフォルダ名です");
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("保存先を選択してください");
  // 絶対パス・ドライブレター・UNC・先頭スラッシュを拒否
  if (/^[a-zA-Z]:/.test(trimmed) || /^[\\/]{2}/.test(trimmed) || /^[\\/]/.test(trimmed)) {
    throw new Error("LoRAルート外は指定できません");
  }
  const value = trimmed
    .replaceAll("\\", "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "");
  if (!value) throw new Error("保存先を選択してください");
  const segments = value.split("/");
  for (const segment of segments) {
    if (!segment) throw new Error("使用できないフォルダ名です");
    if (segment === "." || segment === "..") throw new Error("LoRAルート外は指定できません");
    if (FORBIDDEN_CHARS.test(segment)) throw new Error("使用できないフォルダ名です");
    if (RESERVED_NAME.test(segment)) throw new Error("使用できないフォルダ名です");
    if (/[ .]$/.test(segment)) throw new Error("使用できないフォルダ名です"); // 末尾スペース/ドット
  }
  return segments.join("/");
}

export function isValidInstallFolder(input) {
  try {
    normalizeInstallFolder(input);
    return true;
  } catch {
    return false;
  }
}

// 正規化済みフォルダをLoRAルート配下の絶対パスへ解決し、ルート外を拒否する。
// path.relativeで最終確認し、startsWith頼みにしない。
export function resolveInstallTarget(installRoot, folder) {
  const relative = normalizeInstallFolder(folder);
  const root = path.resolve(String(installRoot ?? ""));
  const absolute = path.resolve(root, relative);
  const rel = path.relative(root, absolute);
  if (rel !== "" && (rel.startsWith("..") || path.isAbsolute(rel))) {
    throw new Error("LoRAルート外は指定できません");
  }
  return { absolute, relative };
}
