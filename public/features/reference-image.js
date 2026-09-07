const DEFAULT_MAX_FILE_BYTES = 20 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function inferImageMimeType(file) {
  if (SUPPORTED_IMAGE_TYPES.has(file?.type)) return file.type;
  const extension = String(file?.name ?? "").split(".").pop()?.toLowerCase();
  return extension === "png"
    ? "image/png"
    : ["jpg", "jpeg"].includes(extension)
      ? "image/jpeg"
      : extension === "webp"
        ? "image/webp"
        : "";
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("ファイル読込エラー")));
    reader.readAsDataURL(file);
  });
}

export function imageDimensions(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve({
      width: image.naturalWidth,
      height: image.naturalHeight
    }), { once: true });
    image.addEventListener("error", () => reject(new Error("画像形式を認識できません")), { once: true });
    image.src = source;
  });
}

function clampRound(value, minimum, maximum, multiple) {
  return Math.min(maximum, Math.max(minimum, Math.round(value / multiple) * multiple));
}

function copyReference(reference) {
  return reference ? { ...reference } : null;
}

export function createReferenceImageController({
  elements,
  getMode,
  setMode,
  clearError,
  showError,
  onClear = () => {},
  onSyncPreferenceChange = () => {},
  readFile = fileToDataUrl,
  readDimensions = imageDimensions,
  createObjectUrl = (file) => URL.createObjectURL(file),
  revokeObjectUrl = (url) => URL.revokeObjectURL(url),
  maxFileBytes = DEFAULT_MAX_FILE_BYTES,
  makeMaskKey = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  windowTarget = globalThis.window,
  managePageLifecycle = true
}) {
  let reference = null;
  let initialized = false;
  let fileLoadToken = 0;
  const listeners = [];

  function listen(target, eventName, handler) {
    target?.addEventListener(eventName, handler);
    listeners.push([target, eventName, handler]);
  }

  function revokeReferenceObjectUrl(value = reference) {
    const objectUrl = value?.objectUrl;
    if (!objectUrl) return;
    revokeObjectUrl(objectUrl);
  }

  function syncResolution(sourceWidth, sourceHeight) {
    const width = Number(sourceWidth);
    const height = Number(sourceHeight);
    if (!(width > 0 && height > 0)) return false;
    const longEdge = Math.min(1536, Math.max(512, Math.max(
      Number(elements.width.value) || 896,
      Number(elements.height.value) || 1152
    )));
    const ratio = width / height;
    const targetWidth = ratio >= 1 ? longEdge : longEdge * ratio;
    const targetHeight = ratio >= 1 ? longEdge / ratio : longEdge;
    elements.width.value = clampRound(targetWidth, 256, 1536, 64);
    elements.height.value = clampRound(targetHeight, 256, 1536, 64);
    return true;
  }

  function sourceStatus(value) {
    if (value.sourceKind === "local-file") return `アップロード: ${value.filename ?? "参照画像"}`;
    if (value.sourceKind === "reference-asset") return `参照アセット: ${value.filename ?? value.imageId}`;
    return `履歴から使用: ${value.filename ?? value.imageId}`;
  }

  function applyReference(nextReference, { scroll = false, mode = "img2img", syncSize = true } = {}) {
    if (!nextReference?.imageUrl) return false;
    const next = {
      ...nextReference,
      sourceKind: ["local-file", "history-image", "reference-asset"].includes(nextReference.sourceKind)
        ? nextReference.sourceKind
        : nextReference.imageId
          ? "history-image"
          : "local-file",
      maskKey: nextReference.maskKey ?? nextReference.imageId ?? makeMaskKey()
    };
    const previous = reference;
    reference = next;
    if (previous?.objectUrl && previous.objectUrl !== next.objectUrl) revokeReferenceObjectUrl(previous);

    setMode(mode);
    elements.initImagePreview.src = next.imageUrl;
    elements.initImagePreview.classList.remove("hidden");
    elements.initImageEmpty.classList.add("hidden");
    elements.initImageStatus.textContent = sourceStatus(next);
    elements.clearInitImageButton.disabled = false;
    elements.initImageInput.value = "";

    if (next.width && next.height) {
      if (syncSize && elements.syncInitImageSize.checked) syncResolution(next.width, next.height);
    } else {
      void readDimensions(next.imageUrl).then(({ width, height }) => {
        if (reference !== next) return;
        next.width = width;
        next.height = height;
        if (syncSize && elements.syncInitImageSize.checked) syncResolution(width, height);
      }).catch(() => {});
    }

    if (scroll) elements.img2imgPanel.scrollIntoView({ behavior: "smooth", block: "center" });
    return true;
  }

  function setReference(nextReference, options) {
    fileLoadToken++;
    return applyReference(nextReference, options);
  }

  async function loadFile(file) {
    const token = ++fileLoadToken;
    clearError();
    const mimeType = inferImageMimeType(file);
    if (!mimeType) {
      showError("参照画像はPNG・JPEG・WebPを選択してください");
      return false;
    }
    if (file.size > maxFileBytes) {
      showError("参照画像は20MB以下にしてください");
      return false;
    }

    let objectUrl = "";
    try {
      const loadedDataUrl = await readFile(file);
      if (token !== fileLoadToken) return false;
      const dataUrl = loadedDataUrl.replace(/^data:[^;]*;/, `data:${mimeType};`);
      const dimensions = await readDimensions(dataUrl);
      if (token !== fileLoadToken) return false;
      objectUrl = createObjectUrl(file);
      if (token !== fileLoadToken) {
        if (objectUrl) revokeObjectUrl(objectUrl);
        return false;
      }
      return applyReference({
        sourceKind: "local-file",
        dataUrl,
        imageUrl: objectUrl || dataUrl,
        objectUrl: objectUrl || null,
        imageId: null,
        filename: file.name,
        mimeType,
        ...dimensions
      }, { mode: getMode() === "inpaint" ? "inpaint" : "img2img" });
    } catch (error) {
      if (objectUrl) revokeObjectUrl(objectUrl);
      showError(`参照画像を読み込めませんでした: ${error.message}`);
      return false;
    }
  }

  function useImage(image, { imageUrl, mode = "img2img", scroll = true, sourceKind = "history-image" } = {}) {
    return setReference({
      sourceKind,
      dataUrl: null,
      imageUrl,
      imageId: image.id,
      filename: image.filename,
      mimeType: image.mimeType,
      width: image.width,
      height: image.height
    }, { scroll, mode });
  }

  function clear() {
    fileLoadToken++;
    const previous = reference;
    reference = null;
    revokeReferenceObjectUrl(previous);
    elements.initImageInput.value = "";
    elements.initImagePreview.removeAttribute("src");
    elements.initImagePreview.classList.add("hidden");
    elements.initImageEmpty.classList.remove("hidden");
    elements.initImageStatus.textContent = "参照画像が未選択です";
    elements.clearInitImageButton.disabled = true;
    onClear();
  }

  function readPayload(mode = getMode()) {
    if (mode === "txt2img" || !reference) return {};
    return reference.imageId
      ? { initImageId: reference.imageId }
      : { initImage: reference.dataUrl };
  }

  function captureSnapshot() {
    if (!reference) return null;
    const snapshot = copyReference(reference);
    delete snapshot.objectUrl;
    if (snapshot.sourceKind === "local-file") snapshot.imageUrl = snapshot.dataUrl;
    return snapshot;
  }

  function restoreSnapshot(snapshot, { mode = "img2img", syncSize = true } = {}) {
    // Restoring an empty snapshot must still supersede an in-flight local read,
    // even when no reference has been committed yet.
    fileLoadToken++;
    if (!snapshot) {
      if (reference) clear();
      return;
    }
    setReference(copyReference(snapshot), { mode, syncSize });
  }

  function syncSelectedSize() {
    if (reference?.width && reference?.height) syncResolution(reference.width, reference.height);
  }

  function init() {
    if (initialized) return;
    initialized = true;
    listen(elements.chooseInitImageButton, "click", () => elements.initImageInput.click());
    listen(elements.initImageInput, "change", () => {
      const [file] = elements.initImageInput.files ?? [];
      if (file) void loadFile(file);
    });
    listen(elements.clearInitImageButton, "click", clear);
    listen(elements.syncInitImageSize, "change", () => {
      onSyncPreferenceChange();
      if (elements.syncInitImageSize.checked) syncSelectedSize();
    });
    for (const eventName of ["dragenter", "dragover"]) {
      listen(elements.img2imgDropZone, eventName, (event) => {
        event.preventDefault();
        elements.img2imgDropZone.classList.add("dragging");
      });
    }
    for (const eventName of ["dragleave", "drop"]) {
      listen(elements.img2imgDropZone, eventName, (event) => {
        event.preventDefault();
        elements.img2imgDropZone.classList.remove("dragging");
      });
    }
    listen(elements.img2imgDropZone, "drop", (event) => {
      const [file] = event.dataTransfer?.files ?? [];
      if (file) void loadFile(file);
    });
    if (managePageLifecycle) listen(windowTarget, "beforeunload", dispose);
  }

  function setBusy(busy) {
    elements.chooseInitImageButton.disabled = busy;
    elements.initImageInput.disabled = busy;
    elements.clearInitImageButton.disabled = busy || !reference;
    elements.syncInitImageSize.disabled = busy;
  }

  function dispose() {
    fileLoadToken++;
    for (const [target, eventName, handler] of listeners.splice(0)) {
      target?.removeEventListener(eventName, handler);
    }
    revokeReferenceObjectUrl();
    reference = null;
    initialized = false;
  }

  return {
    init,
    dispose,
    loadFile,
    useImage,
    setReference,
    clear,
    hasReference: () => Boolean(reference),
    getReference: () => copyReference(reference),
    readPayload,
    captureSnapshot,
    restoreSnapshot,
    syncResolution,
    syncSelectedSize,
    setBusy
  };
}
