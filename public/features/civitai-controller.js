import {
  NEW_FOLDER_VALUE,
  buildFolderGroups,
  isFavoriteFolder,
  normalizeFavorites,
  normalizeFolder,
  normalizeFolderMemory,
  pickInitialFolder,
  rememberRecentFolder,
  toggleFavoriteFolder
} from "../civitai-folders.js";

const TOKEN_KEY = "localImageChat.civitaiToken";
const RECENT_KEY = "localImageChat.civitaiRecentFolders";
const FAVORITES_KEY = "localImageChat.civitaiFavoriteFolders";
const DEFAULT_FOLDERS = { character: "Characters", style: "Style", body: "Body", pose: "Pose" };

function readJson(storage, key, fallback) {
  try {
    const value = JSON.parse(storage?.getItem(key) ?? "null");
    return value === null || value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

export function createCivitaiController({
  elements = {},
  document,
  storage,
  sessionStorage,
  getJson,
  postJson,
  openModal,
  confirmModal,
  toast = {},
  showError = () => {},
  clearError = () => {},
  formatFileSize = (value) => String(value ?? ""),
  runtimePayload = () => ({}),
  getLoraRoot = () => ({ root: "" }),
  library = {}
} = {}) {
  let inspected = null;
  let folders = [];
  let defaults = { ...DEFAULT_FOLDERS };
  let recommended = {};
  let recent = normalizeFolderMemory(readJson(storage, RECENT_KEY, {}));
  let favorites = normalizeFavorites(readJson(storage, FAVORITES_KEY, []));
  let initialized = false;
  let lifecycle = 0;
  let inspectToken = 0;
  let foldersToken = 0;
  const removers = [];

  function listen(target, type, handler) {
    if (!target?.addEventListener) return;
    target.addEventListener(type, handler);
    removers.push(() => target.removeEventListener(type, handler));
  }

  function init() {
    if (initialized) return;
    initialized = true;
    lifecycle += 1;
    if (elements.civitaiToken) {
      elements.civitaiToken.value = sessionStorage?.getItem(TOKEN_KEY) ?? "";
    }
    listen(elements.inspectCivitaiButton, "click", () => void inspect());
    listen(elements.installCivitaiButton, "click", () => void install());
    listen(elements.refreshCivitaiRegistrationsButton, "click", () => void refreshRegistrations());
    listen(elements.civitaiUrl, "input", () => {
      inspected = null;
      if (elements.installCivitaiButton) elements.installCivitaiButton.disabled = true;
    });
    listen(elements.civitaiCategory, "change", () => applyCategoryFolder(elements.civitaiCategory.value));
    listen(elements.civitaiFolder, "change", onFolderChange);
    listen(elements.civitaiFolderFavorite, "click", toggleFolderFavorite);
    listen(elements.civitaiNewFolder, "input", refreshFolderHint);
  }

  function dispose() {
    for (const remove of removers.splice(0)) remove();
    initialized = false;
    lifecycle += 1;
    inspectToken += 1;
    foldersToken += 1;
  }

  function rememberToken() {
    sessionStorage?.setItem(TOKEN_KEY, elements.civitaiToken?.value ?? "");
  }

  async function inspect() {
    const url = elements.civitaiUrl?.value.trim() ?? "";
    if (!url) {
      showError("CivitaiのモデルページURLを入力してください");
      return false;
    }
    clearError();
    rememberToken();
    const generation = lifecycle;
    const token = ++inspectToken;
    if (elements.inspectCivitaiButton) elements.inspectCivitaiButton.disabled = true;
    if (elements.installCivitaiButton) elements.installCivitaiButton.disabled = true;
    if (elements.civitaiStatus) elements.civitaiStatus.textContent = "Civitaiからモデル情報を取得中…";
    try {
      const data = await postJson("/api/civitai/inspect", {
        url,
        token: elements.civitaiToken?.value ?? ""
      });
      if (generation !== lifecycle || token !== inspectToken) return false;
      inspected = data.metadata;
      renderPreview(data.metadata);
      if (elements.installCivitaiButton) elements.installCivitaiButton.disabled = false;
      if (elements.civitaiStatus) elements.civitaiStatus.textContent = "内容を確認しました。分類を選んで登録できます。";
      return true;
    } catch (error) {
      if (generation !== lifecycle || token !== inspectToken) return false;
      inspected = null;
      elements.civitaiPreview?.classList.add("hidden");
      if (elements.civitaiStatus) elements.civitaiStatus.textContent = error.message;
      return false;
    } finally {
      if (generation === lifecycle && token === inspectToken && elements.inspectCivitaiButton) {
        elements.inspectCivitaiButton.disabled = false;
      }
    }
  }

  function renderPreview(metadata) {
    if (!elements.civitaiPreview || !metadata) return;
    elements.civitaiPreview.replaceChildren();
    if (metadata.previewUrl) {
      const image = document.createElement("img");
      image.src = metadata.previewUrl;
      image.alt = metadata.modelName;
      elements.civitaiPreview.append(image);
    }
    const text = document.createElement("div");
    const heading = document.createElement("strong");
    heading.textContent = `${metadata.modelName} / ${metadata.versionName}`;
    const base = document.createElement("span");
    base.textContent = `${metadata.modelType}・${metadata.baseModel}・${formatFileSize(metadata.file.sizeKB)}`;
    const triggers = document.createElement("span");
    triggers.textContent = metadata.trainedWords.length
      ? `Trigger: ${metadata.trainedWords.join(", ")}`
      : "Trigger Wordsの登録なし";
    const outfits = document.createElement("span");
    outfits.textContent = metadata.outfitPresets?.length > 1
      ? `衣装プリセット候補: ${metadata.outfitPresets.length}種類`
      : "衣装プリセット候補: 1種類";
    const filename = document.createElement("span");
    filename.textContent = metadata.file.name;
    const location = document.createElement("span");
    location.className = "civitaiPreviewLocation";
    const categoryLabel = elements.civitaiCategory?.selectedOptions?.[0]?.textContent
      ?? elements.civitaiCategory?.value ?? "";
    const folder = selectedFolder();
    location.textContent = `分類: ${categoryLabel} ／ 保存先: ${folder || "保存先を選択してください"}`;
    text.append(heading, base, triggers, outfits, filename, location);
    elements.civitaiPreview.append(text);
    elements.civitaiPreview.classList.remove("hidden");
  }

  async function loadFolders() {
    const generation = lifecycle;
    const token = ++foldersToken;
    try {
      const data = await getJson("/api/civitai/install-folders");
      if (generation !== lifecycle || token !== foldersToken) return false;
      folders = Array.isArray(data.folders) ? data.folders : [];
      if (data.defaults && typeof data.defaults === "object") defaults = data.defaults;
      recommended = data.recommended && typeof data.recommended === "object" ? data.recommended : {};
    } catch {
      if (generation !== lifecycle || token !== foldersToken) return false;
      folders = [];
      recommended = {};
    }
    applyCategoryFolder(elements.civitaiCategory?.value ?? "character");
    return true;
  }

  function populateFolderSelect(category, preferred) {
    const select = elements.civitaiFolder;
    if (!select) return;
    select.replaceChildren();
    const groups = buildFolderGroups({
      folders,
      recommended,
      recent: recent[category] ?? [],
      favorites,
      category
    });
    for (const group of groups) {
      const optgroup = document.createElement("optgroup");
      optgroup.label = group.label;
      for (const option of group.options) optgroup.append(new Option(option.label, option.value));
      select.append(optgroup);
    }
    const values = [...select.options].map((option) => option.value);
    const fallback = pickInitialFolder({
      folders,
      recommended,
      recent: recent[category] ?? [],
      favorites,
      category
    });
    select.value = preferred && values.includes(preferred)
      ? preferred
      : (values.includes(fallback) ? fallback : NEW_FOLDER_VALUE);
  }

  function saveFolderMemory() {
    storage?.setItem(RECENT_KEY, JSON.stringify(recent));
    storage?.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  }

  function rememberFolder(category, folder) {
    const normalized = normalizeFolder(folder);
    if (!normalized || normalized === NEW_FOLDER_VALUE) return;
    recent = rememberRecentFolder(recent, category, normalized);
    saveFolderMemory();
  }

  function applyCategoryFolder(category) {
    populateFolderSelect(category, recent[category]?.[0]);
    refreshFolderHint();
  }

  function onFolderChange() {
    const value = elements.civitaiFolder?.value ?? "";
    if (value === NEW_FOLDER_VALUE) {
      if (!elements.civitaiNewFolder?.value.trim()) {
        elements.civitaiNewFolder.value = recommended[elements.civitaiCategory?.value]?.folder ?? "";
      }
    } else {
      rememberFolder(elements.civitaiCategory?.value, value);
    }
    refreshFolderHint();
  }

  function toggleFolderFavorite() {
    const folder = selectedFolder();
    if (!folder) return toast.warning?.("お気に入りにする保存先を選んでください");
    const wasFavorite = isFavoriteFolder(favorites, folder);
    favorites = toggleFavoriteFolder(favorites, folder);
    saveFolderMemory();
    populateFolderSelect(elements.civitaiCategory?.value, folder);
    refreshFolderHint();
    toast.info?.(wasFavorite ? `${folder} をお気に入りから外しました` : `${folder} をお気に入りに登録しました`);
  }

  function selectedFolder() {
    return elements.civitaiFolder?.value === NEW_FOLDER_VALUE
      ? normalizeFolder(elements.civitaiNewFolder?.value)
      : (elements.civitaiFolder?.value ?? "");
  }

  function refreshFolderHint() {
    const isNew = elements.civitaiFolder?.value === NEW_FOLDER_VALUE;
    elements.civitaiNewFolderRow?.classList.toggle("hidden", !isNew);
    const folder = selectedFolder();
    const favorite = isFavoriteFolder(favorites, folder);
    if (elements.civitaiFolderFavorite) {
      elements.civitaiFolderFavorite.textContent = favorite ? "★" : "☆";
      elements.civitaiFolderFavorite.title = favorite ? "お気に入りから外す" : "この保存先をお気に入りに登録";
      elements.civitaiFolderFavorite.setAttribute("aria-pressed", String(favorite));
    }
    const exists = folders.some((item) => item.toLowerCase() === folder.toLowerCase());
    const root = getLoraRoot().root;
    if (elements.civitaiFolderPath) {
      elements.civitaiFolderPath.textContent = folder
        ? `保存先: ${root ? `${root} / ` : ""}${folder}${exists ? "" : "（新規作成されます）"}`
        : "保存先を選択してください";
    }
    if (inspected) renderPreview(inspected);
  }

  async function install() {
    if (!inspected) return inspect();
    const folder = selectedFolder();
    if (!folder) {
      if (elements.civitaiStatus) elements.civitaiStatus.textContent = "保存先を選択してください";
      toast.warning?.("保存先を選択してください");
      return false;
    }
    const category = elements.civitaiCategory?.value ?? "character";
    clearError();
    rememberToken();
    setInstallBusy(true);
    try {
      if (elements.civitaiStatus) elements.civitaiStatus.textContent = "既に導入済みかを確認中…";
      const duplicate = await postJson("/api/civitai/check-duplicate", {
        url: elements.civitaiUrl?.value.trim() ?? "",
        token: elements.civitaiToken?.value ?? "",
        category,
        folder
      });
      let choice = { mode: "auto", filename: "", confirmMove: false };
      if (duplicate.duplicate) {
        choice = await openDuplicateDialog(duplicate, folder);
        if (!choice) {
          if (elements.civitaiStatus) elements.civitaiStatus.textContent = "インストールを中止しました。";
          return false;
        }
      }
      if (elements.civitaiStatus) {
        elements.civitaiStatus.textContent = choice.mode === "auto" || choice.mode === "rename"
          ? "LoRAをダウンロード中です。大きいファイルは数分かかります…"
          : "既存ファイルの情報を更新中…";
      }
      // dialog中にruntimeが変わり得るため、実際のinstall直前にcaptureする。
      const capturedRuntimePayload = runtimePayload();
      const result = await postJson("/api/civitai/install", {
        url: elements.civitaiUrl?.value.trim() ?? "",
        token: elements.civitaiToken?.value ?? "",
        category,
        folder,
        mode: choice.mode,
        filename: choice.filename,
        confirmMove: choice.confirmMove,
        ...capturedRuntimePayload
      });
      rememberFolder(category, result.folder ?? folder);
      const message = describeInstallResult(result, folder);
      if (elements.civitaiStatus) elements.civitaiStatus.textContent = message;
      toast.success?.(message);
      await loadFolders();
      await library.load?.();
      return true;
    } catch (error) {
      if (elements.civitaiStatus) elements.civitaiStatus.textContent = error.message;
      toast.error?.(error.message);
      return false;
    } finally {
      setInstallBusy(false);
    }
  }

  function describeInstallResult(result, folder) {
    const name = result.entry?.modelName ?? inspected?.modelName ?? "LoRA";
    if (result.mode === "move") {
      return `${name}を「${result.folder}」へ移動しました（${result.movedFiles.length}ファイル）。`;
    }
    if (result.mode === "metadata") return `${name}のメタデータだけを更新しました。`;
    if (result.reusedExisting) {
      const suffix = result.existingInOtherFolder
        ? `（既存ファイルは ${result.existingInOtherFolder} にあります。移動はしていません）`
        : "";
      return `${name}の既存ファイルを再利用し、分類・全衣装プリセットを更新しました。${suffix}`;
    }
    return `${name}を保存先「${result.folder ?? folder}」へ配置し、全衣装プリセットを登録しました。`;
  }

  function openDuplicateDialog(duplicate, folder) {
    const options = [];
    let renameField = null;
    const existingLocation = duplicate.registeredVersion?.relativeName
      ?? duplicate.installed[0]?.relativeName
      ?? (duplicate.targetExists ? `${duplicate.targetFolder}/${duplicate.filename}` : "");
    return openModal({
      title: "既に導入済みです",
      subtitle: duplicate.metadata ? `${duplicate.metadata.modelName} / ${duplicate.metadata.versionName}` : "",
      dismissValue: null,
      build: (body) => {
        const list = document.createElement("dl");
        list.className = "detailFields";
        const add = (label, value) => {
          if (!value) return;
          const dt = document.createElement("dt");
          dt.textContent = label;
          const dd = document.createElement("dd");
          dd.textContent = value;
          list.append(dt, dd);
        };
        add("保存場所", existingLocation ? `${existingLocation}.safetensors` : "不明");
        add("登録バージョン", duplicate.registeredVersion?.versionName);
        add("Civitaiバージョン", duplicate.metadata?.versionName);
        if (duplicate.registeredModelVersions?.length) {
          add("同じモデルの別バージョン", duplicate.registeredModelVersions
            .map((item) => item.versionName || item.relativeName).join(" / "));
        }
        if (duplicate.installedElsewhere?.length) {
          add("別フォルダの同名ファイル", duplicate.installedElsewhere
            .map((item) => item.folder || "（ルート直下）").join(" / "));
        }
        add("今回の保存先", `${folder}/${duplicate.filename}`);
        body.append(list);
        const choices = document.createElement("div");
        choices.className = "duplicateChoices";
        const definitions = [
          { mode: "reuse", label: "既存を使う", hint: "ダウンロードせず、登録情報だけ現在の保存場所へ紐付けます。" },
          { mode: "metadata", label: "メタデータだけ更新", hint: "ファイルは触らず、Trigger Wordsや推奨Weightなどを更新します。" },
          { mode: "rename", label: "別名で保存", hint: "新しいファイル名でダウンロードします。" },
          ...(duplicate.movableSource
            ? [{ mode: "move", label: "指定フォルダへ移動", hint: `既存ファイルを ${folder} へ移動します（確認あり）。` }]
            : [])
        ];
        for (const [index, definition] of definitions.entries()) {
          const row = document.createElement("label");
          row.className = "duplicateChoice";
          const radio = document.createElement("input");
          radio.type = "radio";
          radio.name = "duplicateMode";
          radio.value = definition.mode;
          radio.checked = index === 0;
          if (index === 0) radio.setAttribute("data-autofocus", "true");
          const text = document.createElement("span");
          const strong = document.createElement("strong");
          strong.textContent = definition.label;
          const hint = document.createElement("small");
          hint.textContent = definition.hint;
          text.append(strong, hint);
          row.append(radio, text);
          choices.append(row);
          options.push(radio);
        }
        body.append(choices);
        const renameRow = document.createElement("label");
        renameRow.className = "duplicateRename hidden";
        const renameLabel = document.createElement("span");
        renameLabel.textContent = "別名で保存するファイル名";
        const renameInput = document.createElement("input");
        renameInput.type = "text";
        renameInput.value = duplicate.suggestedFilename ?? "";
        renameRow.append(renameLabel, renameInput);
        body.append(renameRow);
        const sync = () => {
          const selected = options.find((radio) => radio.checked)?.value;
          renameRow.classList.toggle("hidden", selected !== "rename");
        };
        for (const radio of options) radio.addEventListener("change", sync);
        sync();
        renameField = renameInput;
      },
      actions: [
        { label: "キャンセル", value: null, variant: "secondary" },
        {
          label: "実行する",
          primary: true,
          onSelect: async (close) => {
            const mode = options.find((radio) => radio.checked)?.value ?? "reuse";
            const filename = mode === "rename" ? (renameField?.value ?? "").trim() : "";
            if (mode === "rename" && !/\.safetensors$/i.test(filename)) {
              toast.warning?.("別名は .safetensors で終わるファイル名にしてください");
              return false;
            }
            if (mode === "move") {
              const confirmed = await confirmModal(
                `既存ファイルを ${folder} へ移動します。関連する preview 画像やjsonも一緒に移動します。よろしいですか？`,
                { title: "移動の確認", confirmText: "移動する", danger: true }
              );
              if (!confirmed) return false;
              close({ mode, filename: "", confirmMove: true });
              return;
            }
            close({ mode, filename, confirmMove: false });
          },
          keepOpen: true
        }
      ]
    }).promise;
  }

  async function refreshRegistrations() {
    clearError();
    rememberToken();
    setRefreshBusy(true);
    if (elements.civitaiStatus) {
      elements.civitaiStatus.textContent = "登録済みCivitai LoRAの衣装・Trigger Wordsを再解析中…";
    }
    try {
      const result = await postJson("/api/civitai/refresh-registrations", {
        token: elements.civitaiToken?.value ?? ""
      });
      if (!result.total) {
        if (elements.civitaiStatus) elements.civitaiStatus.textContent = "Civitai URLから登録したLoRAはまだありません。";
        return true;
      }
      const failureNames = (result.failures ?? []).slice(0, 3).map((item) => item.modelName).join("、");
      if (elements.civitaiStatus) {
        elements.civitaiStatus.textContent = result.failed
          ? `${result.updated}/${result.total}件を更新しました。失敗${result.failed}件: ${failureNames}`
          : `${result.updated}件すべての衣装・Trigger Wordsを更新しました。`;
      }
      await library.load?.();
      return true;
    } catch (error) {
      if (elements.civitaiStatus) elements.civitaiStatus.textContent = `一括再解析に失敗しました: ${error.message}`;
      return false;
    } finally {
      setRefreshBusy(false);
    }
  }

  function setInstallBusy(busy) {
    if (elements.inspectCivitaiButton) elements.inspectCivitaiButton.disabled = busy;
    if (elements.installCivitaiButton) elements.installCivitaiButton.disabled = busy || !inspected;
  }

  function setRefreshBusy(busy) {
    if (elements.inspectCivitaiButton) elements.inspectCivitaiButton.disabled = busy;
    if (elements.installCivitaiButton) elements.installCivitaiButton.disabled = busy || !inspected;
    if (elements.refreshCivitaiRegistrationsButton) elements.refreshCivitaiRegistrationsButton.disabled = busy;
  }

  function setBusy(busy) {
    if (elements.refreshCivitaiRegistrationsButton) {
      elements.refreshCivitaiRegistrationsButton.disabled = Boolean(busy);
    }
  }

  return {
    init,
    dispose,
    inspect,
    install,
    refreshRegistrations,
    loadFolders,
    renderPreview,
    openDuplicateDialog,
    getFolders: () => folders,
    getInspected: () => inspected,
    getState: () => ({
      inspected,
      folders: [...folders],
      defaults: { ...defaults },
      recommended: { ...recommended },
      recent: { ...recent },
      favorites: [...favorites]
    }),
    setBusy
  };
}
