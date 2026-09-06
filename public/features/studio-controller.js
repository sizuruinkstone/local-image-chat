import { configureThumbnailImage, originalImageUrl } from "../image-delivery.js";
import { buildMetadataText, buildPromptText } from "../metadata-format.js";
import { generationTitle } from "../history-title.js";
import { toGalleryEntries } from "../gallery-filter.js";
import {
  STUDIO_HISTORY_FILTERS,
  filterStudioHistoryEntries,
  normalizeStudioHistoryFilter
} from "../studio-history.js";

export function createStudioController({
  document,
  elements,
  imageState,
  openImageModal,
  copyToClipboard,
  flashLabel,
  toast,
  formatCheckpointBadge,
  formatDate,
  readFormStats,
  syncGenerationSettingsSummary,
  isHiresAvailable,
  syncCompareControl,
  onHistoryFilterChange,
  onOpenDetail,
  onLoadRecipe,
  onUseAsReference,
  onToggleCompare,
  onRegenerate,
  onUseFinalAsImg2Img,
  onUseFinalAsInpaint,
  onOpenFinalInGallery,
  onFocusSetting,
  onStateChanged = () => {},
  now = () => Date.now(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval
}) {
  let selectedCandidate = null;
  let lastGeneration = null;
  let finalImage = null;
  let finalGeneration = null;
  let inspection = null;
  let historyFilter = STUDIO_HISTORY_FILTERS.all;
  let startedAt = 0;
  let elapsedTimer = null;
  let busy = false;
  let initialized = false;
  let workflowAvailability = { runtimeSwitching: false, ipAdapterAvailable: false };

  const listeners = [
    [elements.resultImage, "click", openFinalImage],
    [elements.studioMetadataButton, "click", inspectFinal],
    [elements.studioCompareButton, "click", compareFinal],
    [elements.studioOpenDetailButton, "click", openInspectionDetail],
    [elements.studioLoadRecipeButton, "click", loadInspectionRecipe],
    [elements.studioMainFavoriteButton, "click", favoriteInspection],
    [elements.studioHistoryAllButton, "click", showAllHistory],
    [elements.studioHistoryFavoriteButton, "click", showFavoriteHistory],
    [elements.studioMainImage, "click", openInspectionImage],
    [elements.studioMainImage, "keydown", handleMainImageKey],
    [elements.studioMainIpAdapterButton, "click", useInspectionAsReference],
    [elements.studioMainCompareButton, "click", compareInspection],
    [elements.studioMainMetadataButton, "click", refreshInspection],
    [elements.studioMainRegenerateButton, "click", regenerateInspection],
    [elements.studioCopyPromptButton, "click", copyPrompt],
    [elements.studioCopyNegativeButton, "click", copyNegative],
    [elements.studioCopyMetadataButton, "click", copyMetadata],
    [elements.studioOutputStats, "click", focusSetting],
    [elements.reuseFinalButton, "click", loadFinalRecipe],
    [elements.finalIpAdapterButton, "click", useFinalAsReference],
    [elements.sendFinalToImg2ImgButton, "click", useFinalAsImg2Img],
    [elements.sendFinalToInpaintButton, "click", useFinalAsInpaint],
    [elements.regenerateFinalButton, "click", regenerateFinal],
    [elements.openInGalleryButton, "click", openFinalInGallery]
  ];

  function init() {
    if (initialized) return;
    initialized = true;
    for (const [element, type, listener] of listeners) element.addEventListener(type, listener);
  }

  function dispose() {
    if (!initialized) return;
    initialized = false;
    for (const [element, type, listener] of listeners) element.removeEventListener(type, listener);
    stopElapsedTimer();
  }

  function resetForGeneration() {
    selectedCandidate = null;
    finalImage = null;
    finalGeneration = null;
    inspection = null;
    elements.finalResult.classList.add("hidden");
    elements.studioMainPreview.classList.add("hidden");
    elements.studioMainImage.removeAttribute("src");
    syncWorkflowAvailability();
    onStateChanged();
  }

  function setCandidates(generation, images = []) {
    lastGeneration = generation ?? null;
    selectedCandidate = null;
    renderCandidates(Array.isArray(images) ? images : []);
    syncWorkflowAvailability();
    onStateChanged();
  }

  function renderCandidates(images) {
    elements.candidateGrid.replaceChildren();
    elements.candidateSummary.textContent = `${images.length}枚生成`;
    images.forEach((candidate, index) => {
      const card = document.createElement("article");
      card.className = "candidateCard";
      card.setAttribute("aria-label", `候補${index + 1}、Seed ${candidate.seed}`);
      const image = document.createElement("img");
      image.className = "candidateImage";
      configureThumbnailImage(image, candidate, { eager: index < 4 });
      image.alt = `生成候補 ${index + 1}`;
      image.title = "クリックして選択";
      image.addEventListener("click", () => selectCandidate(candidate, card));
      const footer = document.createElement("footer");
      const label = document.createElement("span");
      label.textContent = `#${index + 1} · Seed ${candidate.seed}`;
      footer.append(label);
      card.append(image, footer);
      elements.candidateGrid.append(card);
    });
    const first = elements.candidateGrid.firstElementChild;
    if (images[0] && first) selectCandidate(images[0], first);
  }

  function selectCandidate(candidate, card = null) {
    if (!candidate) return;
    selectedCandidate = candidate;
    for (const item of elements.candidateGrid.children) item.classList.remove("selected");
    card?.classList.add("selected");
    if (lastGeneration) {
      elements.studioMainImage.src = originalImageUrl(candidate);
      elements.studioMainImage.alt = generationTitle(lastGeneration);
      elements.studioMainPreview.classList.remove("hidden");
      syncCompareControl(elements.studioMainCompareButton, candidate.id);
      inspect(lastGeneration, candidate);
      syncOutputStats(lastGeneration, candidate);
    }
    const finishLabel = lastGeneration?.mode === "inpaint"
      ? "選択画像を部分修正仕上げ"
      : lastGeneration?.mode === "img2img"
        ? "選択画像をimg2img仕上げ"
        : "選択画像をHires.fix";
    elements.finishButton.textContent = lastGeneration?.mode === "txt2img" || !lastGeneration
      ? "Hires.fix"
      : "仕上げ";
    elements.finishButton.title = finishLabel;
    elements.finishButton.setAttribute("aria-label", finishLabel);
    syncWorkflowAvailability();
    onStateChanged();
  }

  function presentFinal(generation, image, { eyebrow = "", title = "" } = {}) {
    if (!generation || !image) return;
    finalGeneration = generation;
    finalImage = image;
    elements.finalEyebrow.textContent = eyebrow;
    elements.finalTitle.textContent = title;
    configureThumbnailImage(elements.resultImage, image, { eager: true });
    elements.seedText.textContent = `Seed ${image.seed}`;
    elements.resolutionText.textContent = `${image.width} × ${image.height}`;
    elements.downloadLink.href = originalImageUrl(image);
    elements.downloadLink.download = image.filename;
    imageState.bindPresentation(image);
    elements.emptyState.classList.add("hidden");
    elements.resultContent.classList.remove("hidden");
    elements.studioMainPreview.classList.add("hidden");
    elements.finalResult.classList.remove("hidden");
    inspect(generation, image);
    syncOutputStats(generation, image);
    syncWorkflowAvailability();
    elements.finalResult.scrollIntoView({ behavior: "smooth", block: "start" });
    onStateChanged();
  }

  function inspect(generation, image, { showOnCanvas = false } = {}) {
    if (!generation || !image) return;
    inspection = { generation, image };
    const favorite = imageState.resolveImageFavorite(image);
    elements.studioMainFavoriteButton.dataset.favoriteImage = image.id;
    elements.studioMainFavoriteButton.dataset.favoriteStyle = "star";
    imageState.renderFavoriteButton(elements.studioMainFavoriteButton, favorite);
    for (const card of elements.studioRecentList.querySelectorAll("[data-studio-image-id]")) {
      card.classList.toggle("selected", card.dataset.studioImageId === String(image.id));
    }
    renderMetadata(generation, image);
    if (showOnCanvas) {
      elements.emptyState.classList.add("hidden");
      elements.loading.classList.add("hidden");
      elements.resultContent.classList.remove("hidden");
      elements.finalResult.classList.add("hidden");
      elements.studioMainImage.src = originalImageUrl(image);
      elements.studioMainImage.alt = generationTitle(generation);
      syncCompareControl(elements.studioMainCompareButton, image.id);
      elements.studioMainPreview.classList.remove("hidden");
      syncOutputStats(generation, image);
    }
    syncWorkflowAvailability();
    onStateChanged();
  }

  function renderMetadata(generation, image) {
    const settings = generation.settings ?? {};
    const checkpoint = settings.checkpoint || "記録なし";
    const sampler = settings.samplerName || "--";
    const steps = settings.steps ?? "--";
    const cfg = settings.cfgScale ?? "--";
    const seed = image.seed ?? settings.seed ?? "--";
    const resolution = image.width && image.height
      ? `${image.width}×${image.height}`
      : settings.width && settings.height ? `${settings.width}×${settings.height}` : "--";
    const loras = generation.loras ?? [];
    const loraText = loras.length
      ? loras.map((lora) => {
          const name = lora.displayName || lora.name || "LoRA";
          return `${name}${Number.isFinite(Number(lora.weight)) ? ` ${Number(lora.weight).toFixed(2)}` : ""}`;
        }).join(" / ")
      : "なし";
    const hiresText = settings.hiresEnabled
      ? ["ON", settings.hiresScale ? `${settings.hiresScale}×` : "", settings.hiresSteps ? `${settings.hiresSteps} steps` : "", settings.hiresUpscaler]
          .filter(Boolean).join(" · ")
      : "OFF";
    const vramUsage = image.vramUsage ?? generation.vramUsage ?? settings.vramUsage;

    setMetadataValue(elements.studioMetaResolution, resolution);
    setMetadataValue(elements.studioMetaSampler, sampler);
    setMetadataValue(elements.studioMetaSteps, steps);
    setMetadataValue(elements.studioMetaCfg, cfg);
    setMetadataValue(elements.studioMetaSeed, seed);
    setMetadataValue(elements.studioMetaModel, formatCheckpointBadge(checkpoint));
    setMetadataValue(elements.studioMetaLoraCount, `${loras.length} Active`);
    setMetadataValue(elements.studioMetaCreated, formatCreatedAt(generation.createdAt));
    setMetadataValue(elements.studioMetaVram, vramUsage);
    setMetadataValue(elements.studioMetaCheckpoint, checkpoint);
    setMetadataValue(elements.studioMetaModelHash, settings.checkpointHash);
    setMetadataValue(elements.studioMetaParameterSampler, sampler);
    setMetadataValue(elements.studioMetaScheduler, settings.scheduler);
    setMetadataValue(elements.studioMetaParameterSteps, steps);
    setMetadataValue(elements.studioMetaParameterCfg, cfg);
    setMetadataValue(elements.studioMetaParameterSeed, seed);
    setMetadataValue(elements.studioMetaWidth, settings.width ?? image.width);
    setMetadataValue(elements.studioMetaHeight, settings.height ?? image.height);
    setMetadataValue(elements.studioMetaBatchCount, settings.candidateCount ?? generation.images?.length);
    setMetadataValue(elements.studioMetaBatchSize, settings.batchSize ?? 1);
    setMetadataValue(elements.studioMetaHires, hiresText);
    setMetadataValue(elements.studioMetaDenoising, denoisingValue(generation, settings));
    setMetadataValue(elements.studioMetaVae, settings.vae);
    setMetadataValue(elements.studioMetaClipSkip, settings.clipSkip);
    setMetadataValue(elements.studioMetaLoras, loraText, "なし");
    setMetadataValue(elements.studioMetaPositive, generation.effectivePrompt || generation.prompt, "（記録なし）");
    setMetadataValue(elements.studioMetaNegative, generation.effectiveNegativePrompt || generation.negativePrompt, "（記録なし）");
    elements.studioMetadataEmpty.classList.add("hidden");
    elements.studioMetadataContent.classList.remove("hidden");
  }

  function setMetadataValue(element, value, fallback = "--") {
    const text = value === null || value === undefined || String(value).trim() === "" ? fallback : String(value).trim();
    element.textContent = text;
    element.title = text === fallback ? "" : text;
  }

  function formatCreatedAt(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "--";
    return new Intl.DateTimeFormat("ja-JP", {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
    }).format(date);
  }

  function denoisingValue(generation, settings) {
    if (settings.hiresEnabled) return settings.hiresDenoising;
    if (generation.mode === "inpaint") return settings.inpaintDenoising;
    if (generation.mode === "img2img") return settings.img2imgDenoising;
    return null;
  }

  function syncOutputStats(generation = null, image = null) {
    const settings = generation?.settings ?? {};
    const form = readFormStats();
    const width = image?.width ?? settings.width ?? form.width;
    const height = image?.height ?? settings.height ?? form.height;
    const seed = image?.seed ?? settings.seed ?? form.seed;
    elements.studioResolution.textContent = width && height ? `${width}×${height}` : "--";
    elements.studioSeed.textContent = Number(seed) >= 0 ? String(seed) : "RANDOM";
    elements.studioSampler.textContent = settings.samplerName || form.sampler || "--";
    elements.studioCfg.textContent = String(settings.cfgScale ?? form.cfg ?? "--");
    elements.studioSteps.textContent = String(settings.steps ?? form.steps ?? "--");
    syncGenerationSettingsSummary();
  }

  function updateGenerationState(nextBusy, message = "") {
    busy = Boolean(nextBusy);
    elements.studioGenerationStatus.classList.toggle("busy", busy);
    if (busy) {
      if (!startedAt) startedAt = now();
      elements.studioGenerationStatus.textContent = /プロンプト/.test(message) ? "PREPARING" : "GENERATING";
      updateElapsed();
      if (!elapsedTimer) elapsedTimer = setIntervalFn(updateElapsed, 1000);
      syncOutputStats();
    } else {
      stopElapsedTimer();
      if (startedAt) elements.studioGenerationTime.textContent = formatElapsed(Math.max(0, Math.floor((now() - startedAt) / 1000)));
      startedAt = 0;
      elements.studioGenerationStatus.textContent = finalImage || lastGeneration ? "COMPLETE" : "READY";
    }
    syncWorkflowAvailability();
  }

  function updateElapsed() {
    elements.studioGenerationTime.textContent = formatElapsed(Math.max(0, Math.floor((now() - startedAt) / 1000)));
  }

  function stopElapsedTimer() {
    if (elapsedTimer) clearIntervalFn(elapsedTimer);
    elapsedTimer = null;
  }

  function formatElapsed(seconds) {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }

  function syncWorkflowAvailability(nextAvailability = null) {
    if (nextAvailability) {
      workflowAvailability = {
        runtimeSwitching: nextAvailability.runtimeSwitching ?? workflowAvailability.runtimeSwitching,
        ipAdapterAvailable: nextAvailability.ipAdapterAvailable ?? workflowAvailability.ipAdapterAvailable
      };
    }
    const { runtimeSwitching, ipAdapterAvailable } = workflowAvailability;
    const blocked = busy || runtimeSwitching;
    elements.finishButton.disabled = blocked || !selectedCandidate || !isHiresAvailable(lastGeneration);
    elements.lockCompositionButton.disabled = blocked || !selectedCandidate;
    elements.studioMainIpAdapterButton.disabled = blocked || !ipAdapterAvailable || !inspection?.image?.id;
    elements.studioMainIpAdapterButton.classList.toggle("hidden", !inspection?.image?.id);
    elements.finalIpAdapterButton.disabled = blocked || !ipAdapterAvailable || !finalImage?.id;
    elements.finalIpAdapterButton.classList.toggle("hidden", !finalImage?.id);
  }

  async function setHistoryFilter(filter) {
    historyFilter = normalizeStudioHistoryFilter(filter);
    renderHistoryFilterState();
    await onHistoryFilterChange(historyFilter);
  }

  function renderHistoryFilterState() {
    const favoriteActive = historyFilter === STUDIO_HISTORY_FILTERS.favorite;
    elements.studioHistoryAllButton.classList.toggle("active", !favoriteActive);
    elements.studioHistoryAllButton.setAttribute("aria-pressed", String(!favoriteActive));
    elements.studioHistoryFavoriteButton.classList.toggle("active", favoriteActive);
    elements.studioHistoryFavoriteButton.setAttribute("aria-pressed", String(favoriteActive));
  }

  function renderRecent(generations) {
    const entries = filterStudioHistoryEntries(toGalleryEntries(generations ?? []), historyFilter).slice(0, 8);
    elements.studioRecentCount.textContent = `${entries.length}件`;
    elements.studioRecentList.replaceChildren();
    renderHistoryFilterState();
    if (!entries.length) {
      renderRecentMessage(historyFilter === STUDIO_HISTORY_FILTERS.favorite
        ? "お気に入りの画像はまだありません" : "生成履歴はまだありません");
      return;
    }
    for (const [index, entry] of entries.entries()) {
      const { generation, image } = entry;
      const card = document.createElement("article");
      card.className = "studioRecentCard";
      card.dataset.studioImageId = image.id;
      card.classList.toggle("selected", inspection?.image?.id === image.id);
      const selectButton = document.createElement("button");
      selectButton.type = "button";
      selectButton.className = "studioRecentSelect";
      selectButton.setAttribute("aria-label", `${generationTitle(generation)}を選択`);
      const preview = document.createElement("img");
      configureThumbnailImage(preview, image, { eager: index < 2 });
      preview.alt = "";
      const text = document.createElement("span");
      text.className = "studioRecentText";
      const title = document.createElement("strong");
      title.textContent = generationTitle(generation);
      const meta = document.createElement("small");
      meta.textContent = [formatDate(generation.createdAt), formatCheckpointBadge(generation.settings?.checkpoint), `Seed ${image.seed}`]
        .filter(Boolean).join(" · ");
      text.append(title, meta);
      selectButton.append(preview, text);
      selectButton.addEventListener("click", () => inspect(generation, image, { showOnCanvas: true }));
      const favoriteButton = imageState.createFavoriteButton(image, { className: "studioRecentFavorite" });
      card.append(selectButton, favoriteButton);
      elements.studioRecentList.append(card);
    }
    if (!inspection) inspect(entries[0].generation, entries[0].image);
  }

  function renderRecentError(message) {
    elements.studioRecentList.replaceChildren();
    renderRecentMessage(`履歴を取得できません: ${message}`);
  }

  function renderRecentMessage(message) {
    const empty = document.createElement("p");
    empty.className = "studioMetadataEmpty";
    empty.textContent = message;
    elements.studioRecentList.append(empty);
  }

  async function copyInspectionValue(button, buildText) {
    if (!inspection) return toast.warning("コピーする画像を選択してください");
    let text = "";
    try { text = buildText(inspection.generation, inspection.image); } catch { text = ""; }
    if (!String(text ?? "").trim()) return toast.warning("コピーできる情報が保存されていません");
    try {
      await copyToClipboard(String(text));
      flashLabel(button, "Copied!");
    } catch (error) {
      toast.error(`コピーできませんでした: ${error.message}`);
    }
  }

  function openFinalImage() { if (finalImage) openImageModal(originalImageUrl(finalImage), generationTitle(finalGeneration)); }
  function inspectFinal() { if (finalGeneration && finalImage) inspect(finalGeneration, finalImage); }
  function compareFinal() { if (finalGeneration && finalImage) onToggleCompare(finalImage, finalGeneration); }
  function openInspectionDetail() { if (inspection) onOpenDetail(inspection.generation, inspection.image); }
  function loadInspectionRecipe() { if (inspection) onLoadRecipe(inspection.generation, inspection.image); }
  function favoriteInspection() { if (inspection) void imageState.toggleFavorite(inspection.image, elements.studioMainFavoriteButton); }
  function showAllHistory() { void setHistoryFilter(STUDIO_HISTORY_FILTERS.all); }
  function showFavoriteHistory() { void setHistoryFilter(STUDIO_HISTORY_FILTERS.favorite); }
  function openInspectionImage() { if (inspection) openImageModal(originalImageUrl(inspection.image), generationTitle(inspection.generation)); }
  function handleMainImageKey(event) {
    const isSpace = event.key === " " || event.key === "Spacebar";
    if (event.key !== "Enter" && !isSpace) return;
    if (isSpace) event.preventDefault();
    if (!event.repeat) openInspectionImage();
  }
  function useInspectionAsReference(event) { event.preventDefault(); event.stopPropagation(); onUseAsReference(inspection?.image, { focus: true }); }
  function compareInspection() { if (inspection) onToggleCompare(inspection.image, inspection.generation, elements.studioMainCompareButton); }
  function refreshInspection() { if (inspection) inspect(inspection.generation, inspection.image); }
  function regenerateInspection() { if (inspection) onRegenerate(inspection.generation, inspection.image); }
  function copyPrompt() { void copyInspectionValue(elements.studioCopyPromptButton, (generation) => buildPromptText(generation)); }
  function copyNegative() { void copyInspectionValue(elements.studioCopyNegativeButton, (generation) => generation.effectiveNegativePrompt || generation.negativePrompt || ""); }
  function copyMetadata() { void copyInspectionValue(elements.studioCopyMetadataButton, (generation, image) => buildMetadataText(generation, image)); }
  function focusSetting(event) { const target = event.target.closest("[data-generation-setting-target]"); if (target) onFocusSetting(target.dataset.generationSettingTarget); }
  function loadFinalRecipe() { if (finalGeneration && finalImage) onLoadRecipe(finalGeneration, finalImage); }
  function useFinalAsReference(event) { event.preventDefault(); event.stopPropagation(); onUseAsReference(finalImage, { focus: true }); }
  function useFinalAsImg2Img() { if (finalImage) onUseFinalAsImg2Img(finalImage); }
  function useFinalAsInpaint() { if (finalImage) onUseFinalAsInpaint(finalImage); }
  function regenerateFinal() { if (finalGeneration && finalImage) onRegenerate(finalGeneration, finalImage); }
  function openFinalInGallery() { if (finalGeneration && finalImage) onOpenFinalInGallery(finalGeneration, finalImage); }

  return {
    init, dispose, resetForGeneration, setCandidates, selectCandidate, presentFinal, inspect,
    renderRecent, renderRecentError, setHistoryFilter, syncOutputStats, updateGenerationState,
    syncWorkflowAvailability,
    getSelectedCandidate: () => selectedCandidate,
    getLastGeneration: () => lastGeneration,
    getFinalImage: () => finalImage,
    getFinalGeneration: () => finalGeneration,
    getInspection: () => inspection,
    getHistoryFilter: () => historyFilter
  };
}
