// Civitai保存先フォルダ選択のデータモデル。DOMに依存しない純粋関数だけを置き、
// 「実在フォルダ」と「実在しない推奨フォルダ」を混ぜないことを保証する。

export const NEW_FOLDER_VALUE = "__new__";
export const RECENT_LIMIT = 3;
export const CATEGORY_LABELS = {
  character: "キャラクター",
  style: "画風",
  body: "体型",
  pose: "構図・ポーズ"
};

// 分類ごとの推奨フォルダ名（サーバーのCATEGORY_FOLDERSと対応）。
export const CATEGORY_DEFAULTS = {
  character: "Characters",
  style: "Style",
  body: "Body",
  pose: "Pose"
};

export function normalizeFolder(value) {
  return String(value ?? "")
    .replaceAll("\\", "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .trim();
}

// { character: ["Anime/Character", ...] } 形式の履歴を検証して正規化する。
export function normalizeFolderMemory(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const memory = {};
  for (const category of Object.keys(CATEGORY_DEFAULTS)) {
    const list = Array.isArray(source[category]) ? source[category] : [];
    memory[category] = dedupe(list.map(normalizeFolder).filter(Boolean)).slice(0, RECENT_LIMIT);
  }
  return memory;
}

export function rememberRecentFolder(memory, category, folder, limit = RECENT_LIMIT) {
  const normalized = normalizeFolder(folder);
  const next = normalizeFolderMemory(memory);
  if (!normalized || !(category in next)) return next;
  next[category] = dedupe([normalized, ...next[category]]).slice(0, limit);
  return next;
}

export function normalizeFavorites(value) {
  return dedupe((Array.isArray(value) ? value : []).map(normalizeFolder).filter(Boolean)).slice(0, 40);
}

export function toggleFavoriteFolder(favorites, folder) {
  const normalized = normalizeFolder(folder);
  const list = normalizeFavorites(favorites);
  if (!normalized) return list;
  const index = list.findIndex((item) => item.toLowerCase() === normalized.toLowerCase());
  if (index >= 0) return list.filter((_, position) => position !== index);
  return [normalized, ...list].slice(0, 40);
}

export function isFavoriteFolder(favorites, folder) {
  const normalized = normalizeFolder(folder).toLowerCase();
  if (!normalized) return false;
  return normalizeFavorites(favorites).some((item) => item.toLowerCase() === normalized);
}

// selectへ並べるグループを作る。順序は
// 前回使用 → お気に入り → 推奨 → 既存フォルダ → 新規作成。
// 実在しない推奨フォルダは「（新規作成）」と明示し、既存フォルダ群へは混ぜない。
export function buildFolderGroups({
  folders = [],
  recommended = {},
  recent = [],
  favorites = [],
  category = "style"
} = {}) {
  const existing = dedupe(folders.map(normalizeFolder).filter(Boolean));
  const existingKeys = new Set(existing.map((folder) => folder.toLowerCase()));
  const used = new Set();
  const groups = [];

  const take = (values, kind) => values
    .map(normalizeFolder)
    .filter(Boolean)
    .filter((folder) => {
      const key = folder.toLowerCase();
      if (used.has(key)) return false;
      used.add(key);
      return true;
    })
    .map((folder) => ({
      value: folder,
      label: folder,
      kind,
      exists: existingKeys.has(folder.toLowerCase())
    }));

  const recentOptions = take(recent.filter((folder) => existingKeys.has(normalizeFolder(folder).toLowerCase())), "recent");
  if (recentOptions.length) groups.push({ label: "前回使用した保存先", options: recentOptions });

  const favoriteOptions = take(favorites, "favorite")
    .map((option) => ({ ...option, label: option.exists ? option.value : `${option.value}（新規作成）` }));
  if (favoriteOptions.length) groups.push({ label: "お気に入り保存先", options: favoriteOptions });

  const suggestion = recommended[category] ?? {
    folder: CATEGORY_DEFAULTS[category] ?? CATEGORY_DEFAULTS.style,
    exists: false
  };
  const recommendedOptions = take([suggestion.folder], "recommended")
    .map((option) => ({
      ...option,
      label: option.exists ? `推奨: ${option.value}` : `推奨: ${option.value}（新規作成）`
    }));
  if (recommendedOptions.length) groups.push({ label: "推奨保存先", options: recommendedOptions });

  const existingOptions = take(existing, "existing");
  if (existingOptions.length) groups.push({ label: "既存フォルダ", options: existingOptions });

  groups.push({
    label: "その他",
    options: [{ value: NEW_FOLDER_VALUE, label: "＋ 新しいフォルダを作成", kind: "new", exists: false }]
  });
  return groups;
}

// 初期選択値: 前回使用 → お気に入り → 推奨 の順で最初に見つかったもの。
export function pickInitialFolder({ folders = [], recommended = {}, recent = [], favorites = [], category = "style" } = {}) {
  const groups = buildFolderGroups({ folders, recommended, recent, favorites, category });
  for (const kind of ["recent", "favorite", "recommended", "existing"]) {
    const option = groups.flatMap((group) => group.options).find((item) => item.kind === kind);
    if (option) return option.value;
  }
  return "";
}

function dedupe(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const key = String(value).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}
