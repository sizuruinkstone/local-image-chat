import { fileToDataUrl, inferImageMimeType } from "./reference-image.js";

const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
const INITIAL_OPTIONS = Object.freeze({
  available: false,
  family: null,
  module: null,
  model: null,
  message: "利用可否を確認中…"
});
const INITIAL_STATE = Object.freeze({
  enabled: false,
  weight: 0.65,
  guidanceStart: 0,
  guidanceEnd: 1,
  referenceImageId: null,
  referenceImageUrl: null,
  referenceImage: null,
  previewUrl: "",
  label: ""
});

function copyOptions(value) {
  return { ...INITIAL_OPTIONS, ...value };
}

function copyState(value) {
  return { ...INITIAL_STATE, ...value };
}

function copyRestorableState(value) {
  const snapshot = copyState(value);
  // Blob URLs are owned by the live controller and may be revoked as soon as
  // another reference replaces them. Local references always retain the Data
  // URL needed to recreate their preview without sharing URL ownership.
  if (snapshot.referenceImage) snapshot.previewUrl = String(snapshot.referenceImage);
  return snapshot;
}

export function createIpAdapterController({
  elements,
  getJson,
  runtimeApiUrl,
  runtimeRequestContext,
  isRuntimeContextCurrent,
  runtimeSupports,
  isRuntimeSwitching,
  getGenerationBusy,
  showError,
  clearError,
  toast,
  shorten,
  originalImageUrl,
  onAvailabilityChange = () => {},
  readFile = fileToDataUrl,
  createObjectUrl = (file) => URL.createObjectURL(file),
  revokeObjectUrl = (url) => URL.revokeObjectURL(url),
  requestFrame = (callback) => requestAnimationFrame(callback),
  prefersReducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches,
  windowTarget = globalThis.window,
  maxReferenceBytes = MAX_REFERENCE_BYTES,
  managePageLifecycle = true
}) {
  let options = copyOptions();
  let state = copyState();
  let objectUrl = null;
  let requestToken = 0;
  let fileLoadToken = 0;
  let initialized = false;
  const listeners = [];

  function listen(target, eventName, handler) {
    target?.addEventListener(eventName, handler);
    listeners.push([target, eventName, handler]);
  }

  function runtimeAvailable() {
    return runtimeSupports("ipAdapter") === true;
  }

  function isAvailable() {
    return options.available === true && runtimeAvailable();
  }

  function hasReference() {
    return Boolean(state.referenceImageId || state.referenceImageUrl || state.referenceImage);
  }

  function syncValueLabels() {
    elements.ipAdapterWeightValue.textContent = Number(elements.ipAdapterWeight.value).toFixed(2);
    elements.ipAdapterGuidanceStartValue.textContent = Number(elements.ipAdapterGuidanceStart.value).toFixed(2);
    elements.ipAdapterGuidanceEndValue.textContent = Number(elements.ipAdapterGuidanceEnd.value).toFixed(2);
  }

  function syncUi() {
    const referenceAvailable = hasReference();
    const available = isAvailable();
    const runtimeSwitching = isRuntimeSwitching();
    const generationBusy = getGenerationBusy();
    const disabled = generationBusy || runtimeSwitching || !available;
    const unavailableMessage = runtimeAvailable()
      ? options.message
      : "選択したRuntimeではIP-Adapterを利用できません";
    elements.ipAdapterModel.textContent = available
      ? shorten(options.model || options.module || "利用可能", 28)
      : "利用不可";
    elements.ipAdapterModel.title = available ? options.model || "" : unavailableMessage;
    elements.ipAdapterEnabled.checked = Boolean(state.enabled && referenceAvailable && available);
    elements.ipAdapterEnabled.disabled = disabled || !referenceAvailable;
    elements.chooseIpAdapterButton.disabled = disabled;
    elements.ipAdapterInput.disabled = disabled;
    elements.clearIpAdapterButton.disabled = generationBusy || !referenceAvailable;
    for (const control of [
      elements.ipAdapterWeight,
      elements.ipAdapterGuidanceStart,
      elements.ipAdapterGuidanceEnd
    ]) control.disabled = disabled || !referenceAvailable;

    elements.ipAdapterWeight.value = String(state.weight);
    elements.ipAdapterGuidanceStart.value = String(state.guidanceStart);
    elements.ipAdapterGuidanceEnd.value = String(state.guidanceEnd);
    syncValueLabels();
    if (state.previewUrl) {
      if (elements.ipAdapterPreview.getAttribute("src") !== state.previewUrl) {
        elements.ipAdapterPreview.src = state.previewUrl;
      }
      elements.ipAdapterPreview.classList.remove("hidden");
      elements.ipAdapterEmpty.classList.add("hidden");
    } else {
      elements.ipAdapterPreview.removeAttribute("src");
      elements.ipAdapterPreview.classList.add("hidden");
      elements.ipAdapterEmpty.classList.remove("hidden");
    }
    elements.ipAdapterStatus.textContent = !available
      ? unavailableMessage
      : generationBusy || runtimeSwitching
        ? "生成中はIP-Adapterを変更できません"
        : state.enabled && referenceAvailable
          ? `この画像を参照中: ${shorten(state.label, 42)}`
          : referenceAvailable
            ? `参照画像を設定済み（OFF）: ${shorten(state.label, 42)}`
            : "参照画像を選択してください";
    onAvailabilityChange({ runtimeSwitching, ipAdapterAvailable: available });
  }

  function revokeOwnedObjectUrl(url = objectUrl) {
    if (!url) return;
    revokeObjectUrl(url);
    if (url === objectUrl) objectUrl = null;
  }

  function openSettings() {
    elements.generationSettingsDetails.open = true;
    elements.ipAdapterDetails.open = true;
    requestFrame(() => {
      elements.ipAdapterDetails.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: "nearest"
      });
    });
  }

  function applyReference(reference, { focus = false, silent = false } = {}) {
    if (!isAvailable()) {
      if (!silent) showError(runtimeAvailable()
        ? options.message
        : "選択したRuntimeではIP-Adapterを利用できません");
      return false;
    }
    const imageId = reference?.imageId ? String(reference.imageId) : null;
    const referenceImageId = reference?.referenceImageId ? String(reference.referenceImageId) : imageId;
    const imageUrl = reference?.imageUrl ? String(reference.imageUrl) : null;
    const dataUrl = reference?.dataUrl ? String(reference.dataUrl) : null;
    if (!referenceImageId && !imageUrl && !dataUrl) {
      if (!silent) showError("IP-Adapter参照画像を選択してください");
      return false;
    }

    const sameReference = referenceImageId === state.referenceImageId
      && imageUrl === state.referenceImageUrl
      && dataUrl === state.referenceImage;
    let previewUrl = String(reference.previewUrl ?? imageUrl ?? dataUrl ?? "");
    if (!sameReference) revokeOwnedObjectUrl();
    if (reference.objectUrl) {
      if (sameReference && objectUrl && objectUrl !== reference.objectUrl) {
        revokeOwnedObjectUrl(reference.objectUrl);
        previewUrl = state.previewUrl;
      } else {
        objectUrl = reference.objectUrl;
      }
    }
    state = {
      ...state,
      enabled: true,
      referenceImageId,
      referenceImageUrl: imageUrl,
      referenceImage: dataUrl,
      previewUrl,
      label: String(reference.label ?? referenceImageId ?? imageUrl ?? "参照画像")
    };
    if (sameReference) {
      state.weight = Number(elements.ipAdapterWeight.value);
      state.guidanceStart = Number(elements.ipAdapterGuidanceStart.value);
      state.guidanceEnd = Number(elements.ipAdapterGuidanceEnd.value);
    }
    syncUi();
    if (focus) openSettings();
    return true;
  }

  function setReference(reference, options) {
    fileLoadToken++;
    return applyReference(reference, options);
  }

  function setCurrentImageAsReference(image, { focus = false } = {}) {
    if (!image?.id) {
      showError("この画像はIP-Adapter参照に使用できません");
      return false;
    }
    if (!isAvailable()) {
      showError(runtimeAvailable()
        ? options.message
        : "選択したRuntimeではIP-Adapterを利用できません");
      return false;
    }
    return setReference({
      referenceImageId: image.id,
      previewUrl: image.thumbnailUrl || originalImageUrl(image),
      label: image.filename || image.id
    }, { focus });
  }

  function clearReference({ silent = false } = {}) {
    fileLoadToken++;
    revokeOwnedObjectUrl();
    state = {
      ...state,
      enabled: false,
      referenceImageId: null,
      referenceImageUrl: null,
      referenceImage: null,
      previewUrl: "",
      label: ""
    };
    elements.ipAdapterInput.value = "";
    syncUi();
    if (!silent) toast.info("IP-Adapter参照を解除しました");
  }

  function toggleEnabled() {
    if (!elements.ipAdapterEnabled.checked) {
      state.enabled = false;
      syncUi();
      return false;
    }
    if (!isAvailable() || !hasReference()) {
      elements.ipAdapterEnabled.checked = false;
      state.enabled = false;
      showError(isAvailable()
        ? "IP-Adapter参照画像を選択してください"
        : runtimeAvailable()
          ? options.message
          : "選択したRuntimeではIP-Adapterを利用できません");
      syncUi();
      return false;
    }
    state.enabled = true;
    syncUi();
    return true;
  }

  function syncNumbers() {
    state.weight = Number(elements.ipAdapterWeight.value);
    state.guidanceStart = Number(elements.ipAdapterGuidanceStart.value);
    state.guidanceEnd = Number(elements.ipAdapterGuidanceEnd.value);
    syncValueLabels();
  }

  async function loadFile(file) {
    const token = ++fileLoadToken;
    clearError();
    if (!isAvailable()) {
      showError(runtimeAvailable()
        ? options.message
        : "選択したRuntimeではIP-Adapterを利用できません");
      return false;
    }
    const mimeType = inferImageMimeType(file);
    if (!mimeType) {
      showError("IP-Adapter参照画像はPNG・JPEG・WebPを選択してください");
      return false;
    }
    if (file.size > maxReferenceBytes) {
      showError("参照画像は20MB以下にしてください");
      return false;
    }

    const nextObjectUrl = createObjectUrl(file);
    try {
      const loadedDataUrl = await readFile(file);
      if (token !== fileLoadToken) {
        revokeObjectUrl(nextObjectUrl);
        return false;
      }
      const dataUrl = loadedDataUrl.replace(/^data:[^;]*;/, `data:${mimeType};`);
      const applied = applyReference({
        dataUrl,
        previewUrl: nextObjectUrl,
        objectUrl: nextObjectUrl,
        label: file.name
      }, { focus: true });
      if (!applied) revokeOwnedObjectUrl(nextObjectUrl);
      return applied;
    } catch (error) {
      revokeOwnedObjectUrl(nextObjectUrl);
      showError(`IP-Adapter参照画像を読み込めませんでした: ${error.message}`);
      return false;
    }
  }

  async function loadOptions(context = runtimeRequestContext()) {
    if (!isRuntimeContextCurrent(context)) return false;
    const token = ++requestToken;
    options = copyOptions({ message: "IP-Adapterの利用可否を確認中…" });
    syncUi();
    try {
      const data = await getJson(runtimeApiUrl("/api/reforge/ip-adapter/options"));
      if (token !== requestToken || !isRuntimeContextCurrent(context)) return false;
      options = copyOptions({
        available: data.available === true,
        family: typeof data.family === "string" ? data.family : null,
        module: typeof data.module === "string" ? data.module : null,
        model: typeof data.model === "string" ? data.model : null,
        message: String(data.message ?? "IP-Adapterを利用できません")
      });
    } catch (error) {
      if (token !== requestToken || !isRuntimeContextCurrent(context)) return false;
      options = copyOptions({ message: `IP-Adapterを利用できません: ${error.message}` });
    }
    if (!isAvailable()) state.enabled = false;
    syncUi();
    return isAvailable() || Boolean(options.message);
  }

  function applyMetadata(value) {
    fileLoadToken++;
    revokeOwnedObjectUrl();
    const imageId = value?.enabled && value.referenceImageId ? String(value.referenceImageId) : null;
    const imageUrl = value?.enabled && value.referenceImageUrl ? String(value.referenceImageUrl) : null;
    if (!imageId && !imageUrl) {
      clearReference({ silent: true });
      return false;
    }
    state = {
      ...state,
      enabled: isAvailable(),
      weight: Number(value.weight ?? state.weight),
      guidanceStart: Number(value.guidanceStart ?? state.guidanceStart),
      guidanceEnd: Number(value.guidanceEnd ?? state.guidanceEnd),
      referenceImageId: imageId,
      referenceImageUrl: imageUrl,
      referenceImage: null,
      previewUrl: imageId ? `/api/images/${encodeURIComponent(imageId)}/thumbnail` : imageUrl,
      label: imageId || imageUrl
    };
    syncUi();
    return true;
  }

  function restoreRecipe(recipe) {
    const value = recipe?.ipAdapter;
    if (!value?.enabled || (!value.referenceImageId && !value.referenceImageUrl)) {
      clearReference({ silent: true });
      return false;
    }
    return applyMetadata(value);
  }

  function readPayload() {
    if (!isAvailable() || !state.enabled || !hasReference()) return {};
    const ipAdapter = {
      enabled: true,
      weight: Number(state.weight),
      guidanceStart: Number(state.guidanceStart),
      guidanceEnd: Number(state.guidanceEnd)
    };
    if (state.referenceImageId) ipAdapter.referenceImageId = state.referenceImageId;
    else if (state.referenceImageUrl) ipAdapter.referenceImageUrl = state.referenceImageUrl;
    else if (state.referenceImage) ipAdapter.referenceImage = state.referenceImage;
    else return {};
    return { ipAdapter };
  }

  function captureState() {
    // Runtime/transaction rollback port. It is capability-independent;
    // readPayload() is the only port that gates data on the active Runtime.
    return { options: copyOptions(options), state: copyRestorableState(state) };
  }

  function restoreState(snapshot, { render = true } = {}) {
    if (!snapshot) return false;
    requestToken++;
    fileLoadToken++;
    revokeOwnedObjectUrl();
    options = copyOptions(snapshot.options);
    state = copyRestorableState(snapshot.state);
    elements.ipAdapterInput.value = "";
    if (render) syncUi();
    return true;
  }

  function getSnapshot() {
    // Compatibility metadata port for the retained IP feature state. Unlike a
    // generation payload, this remains readable while the Runtime is unsupported.
    if (!hasReference()) return null;
    const snapshot = copyRestorableState(state);
    return {
      enabled: snapshot.enabled,
      weight: Number(snapshot.weight),
      guidanceStart: Number(snapshot.guidanceStart),
      guidanceEnd: Number(snapshot.guidanceEnd),
      referenceImageId: snapshot.referenceImageId,
      referenceImageUrl: snapshot.referenceImageUrl,
      referenceImage: snapshot.referenceImage,
      previewUrl: snapshot.previewUrl,
      label: snapshot.label
    };
  }

  function restoreSnapshot(snapshot) {
    // Restore retained feature metadata without acquiring external resources.
    // Recipe restore remains restoreRecipe(), with its existing recipe semantics.
    if (!snapshot) {
      clearReference({ silent: true });
      return false;
    }
    fileLoadToken++;
    revokeOwnedObjectUrl();
    state = copyRestorableState({
      enabled: snapshot.enabled === true,
      weight: Number(snapshot.weight ?? state.weight),
      guidanceStart: Number(snapshot.guidanceStart ?? state.guidanceStart),
      guidanceEnd: Number(snapshot.guidanceEnd ?? state.guidanceEnd),
      referenceImageId: snapshot.referenceImageId ? String(snapshot.referenceImageId) : null,
      referenceImageUrl: snapshot.referenceImageUrl ? String(snapshot.referenceImageUrl) : null,
      referenceImage: snapshot.referenceImage ? String(snapshot.referenceImage) : null,
      previewUrl: String(snapshot.previewUrl ?? ""),
      label: String(snapshot.label ?? snapshot.referenceImageId ?? snapshot.referenceImageUrl ?? "参照画像")
    });
    if (!hasReference()) {
      clearReference({ silent: true });
      return false;
    }
    if (!state.previewUrl) {
      state.previewUrl = state.referenceImageId
        ? `/api/images/${encodeURIComponent(state.referenceImageId)}/thumbnail`
        : state.referenceImageUrl || state.referenceImage || "";
    }
    elements.ipAdapterInput.value = "";
    syncUi();
    return true;
  }

  function init() {
    if (initialized) return;
    initialized = true;
    listen(elements.chooseIpAdapterButton, "click", () => elements.ipAdapterInput.click());
    listen(elements.ipAdapterInput, "change", () => {
      const [file] = elements.ipAdapterInput.files ?? [];
      if (file) void loadFile(file);
    });
    for (const eventName of ["dragenter", "dragover"]) {
      listen(elements.ipAdapterDropZone, eventName, (event) => {
        event.preventDefault();
        elements.ipAdapterDropZone.classList.add("dragging");
      });
    }
    for (const eventName of ["dragleave", "drop"]) {
      listen(elements.ipAdapterDropZone, eventName, (event) => {
        event.preventDefault();
        elements.ipAdapterDropZone.classList.remove("dragging");
      });
    }
    listen(elements.ipAdapterDropZone, "drop", (event) => {
      const [file] = event.dataTransfer?.files ?? [];
      if (file) void loadFile(file);
    });
    listen(elements.clearIpAdapterButton, "click", () => clearReference());
    listen(elements.ipAdapterEnabled, "change", toggleEnabled);
    listen(elements.ipAdapterWeight, "input", syncNumbers);
    listen(elements.ipAdapterGuidanceStart, "input", syncNumbers);
    listen(elements.ipAdapterGuidanceEnd, "input", syncNumbers);
    if (managePageLifecycle) listen(windowTarget, "beforeunload", dispose);
  }

  function dispose() {
    requestToken++;
    fileLoadToken++;
    for (const [target, eventName, handler] of listeners.splice(0)) {
      target?.removeEventListener(eventName, handler);
    }
    revokeOwnedObjectUrl();
    initialized = false;
  }

  return {
    init,
    dispose,
    loadOptions,
    loadFile,
    setReference,
    setCurrentImageAsReference,
    clearReference,
    toggleEnabled,
    syncNumbers,
    syncUi,
    hasReference,
    isAvailable,
    applyMetadata,
    restoreRecipe,
    readPayload,
    captureState,
    restoreState,
    getSnapshot,
    restoreSnapshot,
    getOptions: () => copyOptions(options)
  };
}
