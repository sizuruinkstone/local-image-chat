// ReForgeのLoRAルート（models/Lora等）を安全に決定するための純粋関数群。
//
// /sdapi/v1/loras の item.name はサブフォルダ込み（例 "Anime/foo"）で返る場合と
// ファイル名だけ（例 "foo"）で返る場合があり、name の階層数だけ path から
// 親へ戻る方式では "models/Lora/Anime" のような整理用サブフォルダを
// ルートと誤認する。ここでは path 中の既知ディレクトリ名から判定する。

// LoRAルートとして採用してよいディレクトリ名（大文字小文字を区別しない）。
export const LORA_ROOT_DIR_NAMES = ["lora", "loras", "lycoris"];

// 整理用サブフォルダとして使われやすく、ルートとして採用してはいけない名前。
export const FORBIDDEN_ROOT_NAMES = [
  "anime", "artist", "artists", "body", "bodies", "char", "chara", "character", "characters",
  "concept", "concepts", "effect", "effects", "flux", "illustrious", "noobai", "outfit", "outfits",
  "pdxl", "pony", "pose", "poses", "sd15", "sd35", "sdxl", "style", "styles", "utility"
];

const ROOT_DIR_SET = new Set(LORA_ROOT_DIR_NAMES);
const FORBIDDEN_SET = new Set(FORBIDDEN_ROOT_NAMES);

export const AMBIGUOUS_ROOT_MESSAGE =
  "LoRA保存先を安全に特定できません。\nconfig.local.json の lora.installDir にReForgeのLoRAルートを設定してください";

export function isForbiddenRootName(name) {
  return FORBIDDEN_SET.has(normalizeSegment(name));
}

export function isKnownRootName(name) {
  return ROOT_DIR_SET.has(normalizeSegment(name));
}

// パス文字列から models/Lora 相当のルートを取り出す。見つからなければ空文字。
export function detectLoraRootFromPath(rawPath) {
  const raw = String(rawPath ?? "").trim();
  if (!raw) return "";
  const separator = raw.includes("\\") ? "\\" : "/";
  const segments = raw.replaceAll("\\", "/").split("/");
  // 末尾はファイル名なので、ルート候補は最後から2番目まで。
  let best = -1;
  let bestWithModels = -1;
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (!isKnownRootName(segments[index])) continue;
    best = index;
    if (normalizeSegment(segments[index - 1]) === "models") bestWithModels = index;
  }
  const chosen = bestWithModels >= 0 ? bestWithModels : best;
  if (chosen < 0) return "";
  return segments.slice(0, chosen + 1).join(separator);
}

// 優先順位: 1) 明示設定 2) ReForge設定API 3) LoRAパスからの検出 4) 特定不可
export function resolveLoraRoot({ installDir = "", reforgeLoraDir = "", rawLoras = [] } = {}) {
  const configured = String(installDir ?? "").trim();
  if (configured) {
    return {
      root: configured,
      source: "config",
      label: "設定済み",
      warning: isForbiddenRootName(basename(configured))
        ? "設定されたLoRAルートは整理用サブフォルダに見えます。ReForgeのLoRAルート自体を指定してください"
        : ""
    };
  }

  const fromReforge = String(reforgeLoraDir ?? "").trim();
  if (fromReforge && !isForbiddenRootName(basename(fromReforge))) {
    return { root: fromReforge, source: "reforge", label: "ReForge設定", warning: "" };
  }

  const votes = new Map();
  for (const item of Array.isArray(rawLoras) ? rawLoras : []) {
    const detected = detectLoraRootFromPath(item?.path);
    if (!detected || isForbiddenRootName(basename(detected))) continue;
    votes.set(detected, (votes.get(detected) ?? 0) + 1);
  }
  // 最も多くのLoRAが属するルートを採用する（外れ値のパスに引きずられない）。
  const winner = [...votes.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0];
  if (winner) return { root: winner[0], source: "detected", label: "自動検出", warning: "" };

  return { root: "", source: "", label: "未特定", warning: AMBIGUOUS_ROOT_MESSAGE };
}

function basename(value) {
  return String(value ?? "").replaceAll("\\", "/").replace(/\/+$/, "").split("/").at(-1) ?? "";
}

function normalizeSegment(value) {
  return String(value ?? "").trim().toLowerCase();
}
