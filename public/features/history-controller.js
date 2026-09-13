import { createRecentHistoryService } from "../core/recent-history-service.js";
import {
  collectCheckpoints,
  collectLoras,
  collectPromptTags,
  describeGalleryFilter,
  filterGalleryEntries,
  sortGalleryEntries,
  toGalleryEntries
} from "../gallery-filter.js";
import { configureThumbnailImage, originalImageUrl } from "../image-delivery.js";
import { buildMetadataText, buildPromptText } from "../metadata-format.js";
import {
  PROMPT_FIELDS,
  PROMPT_FIELD_LABELS,
  formatTriggerWord,
  normalizeAppliedTriggerWords
} from "../structured-prompt.js";

export const HISTORY_PAGE_SIZE = 20;

const DEFAULT_FILTER = Object.freeze({
  kind: "all",
  rating: "all",
  checkpoint: "",
  lora: "",
  period: "",
  query: "",
  tags: []
});

export function mergeHistoryGenerations(current, incoming) {
  const merged = (current ?? []).map((generation) => ({
    ...generation,
    images: [...(generation.images ?? [])]
  }));
  const byGeneration = new Map(merged.map((generation) => [generation.id, generation]));
  for (const generation of incoming ?? []) {
    const existing = byGeneration.get(generation.id);
    if (!existing) {
      const added = { ...generation, images: [...(generation.images ?? [])] };
      merged.push(added);
      byGeneration.set(added.id, added);
      continue;
    }
    const imageIds = new Set(existing.images.map((image) => image.id));
    for (const image of generation.images ?? []) {
      if (imageIds.has(image.id)) continue;
      existing.images.push(image);
      imageIds.add(image.id);
    }
  }
  return merged;
}

export function createHistoryController({
  document,
  elements,
  getJson,
  patchJson,
  deleteJson,
  imageState,
  toast,
  showError,
  confirmModal,
  openImageModal,
  copyToClipboard,
  flashLabel,
  generationTitle,
  formatCheckpointBadge,
  formatDate,
  shorten,
  getStudioHistoryFilter = () => "all",
  onStudioRecentData = () => {},
  onStudioRecentError = () => {},
  isCompareMode = () => false,
  isCompareSelected = () => false,
  syncCompareControl = () => {},
  onToggleCompare = () => {},
  onLoadRecipe = () => {},
  onUseAsImg2Img = () => {},
  onUseAsInpaint = () => {},
  onRegenerate = () => {},
  onChangeLora = () => {},
  onDerive = () => {},
  onDuplicateRecipe = () => {},
  isHiresAvailable = () => false,
  onHires = () => {},
  onPreferencesChanged = () => {},
  onRendered = () => {}
}) {
  let generations = [];
  let entries = [];
  let cursor = null;
  let hasMore = true;
  let loading = false;
  let loadRevision = 0;
  const recentHistory = createRecentHistoryService({ getJson, onData: onStudioRecentData, onError: onStudioRecentError });
  let total = 0;
  let filter = { ...DEFAULT_FILTER, tags: [] };
  let sort = "newest";
  let tagQuery = "";
  let initialized = false;
  let loadMoreObserver = null;
  let autoLoadFailed = false;
  let failedAppend = false;
  const listeners = [];
  const activeDetailClosers = new Set();

  const bind = (element, type, listener) => {
    element.addEventListener(type, listener);
    listeners.push([element, type, listener]);
  };

  function init() {
    if (initialized) return;
    initialized = true;
    bind(elements.refreshHistoryButton, "click", refresh);
    bind(elements.historyLoadMoreButton, "click", loadMore);
    bind(elements.galleryFilterButton, "click", openFilterDialog);
    bind(elements.galleryFilterCloseButton, "click", closeFilterDialog);
    bind(elements.galleryFilterDialog, "click", closeFilterDialogOnBackdrop);
    bind(elements.gallerySort, "change", changeSort);
    bind(elements.galleryAllButton, "click", showAll);
    bind(elements.galleryFavoriteButton, "click", showFavorites);
    bind(elements.galleryKindFilter, "click", changeKind);
    for (const element of [elements.galleryCheckpoint, elements.galleryLora, elements.galleryPeriod]) {
      bind(element, "change", changeSelectFilters);
    }
    bind(elements.gallerySearch, "input", changeSearch);
    bind(elements.galleryTagSearch, "input", changeTagSearch);
    for (const container of [elements.galleryRatingFilter, elements.galleryRatingDialogFilter]) {
      bind(container, "click", changeRating);
    }
    bind(elements.resetGalleryFilterButton, "click", resetFilter);
    const Observer = document.defaultView?.IntersectionObserver;
    if (Observer) {
      loadMoreObserver = new Observer(items => {
        if (items.some(item => item.isIntersecting) && !autoLoadFailed && !loading && hasMore) void loadMore();
      }, { rootMargin: "160px" });
      loadMoreObserver.observe(elements.historyLoadMoreButton);
    }
  }

  function dispose() {
    loadMoreObserver?.disconnect();
    loadMoreObserver = null;
    loadRevision += 1;
    recentHistory.dispose();
    loading = false;
    for (const closeDetail of [...activeDetailClosers]) closeDetail();
    if (!initialized) return;
    for (const [element, type, listener] of listeners.splice(0)) element.removeEventListener(type, listener);
    initialized = false;
  }

  async function load({ append = false } = {}) {
    if (append && (loading || !hasMore)) return;
    const revision = ++loadRevision;
    autoLoadFailed = false;
    loading = true;
    elements.historyLoadMoreButton.disabled = true;
    elements.historyLoadMoreButton.textContent = append ? "読み込み中…" : "履歴を読み込み中…";
    try {
      const cursorQuery = append && cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
      const favoriteQuery = filter.kind === "favorite" ? "&favorites=1" : "";
      const ratingQuery = filter.rating === "all" ? "" : `&rating=${encodeURIComponent(filter.rating)}`;
      const historyRequest = getJson(`/api/history?limit=${HISTORY_PAGE_SIZE}${favoriteQuery}${ratingQuery}${cursorQuery}`);
      const [historyData, preferences] = append
        ? [await historyRequest, null]
        : await Promise.all([historyRequest, getJson("/api/history/preferences")]);
      if (revision !== loadRevision) return;
      if (preferences) onPreferencesChanged(preferences);
      cursor = historyData.nextCursor ?? null;
      hasMore = historyData.hasMore === true;
      total = Number(historyData.total) || 0;
      generations = append
        ? mergeHistoryGenerations(generations, historyData.generations ?? [])
        : (historyData.generations ?? []);
      render(generations);
    } catch (error) {
      if (revision !== loadRevision) return;
      autoLoadFailed = true;
      failedAppend = append;
      if (!append) elements.historyGrid.textContent = `履歴を取得できません: ${error.message}`;
      else toast.error(`追加の履歴を取得できません: ${error.message}`);
    } finally {
      if (revision === loadRevision) {
        loading = false;
        elements.historyLoadMoreButton.disabled = false;
        elements.historyLoadMoreButton.textContent = autoLoadFailed ? "再試行" : `さらに${HISTORY_PAGE_SIZE}件読み込む`;
        elements.historyLoadMoreButton.hidden = !hasMore && !autoLoadFailed;
      }
    }
  }

  async function loadMore() {
    await load({ append: autoLoadFailed ? failedAppend : true });
  }

  async function loadStudioRecent(studioFilter = getStudioHistoryFilter()) {
    await recentHistory.load(studioFilter);
  }

  function render(nextGenerations = generations) {
    generations = nextGenerations ?? [];
    imageState.rememberImageFavorites(generations);
    imageState.rememberDiscordStates(generations);
    elements.historyGrid.replaceChildren();
    const allEntries = toGalleryEntries(generations);
    renderFilterOptions(allEntries);
    entries = sortGalleryEntries(filterGalleryEntries(allEntries, filter), sort);
    elements.galleryFilterSummary.textContent = describeGalleryFilter(filter, allEntries.length, entries.length);
    for (const [index, { generation, image }] of entries.entries()) {
      elements.historyGrid.append(createCard(generation, image, index));
    }
    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = hasFilter()
        ? "条件に一致する画像がありません"
        : "生成すると画像とレシピがここへ保存されます";
      elements.historyGrid.append(empty);
    }
    if (total > allEntries.length) {
      elements.galleryFilterSummary.textContent += `（${total}枚中${allEntries.length}枚を取得済み）`;
    }
    syncFilterState();
    updateFilterDialogSummary();
    elements.historyLoadMoreButton.hidden = !hasMore;
    const galleryUsesFavoriteDataset = filter.kind === "favorite";
    const studioUsesFavoriteDataset = getStudioHistoryFilter() === "favorite";
    if (galleryUsesFavoriteDataset === studioUsesFavoriteDataset && filter.rating === "all") {
      recentHistory.replace(generations);
    }
    else void loadStudioRecent();
    onRendered(generations, entries);
  }

  function hasFilter() {
    return filter.kind !== "all"
      || filter.rating !== "all"
      || Boolean(filter.checkpoint || filter.lora || filter.period || filter.query)
      || filter.tags.length > 0;
  }

  function setFilter(patch) {
    const wasFavorite = filter.kind === "favorite";
    const previousRating = filter.rating;
    filter = {
      ...filter,
      ...patch,
      tags: Array.isArray(patch.tags)
        ? [...new Map(patch.tags.map((tag) => [String(tag).trim().toLowerCase(), String(tag).trim()])).values()]
        : filter.tags
    };
    syncFilterState();
    if (wasFavorite !== (filter.kind === "favorite") || previousRating !== filter.rating) {
      resetPaging();
      void load();
      return;
    }
    render(generations);
  }

  function resetFilter() {
    elements.galleryCheckpoint.value = "";
    elements.galleryLora.value = "";
    elements.galleryPeriod.value = "";
    elements.gallerySearch.value = "";
    elements.galleryTagSearch.value = "";
    tagQuery = "";
    setFilter({ ...DEFAULT_FILTER, tags: [] });
  }

  function renderFilterOptions(allEntries) {
    fillFilterSelect(elements.galleryCheckpoint, collectCheckpoints(allEntries), filter.checkpoint);
    fillFilterSelect(elements.galleryLora, collectLoras(allEntries), filter.lora);
    renderSelectedTags();
    renderTagOptions(allEntries);
    updateFilterDialogSummary();
  }

  function syncFilterState() {
    for (const button of elements.galleryKindFilter.querySelectorAll("[data-gallery-kind]")) {
      const active = button.dataset.galleryKind === filter.kind;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    for (const container of [elements.galleryRatingFilter, elements.galleryRatingDialogFilter]) {
      for (const button of container.querySelectorAll("[data-gallery-rating]")) {
        const active = button.dataset.galleryRating === filter.rating;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
      }
    }
    const favoriteActive = filter.kind === "favorite";
    for (const [button, active] of [[elements.galleryAllButton, !favoriteActive], [elements.galleryFavoriteButton, favoriteActive]]) {
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    elements.gallerySort.value = sort;
  }

  function openFilterDialog() {
    renderFilterOptions(toGalleryEntries(generations));
    if (!elements.galleryFilterDialog.open) elements.galleryFilterDialog.showModal();
  }

  function updateFilterDialogSummary() {
    elements.galleryFilterDialogSummary.textContent = `${elements.galleryFilterSummary.textContent}（取得済みデータのみ）`;
  }

  function renderSelectedTags() {
    elements.gallerySelectedTags.replaceChildren();
    if (!filter.tags.length) {
      const empty = document.createElement("span");
      empty.className = "galleryTagEmpty";
      empty.textContent = "選択中のタグはありません";
      elements.gallerySelectedTags.append(empty);
      return;
    }
    for (const tag of filter.tags) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "gallerySelectedTag";
      button.textContent = `× ${tag}`;
      button.title = `${tag}を解除`;
      button.addEventListener("click", () => setFilter({ tags: filter.tags.filter((item) => item !== tag) }));
      elements.gallerySelectedTags.append(button);
    }
  }

  function renderTagOptions(allEntries) {
    const query = tagQuery.trim().toLowerCase();
    const tags = collectPromptTags(allEntries).filter((tag) => !query || tag.toLowerCase().includes(query));
    elements.galleryTagOptions.replaceChildren();
    if (!tags.length) {
      const empty = document.createElement("span");
      empty.className = "galleryTagEmpty";
      empty.textContent = query ? "一致するタグがありません" : "取得済みPromptから候補を収集中です";
      elements.galleryTagOptions.append(empty);
      return;
    }
    for (const tag of tags) {
      const selected = filter.tags.some((item) => item.toLowerCase() === tag.toLowerCase());
      const button = document.createElement("button");
      button.type = "button";
      button.className = "galleryTagOption";
      button.textContent = tag;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(selected));
      button.disabled = selected;
      button.addEventListener("click", () => setFilter({ tags: [...filter.tags, tag] }));
      elements.galleryTagOptions.append(button);
    }
  }

  function fillFilterSelect(select, values, selected) {
    const current = selected ?? select.value;
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "すべて";
    select.replaceChildren(option);
    for (const value of values) {
      const item = document.createElement("option");
      item.value = value;
      item.textContent = shorten(value, 40);
      select.append(item);
    }
    select.value = values.includes(current) ? current : "";
  }

  function createCard(generation, image, index = 0) {
    const card = document.createElement("article");
    card.className = "historyCard";
    const previewWrap = document.createElement("div");
    previewWrap.className = "historyCardPreview";
    const preview = document.createElement("img");
    preview.className = "historyCardImage";
    configureThumbnailImage(preview, image, { eager: index < 4 });
    preview.alt = generationTitle(generation);
    preview.title = "画像と生成情報を開く";
    preview.tabIndex = 0;
    preview.setAttribute("role", "button");
    preview.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openDetail(generation, image); }
    });
    card.addEventListener("click", (event) => {
      if (event.target.closest("button, summary, details, input, a")) return;
      openDetail(generation, image);
    });

    const body = document.createElement("div");
    body.className = "historyCardBody";
    const meta = document.createElement("div");
    meta.className = "historyCardMeta";
    const title = document.createElement("strong");
    title.className = "historyCardTitle";
    title.textContent = generationTitle(generation);
    const summary = document.createElement("span");
    summary.className = "historyCardSummary";
    const badge = generation.settings?.checkpoint ? formatCheckpointBadge(generation.settings.checkpoint) : null;
    summary.textContent = [badge, historyModeLabel(generation.mode)].filter(Boolean).join("・") || "通常生成";
    const dateLine = document.createElement("span");
    dateLine.className = "historyCardDate";
    dateLine.textContent = formatDate(generation.createdAt);
    meta.append(title, summary, dateLine);

    previewWrap.append(preview, imageState.createFavoriteButton(image, { className: "cardFavorite" }));
    const contentRating = generation.contentRating === "nsfw"
      ? "nsfw"
      : generation.contentRating === "general" ? "general" : "unrated";
    if (contentRating !== "general") {
      const ratingBadge = document.createElement("span");
      ratingBadge.className = `historyContentRatingBadge ${contentRating}`;
      ratingBadge.textContent = contentRating === "nsfw" ? "NSFW" : "未分類";
      previewWrap.append(ratingBadge);
    }

    const compareCheck = document.createElement("input");
    compareCheck.type = "checkbox";
    compareCheck.className = "historyCompareCheck";
    compareCheck.dataset.compareImageId = String(image.id);
    compareCheck.hidden = !isCompareMode();
    compareCheck.checked = isCompareSelected(image.id);
    compareCheck.setAttribute("aria-label", `${generationTitle(generation)}を比較対象に選択`);
    compareCheck.title = "比較対象に選択";
    compareCheck.addEventListener("click", (event) => event.stopPropagation());
    compareCheck.addEventListener("change", () => {
      if (compareCheck.checked !== isCompareSelected(image.id)) onToggleCompare(image, generation);
    });
    previewWrap.append(compareCheck);

    const menu = document.createElement("details");
    menu.className = "historyCardMenu";
    const menuSummary = document.createElement("summary");
    menuSummary.textContent = "⋯";
    menuSummary.setAttribute("aria-label", "画像操作");
    menuSummary.title = "画像操作";
    menuSummary.addEventListener("click", (event) => event.stopPropagation());
    const menuBody = document.createElement("div");
    menuBody.className = "historyCardMenuBody";
    menuBody.append(imageState.createDiscordStatusNode(image), imageState.createDiscordGenerationStatusNode(image));
    const addMenuAction = (label, className, handler, titleText = label) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = className;
      button.textContent = label;
      button.title = titleText;
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        menu.open = false;
        handler(button);
      });
      menuBody.append(button);
      return button;
    };
    addMenuAction("読込", "secondary", () => onLoadRecipe(generation, image), "この画像の設定を読み込む");
    const compare = document.createElement("button");
    compare.type = "button";
    compare.className = "ghost compareToggle";
    compare.dataset.compareImageId = String(image.id);
    syncCompareControl(compare, image.id);
    compare.title = "比較対象へ追加または解除";
    compare.addEventListener("click", (event) => {
      event.stopPropagation();
      menu.open = false;
      onToggleCompare(image, generation, compare);
    });
    menuBody.append(compare);
    addMenuAction("詳細", "ghost", () => openDetail(generation, image), "生成情報を表示");
    addMenuAction(
      contentRating === "nsfw" ? "一般に分類" : "NSFWに分類",
      "ghost",
      () => void updateContentRating(image, contentRating === "nsfw" ? "general" : "nsfw"),
      "同じ生成の候補画像をまとめて分類"
    );
    addMenuAction("削除", "historyDelete", (button) => void deleteImage(image, button), "この画像を削除する");
    menu.append(menuSummary, menuBody);

    if (generation.experimentName) {
      const experimentBadge = document.createElement("span");
      experimentBadge.className = "historyExperimentBadge";
      experimentBadge.textContent = generation.comparedValue != null
        ? `${generation.experimentName}: ${generation.comparedValue}`
        : generation.experimentName;
      experimentBadge.title = "実験グループ";
      meta.append(experimentBadge);
    }
    body.append(meta, menu);
    card.append(previewWrap, body);
    return card;
  }

  async function updateContentRating(image, contentRating) {
    try {
      await patchJson(`/api/history/${encodeURIComponent(image.id)}/content-rating`, { contentRating });
      toast.info(contentRating === "nsfw" ? "NSFWに分類しました" : "一般に分類しました");
      resetPaging();
      await load();
    } catch (error) {
      toast.error(`分類を変更できませんでした: ${error.message}`);
    }
  }

  async function deleteImage(image, button) {
    const confirmed = await confirmModal("この画像を削除しますか？", {
      confirmText: "削除する",
      cancelText: "キャンセル",
      danger: true
    });
    if (!confirmed) return;
    button.disabled = true;
    try {
      const data = await deleteJson(`/api/history/${image.id}`);
      if (data.preferences) onPreferencesChanged(data.preferences);
      await load();
    } catch (error) {
      button.disabled = false;
      showError(`削除できませんでした: ${error.message}`);
    }
  }

  function openDetail(generation, image, { sequence = [...entries], returnFocus = document.activeElement } = {}) {
    const overlay = document.createElement("div");
    overlay.className = "detailModal";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "生成情報");
    const box = document.createElement("div");
    box.className = "detailBox";
    let closed = false;
    const closeDetail = (restoreFocus = true) => {
      if (closed) return;
      closed = true;
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      activeDetailClosers.delete(closeDetail);
      if (restoreFocus && returnFocus?.isConnected) returnFocus.focus?.();
    };
    const move = direction => {
      const index = sequence.findIndex(entry => entry.image.id === image.id);
      const next = sequence[index + direction];
      if (!next || index < 0) return;
      closeDetail(false);
      openDetail(next.generation, next.image, { sequence, returnFocus });
    };
    const onKey = (event) => {
      if (event.key === "Escape") { event.preventDefault(); closeDetail(); }
      if (event.target?.closest?.("input,textarea,select")) return;
      if (event.key === "ArrowLeft") { event.preventDefault(); move(-1); }
      if (event.key === "ArrowRight") { event.preventDefault(); move(1); }
      if (event.key === "Tab") {
        const controls = [...(overlay.querySelectorAll?.("button:not(:disabled),a[href],summary,[tabindex='0']") ?? [])];
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus?.(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus?.(); }
      }
    };
    const header = document.createElement("div");
    header.className = "detailHeader";
    const heading = document.createElement("strong");
    heading.textContent = generationTitle(generation);
    const close = document.createElement("button");
    close.type = "button";
    close.className = "imageModalClose";
    close.setAttribute("aria-label", "閉じる");
    close.textContent = "×";
    close.addEventListener("click", closeDetail);
    header.append(heading, close);

    const detailImage = document.createElement("img");
    detailImage.className = "detailImage";
    detailImage.src = originalImageUrl(image);
    detailImage.alt = generationTitle(generation);
    detailImage.title = "クリックで拡大";
    detailImage.addEventListener("click", () => openImageModal(detailImage.src, detailImage.alt));
    const settings = generation.settings ?? {};
    const dl = document.createElement("dl");
    dl.className = "detailFields";
    const addField = (label, value) => {
      if (value === null || value === undefined || value === "") return;
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      if (typeof value === "object" && value?.tagName) dd.append(value);
      else dd.textContent = String(value);
      dl.append(dt, dd);
    };
    addField("Checkpoint", settings.checkpoint || "Checkpoint記録なし");
    addField("Runtime", generation.runtime?.label || generation.runtime?.id);
    addField("LoRA", buildLoraDetailNode(document, generation.loras));
    addField("LoRA警告", buildLoraNoticeNode(document, generation.loraNotices));
    addField("Seed", image.seed);
    addField("Sampler", settings.samplerName);
    addField("Scheduler", settings.scheduler);
    if (settings.noiseSchedule && settings.noiseSchedule !== "Automatic") addField("Noise schedule", settings.noiseSchedule);
    addField("Steps", settings.steps);
    addField("CFG", settings.cfgScale);
    const resolution = image.width && image.height
      ? `${image.width}×${image.height}`
      : (settings.width && settings.height ? `${settings.width}×${settings.height}` : null);
    addField("解像度", resolution);
    addField("生成モード", historyModeLabel(generation.mode) ?? "txt2img");
    addField("生成日時", formatDate(generation.createdAt));

    const copyRow = document.createElement("div");
    copyRow.className = "detailCopyActions";
    copyRow.append(
      createCopyButton("Copy Prompt", "secondary smallButton", () => buildPromptText(generation), "ポジティブプロンプトだけをコピー"),
      createCopyButton("Copy All Metadata", "secondary smallButton", () => buildMetadataText(generation, image), "PNG Info形式で生成情報をコピー")
    );
    const prompts = document.createElement("div");
    prompts.className = "detailPrompts";
    prompts.append(buildPromptDetails(document, "Prompt", generation.prompt));
    prompts.append(buildPromptDetails(document, "Negative Prompt", generation.negativePrompt));
    for (const details of buildStructuredPromptDetails(document, generation)) prompts.append(details);

    const footer = document.createElement("div");
    footer.className = "detailActions";
    const addAction = (label, className, handler, titleText = "") => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = className;
      button.textContent = label;
      if (titleText) button.title = titleText;
      button.addEventListener("click", handler);
      footer.append(button);
      return button;
    };
    footer.append(imageState.createFavoriteButton(image, { style: "label", className: "favoriteButton" }));
    addAction("img2imgへ", "secondary", () => { closeDetail(); onUseAsImg2Img(image); });
    addAction("部分修正", "secondary", () => { closeDetail(); onUseAsInpaint(image); });
    addAction("同じSeedで再生成", "secondary", () => { closeDetail(); onRegenerate(generation, image); },
      "Prompt・Seed・Checkpoint・LoRA・設定を復元して生成画面へ読み込みます");
    addAction("LoRAだけ変更", "secondary", () => { closeDetail(); void onChangeLora(generation, image); });
    addAction("衣装だけ変更", "secondary", () => { closeDetail(); void onDerive(generation, image, "outfit"); });
    addAction("背景だけ変更", "secondary", () => { closeDetail(); void onDerive(generation, image, "background"); });
    addAction("表情だけ変更", "secondary", () => { closeDetail(); void onDerive(generation, image, "expression"); });
    addAction("設定を複製", "ghost", () => { closeDetail(); onDuplicateRecipe(generation, image); }, "Seedは-1のまま設定だけ読み込みます");
    const detailCompare = addAction("比較に追加", "ghost", () => onToggleCompare(image, generation, detailCompare));
    detailCompare.dataset.compareImageId = String(image.id);
    syncCompareControl(detailCompare, image.id);
    const hiresAvailable = isHiresAvailable(generation);
    const hiresAction = addAction("Hiresする", "primary", () => { closeDetail(); void onHires(generation, image); },
      hiresAvailable ? "この画像を元に高解像度仕上げ" : "生成元RuntimeではHiresを利用できません");
    hiresAction.disabled = !hiresAvailable;
    overlay.addEventListener("click", (event) => { if (event.target === overlay) closeDetail(); });
    document.addEventListener("keydown", onKey);
    activeDetailClosers.add(closeDetail);
    const visual = document.createElement("div");
    visual.className = "detailVisual";
    visual.append(detailImage);
    const index = sequence.findIndex(entry => entry.image.id === image.id);
    for (const [direction, label, className, glyph] of [[-1, "前の画像", "detailPrevious", "‹"], [1, "次の画像", "detailNext", "›"]]) {
      const button = document.createElement("button");
      button.type = "button"; button.className = className; button.textContent = glyph;
      button.setAttribute("aria-label", label);
      button.disabled = index < 0 || !sequence[index + direction];
      button.addEventListener("click", () => move(direction));
      visual.append(button);
    }
    const metadata = document.createElement("aside");
    metadata.className = "detailMetadata";
    metadata.append(header, dl, copyRow, prompts, footer);
    box.append(visual, metadata);
    overlay.append(box);
    document.body.append(overlay);
    close.focus?.();
  }

  function createCopyButton(label, className, buildText, titleText = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    if (titleText) button.title = titleText;
    button.addEventListener("click", async () => {
      let text = "";
      try { text = buildText(); } catch { text = ""; }
      if (!text) return toast.warning("コピーできる情報が保存されていません");
      try {
        await copyToClipboard(text);
        flashLabel(button, "Copied!");
      } catch (error) {
        toast.error(`コピーできませんでした: ${error.message}`);
      }
    });
    return button;
  }

  function resetPaging() {
    cursor = null;
    hasMore = true;
  }

  function refresh() { return load(); }
  function closeFilterDialog() { elements.galleryFilterDialog.close(); }
  function closeFilterDialogOnBackdrop(event) { if (event.target === elements.galleryFilterDialog) closeFilterDialog(); }
  function changeSort() { sort = elements.gallerySort.value === "oldest" ? "oldest" : "newest"; render(generations); }
  function showAll() { setFilter({ kind: "all" }); }
  function showFavorites() { setFilter({ kind: "favorite" }); }
  function changeKind(event) { const button = event.target.closest("[data-gallery-kind]"); if (button) setFilter({ kind: button.dataset.galleryKind }); }
  function changeSelectFilters() { setFilter({ checkpoint: elements.galleryCheckpoint.value, lora: elements.galleryLora.value, period: elements.galleryPeriod.value }); }
  function changeSearch() { setFilter({ query: elements.gallerySearch.value }); }
  function changeTagSearch() { tagQuery = elements.galleryTagSearch.value; renderTagOptions(toGalleryEntries(generations)); }
  function changeRating(event) { const button = event.target.closest("[data-gallery-rating]"); if (button) setFilter({ rating: button.dataset.galleryRating }); }

  return {
    init,
    dispose,
    load,
    loadMore,
    loadStudioRecent,
    render,
    setFilter,
    resetFilter,
    openFilterDialog,
    openDetail,
    resetPaging,
    getGenerations: () => generations,
    getEntries: () => entries,
    getFilter: () => ({ ...filter, tags: [...filter.tags] }),
    getState: () => ({ cursor, hasMore, loading, total, sort, tagQuery })
  };
}

function historyModeLabel(mode) {
  if (mode === "img2img") return "img2img";
  if (mode === "inpaint") return "部分修正";
  return null;
}

const LORA_SOURCE_LABELS = { ui: "Source: ui", prompt: "Source: prompt", both: "Source: both" };

function buildLoraDetailNode(document, loras) {
  if (!Array.isArray(loras) || !loras.length) {
    const span = document.createElement("span");
    span.textContent = "LoRAなし";
    return span;
  }
  const list = document.createElement("div");
  list.className = "detailLoraList";
  for (const lora of loras) {
    const row = document.createElement("div");
    row.className = "detailLoraRow";
    const name = document.createElement("span");
    name.className = "detailLoraName";
    name.textContent = lora.name;
    const weight = document.createElement("span");
    weight.className = "detailLoraWeight";
    weight.textContent = Number(lora.weight).toFixed(2);
    row.append(name, weight);
    if (lora.source) {
      const source = document.createElement("small");
      source.className = "detailLoraSource";
      source.textContent = LORA_SOURCE_LABELS[lora.source] ?? lora.source;
      source.title = "このLoRAの選択元";
      row.append(source);
    }
    list.append(row);
  }
  return list;
}

function buildLoraNoticeNode(document, notices) {
  if (!Array.isArray(notices) || !notices.length) return null;
  const list = document.createElement("div");
  list.className = "detailLoraNotices";
  for (const notice of notices) {
    const row = document.createElement("div");
    row.textContent = {
      duplicate: () => `同じLoRAが複数記述: ${notice.name}（${(notice.weights ?? []).join(" / ")} → ${notice.weight}）`,
      unresolved: () => `未インストール: ${notice.name}`,
      ambiguous: () => `特定不能: ${notice.name}（候補: ${(notice.candidates ?? []).join(" / ")}）`,
      invalidWeight: () => `Weightを読み取れず1を使用: ${notice.name}`
    }[notice.type]?.() ?? `${notice.type}: ${notice.name}`;
    list.append(row);
  }
  return list;
}

function buildStructuredPromptDetails(document, generation) {
  const sections = generation?.structuredPrompt;
  if (!sections) return [];
  const lines = PROMPT_FIELDS
    .map((field) => [PROMPT_FIELD_LABELS[field], String(sections[field] ?? "").trim()])
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`);
  const triggers = normalizeAppliedTriggerWords(generation.appliedTriggerWords).map((trigger) => {
    const state = trigger.enabled ? formatTriggerWord(trigger) : `${trigger.text}（無効）`;
    return `${PROMPT_FIELD_LABELS[trigger.targetField]}: ${state}`;
  });
  const result = [];
  if (lines.length) result.push(buildPromptDetails(document, "構造化プロンプト", lines.join("\n")));
  if (triggers.length) result.push(buildPromptDetails(document, "LoRAトリガーワード", triggers.join("\n")));
  if (generation.rawPromptOverride) result.push(buildPromptDetails(document, "Raw Prompt上書き", generation.rawPrompt || generation.prompt));
  return result;
}

function buildPromptDetails(document, label, text) {
  const details = document.createElement("details");
  details.className = "detailPrompt";
  const summary = document.createElement("summary");
  summary.textContent = label;
  const body = document.createElement("p");
  body.className = "detailPromptBody";
  body.textContent = text || "（なし）";
  details.append(summary, body);
  return details;
}
