import { LORA_PROFILES, getPreset, getProfile } from "../lora-profiles.js";
import {
  compatibilityFilterAllows,
  getRecommendedWeight,
  hasLoraPreview,
  isCompatibilityFilter,
  resolveLoraPreviewUrl
} from "../lora-preview.js";
import {
  LORA_ROOT_FOLDER,
  buildLoraCatalog,
  buildLoraFolderTree,
  filterItemsByFolder,
  formatLoraRelativeLocation,
  getFolderDescendantCount,
  loraFolderKey
} from "../preset-catalog.js";

const CATEGORY_STORAGE_KEY = "localImageChat.loraCategory";
const COMPATIBILITY_STORAGE_KEY = "localImageChat.loraCompatibilityFilter";
const SUBCATEGORY_LABELS = {
  character: "キャラクター",
  style: "画風",
  body: "体型",
  pose: "構図・ポーズ"
};

function noop() {}
function asyncNoop() { return Promise.resolve(); }

export function createLoraLibrary({
  elements = {},
  document,
  window,
  storage,
  getJson,
  postJson,
  patchJson,
  runtime = {},
  controls = {},
  resolveProfile = () => null,
  getCompatibility = () => ({ level: "unknown", label: "不明", message: "" }),
  getConfig = () => ({ defaultWeight: 0.7, maxSelected: 4 }),
  getInstallFolders = () => [],
  reloadInstallFolders = asyncNoop,
  onCatalogPublished = noop,
  openModal,
  openPresetPicker,
  openImageModal = noop,
  openEditor,
  withBusy = async (_button, _label, callback) => callback(),
  toast = {},
  showError = noop,
  clearError = noop
} = {}) {
  let items = [];
  let selectedFolder = "";
  const expandedFolders = new Set();
  let pinnedName = null;
  let displayedName = null;
  let activeCategory = loadCategory();
  let rootInfo = { root: "", source: "", label: "", warning: "" };
  let initialized = false;
  let lifecycle = 0;
  let loadToken = 0;
  let rootToken = 0;
  const removers = [];

  function loadCategory() {
    const value = storage?.getItem(CATEGORY_STORAGE_KEY);
    return ["character", "direction", "selected", "all"].includes(value) ? value : "character";
  }

  function listen(target, type, handler) {
    if (!target?.addEventListener) return;
    target.addEventListener(type, handler);
    removers.push(() => target.removeEventListener(type, handler));
  }

  function init() {
    if (initialized) return;
    initialized = true;
    lifecycle += 1;
    if (elements.loraCompatibilityFilter) {
      const stored = storage?.getItem(COMPATIBILITY_STORAGE_KEY);
      elements.loraCompatibilityFilter.value = isCompatibilityFilter(stored) ? stored : "all";
    }
    listen(elements.loraSearch, "input", render);
    listen(elements.loraCompatibilityFilter, "change", () => {
      storage?.setItem(COMPATIBILITY_STORAGE_KEY, elements.loraCompatibilityFilter.value);
      render();
    });
    listen(elements.refreshLorasButton, "click", () => void load(true));
    listen(elements.loraFolderButton, "click", openFolderModal);
    listen(elements.openLoraRootButton, "click", () => void openRoot());
    listen(elements.loraCategories, "click", (event) => {
      const button = event.target?.closest?.("[data-lora-category]");
      if (!button) return;
      activeCategory = button.dataset.loraCategory;
      storage?.setItem(CATEGORY_STORAGE_KEY, activeCategory);
      render();
    });
  }

  function dispose() {
    for (const remove of removers.splice(0)) remove();
    initialized = false;
    lifecycle += 1;
    loadToken += 1;
    rootToken += 1;
  }

  function isLoadCurrent(generation, token, context) {
    return generation === lifecycle
      && token === loadToken
      && (runtime.isCurrent?.(context) ?? true);
  }

  async function load(refresh = false, context = runtime.getContext?.()) {
    const generation = lifecycle;
    const token = ++loadToken;
    const activeRuntime = runtime.getState?.().activeRuntime;
    if (elements.loraStatus) {
      elements.loraStatus.textContent = refresh
        ? `${activeRuntime?.label ?? "Runtime"}でLoRAを再読込中…`
        : "LoRAを取得中…";
    }
    if (elements.refreshLorasButton) elements.refreshLorasButton.disabled = true;
    try {
      const data = refresh
        ? await postJson(runtime.apiUrl("/api/loras/refresh"), runtime.payload())
        : await getJson(runtime.apiUrl("/api/loras"));
      if (!isLoadCurrent(generation, token, context)) return false;
      setItems(data.loras ?? [], { publish: true, renderNow: false });
      const counts = countCategories();
      if (elements.loraStatus) {
        elements.loraStatus.textContent = items.length
          ? `${items.length}個を検出・キャラ${counts.character}・画風系${counts.direction}`
          : "LoRAが見つかりません。追加後に「再読込」を押してください。";
      }
      render();
      return true;
    } catch (error) {
      if (!isLoadCurrent(generation, token, context)) return false;
      if (elements.loraStatus) elements.loraStatus.textContent = `LoRA一覧を取得できません: ${error.message}`;
      return false;
    } finally {
      if (isLoadCurrent(generation, token, context) && elements.refreshLorasButton) {
        elements.refreshLorasButton.disabled = Boolean(
          runtime.getGenerationBusy?.() || runtime.getState?.().switching
        );
      }
    }
  }

  function setItems(nextItems, { publish = false, renderNow = true } = {}) {
    items = Array.isArray(nextItems) ? nextItems : [];
    if (pinnedName && !findByName(pinnedName)) pinnedName = null;
    if (publish) onCatalogPublished(items);
    if (renderNow) render();
    return items;
  }

  function getItems() {
    return items;
  }

  function findByName(name) {
    return items.find((item) => item.name === name) ?? null;
  }

  function getCategory(lora) {
    const profile = resolveProfile(lora);
    if (profile) return profile.category === "direction" ? "direction" : "character";
    if (lora?.registry?.category) return lora.registry.category;
    return lora?.category === "character" ? "character" : "direction";
  }

  function countCategories() {
    return items.reduce((counts, lora) => {
      counts[getCategory(lora)] += 1;
      return counts;
    }, { character: 0, direction: 0 });
  }

  function renderCategoryButtons() {
    if (!elements.loraCategories) return;
    const counts = countCategories();
    const countByCategory = {
      character: counts.character,
      direction: counts.direction,
      selected: controls.selectedCount?.() ?? 0,
      all: items.length
    };
    for (const button of elements.loraCategories.querySelectorAll("[data-lora-category]")) {
      const category = button.dataset.loraCategory;
      const active = category === activeCategory;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
      const count = button.querySelector("span");
      if (count) count.textContent = String(countByCategory[category] ?? 0);
    }
  }

  function render() {
    renderCategoryButtons();
    if (!elements.loraList) return;
    const query = elements.loraSearch?.value.trim().toLowerCase() ?? "";
    const compatibilityFilter = elements.loraCompatibilityFilter?.value ?? "all";
    const matches = filterItemsByFolder(items, selectedFolder)
      .filter((item) => {
        const category = getCategory(item);
        const matchesCategory = activeCategory === "all"
          || activeCategory === category
          || (activeCategory === "selected" && controls.isSelected?.(item.name));
        const matchesSearch = `${item.displayName} ${item.name} ${item.alias} ${item.folder ?? ""}`
          .toLowerCase()
          .includes(query);
        const matchesCompatibility = compatibilityFilterAllows(compatibilityFilter, {
          level: getCompatibility(item).level,
          hasPreview: hasLoraPreview(item)
        });
        return matchesCategory && matchesSearch && matchesCompatibility;
      })
      .sort((left, right) => {
        const leftSelected = controls.isSelected?.(left.name) ? 0 : 1;
        const rightSelected = controls.isSelected?.(right.name) ? 0 : 1;
        return leftSelected - rightSelected
          || left.displayName.localeCompare(right.displayName, "ja", { numeric: true });
      });

    renderFolderTree(elements.loraFolderTree, items, {
      selectedFolder,
      expandedFolders,
      onToggle: toggleFolder,
      onSelect: selectFolder
    });
    if (elements.loraListBreadcrumb) elements.loraListBreadcrumb.textContent = `LoRA / ${selectedFolder || "すべて"}`;
    if (elements.loraListCount) elements.loraListCount.textContent = `${matches.length}件`;
    elements.loraList.replaceChildren();

    const groups = new Map();
    for (const lora of matches) {
      const label = loraFolderKey(lora);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(lora);
    }
    for (const [folder, loras] of groups) {
      const group = document.createElement("details");
      group.className = "loraFolderGroup";
      group.open = true;
      const heading = document.createElement("summary");
      heading.className = "loraFolderHeader";
      const folderName = document.createElement("strong");
      folderName.textContent = folder;
      const count = document.createElement("span");
      count.textContent = `${loras.length}個`;
      heading.append(folderName, count);
      const rows = document.createElement("div");
      rows.className = "loraFolderRows";
      for (const lora of loras) rows.append(createRow(lora));
      group.append(heading, rows);
      elements.loraList.append(group);
    }
    if (!matches.length && items.length) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "一致するLoRAがありません";
      elements.loraList.append(empty);
    }
    restorePinnedPreview();
  }

  function expandFolderPath(folder, target = expandedFolders) {
    if (!folder || folder === LORA_ROOT_FOLDER) return;
    const segments = String(folder).replaceAll("\\", "/").split("/").filter(Boolean);
    let path = "";
    for (const segment of segments) {
      path = path ? `${path}/${segment}` : segment;
      target.add(path);
    }
  }

  function renderFolderTree(container, folderItems, {
    selectedFolder: currentFolder = "",
    expandedFolders: currentExpanded = new Set(),
    onSelect = noop,
    onToggle = noop
  } = {}) {
    if (!container) return;
    const tree = buildLoraFolderTree(folderItems);
    container.replaceChildren();
    const appendRow = (parent, { value, label, count, depth = 0, node = null, rootFolder = false }) => {
      const row = document.createElement("div");
      row.className = "loraFolderTreeRow";
      row.style.setProperty("--folder-depth", String(depth));
      row.setAttribute("role", "treeitem");
      row.setAttribute("aria-selected", String(currentFolder === value));
      if (node) row.setAttribute("aria-expanded", String(currentExpanded.has(node.value)));
      if (node?.children?.length) {
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "loraFolderTreeToggle";
        toggle.textContent = currentExpanded.has(node.value) ? "▾" : "▸";
        toggle.setAttribute("aria-label", `${label}${currentExpanded.has(node.value) ? "を折りたたむ" : "を展開"}`);
        toggle.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          onToggle(node.value, node);
        });
        row.append(toggle);
      } else {
        const spacer = document.createElement("span");
        spacer.className = "loraFolderTreeToggle loraFolderTreeToggleSpacer";
        spacer.setAttribute("aria-hidden", "true");
        row.append(spacer);
      }
      const select = document.createElement("button");
      select.type = "button";
      select.className = "loraFolderTreeSelect";
      select.classList.toggle("active", currentFolder === value);
      select.dataset.loraFolder = value;
      select.title = rootFolder ? LORA_ROOT_FOLDER : (node?.value || label);
      const labelText = document.createElement("span");
      labelText.className = "loraFolderTreeLabel";
      labelText.textContent = label;
      const countText = document.createElement("span");
      countText.className = "loraFolderTreeCount";
      countText.textContent = `${count}個`;
      select.append(labelText, countText);
      select.addEventListener("click", () => onSelect(value, node));
      row.append(select);
      parent.append(row);
      if (node?.children?.length && currentExpanded.has(node.value)) {
        const children = document.createElement("div");
        children.className = "loraFolderTreeChildren";
        children.setAttribute("role", "group");
        for (const child of node.children) {
          appendRow(children, {
            value: child.value,
            label: child.label,
            count: getFolderDescendantCount(child),
            depth: depth + 1,
            node: child
          });
        }
        parent.append(children);
      }
    };
    appendRow(container, { value: "", label: "すべて", count: getFolderDescendantCount(tree), rootFolder: true });
    appendRow(container, { value: LORA_ROOT_FOLDER, label: LORA_ROOT_FOLDER, count: tree.directCount, rootFolder: true });
    for (const child of tree.children) {
      appendRow(container, {
        value: child.value,
        label: child.label,
        count: getFolderDescendantCount(child),
        node: child
      });
    }
  }

  function selectFolder(folder) {
    selectedFolder = folder;
    expandFolderPath(folder);
    render();
  }

  function toggleFolder(folder) {
    if (expandedFolders.has(folder)) expandedFolders.delete(folder);
    else expandedFolders.add(folder);
    render();
  }

  function openFolderModal() {
    openModal({
      title: "LoRAフォルダ",
      subtitle: "表示する保存場所を選択",
      size: "small",
      build: (body, close) => {
        body.classList.add("loraFolderDrawerBody");
        const rootButton = document.createElement("button");
        rootButton.type = "button";
        rootButton.className = "ghost loraFolderDrawerRoot";
        rootButton.textContent = "LoRAフォルダを開く";
        rootButton.addEventListener("click", () => void openRoot());
        const tree = document.createElement("div");
        tree.className = "loraFolderTree loraFolderDrawerTree";
        tree.setAttribute("role", "tree");
        tree.setAttribute("aria-label", "LoRAフォルダ一覧");
        body.append(rootButton, tree);
        renderFolderTree(tree, items, {
          selectedFolder,
          expandedFolders,
          onToggle: toggleFolder,
          onSelect: (folder) => { selectFolder(folder); close(); }
        });
      },
      actions: [{ label: "閉じる", value: true, variant: "ghost" }]
    });
  }

  function showTransientPreview(lora) {
    if (!lora) return restorePinnedPreview();
    renderPreview(lora, { pinned: pinnedName === lora.name });
  }

  function pinPreview(lora) {
    if (!lora) return;
    pinnedName = lora.name;
    renderPreview(lora, { pinned: true });
  }

  function restorePinnedPreview() {
    const pinned = pinnedName ? findByName(pinnedName) : null;
    if (!pinned) pinnedName = null;
    renderPreview(pinned, { pinned: Boolean(pinned) });
  }

  function createPlaceholder(lora) {
    const placeholder = document.createElement("span");
    placeholder.className = "loraThumbPlaceholder";
    placeholder.setAttribute("aria-hidden", "true");
    placeholder.textContent = (lora?.displayName ?? "?").trim().charAt(0) || "?";
    return placeholder;
  }

  function createTriggerWordsNode(triggerWords) {
    if (triggerWords.length <= 60) {
      const span = document.createElement("span");
      span.textContent = triggerWords;
      return span;
    }
    const details = document.createElement("details");
    details.className = "loraTriggerWords";
    const summary = document.createElement("summary");
    summary.textContent = `${triggerWords.slice(0, 48)}…`;
    const body = document.createElement("span");
    body.textContent = triggerWords;
    details.append(summary, body);
    return details;
  }

  function renderPreview(lora, { pinned = false, container = elements.loraPreview } = {}) {
    if (!container) return;
    const isMainPane = container === elements.loraPreview;
    container.replaceChildren();
    if (isMainPane) displayedName = lora?.name ?? null;
    if (!lora) {
      const hint = document.createElement("p");
      hint.className = "loraPreviewHint";
      hint.textContent = "LoRAにカーソルを合わせるか選ぶと、作例画像と詳細をここに表示します。";
      container.append(hint);
      return;
    }
    const profile = resolveProfile(lora);
    const registry = lora.registry;
    const compatibility = getCompatibility(lora);
    const figure = document.createElement("div");
    figure.className = "loraPreviewImage";
    const url = resolveLoraPreviewUrl(lora);
    if (url) {
      const image = document.createElement("img");
      image.loading = "lazy";
      image.decoding = "async";
      image.alt = `${lora.displayName}の作例`;
      image.src = url;
      image.title = "クリックで拡大";
      image.addEventListener("error", () => {
        figure.replaceChildren(createPlaceholder(lora));
        figure.classList.add("noPreview");
      });
      figure.classList.add("clickable");
      figure.addEventListener("click", () => openImageModal(url, `${lora.displayName}の作例`));
      figure.append(image);
    } else {
      figure.classList.add("noPreview");
      figure.append(createPlaceholder(lora));
    }
    container.append(figure);
    const header = document.createElement("div");
    header.className = "loraPreviewHeader";
    const title = document.createElement("strong");
    title.className = "loraPreviewTitle";
    title.textContent = lora.displayName;
    header.append(title);
    if (pinned) {
      const badge = document.createElement("span");
      badge.className = "loraPreviewPinned";
      badge.textContent = "固定中";
      header.append(badge);
    }
    container.append(header);
    const addFieldTo = (target) => (label, value) => {
      if (value === null || value === undefined || value === "") return;
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      if (typeof Node !== "undefined" && value instanceof Node) dd.append(value);
      else dd.textContent = String(value);
      target.append(dt, dd);
    };
    const list = document.createElement("dl");
    list.className = "loraPreviewFields";
    const addField = addFieldTo(list);
    addField("保存場所", formatLoraRelativeLocation(lora));
    const baseModel = registry?.baseModel ?? profile?.baseModel;
    addField("Base Model", baseModel);
    if (baseModel && runtime.getState?.().selectedCheckpoint) {
      const badge = document.createElement("span");
      badge.className = `loraCompatibility ${compatibility.level}`;
      badge.textContent = compatibility.label;
      badge.title = compatibility.message;
      addField("互換性", badge);
    }
    const recommended = getRecommendedWeight(registry);
    const currentWeight = controls.getWeight?.(lora.name)
      ?? recommended?.weight ?? profile?.recommendedWeight ?? getConfig().defaultWeight;
    if (recommended) {
      addField("Recommended Weight", recommended.weight.toFixed(2));
      if (recommended.min != null) addField("Recommended Range", recommended.label);
    }
    addField("現在値", Number(currentWeight).toFixed(2));
    const triggerWords = controls.getTrigger?.(lora.name) ?? "";
    if (triggerWords) {
      addField(
        typeof registry?.characterTriggerWords === "string" ? "基本セット" : "Trigger Words",
        createTriggerWordsNode(triggerWords)
      );
    }
    if (list.childElementCount) container.append(list);
    const moreList = document.createElement("dl");
    moreList.className = "loraPreviewFields";
    const addMore = addFieldTo(moreList);
    addMore("Category", getCategory(lora) === "character" ? "キャラクター" : "画風・体型・構図");
    addMore("Subcategory", SUBCATEGORY_LABELS[registry?.subcategory] ?? registry?.subcategory);
    const presetCount = profile?.presets
      ? profile.presets.filter((preset) => preset.id !== "identity").length
      : (registry?.outfitPresets?.length ?? 0);
    if (presetCount > 0) addMore("衣装プリセット", `${presetCount}種`);
    addMore("Civitaiモデル", registry?.modelName);
    addMore("Civitaiバージョン", registry?.versionName);
    if (moreList.childElementCount) {
      const more = document.createElement("details");
      more.className = "loraPreviewMore";
      const summary = document.createElement("summary");
      summary.textContent = "詳細情報";
      more.append(summary, moreList);
      container.append(more);
    }
    const actions = document.createElement("div");
    actions.className = "loraPreviewActions";
    const toggle = document.createElement("button");
    toggle.type = "button";
    const isSelected = Boolean(controls.isSelected?.(lora.name));
    toggle.className = isSelected ? "secondary" : "primary";
    toggle.textContent = isSelected ? "LoRAを解除" : "LoRAを選択";
    toggle.addEventListener("click", () => {
      toggleSelection(lora);
      if (!isMainPane) renderPreview(lora, { pinned, container });
    });
    actions.append(toggle);
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "secondary";
    edit.textContent = "編集";
    edit.title = "表示名・分類・Trigger Words・推奨Weightなどを編集";
    edit.addEventListener("click", () => void editMetadata(lora, edit));
    actions.append(edit);
    if (recommended && Number(currentWeight).toFixed(2) !== recommended.weight.toFixed(2)) {
      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "ghost loraResetWeight";
      reset.textContent = recommended.min != null
        ? `中央値${recommended.weight.toFixed(2)}へ戻す`
        : `推奨${recommended.weight.toFixed(2)}へ戻す`;
      reset.addEventListener("click", () => applyRecommendedWeight(lora));
      actions.append(reset);
    }
    const sourceUrl = profile?.sourceUrl || registry?.sourceUrl;
    if (sourceUrl && sourceUrl !== "#") {
      const link = document.createElement("a");
      link.className = "loraPreviewLink";
      link.href = sourceUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Civitai";
      actions.append(link);
    }
    container.append(actions);
  }

  function toggleSelection(lora) {
    const selected = Boolean(controls.isSelected?.(lora.name));
    if (!selected && (controls.selectedCount?.() ?? 0) >= getConfig().maxSelected) {
      showError(`LoRAは最大${getConfig().maxSelected}個までです`);
      return;
    }
    const weight = controls.getWeight?.(lora.name)
      ?? lora.registry?.recommendedWeight ?? getConfig().defaultWeight;
    controls.setSelected?.(lora.name, !selected, weight);
    clearError();
    pinnedName = lora.name;
    controls.renderSummary?.();
    render();
  }

  function applyRecommendedWeight(lora) {
    const recommended = getRecommendedWeight(lora.registry);
    if (!recommended) return;
    controls.setWeight?.(lora.name, recommended.weight, { syncPrompt: true });
    pinnedName = lora.name;
    controls.renderSummary?.();
    render();
  }

  function createThumb(lora) {
    const thumb = document.createElement("button");
    thumb.type = "button";
    thumb.className = "loraThumb";
    thumb.setAttribute("aria-label", `${lora.displayName}のプレビューを固定`);
    const url = resolveLoraPreviewUrl(lora);
    if (url) {
      const image = document.createElement("img");
      image.loading = "lazy";
      image.decoding = "async";
      image.alt = "";
      image.src = url;
      image.addEventListener("error", () => {
        image.remove();
        thumb.classList.add("noPreview");
        thumb.append(createPlaceholder(lora));
      });
      thumb.append(image);
    } else {
      thumb.classList.add("noPreview");
      thumb.append(createPlaceholder(lora));
    }
    thumb.addEventListener("click", () => pinPreview(lora));
    return thumb;
  }

  function fillPresetSelect(select, profile, selectedPresetId) {
    select.replaceChildren();
    if (!profile) {
      select.append(new Option("衣装プリセットなし", ""));
      select.disabled = true;
      return;
    }
    select.disabled = false;
    const identityGroup = document.createElement("optgroup");
    identityGroup.label = "キャラのみ";
    const outfitGroup = document.createElement("optgroup");
    outfitGroup.label = profile.category === "direction" ? "キャラクター" : "衣装プリセット";
    for (const preset of profile.presets) {
      const option = new Option(preset.name, preset.id);
      if (preset.id === "identity") identityGroup.append(option);
      else outfitGroup.append(option);
    }
    if (identityGroup.children.length) select.append(identityGroup);
    if (outfitGroup.children.length) select.append(outfitGroup);
    select.value = getPreset(profile, selectedPresetId)?.id ?? profile.defaultPreset;
  }

  function profileAddon(profile, addonId) {
    if (!profile?.addons?.length) return null;
    return profile.addons.find((addon) => addon.id === addonId)
      ?? profile.addons.find((addon) => addon.id === profile.defaultAddon)
      ?? profile.addons[0];
  }

  function fillAddonSelect(select, profile, selectedAddonId) {
    select.replaceChildren();
    if (!profile?.addons?.length) {
      select.append(new Option("追加衣装なし", ""));
      select.disabled = true;
      select.classList.add("hidden");
      return;
    }
    select.disabled = false;
    select.classList.remove("hidden");
    for (const addon of profile.addons) select.append(new Option(addon.name, addon.id));
    select.value = profileAddon(profile, selectedAddonId)?.id ?? "";
  }

  function createRow(lora) {
    const profile = resolveProfile(lora);
    const registry = lora.registry;
    const compatibility = getCompatibility(lora);
    const isCharacter = getCategory(lora) === "character";
    const weight = controls.getWeight?.(lora.name) ?? registry?.recommendedWeight ?? getConfig().defaultWeight;
    const row = document.createElement("div");
    row.className = "loraRow";
    row.classList.toggle("selected", Boolean(controls.isSelected?.(lora.name)));
    if (registry?.baseModel && ["caution", "incompatible"].includes(compatibility.level)) {
      row.classList.add(`compatibility-${compatibility.level}`);
    }
    const choice = document.createElement("label");
    choice.className = "loraChoice";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(controls.isSelected?.(lora.name));
    const names = document.createElement("span");
    names.className = "loraNames";
    const title = document.createElement("strong");
    title.textContent = lora.displayName;
    const location = document.createElement("small");
    location.className = "loraRelativeLocation";
    location.textContent = formatLoraRelativeLocation(lora);
    location.title = location.textContent;
    names.append(title, location);
    const badges = document.createElement("div");
    badges.className = "loraBadges";
    if (registry?.baseModel && runtime.getState?.().selectedCheckpoint) {
      const badge = document.createElement("small");
      badge.className = `loraCompatibility ${compatibility.level}`;
      badge.textContent = `${compatibility.label}・${registry.baseModel}`;
      badge.title = compatibility.message;
      badges.append(badge);
    }
    const recommended = getRecommendedWeight(registry);
    if (recommended) {
      const badge = document.createElement("small");
      badge.className = "loraRecommendedBadge";
      badge.textContent = recommended.badge;
      badge.title = recommended.min != null
        ? `Civitai推奨Weight範囲 ${recommended.label}`
        : `Civitai推奨Weight ${recommended.display}`;
      badges.append(badge);
    }
    if (badges.childElementCount) names.append(badges);
    choice.append(checkbox, names);
    const weightWrap = document.createElement("label");
    weightWrap.className = "loraWeight";
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0.05";
    slider.max = "2";
    slider.step = "0.05";
    slider.value = String(weight);
    slider.setAttribute("aria-label", `${lora.displayName}の強度`);
    const output = document.createElement("output");
    output.textContent = Number(weight).toFixed(2);
    weightWrap.append(slider, output);
    const triggerInput = document.createElement("input");
    triggerInput.type = "text";
    triggerInput.className = "loraTrigger";
    triggerInput.placeholder = "Trigger Words（例: modern_anime_render）";
    triggerInput.value = controls.getTrigger?.(lora.name) ?? "";
    triggerInput.setAttribute("aria-label", `${lora.displayName}のTrigger Words`);
    const negativeInput = document.createElement("input");
    negativeInput.type = "text";
    negativeInput.className = "loraNegative";
    negativeInput.placeholder = isCharacter
      ? "標準衣装の抑制タグ（Negativeへ自動追加）"
      : "このLoRA使用時にNegativeへ追加するタグ";
    negativeInput.value = controls.getNegative?.(lora.name) ?? "";
    negativeInput.setAttribute("aria-label", `${lora.displayName}のNegative追加タグ`);
    const advanced = document.createElement("details");
    advanced.className = "loraAdvanced";
    const advancedSummary = document.createElement("summary");
    advancedSummary.textContent = isCharacter || profile
      ? "キャラ・衣装・Trigger設定"
      : "Trigger・Negative設定";
    const advancedBody = document.createElement("div");
    advancedBody.className = "loraAdvancedBody";
    const profileControls = document.createElement("div");
    profileControls.className = "loraProfileControls";
    const profileSelect = document.createElement("select");
    profileSelect.className = "loraProfileSelect";
    profileSelect.setAttribute("aria-label", `${lora.displayName}のプロフィール`);
    profileSelect.append(new Option("プロフィール未設定", ""));
    for (const item of LORA_PROFILES) profileSelect.append(new Option(item.name, item.id));
    if (profile && !getProfile(profile.id)) profileSelect.append(new Option(profile.name, profile.id));
    profileSelect.value = profile?.id ?? "";
    const presetSelect = document.createElement("select");
    presetSelect.className = "loraPresetSelect";
    presetSelect.setAttribute("aria-label", `${lora.displayName}の衣装プリセット`);
    fillPresetSelect(presetSelect, profile, controls.getPresetSelection?.(lora.name));
    const addonSelect = document.createElement("select");
    addonSelect.className = "loraAddonSelect";
    addonSelect.setAttribute("aria-label", `${lora.displayName}の追加衣装`);
    fillAddonSelect(addonSelect, profile, controls.getAddonSelection?.(lora.name));
    const sourceLink = document.createElement("a");
    sourceLink.className = "loraSourceLink";
    sourceLink.textContent = "配布元";
    sourceLink.target = "_blank";
    sourceLink.rel = "noreferrer";
    sourceLink.href = profile?.sourceUrl ?? registry?.sourceUrl ?? "#";
    sourceLink.classList.toggle("hidden", !profile && !registry);
    if (profile) sourceLink.title = `${profile.baseModel}・${profile.note}`;
    else if (registry) sourceLink.title = `${registry.baseModel}・Civitaiから登録`;
    profileControls.append(profileSelect, presetSelect, addonSelect, sourceLink);
    if (isCharacter || profile) advancedBody.append(profileControls);
    else if (registry) {
      profileControls.classList.add("sourceOnly");
      profileSelect.classList.add("hidden");
      presetSelect.classList.add("hidden");
      advancedBody.append(profileControls);
    }
    advancedBody.append(triggerInput, negativeInput);
    advanced.append(advancedSummary, advancedBody);

    checkbox.addEventListener("change", () => {
      if (checkbox.checked && (controls.selectedCount?.() ?? 0) >= getConfig().maxSelected) {
        checkbox.checked = false;
        showError(`LoRAは最大${getConfig().maxSelected}個までです`);
        return;
      }
      controls.setSelected?.(lora.name, checkbox.checked, Number(slider.value));
      clearError();
      controls.renderSummary?.();
      if (activeCategory === "selected" && !checkbox.checked) render();
      else {
        renderCategoryButtons();
        if (displayedName === lora.name) renderPreview(lora, { pinned: pinnedName === lora.name });
      }
    });
    slider.addEventListener("input", () => {
      const nextWeight = Number(slider.value);
      output.textContent = nextWeight.toFixed(2);
      controls.setWeight?.(lora.name, nextWeight, { syncPrompt: true });
      if (controls.isSelected?.(lora.name)) controls.renderSummary?.();
    });
    triggerInput.addEventListener("input", () => {
      controls.setTrigger?.(lora.name, triggerInput.value.trim());
      controls.scheduleShare?.();
      if (controls.isSelected?.(lora.name)) controls.renderSummary?.();
    });
    negativeInput.addEventListener("input", () => {
      controls.setNegative?.(lora.name, negativeInput.value.trim());
      if (controls.isSelected?.(lora.name)) controls.renderSummary?.();
    });
    profileSelect.addEventListener("change", () => {
      const nextProfile = getProfile(profileSelect.value)
        ?? (profileSelect.value === profile?.id ? profile : null);
      if (!nextProfile) controls.clearProfile?.(lora.name);
      else {
        const preset = getPreset(nextProfile, nextProfile.defaultPreset);
        const addon = profileAddon(nextProfile, nextProfile.defaultAddon);
        controls.selectProfile?.(lora.name, nextProfile, preset, addon);
      }
      render();
      controls.renderSummary?.();
    });
    presetSelect.addEventListener("change", () => {
      const currentProfile = getProfile(profileSelect.value)
        ?? (profileSelect.value === profile?.id ? profile : null);
      const preset = getPreset(currentProfile, presetSelect.value);
      if (!currentProfile || !preset) return;
      const addon = profileAddon(currentProfile, addonSelect.value);
      controls.selectPreset?.(lora.name, currentProfile, preset, addon);
      triggerInput.value = controls.getTrigger?.(lora.name) ?? "";
      negativeInput.value = controls.getNegative?.(lora.name) ?? "";
      slider.value = String(controls.getWeight?.(lora.name) ?? weight);
      output.textContent = Number(slider.value).toFixed(2);
      controls.renderSummary?.();
    });
    addonSelect.addEventListener("change", () => {
      const currentProfile = getProfile(profileSelect.value)
        ?? (profileSelect.value === profile?.id ? profile : null);
      const preset = getPreset(currentProfile, presetSelect.value);
      const addon = profileAddon(currentProfile, addonSelect.value);
      if (!currentProfile || !preset || !addon) return;
      controls.selectAddon?.(lora.name, currentProfile, preset, addon);
      triggerInput.value = controls.getTrigger?.(lora.name) ?? "";
      negativeInput.value = controls.getNegative?.(lora.name) ?? "";
      controls.renderSummary?.();
    });
    const main = document.createElement("div");
    main.className = "loraMain";
    const detailButton = document.createElement("button");
    detailButton.type = "button";
    detailButton.className = "ghost smallButton loraDetailButton";
    detailButton.textContent = "詳細";
    detailButton.setAttribute("aria-label", `${lora.displayName}の詳細を表示`);
    detailButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (window?.matchMedia?.("(max-width: 1099px)")?.matches) openDetailModal(lora);
      else pinPreview(lora);
    });
    main.append(createThumb(lora), choice, detailButton);
    row.append(main, weightWrap, advanced);
    row.addEventListener("mouseenter", () => showTransientPreview(lora));
    row.addEventListener("mouseleave", restorePinnedPreview);
    row.addEventListener("focusin", () => showTransientPreview(lora));
    row.addEventListener("focusout", (event) => {
      if (!row.contains(event.relatedTarget)) restorePinnedPreview();
    });
    return row;
  }

  function openDetailModal(lora) {
    openModal({
      title: lora.displayName || lora.name,
      subtitle: formatLoraRelativeLocation(lora),
      size: "medium",
      build: (body) => {
        const pane = document.createElement("div");
        pane.className = "loraPreview loraPreviewModal";
        pane.setAttribute("aria-live", "polite");
        pane.setAttribute("aria-label", "LoRA詳細");
        body.append(pane);
        renderPreview(lora, { pinned: true, container: pane });
      },
      actions: [{ label: "閉じる", value: true, variant: "ghost" }]
    });
  }

  async function editMetadata(lora, button) {
    return withBusy(button, "準備中…", async () => {
      try {
        const relativeName = String(lora.name ?? "").replaceAll("\\", "/");
        const { entry } = await postJson("/api/loras/registry/ensure", {
          relativeName,
          displayName: lora.displayName ?? ""
        });
        await openEditor({
          lora,
          entry,
          folders: getInstallFolders(),
          onSave: async (patch) => {
            const result = await patchJson(`/api/loras/${entry.uid}`, patch);
            if (Array.isArray(result.loras)) setItems(result.loras);
            toast.success?.(`${result.entry.displayName || result.entry.modelName || "LoRA"} の情報を保存しました`);
          },
          onMove: async (folder) => {
            const result = await postJson(`/api/loras/${entry.uid}/move`, { folder, confirm: true });
            if (Array.isArray(result.loras)) setItems(result.loras);
            toast.success?.(`${folder} へ移動しました（${result.moved.length}ファイル）`);
          }
        });
        await load();
        await reloadInstallFolders();
      } catch (error) {
        toast.error?.(error.message);
      }
    });
  }

  async function toggleFavorite(loraName, favorite) {
    const lora = findByName(loraName);
    if (!lora) return null;
    try {
      let uid = lora.registry?.uid;
      if (!uid) {
        const { entry } = await postJson("/api/loras/registry/ensure", {
          relativeName: String(loraName).replaceAll("\\", "/"),
          displayName: lora.displayName ?? ""
        });
        uid = entry.uid;
      }
      const result = await patchJson(`/api/loras/${uid}`, { favorite });
      if (Array.isArray(result.loras)) setItems(result.loras);
      else if (lora.registry) lora.registry.favorite = favorite;
      render();
      return favorite;
    } catch (error) {
      toast.error?.(`Favoriteを保存できませんでした: ${error.message}`);
      return null;
    }
  }

  async function openPicker() {
    if (runtime.getState?.().switching) {
      toast.info?.("Runtimeの一覧を更新中です。完了してからLoRAを選択してください");
      return;
    }
    const pickerItems = buildLoraCatalog(items, { resolveThumbnail: resolveLoraPreviewUrl });
    await openPresetPicker({
      title: "LoRAを追加",
      subtitle: `最大${getConfig().maxSelected}個まで。★はLoRAのお気に入り（画像のFavoriteとは別です）`,
      items: pickerItems,
      groupKey: "folder",
      folderBrowser: true,
      isApplied: (item) => Boolean(controls.isSelected?.(item.loraName)),
      onApply: (item) => {
        if (controls.isSelected?.(item.loraName)) controls.setSelected?.(item.loraName, false);
        else if (!controls.addToForm?.(item.loraName)) return;
        controls.renderSummary?.();
        render();
      }
    });
  }

  async function loadRoot() {
    const generation = lifecycle;
    const token = ++rootToken;
    try {
      const next = await getJson("/api/lora/install-root");
      if (generation !== lifecycle || token !== rootToken) return false;
      rootInfo = next;
    } catch (error) {
      if (generation !== lifecycle || token !== rootToken) return false;
      rootInfo = { root: "", source: "", label: "取得失敗", warning: error.message };
    }
    renderRoot();
    return true;
  }

  function renderRoot() {
    const { root, source, label, warning } = rootInfo;
    if (elements.loraRootPath) {
      elements.loraRootPath.textContent = root || "特定できていません";
      elements.loraRootPath.title = warning || root || "";
    }
    if (elements.loraRootBadge) {
      elements.loraRootBadge.textContent = label || "未特定";
      elements.loraRootBadge.className = `loraRootBadge ${
        source === "config" ? "configured" : source ? "detected" : "missing"
      }`;
    }
    if (elements.openLoraRootButton) elements.openLoraRootButton.disabled = !root;
  }

  async function openRoot() {
    return withBusy(elements.openLoraRootButton, "開いています…", async () => {
      try {
        const data = await postJson("/api/lora/open-root", {});
        toast.success?.(`LoRAフォルダを開きました: ${data.root}`);
      } catch (error) {
        toast.error?.(error.message);
      }
    });
  }

  function getState() {
    return {
      selectedFolder,
      expandedFolders: new Set(expandedFolders),
      pinnedName,
      displayedName,
      activeCategory
    };
  }

  function restoreState(state = {}) {
    selectedFolder = state.selectedFolder ?? "";
    expandedFolders.clear();
    for (const folder of state.expandedFolders ?? []) expandedFolders.add(folder);
    pinnedName = state.pinnedName ?? null;
    activeCategory = ["character", "direction", "selected", "all"].includes(state.activeCategory)
      ? state.activeCategory
      : activeCategory;
    render();
  }

  function setBusy(busy) {
    if (elements.refreshLorasButton) elements.refreshLorasButton.disabled = Boolean(busy);
  }

  return {
    init,
    dispose,
    load,
    render,
    getItems,
    setItems,
    findByName,
    getCategory,
    getCompatibility,
    renderFolderTree,
    expandFolderPath,
    editMetadata,
    toggleFavorite,
    openPicker,
    loadRoot,
    getRootInfo: () => ({ ...rootInfo }),
    getState,
    restoreState,
    setBusy
  };
}
