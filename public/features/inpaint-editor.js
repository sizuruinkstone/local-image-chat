const DEFAULT_MAX_HISTORY = 12;

function defaultWaitForImage(image) {
  if (image.complete && image.naturalWidth) return Promise.resolve();
  return new Promise((resolve, reject) => {
    image.addEventListener("load", resolve, { once: true });
    image.addEventListener("error", () => reject(new Error("画像読込エラー")), { once: true });
  });
}

export function createInpaintEditor({
  elements,
  storage,
  createImage = () => new Image(),
  waitForImage = defaultWaitForImage,
  maxHistory = DEFAULT_MAX_HISTORY
}) {
  let drawing = false;
  let lastPoint = null;
  let tool = "paint";
  let sourceKey = "";
  let sourceReference = null;
  let undoStack = [];
  let redoStack = [];
  let asyncGeneration = 0;
  let defaultFullRes = true;
  let initialized = false;
  const listeners = [];

  function listen(target, eventName, handler) {
    target?.addEventListener(eventName, handler);
    listeners.push([target, eventName, handler]);
  }

  function updateBrushSize() {
    elements.maskBrushSizeValue.value = elements.maskBrushSize.value;
  }

  function setTool(nextTool) {
    tool = nextTool === "erase" ? "erase" : "paint";
    const painting = tool === "paint";
    elements.maskPaintButton.classList.toggle("active", painting);
    elements.maskPaintButton.setAttribute("aria-pressed", String(painting));
    elements.maskEraseButton.classList.toggle("active", !painting);
    elements.maskEraseButton.setAttribute("aria-pressed", String(!painting));
  }

  function updateHistoryButtons() {
    const available = Boolean(elements.inpaintMaskCanvas.width);
    elements.maskUndoButton.disabled = !available || !undoStack.length;
    elements.maskRedoButton.disabled = !available || !redoStack.length;
    elements.maskClearButton.disabled = !available;
  }

  function captureMaskSnapshot() {
    return elements.inpaintMaskCanvas.width
      ? elements.inpaintMaskCanvas.toDataURL("image/png")
      : null;
  }

  function copyRestorableSource(reference) {
    if (!reference) return null;
    const imageUrl = reference.dataUrl || reference.imageUrl;
    if (!imageUrl) return null;
    return {
      maskKey: String(reference.maskKey ?? reference.imageId ?? imageUrl),
      imageId: reference.imageId ? String(reference.imageId) : null,
      imageUrl: String(imageUrl),
      dataUrl: reference.dataUrl ? String(reference.dataUrl) : null,
      width: Number(reference.width) || null,
      height: Number(reference.height) || null
    };
  }

  function invalidateAsyncWork() {
    asyncGeneration++;
    drawing = false;
    lastPoint = null;
    return asyncGeneration;
  }

  function pushUndo() {
    const snapshot = captureMaskSnapshot();
    if (!snapshot) return;
    undoStack.push(snapshot);
    if (undoStack.length > maxHistory) undoStack.shift();
  }

  function hasMask() {
    const canvas = elements.inpaintMaskCanvas;
    if (!canvas.width) return false;
    const pixels = canvas.getContext("2d", { willReadFrequently: true })
      .getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] > 16) return true;
    }
    return false;
  }

  function clearMask(record = true) {
    invalidateAsyncWork();
    const canvas = elements.inpaintMaskCanvas;
    if (!canvas.width) return;
    if (record) pushUndo();
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.save();
    context.globalCompositeOperation = "source-over";
    context.fillStyle = "#000000";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.restore();
    if (record) redoStack = [];
    elements.maskStatus.textContent = "未塗り";
    updateHistoryButtons();
  }

  function pointFromEvent(event) {
    const canvas = elements.inpaintMaskCanvas;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * canvas.width / rect.width,
      y: (event.clientY - rect.top) * canvas.height / rect.height
    };
  }

  function drawLine(from, to) {
    const context = elements.inpaintMaskCanvas.getContext("2d", { willReadFrequently: true });
    context.save();
    const color = tool === "paint" ? "#ffffff" : "#000000";
    const lineWidth = Number(elements.maskBrushSize.value);
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = lineWidth;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
    if (from.x === to.x && from.y === to.y) {
      context.beginPath();
      context.arc(from.x, from.y, lineWidth / 2, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  function beginStroke(event) {
    if (!elements.inpaintMaskCanvas.width) return;
    invalidateAsyncWork();
    event.preventDefault();
    elements.inpaintMaskCanvas.setPointerCapture?.(event.pointerId);
    pushUndo();
    redoStack = [];
    drawing = true;
    lastPoint = pointFromEvent(event);
    drawLine(lastPoint, lastPoint);
    updateHistoryButtons();
  }

  function continueStroke(event) {
    if (!drawing || !lastPoint) return;
    event.preventDefault();
    const nextPoint = pointFromEvent(event);
    drawLine(lastPoint, nextPoint);
    lastPoint = nextPoint;
  }

  function endStroke(event) {
    if (!drawing) return;
    event.preventDefault();
    drawing = false;
    lastPoint = null;
    elements.maskStatus.textContent = hasMask() ? "修正範囲あり" : "未塗り";
    updateHistoryButtons();
  }

  async function decodeImage(dataUrl) {
    const image = createImage();
    image.src = dataUrl;
    await waitForImage(image);
    return image;
  }

  function drawMaskImage(image) {
    const canvas = elements.inpaintMaskCanvas;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    elements.maskStatus.textContent = hasMask() ? "修正範囲あり" : "未塗り";
    updateHistoryButtons();
  }

  async function restoreMaskSnapshot(dataUrl, generation) {
    const image = await decodeImage(dataUrl);
    if (generation !== asyncGeneration || !elements.inpaintMaskCanvas.width) return false;
    drawMaskImage(image);
    return true;
  }

  async function undo() {
    const snapshot = undoStack.at(-1);
    if (!snapshot) return false;
    const current = captureMaskSnapshot();
    const generation = invalidateAsyncWork();
    try {
      if (!await restoreMaskSnapshot(snapshot, generation)) return false;
    } catch {
      return false;
    }
    undoStack.pop();
    if (current) redoStack.push(current);
    updateHistoryButtons();
    return true;
  }

  async function redo() {
    const snapshot = redoStack.at(-1);
    if (!snapshot) return false;
    const current = captureMaskSnapshot();
    const generation = invalidateAsyncWork();
    try {
      if (!await restoreMaskSnapshot(snapshot, generation)) return false;
    } catch {
      return false;
    }
    redoStack.pop();
    if (current) undoStack.push(current);
    updateHistoryButtons();
    return true;
  }

  async function setSource(reference) {
    if (!reference) {
      reset();
      return false;
    }
    const nextSourceKey = reference.maskKey ?? reference.imageId ?? reference.imageUrl;
    if (sourceKey === nextSourceKey && elements.inpaintMaskCanvas.width) return true;
    const generation = invalidateAsyncWork();
    elements.inpaintBaseImage.src = reference.imageUrl;
    try {
      await waitForImage(elements.inpaintBaseImage);
    } catch {
      if (generation === asyncGeneration) elements.maskStatus.textContent = "画像を表示できませんでした";
      return false;
    }
    if (generation !== asyncGeneration) return false;

    const width = elements.inpaintBaseImage.naturalWidth;
    const height = elements.inpaintBaseImage.naturalHeight;
    sourceKey = String(nextSourceKey);
    sourceReference = copyRestorableSource(reference);
    elements.inpaintMaskCanvas.width = width;
    elements.inpaintMaskCanvas.height = height;
    elements.inpaintCanvasStage.classList.add("hasImage");
    elements.inpaintBaseImage.classList.remove("hidden");
    elements.inpaintMaskCanvas.classList.remove("hidden");
    elements.inpaintMaskEmpty.classList.add("hidden");
    undoStack = [];
    redoStack = [];
    clearMask(false);
    elements.maskStatus.textContent = `${width}×${height}・未塗り`;
    return true;
  }

  function reset() {
    invalidateAsyncWork();
    sourceKey = "";
    sourceReference = null;
    undoStack = [];
    redoStack = [];
    drawing = false;
    lastPoint = null;
    elements.inpaintBaseImage.removeAttribute("src");
    elements.inpaintBaseImage.classList.add("hidden");
    elements.inpaintMaskCanvas.width = 0;
    elements.inpaintMaskCanvas.height = 0;
    elements.inpaintMaskCanvas.classList.add("hidden");
    elements.inpaintMaskEmpty.classList.remove("hidden");
    elements.inpaintCanvasStage.classList.remove("hasImage");
    elements.maskStatus.textContent = "画像を選択してください";
    updateHistoryButtons();
  }

  function captureState() {
    const canvas = elements.inpaintMaskCanvas;
    return {
      source: sourceReference ? { ...sourceReference } : null,
      sourceKey,
      width: Number(canvas.width) || 0,
      height: Number(canvas.height) || 0,
      maskImage: captureMaskSnapshot(),
      tool,
      brushSize: String(elements.maskBrushSize.value),
      undoStack: [...undoStack],
      redoStack: [...redoStack]
    };
  }

  async function restoreState(snapshot, { isCurrent = () => true } = {}) {
    const generation = invalidateAsyncWork();
    if (!snapshot || !isCurrent()) return false;

    const source = copyRestorableSource(snapshot.source);
    const width = Number(snapshot.width);
    const height = Number(snapshot.height);
    const maskImage = typeof snapshot.maskImage === "string" ? snapshot.maskImage : null;
    const nextUndoStack = Array.isArray(snapshot.undoStack)
      ? snapshot.undoStack.filter((value) => typeof value === "string").slice(-maxHistory)
      : [];
    const nextRedoStack = Array.isArray(snapshot.redoStack)
      ? snapshot.redoStack.filter((value) => typeof value === "string").slice(-maxHistory)
      : [];

    if (!source) {
      if (width || height || maskImage || !isCurrent()) return false;
      reset();
      elements.maskBrushSize.value = String(snapshot.brushSize ?? elements.maskBrushSize.value);
      updateBrushSize();
      setTool(snapshot.tool);
      return true;
    }
    if (!(width > 0 && height > 0) || !maskImage) return false;

    let decodedSource;
    let decodedMask;
    try {
      [decodedSource, decodedMask] = await Promise.all([
        decodeImage(source.imageUrl),
        decodeImage(maskImage)
      ]);
    } catch {
      return false;
    }
    if (generation !== asyncGeneration || !isCurrent()) return false;

    const canvas = elements.inpaintMaskCanvas;
    sourceKey = String(snapshot.sourceKey || source.maskKey);
    sourceReference = source;
    elements.inpaintBaseImage.src = source.imageUrl;
    canvas.width = width;
    canvas.height = height;
    elements.inpaintCanvasStage.classList.add("hasImage");
    elements.inpaintBaseImage.classList.remove("hidden");
    canvas.classList.remove("hidden");
    elements.inpaintMaskEmpty.classList.add("hidden");
    drawMaskImage(decodedMask);
    // decodedSource is intentionally owner-local validation only. The live base
    // image remains the supplied DOM element, never part of the snapshot.
    void decodedSource;
    undoStack = nextUndoStack;
    redoStack = nextRedoStack;
    elements.maskBrushSize.value = String(snapshot.brushSize ?? elements.maskBrushSize.value);
    updateBrushSize();
    setTool(snapshot.tool);
    elements.maskStatus.textContent = hasMask() ? "修正範囲あり" : `${width}×${height}・未塗り`;
    updateHistoryButtons();
    return true;
  }

  function savePreferences() {
    elements.inpaintDenoisingValue.value = Number(elements.inpaintDenoising.value).toFixed(2);
    storage.setItem("localImageChat.inpaintDenoising", elements.inpaintDenoising.value);
    storage.setItem("localImageChat.maskBlur", elements.maskBlur.value);
    storage.setItem("localImageChat.inpaintFill", elements.inpaintFill.value);
    storage.setItem("localImageChat.inpaintFullRes", String(elements.inpaintFullRes.checked));
    storage.setItem("localImageChat.inpaintFullResPadding", elements.inpaintFullResPadding.value);
  }

  function loadPreferences() {
    const saved = {
      inpaintDenoising: storage.getItem("localImageChat.inpaintDenoising"),
      maskBlur: storage.getItem("localImageChat.maskBlur"),
      inpaintFill: storage.getItem("localImageChat.inpaintFill"),
      inpaintFullResPadding: storage.getItem("localImageChat.inpaintFullResPadding")
    };
    if (Number(saved.inpaintDenoising) >= 0.05 && Number(saved.inpaintDenoising) <= 0.95) {
      elements.inpaintDenoising.value = saved.inpaintDenoising;
    }
    if (saved.maskBlur !== null && Number(saved.maskBlur) >= 0 && Number(saved.maskBlur) <= 64) {
      elements.maskBlur.value = saved.maskBlur;
    }
    if (["0", "1", "2", "3"].includes(saved.inpaintFill)) elements.inpaintFill.value = saved.inpaintFill;
    if (
      saved.inpaintFullResPadding !== null
      && Number(saved.inpaintFullResPadding) >= 0
      && Number(saved.inpaintFullResPadding) <= 256
    ) {
      elements.inpaintFullResPadding.value = saved.inpaintFullResPadding;
    }
    const fullRes = storage.getItem("localImageChat.inpaintFullRes");
    elements.inpaintFullRes.checked = fullRes === null ? defaultFullRes : fullRes !== "false";
    savePreferences();
    updateBrushSize();
    setTool("paint");
    updateHistoryButtons();
  }

  function init() {
    if (initialized) return;
    initialized = true;
    listen(elements.maskPaintButton, "click", () => setTool("paint"));
    listen(elements.maskEraseButton, "click", () => setTool("erase"));
    listen(elements.maskUndoButton, "click", () => { void undo(); });
    listen(elements.maskRedoButton, "click", () => { void redo(); });
    listen(elements.maskClearButton, "click", () => clearMask());
    listen(elements.maskBrushSize, "input", updateBrushSize);
    listen(elements.inpaintDenoising, "input", savePreferences);
    for (const element of [
      elements.maskBlur, elements.inpaintFill, elements.inpaintFullRes, elements.inpaintFullResPadding
    ]) listen(element, "change", savePreferences);
    listen(elements.inpaintMaskCanvas, "pointerdown", beginStroke);
    listen(elements.inpaintMaskCanvas, "pointermove", continueStroke);
    for (const eventName of ["pointerup", "pointercancel", "pointerleave"]) {
      listen(elements.inpaintMaskCanvas, eventName, endStroke);
    }
  }

  function setBusy(busy) {
    elements.maskPaintButton.disabled = busy;
    elements.maskEraseButton.disabled = busy;
    elements.maskBrushSize.disabled = busy;
    elements.inpaintDenoising.disabled = busy;
    elements.maskBlur.disabled = busy;
    elements.inpaintFill.disabled = busy;
    elements.inpaintFullRes.disabled = busy;
    elements.inpaintFullResPadding.disabled = busy;
    if (busy) {
      elements.maskUndoButton.disabled = true;
      elements.maskRedoButton.disabled = true;
      elements.maskClearButton.disabled = true;
    } else {
      updateHistoryButtons();
    }
  }

  function readPayload(mode) {
    if (mode !== "inpaint" || !elements.inpaintMaskCanvas.width) return {};
    return { maskImage: elements.inpaintMaskCanvas.toDataURL("image/png") };
  }

  function dispose() {
    for (const [target, eventName, handler] of listeners.splice(0)) {
      target?.removeEventListener(eventName, handler);
    }
    reset();
    initialized = false;
  }

  return {
    init,
    dispose,
    setSource,
    reset,
    setTool,
    clearMask,
    undo,
    redo,
    hasMask,
    readPayload,
    captureState,
    restoreState,
    loadPreferences,
    savePreferences,
    setDefaultFullRes: (value) => { defaultFullRes = value !== false; },
    setBusy,
    getState: () => ({
      drawing,
      tool,
      sourceKey,
      undoCount: undoStack.length,
      redoCount: redoStack.length
    })
  };
}
