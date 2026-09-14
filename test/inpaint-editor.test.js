import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import { createInpaintEditor } from "../public/features/inpaint-editor.js";

function classList() {
  const values = new Set();
  return {
    add: (...names) => names.forEach((name) => values.add(name)),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    toggle(name, force) {
      if (force === undefined ? !values.has(name) : force) values.add(name);
      else values.delete(name);
    },
    contains: (name) => values.has(name)
  };
}

function eventTarget(extra = {}) {
  const listeners = new Map();
  const attributes = new Map();
  return {
    value: "",
    disabled: false,
    classList: classList(),
    ...extra,
    addEventListener(name, handler) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(handler);
    },
    removeEventListener(name, handler) {
      listeners.get(name)?.delete(handler);
    },
    dispatch(name, event = {}) {
      for (const handler of listeners.get(name) ?? []) handler(event);
    },
    listenerCount(name) {
      return listeners.get(name)?.size ?? 0;
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    getAttribute(name) {
      return attributes.get(name);
    }
  };
}

function makeCanvas() {
  let color = "transparent";
  let snapshotId = 0;
  const calls = [];
  const context = {
    fillStyle: "#000000",
    strokeStyle: "#000000",
    globalCompositeOperation: "source-over",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    save: () => calls.push(["save"]),
    restore: () => calls.push(["restore"]),
    beginPath: () => calls.push(["beginPath"]),
    moveTo: (x, y) => calls.push(["moveTo", x, y]),
    lineTo: (x, y) => calls.push(["lineTo", x, y]),
    arc: (x, y, radius) => calls.push(["arc", x, y, radius]),
    stroke() {
      color = context.strokeStyle === "#ffffff" ? "white" : "black";
      calls.push(["stroke", context.strokeStyle, context.lineWidth, context.globalCompositeOperation]);
    },
    fill() {
      color = context.fillStyle === "#ffffff" ? "white" : "black";
      calls.push(["fill", context.fillStyle, context.globalCompositeOperation]);
    },
    fillRect(x, y, width, height) {
      color = context.fillStyle === "#ffffff" ? "white" : "black";
      calls.push(["fillRect", x, y, width, height, context.fillStyle, context.globalCompositeOperation]);
    },
    clearRect: (...args) => {
      color = "transparent";
      calls.push(["clearRect", ...args]);
    },
    drawImage(image, x, y, width, height) {
      color = String(image.src).includes("mask=white") ? "white" : "black";
      calls.push(["drawImage", image.src, x, y, width, height]);
    },
    getImageData() {
      return {
        data: color === "white"
          ? new Uint8ClampedArray([255, 255, 255, 255])
          : color === "black"
            ? new Uint8ClampedArray([0, 0, 0, 255])
            : new Uint8ClampedArray([0, 0, 0, 0])
      };
    }
  };
  const canvas = eventTarget({
    width: 0,
    height: 0,
    getContext: () => context,
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 500, height: 250 }),
    setPointerCapture: (pointerId) => calls.push(["capture", pointerId]),
    toDataURL(type) {
      calls.push(["toDataURL", type]);
      return `data:image/png;mask=${color};snapshot=${++snapshotId}`;
    }
  });
  return { canvas, context, calls, color: () => color };
}

function make(overrides = {}) {
  const { canvas, context, calls, color } = makeCanvas();
  const storageValues = new Map(Object.entries(overrides.storage ?? {}));
  const storage = {
    getItem: (key) => storageValues.has(key) ? storageValues.get(key) : null,
    setItem: (key, value) => storageValues.set(key, String(value))
  };
  const baseImage = eventTarget({
    src: "",
    complete: true,
    naturalWidth: overrides.sourceWidth ?? 1000,
    naturalHeight: overrides.sourceHeight ?? 500,
    removeAttribute(name) {
      if (name === "src") baseImage.src = "";
    }
  });
  const elements = {
    inpaintCanvasStage: eventTarget(),
    inpaintMaskEmpty: eventTarget(),
    inpaintBaseImage: baseImage,
    inpaintMaskCanvas: canvas,
    maskStatus: eventTarget({ textContent: "画像を選択してください" }),
    maskPaintButton: eventTarget(),
    maskEraseButton: eventTarget(),
    maskUndoButton: eventTarget(),
    maskRedoButton: eventTarget(),
    maskClearButton: eventTarget(),
    maskBrushSize: eventTarget({ value: "48" }),
    maskBrushSizeValue: eventTarget(),
    inpaintDenoising: eventTarget({ value: "0.55" }),
    inpaintDenoisingValue: eventTarget(),
    maskBlur: eventTarget({ value: "6" }),
    inpaintFill: eventTarget({ value: "1" }),
    inpaintFullRes: eventTarget({ checked: true }),
    inpaintFullResPadding: eventTarget({ value: "32" })
  };
  const editor = createInpaintEditor({
    elements,
    storage,
    createImage: overrides.createImage ?? (() => ({ src: "" })),
    waitForImage: overrides.waitForImage ?? (async () => {}),
    maxHistory: overrides.maxHistory ?? 12
  });
  return { editor, elements, storageValues, context, calls, color };
}

function pointer(clientX, clientY, pointerId = 1) {
  return { clientX, clientY, pointerId, preventDefault() {} };
}

test("source image sets backing size, opaque black mask and empty history", async () => {
  const f = make();
  assert.equal(await f.editor.setSource({ maskKey: "source-a", imageUrl: "/a.png" }), true);
  assert.equal(f.elements.inpaintMaskCanvas.width, 1000);
  assert.equal(f.elements.inpaintMaskCanvas.height, 500);
  assert.equal(f.color(), "black");
  assert.equal(f.elements.inpaintCanvasStage.classList.contains("hasImage"), true);
  assert.equal(f.elements.maskStatus.textContent, "1000×500・未塗り");
  assert.deepEqual(f.editor.getState(), {
    drawing: false, tool: "paint", sourceKey: "source-a", undoCount: 0, redoCount: 0
  });
  assert.deepEqual(f.context.getImageData().data, new Uint8ClampedArray([0, 0, 0, 255]));
});

test("pointer coordinates map displayed rect to backing canvas and paint white with source-over", async () => {
  const f = make();
  await f.editor.setSource({ maskKey: "source-a", imageUrl: "/a.png" });
  f.editor.init();
  f.elements.inpaintMaskCanvas.dispatch("pointerdown", pointer(260, 145, 7));
  f.elements.inpaintMaskCanvas.dispatch("pointermove", pointer(510, 270, 7));
  f.elements.inpaintMaskCanvas.dispatch("pointerup", pointer(510, 270, 7));

  assert.equal(f.editor.hasMask(), true);
  assert.equal(f.elements.maskStatus.textContent, "修正範囲あり");
  assert.deepEqual(f.calls.find((call) => call[0] === "moveTo"), ["moveTo", 500, 250]);
  assert.ok(f.calls.some((call) => call[0] === "lineTo" && call[1] === 1000 && call[2] === 500));
  assert.ok(f.calls.some((call) => call[0] === "stroke"
    && call[1] === "#ffffff" && call[2] === 48 && call[3] === "source-over"));
  assert.deepEqual(f.context.getImageData().data, new Uint8ClampedArray([255, 255, 255, 255]));
});

test("erase writes opaque black and clear records an undo snapshot", async () => {
  const f = make();
  await f.editor.setSource({ maskKey: "source-a", imageUrl: "/a.png" });
  f.editor.init();
  f.elements.inpaintMaskCanvas.dispatch("pointerdown", pointer(260, 145));
  f.elements.inpaintMaskCanvas.dispatch("pointerup", pointer(260, 145));
  f.editor.setTool("erase");
  f.elements.inpaintMaskCanvas.dispatch("pointerdown", pointer(260, 145));
  f.elements.inpaintMaskCanvas.dispatch("pointerup", pointer(260, 145));
  assert.equal(f.editor.hasMask(), false);
  assert.ok(f.calls.some((call) => call[0] === "stroke" && call[1] === "#000000"));
  assert.deepEqual(f.context.getImageData().data, new Uint8ClampedArray([0, 0, 0, 255]));

  f.editor.setTool("paint");
  f.elements.inpaintMaskCanvas.dispatch("pointerdown", pointer(260, 145));
  f.elements.inpaintMaskCanvas.dispatch("pointerup", pointer(260, 145));
  f.editor.clearMask();
  assert.equal(f.editor.hasMask(), false);
  assert.equal(f.editor.getState().undoCount, 4);
});

test("undo and redo restore PNG snapshots; undo history remains capped at 12", async () => {
  const f = make();
  await f.editor.setSource({ maskKey: "source-a", imageUrl: "/a.png" });
  f.editor.init();
  f.elements.inpaintMaskCanvas.dispatch("pointerdown", pointer(260, 145));
  f.elements.inpaintMaskCanvas.dispatch("pointerup", pointer(260, 145));
  assert.equal(f.editor.hasMask(), true);
  assert.equal(await f.editor.undo(), true);
  assert.equal(f.editor.hasMask(), false);
  assert.equal(f.editor.getState().redoCount, 1);
  assert.equal(await f.editor.redo(), true);
  assert.equal(f.editor.hasMask(), true);

  for (let index = 0; index < 13; index++) {
    f.elements.inpaintMaskCanvas.dispatch("pointerdown", pointer(20 + index, 30));
    f.elements.inpaintMaskCanvas.dispatch("pointerup", pointer(20 + index, 30));
  }
  assert.equal(f.editor.getState().undoCount, 12);
  assert.ok(f.calls.every((call) => call[0] !== "toDataURL" || call[1] === "image/png"));
});

test("rollback snapshot restores source dimensions, mask, tool, brush and history without live objects", async () => {
  const f = make();
  await f.editor.setSource({
    maskKey: "source-a",
    imageUrl: "blob:revocable-source",
    dataUrl: "data:image/png;base64,SOURCE",
    imageId: null
  });
  f.editor.init();
  f.elements.inpaintMaskCanvas.dispatch("pointerdown", pointer(260, 145));
  f.elements.inpaintMaskCanvas.dispatch("pointerup", pointer(260, 145));
  f.editor.setTool("erase");
  f.elements.maskBrushSize.value = "72";
  const snapshot = f.editor.captureState();

  assert.equal(snapshot.source.imageUrl, "data:image/png;base64,SOURCE");
  assert.equal(snapshot.width, 1000);
  assert.equal(snapshot.height, 500);
  assert.match(snapshot.maskImage, /^data:image\/png;/);
  assert.equal(snapshot.tool, "erase");
  assert.equal(snapshot.brushSize, "72");
  assert.equal(snapshot.undoStack.length, 1);
  assert.equal("canvas" in snapshot, false);
  assert.equal("context" in snapshot, false);

  await f.editor.setSource({ maskKey: "source-b", imageUrl: "/b.png" });
  f.editor.clearMask();
  assert.equal(await f.editor.restoreState(snapshot), true);
  assert.equal(f.editor.getState().sourceKey, "source-a");
  assert.equal(f.editor.getState().tool, "erase");
  assert.equal(f.editor.getState().undoCount, 1);
  assert.equal(f.elements.maskBrushSize.value, "72");
  assert.equal(f.elements.inpaintMaskCanvas.width, 1000);
  assert.equal(f.elements.inpaintMaskCanvas.height, 500);
  assert.equal(f.editor.hasMask(), true);
  assert.equal(await f.editor.undo(), true);
  assert.equal(f.editor.hasMask(), false);
});

test("stale undo completion cannot draw after source replacement, clear, reset, restore or dispose", async () => {
  for (const invalidate of ["source", "clear", "reset", "restore", "dispose"]) {
    const waits = [];
    const f = make({ waitForImage: () => new Promise((resolve) => waits.push(resolve)) });
    const sourceLoad = f.editor.setSource({ maskKey: "source-a", imageUrl: "/a.png" });
    waits.shift()();
    await sourceLoad;
    f.editor.init();
    f.elements.inpaintMaskCanvas.dispatch("pointerdown", pointer(260, 145));
    f.elements.inpaintMaskCanvas.dispatch("pointerup", pointer(260, 145));
    const before = f.editor.captureState();
    const undo = f.editor.undo();
    const pendingUndo = waits.shift();

    let pendingAction = null;
    if (invalidate === "source") {
      pendingAction = f.editor.setSource({ maskKey: "source-b", imageUrl: "/b.png" });
    } else if (invalidate === "clear") {
      f.editor.clearMask();
    } else if (invalidate === "reset") {
      f.editor.reset();
    } else if (invalidate === "restore") {
      pendingAction = f.editor.restoreState(before);
    } else {
      f.editor.dispose();
    }

    pendingUndo();
    assert.equal(await undo, false, invalidate);
    if (invalidate === "source") {
      waits.shift()();
      assert.equal(await pendingAction, true);
      assert.equal(f.editor.getState().sourceKey, "source-b");
      assert.equal(f.editor.hasMask(), false);
    } else if (invalidate === "restore") {
      waits.shift()();
      waits.shift()();
      assert.equal(await pendingAction, true);
      assert.equal(f.editor.getState().sourceKey, "source-a");
      assert.equal(f.editor.hasMask(), true);
    } else if (invalidate === "clear") {
      assert.equal(f.elements.inpaintMaskCanvas.width, 1000);
      assert.equal(f.editor.hasMask(), false);
    } else {
      assert.equal(f.elements.inpaintMaskCanvas.width, 0);
    }
  }
});

test("failed and superseded rollback restores leave the prior state intact", async () => {
  const waits = [];
  const images = [];
  const f = make({
    createImage: () => {
      const image = { src: "" };
      images.push(image);
      return image;
    },
    waitForImage: (image) => new Promise((resolve, reject) => waits.push({ image, resolve, reject }))
  });
  const sourceLoad = f.editor.setSource({ maskKey: "source-a", imageUrl: "/a.png" });
  f.elements.inpaintBaseImage.naturalWidth = 320;
  f.elements.inpaintBaseImage.naturalHeight = 240;
  // setSource waits on the live base image, not createImage.
  waits.shift().resolve();
  await sourceLoad;
  const original = f.editor.captureState();
  const invalid = { ...original, sourceKey: "broken", source: { ...original.source, imageUrl: "/broken.png" } };
  const failed = f.editor.restoreState(invalid);
  waits.shift().reject(new Error("decode failed"));
  waits.shift().resolve();
  assert.equal(await failed, false);
  assert.equal(f.editor.getState().sourceKey, "source-a");
  assert.equal(f.elements.inpaintMaskCanvas.width, 320);

  const first = f.editor.restoreState({ ...original, sourceKey: "first" });
  const second = f.editor.restoreState({ ...original, sourceKey: "second" });
  const firstWaits = waits.splice(0, 2);
  const secondWaits = waits.splice(0, 2);
  firstWaits.forEach(({ resolve }) => resolve());
  assert.equal(await first, false);
  secondWaits.forEach(({ resolve }) => resolve());
  assert.equal(await second, true);
  assert.equal(f.editor.getState().sourceKey, "second");
});

test("Runtime context guard prevents a decoded rollback from committing after a switch", async () => {
  const waits = [];
  const f = make({
    createImage: () => ({ src: "" }),
    waitForImage: (image) => new Promise((resolve) => waits.push({ image, resolve }))
  });
  const sourceLoad = f.editor.setSource({ maskKey: "source-a", imageUrl: "/a.png" });
  f.elements.inpaintBaseImage.naturalWidth = 320;
  f.elements.inpaintBaseImage.naturalHeight = 240;
  waits.shift().resolve();
  await sourceLoad;
  const snapshot = { ...f.editor.captureState(), sourceKey: "rollback-source" };
  let current = true;
  const restore = f.editor.restoreState(snapshot, { isCurrent: () => current });
  const decodeWaits = waits.splice(0, 2);
  current = false;
  decodeWaits.forEach(({ resolve }) => resolve());
  assert.equal(await restore, false);
  assert.equal(f.editor.getState().sourceKey, "source-a");
  assert.equal(f.elements.inpaintMaskCanvas.width, 320);
});

test("same source preserves mask while replacement resets mask and history", async () => {
  const f = make();
  await f.editor.setSource({ maskKey: "source-a", imageUrl: "/a.png" });
  f.editor.init();
  f.elements.inpaintMaskCanvas.dispatch("pointerdown", pointer(260, 145));
  f.elements.inpaintMaskCanvas.dispatch("pointerup", pointer(260, 145));
  assert.equal(await f.editor.setSource({ maskKey: "source-a", imageUrl: "/a-again.png" }), true);
  assert.equal(f.editor.hasMask(), true);
  assert.equal(f.editor.getState().undoCount, 1);

  assert.equal(await f.editor.setSource({ maskKey: "source-b", imageUrl: "/b.png" }), true);
  assert.equal(f.editor.hasMask(), false);
  assert.equal(f.editor.getState().undoCount, 0);
  assert.equal(f.editor.getState().sourceKey, "source-b");
});

test("stale source load cannot resize or reset the replacement", async () => {
  const waits = [];
  const f = make({ waitForImage: () => new Promise((resolve) => waits.push(resolve)) });
  const first = f.editor.setSource({ maskKey: "first", imageUrl: "/first.png" });
  f.elements.inpaintBaseImage.naturalWidth = 640;
  f.elements.inpaintBaseImage.naturalHeight = 960;
  const second = f.editor.setSource({ maskKey: "second", imageUrl: "/second.png" });
  waits[1]();
  assert.equal(await second, true);
  waits[0]();
  assert.equal(await first, false);
  assert.equal(f.editor.getState().sourceKey, "second");
  assert.equal(f.elements.inpaintMaskCanvas.width, 640);
  assert.equal(f.elements.inpaintMaskCanvas.height, 960);
});

test("payload, reset and listener disposal keep source ownership outside the editor", async () => {
  const f = make();
  await f.editor.setSource({ maskKey: "history-1", imageUrl: "/history.png", imageId: "history-1" });
  assert.deepEqual(f.editor.readPayload("txt2img"), {});
  assert.match(f.editor.readPayload("inpaint").maskImage, /^data:image\/png;/);
  f.editor.init();
  f.editor.init();
  assert.equal(f.elements.inpaintMaskCanvas.listenerCount("pointerdown"), 1);
  f.editor.dispose();
  assert.equal(f.elements.inpaintMaskCanvas.listenerCount("pointerdown"), 0);
  assert.equal(f.editor.getState().sourceKey, "");
  assert.equal(f.elements.inpaintMaskCanvas.width, 0);
  assert.deepEqual(f.editor.readPayload("inpaint"), {});
});

test("preferences retain validation, defaults, display formatting and persistence", () => {
  const f = make({
    storage: {
      "localImageChat.inpaintDenoising": "0.65",
      "localImageChat.maskBlur": "12",
      "localImageChat.inpaintFill": "3",
      "localImageChat.inpaintFullResPadding": "128"
    }
  });
  f.editor.setDefaultFullRes(false);
  f.editor.loadPreferences();
  assert.equal(f.elements.inpaintDenoising.value, "0.65");
  assert.equal(f.elements.inpaintDenoisingValue.value, "0.65");
  assert.equal(f.elements.maskBlur.value, "12");
  assert.equal(f.elements.inpaintFill.value, "3");
  assert.equal(f.elements.inpaintFullResPadding.value, "128");
  assert.equal(f.elements.inpaintFullRes.checked, false);
  assert.equal(f.elements.maskBrushSizeValue.value, "48");
  assert.equal(f.editor.getState().tool, "paint");
  assert.equal(f.storageValues.get("localImageChat.inpaintFullRes"), "false");
});

test("app composes Inpaint through Reference, payload and busy ports without mask state", async () => {
  const source = await fs.readFile("public/app.js", "utf8");
  assert.match(source, /createInpaintEditor\(\{/);
  assert.match(source, /onClear:\s*inpaintEditor\.reset/);
  assert.match(source, /inpaintEditor\.setSource\(initImageReference\)/);
  assert.match(source, /inpaintEditor\.hasMask\(\)/);
  assert.match(source, /return inpaintEditor\.readPayload\(generationMode\)/);
  assert.match(source, /inpaintEditor\.setBusy\(busy\)/);
  assert.doesNotMatch(source, /let mask(?:Drawing|LastPoint|Tool|SourceKey|UndoStack|RedoStack)\s*=/);
  assert.doesNotMatch(source, /function beginMaskStroke\(/);
});
