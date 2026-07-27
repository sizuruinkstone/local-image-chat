// トップレベル画面（生成 / ギャラリー / 比較 / 設定）の切り替え。
// 画面はDOMを作り直さず表示を切り替えるだけなので、生成中でも自由に移動できる。
// 生成の状態・進捗はサーバー側のジョブ管理が持ち、この切り替えでは何も止めない。

export const APP_VIEWS = ["generate", "gallery", "compare", "settings"];

export const APP_VIEW_LABELS = {
  generate: "生成",
  gallery: "ギャラリー",
  compare: "比較",
  settings: "設定"
};

export function isAppView(value) {
  return APP_VIEWS.includes(value);
}

export function normalizeAppView(value, fallback = "generate") {
  return isAppView(value) ? value : fallback;
}

// URLのハッシュ（#gallery など）と画面名を対応させる。リロードしても同じ画面へ戻る。
export function viewFromHash(hash) {
  const value = String(hash ?? "").replace(/^#/, "").trim().toLowerCase();
  return isAppView(value) ? value : null;
}

export function hashForView(view) {
  return `#${normalizeAppView(view)}`;
}
