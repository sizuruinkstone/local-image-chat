const SETTINGS_CATEGORIES = Object.freeze([
  { id: "general", label: "一般", description: "接続確認、保存先、共有、日常のアプリ操作をまとめます。" },
  { id: "prompt", label: "プロンプト", description: "プロンプト部品と生成補助の既存設定をまとめます。" },
  { id: "model", label: "モデル", description: "Checkpointプロフィール、既定値、自動適用、LoRAセットを管理します。" },
  { id: "lora", label: "LoRA", description: "LoRAの検索・選択・編集とCivitai登録を管理します。" },
  { id: "history", label: "履歴・ギャラリー", description: "履歴に表示するタイトルの既存設定を管理します。" },
  { id: "discord", label: "Discord通知", description: "Favorite通知と生成完了通知の既存設定を管理します。" },
  { id: "connection", label: "接続", description: "スマホ接続と既存の接続案内を確認します。" },
  { id: "details", label: "詳細", description: "Grok向け指示テンプレートなど高度な補助設定を管理します。" },
  { id: "appInfo", label: "アプリ情報", description: "バージョン確認と既存の更新操作を行います。" }
]);

const SETTINGS_SEARCH_INDEX = Object.freeze([
  { categoryId: "history", label: "履歴タイトル", targetId: "titleGenerationDetails", keywords: "履歴 ギャラリー タイトル 日時 キャラクター Model モデル 衣装 カスタムテンプレート" },
  { categoryId: "general", label: "アプリ管理", targetId: "appManagementDetails", keywords: "アプリ 接続確認 Ollama ReForge 最新版 Grok AI共有 CSV" },
  { categoryId: "general", label: "画像の保存場所", targetId: "storageSettingsDetails", keywords: "画像 保存先 outputs 出力 移行 再起動 Favorite サムネイル" },
  { categoryId: "model", label: "Checkpoint管理", targetId: "checkpointDetails", keywords: "Checkpoint モデル プロフィール 既定値 自動適用 LoRAセット" },
  { categoryId: "lora", label: "LoRA管理", targetId: "settingsLoraDetails", keywords: "LoRA 検索 分類 Preview プレビュー 選択 編集 衣装 Trigger" },
  { categoryId: "lora", label: "CivitaiからLoRAを追加", targetId: "civitaiDetails", keywords: "Civitai URL APIキー 保存先 フォルダ ダウンロード 登録" },
  { categoryId: "prompt", label: "プロンプト部品・好み補助", targetId: "promptPartsDetails", keywords: "プロンプト 部品 好み 補助 キャラクター 衣装 構図 シチュエーション" },
  { categoryId: "details", label: "Grok向け指示テンプレート", targetId: "promptTemplateDetails", keywords: "Grok 指示テンプレート MY_SD_SETUP lora_list CSV コピー" },
  { categoryId: "discord", label: "Discord通知", targetId: "discordDetails", keywords: "Discord Webhook Favorite 生成完了通知 添付 表示項目 テスト通知 保存" },
  { categoryId: "connection", label: "スマホから接続", targetId: "mobileAccessDetails", keywords: "スマホ ReForge Tailscale LAN 接続 ホーム画面" },
  { categoryId: "appInfo", label: "アプリのアップデート", targetId: "updateDetails", keywords: "アップデート 更新 GitHub Token 最新版 適用" }
]);

const DEFAULT_SETTINGS_CATEGORY = "general";

export function createSettingsNavigation({ elements, document, window, requestAnimationFrame }) {
  let activeSettingsCategory = DEFAULT_SETTINGS_CATEGORY;
  let initialized = false;

  function settingsCategoryById(categoryId) {
    return SETTINGS_CATEGORIES.find((category) => category.id === categoryId) ?? null;
  }

  function activate(categoryId, { targetId = "", focus = false } = {}) {
    const category = settingsCategoryById(categoryId);
    if (!category) return;
    activeSettingsCategory = category.id;
    for (const button of elements.settingsCategoryNav.querySelectorAll("[data-settings-category]")) {
      const selected = button.dataset.settingsCategory === category.id;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-selected", String(selected));
    }
    elements.settingsCategorySelect.value = category.id;
    elements.settingsCategoryTitle.textContent = category.label;
    elements.settingsCategoryDescription.textContent = category.description;
    elements.settingsContent.classList.toggle("is-lora-category", category.id === "lora");
    for (const panel of elements.settingsContent.querySelectorAll("[data-settings-panel]")) {
      const selected = panel.dataset.settingsCategory === category.id;
      panel.hidden = !selected;
      panel.setAttribute("aria-hidden", String(!selected));
    }
    if (!targetId) return;
    const target = document.getElementById(targetId);
    if (!target) return;
    if (target.tagName === "DETAILS") target.open = true;
    requestAnimationFrame(() => {
      const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
      if (!focus) return;
      const focusTarget = target.matches("input, select, textarea, button") ? target : target.querySelector("input, select, textarea, button");
      if (focusTarget && !focusTarget.disabled) focusTarget.focus({ preventScroll: true });
    });
  }

  function normalize(value) {
    return String(value ?? "").trim().toLowerCase();
  }
  function render() {
    const query = normalize(elements.settingsSearch.value);
    elements.settingsSearchResults.replaceChildren();
    if (!query) {
      elements.settingsSearchResults.hidden = true;
      elements.settingsSearch.setAttribute("aria-expanded", "false");
      return;
    }
    const terms = query.split(/\s+/).filter(Boolean);
    const matches = SETTINGS_SEARCH_INDEX.filter((item) => {
      const searchable = normalize(`${item.label} ${item.keywords}`);
      return terms.every((term) => searchable.includes(term));
    });
    if (!matches.length) {
      const empty = document.createElement("p");
      empty.className = "settingsSearchEmpty";
      empty.textContent = "一致する設定がありません";
      elements.settingsSearchResults.append(empty);
    } else {
      for (const item of matches) {
        const category = settingsCategoryById(item.categoryId);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "settingsSearchResult";
        button.setAttribute("role", "option");
        button.dataset.settingsSearchCategory = item.categoryId;
        button.dataset.settingsSearchTarget = item.targetId;
        const label = document.createElement("strong");
        label.textContent = item.label;
        const categoryLabel = document.createElement("small");
        categoryLabel.textContent = category?.label ?? "設定";
        button.append(label, categoryLabel);
        elements.settingsSearchResults.append(button);
      }
    }
    elements.settingsSearchResults.hidden = false;
    elements.settingsSearch.setAttribute("aria-expanded", "true");
  }

  const onNavClick = (event) => {
    const button = event.target.closest("[data-settings-category]");
    if (button) activate(button.dataset.settingsCategory);
  };
  const onSelectChange = () => activate(elements.settingsCategorySelect.value);
  const onSearchInput = () => render();
  const onResultsClick = (event) => {
    const button = event.target.closest("[data-settings-search-category]");
    if (!button) return;
    activate(button.dataset.settingsSearchCategory, { targetId: button.dataset.settingsSearchTarget, focus: true });
    elements.settingsSearch.value = "";
    render();
  };
  function init() {
    if (initialized) return;
    initialized = true;
    elements.settingsCategoryNav.addEventListener("click", onNavClick);
    elements.settingsCategorySelect.addEventListener("change", onSelectChange);
    elements.settingsSearch.addEventListener("input", onSearchInput);
    elements.settingsSearchResults.addEventListener("click", onResultsClick);
  }
  function dispose() {
    if (!initialized) return;
    initialized = false;
    elements.settingsCategoryNav.removeEventListener("click", onNavClick);
    elements.settingsCategorySelect.removeEventListener("change", onSelectChange);
    elements.settingsSearch.removeEventListener("input", onSearchInput);
    elements.settingsSearchResults.removeEventListener("click", onResultsClick);
  }
  return { init, dispose, activate, normalize, render, active: () => activeSettingsCategory, categories: SETTINGS_CATEGORIES };
}
