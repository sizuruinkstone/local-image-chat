import { openCompareView } from "../compare-view.js";
import { configureThumbnailImage } from "../image-delivery.js";

export function createComparisonController({
  document,
  elements,
  postJson,
  toast,
  generationTitle,
  getStudioInspection = () => null,
  getStudioFinalImage = () => null,
  onOpenGallery = () => {},
  onHistoryReload = async () => {},
  onSetExperimentBest = async () => {},
  openCompareViewFn = openCompareView
}) {
  const selection = new Map();
  let galleryMode = false;
  let initialized = false;
  const listeners = [];

  const bind = (element, type, listener) => {
    element.addEventListener(type, listener);
    listeners.push([element, type, listener]);
  };

  function init() {
    if (initialized) return;
    initialized = true;
    bind(elements.compareTrayOpenButton, "click", compareSelection);
    bind(elements.compareTrayClearButton, "click", clear);
    bind(elements.galleryCompareModeButton, "click", toggleGalleryMode);
    bind(elements.galleryCompareClearButton, "click", clear);
    bind(elements.galleryCompareExitButton, "click", exitGalleryMode);
    bind(elements.imageCompareGalleryButton, "click", onOpenGallery);
    bind(elements.imageCompareStartButton, "click", compareSelection);
    bind(elements.compareSelectionButton, "click", compareSelection);
    sync();
  }

  function dispose() {
    if (!initialized) return;
    for (const [element, type, listener] of listeners.splice(0)) element.removeEventListener(type, listener);
    initialized = false;
  }

  function isSelected(imageId) {
    return imageId !== undefined && imageId !== null && selection.has(String(imageId));
  }

  function syncControl(button, imageId) {
    if (!button) return;
    const selected = isSelected(imageId);
    const label = selected ? "比較から外す" : "比較に追加";
    button.textContent = label;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", String(selected));
    button.classList.toggle("active", selected);
  }

  function sync() {
    const count = selection.size;
    const startLabel = count ? `画像比較を開始（${count}）` : "画像比較を開始";
    elements.compareSelectionButton.disabled = count < 2;
    elements.compareSelectionButton.textContent = startLabel;
    elements.compareSelectionButton.title = count < 2
      ? "画像比較を開始するには2枚以上を選んでください"
      : startLabel;
    elements.compareSelectionButton.setAttribute("aria-label", elements.compareSelectionButton.title);
    elements.compareSelectionBadge.textContent = count ? String(count) : "";
    elements.compareSelectionBadge.classList.toggle("hidden", count === 0);
    const compareNavButton = elements.mainNav.querySelector('[data-view="compare"]');
    compareNavButton?.setAttribute("aria-label", count ? `比較（${count}枚選択中）` : "比較");
    syncControl(elements.studioMainCompareButton, getStudioInspection()?.image?.id);
    syncControl(elements.studioCompareButton, getStudioFinalImage()?.id);
    for (const button of document.querySelectorAll("[data-compare-image-id]")) {
      syncControl(button, button.dataset.compareImageId);
    }
    renderTray();
    renderEntry();
    renderGalleryMode();
  }

  function toggle(image, generation, button) {
    if (!image || image.id === undefined || image.id === null) return false;
    const key = String(image.id);
    const selected = selection.has(key);
    if (selected) {
      selection.delete(key);
    } else {
      if (selection.size >= 4) {
        toast.warning("比較は最大4枚までです");
        return false;
      }
      selection.set(key, { image, generation });
    }
    if (button) button.dataset.compareImageId = key;
    sync();
    toast.info(selected ? "比較から外しました" : "比較に追加しました");
    return true;
  }

  function clear() {
    if (!selection.size) return;
    selection.clear();
    sync();
    toast.info("比較候補をすべて解除しました");
  }

  function renderTray() {
    const entries = getSelection();
    elements.compareTray.classList.toggle("hidden", entries.length === 0);
    elements.compareTrayCount.textContent = `${entries.length}枚`;
    elements.compareTrayOpenButton.disabled = entries.length < 2;
    elements.compareTrayOpenButton.title = entries.length < 2
      ? "比較を開始するには2枚以上を選んでください"
      : "選択した画像で画像比較を開始";
    elements.compareTrayClearButton.disabled = entries.length === 0;
    elements.compareTrayItems.replaceChildren();
    for (const [index, entry] of entries.entries()) {
      const item = document.createElement("div");
      item.className = "compareTrayItem";
      const preview = document.createElement("img");
      configureThumbnailImage(preview, entry.image);
      const title = generationTitle(entry.generation);
      preview.alt = `比較候補${index + 1}: ${title}`;
      preview.title = "比較候補から外すには右上のボタンを押してください";
      const label = document.createElement("span");
      label.className = "compareTrayItemLabel";
      label.textContent = `${index + 1}. ${title}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "compareTrayRemove";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `${title}を比較から外す`);
      remove.title = "この画像を比較から外す";
      remove.addEventListener("click", () => toggle(entry.image, entry.generation));
      item.append(preview, label, remove);
      elements.compareTrayItems.append(item);
    }
  }

  function renderEntry() {
    const count = selection.size;
    if (count === 0) {
      elements.imageCompareMessage.textContent = "比較する画像がありません";
      elements.imageCompareGalleryButton.textContent = "ギャラリーで画像を選ぶ";
    } else if (count === 1) {
      elements.imageCompareMessage.textContent = "あと1枚追加すると比較できます";
      elements.imageCompareGalleryButton.textContent = "ギャラリーで画像を追加";
    } else {
      elements.imageCompareMessage.textContent = `${count}枚を選択中です。比較を開始できます。`;
      elements.imageCompareGalleryButton.textContent = "ギャラリーで追加";
    }
    elements.imageCompareStartButton.classList.toggle("hidden", count < 2);
    elements.imageCompareStartButton.disabled = count < 2;
  }

  function setGalleryMode(active) {
    galleryMode = Boolean(active);
    elements.galleryCompareModeBar.classList.toggle("hidden", !galleryMode);
    elements.galleryCompareModeButton.setAttribute("aria-pressed", String(galleryMode));
    elements.galleryCompareModeButton.textContent = galleryMode ? "比較モードを終了" : "比較モード";
    renderGalleryMode();
  }

  function renderGalleryMode() {
    const count = selection.size;
    elements.galleryCompareModeCount.textContent = `${count}枚選択中`;
    elements.galleryCompareModeMessage.textContent = count === 0
      ? "あと2枚選択してください"
      : count === 1 ? "あと1枚選択してください" : `${count}枚を選択中です。比較を開始できます。`;
    elements.galleryCompareClearButton.disabled = count === 0;
    for (const checkbox of document.querySelectorAll(".historyCompareCheck")) {
      checkbox.hidden = !galleryMode;
      checkbox.checked = isSelected(checkbox.dataset.compareImageId);
    }
  }

  async function openEntries(entries, { experimentId = null, parameter = "" } = {}) {
    const items = Array.isArray(entries) ? entries.slice(0, 4) : [];
    return openCompareViewFn({
      entries: items,
      onVote: async ({ winnerImageId, result }) => {
        try {
          await postJson("/api/comparisons", {
            imageIds: items.map((entry) => entry.image.id),
            winnerImageId,
            result,
            parameter: parameter || items[0]?.generation?.comparedParameter || ""
          });
          if (experimentId && winnerImageId) await onSetExperimentBest(experimentId, winnerImageId);
          toast.success("比較結果を記録しました");
          await onHistoryReload();
        } catch (error) {
          toast.error(error.message);
        }
      }
    });
  }

  function compareSelection() {
    const entries = getSelection();
    if (entries.length < 2) return toast.warning("比較する画像を2枚以上選んでください");
    void openEntries(entries);
  }

  function toggleGalleryMode() { setGalleryMode(!galleryMode); }
  function exitGalleryMode() { setGalleryMode(false); }
  function getSelection() { return [...selection.values()]; }

  return {
    init,
    dispose,
    toggle,
    clear,
    isSelected,
    syncControl,
    sync,
    renderTray,
    renderEntry,
    setGalleryMode,
    openEntries,
    compareSelection,
    getSelection,
    isGalleryMode: () => galleryMode
  };
}
