import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import {
  createReferenceImageController,
  inferImageMimeType
} from "../public/features/reference-image.js";

function classList() {
  const values = new Set();
  return {
    add: (...names) => names.forEach((name) => values.add(name)),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    contains: (name) => values.has(name)
  };
}

function eventTarget(extra = {}) {
  const listeners = new Map();
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
    }
  };
}

function make(overrides = {}) {
  const removedAttributes = [];
  const elements = {
    width: eventTarget({ value: "896" }),
    height: eventTarget({ value: "1152" }),
    img2imgPanel: eventTarget({ scrollIntoView: (...args) => calls.scroll.push(args) }),
    img2imgDropZone: eventTarget(),
    initImageInput: eventTarget({ files: [], click: () => calls.inputClicks++ }),
    initImageEmpty: eventTarget(),
    initImagePreview: eventTarget({
      src: "",
      removeAttribute: (name) => {
        removedAttributes.push(name);
        if (name === "src") elements.initImagePreview.src = "";
      }
    }),
    chooseInitImageButton: eventTarget(),
    clearInitImageButton: eventTarget({ disabled: true }),
    initImageStatus: eventTarget({ textContent: "参照画像が未選択です" }),
    syncInitImageSize: eventTarget({ checked: true })
  };
  const calls = {
    modes: [], errors: [], revoked: [], cleared: 0, preferences: 0, scroll: [], inputClicks: 0
  };
  let mode = overrides.mode ?? "txt2img";
  let objectUrlIndex = 0;
  const controller = createReferenceImageController({
    elements,
    getMode: () => mode,
    setMode: (next) => { mode = next; calls.modes.push(next); },
    clearError: () => {},
    showError: (message) => calls.errors.push(message),
    onClear: () => calls.cleared++,
    onSyncPreferenceChange: () => calls.preferences++,
    readFile: overrides.readFile ?? (async () => "data:application/octet-stream;base64,AAAA"),
    readDimensions: overrides.readDimensions ?? (async () => ({ width: 2048, height: 1024 })),
    createObjectUrl: overrides.createObjectUrl ?? (() => `blob:reference-${++objectUrlIndex}`),
    revokeObjectUrl: (url) => calls.revoked.push(url),
    makeMaskKey: () => "local-mask-key",
    maxFileBytes: overrides.maxFileBytes ?? 20,
    windowTarget: overrides.windowTarget ?? eventTarget()
  });
  return { controller, elements, calls, getMode: () => mode, removedAttributes };
}

test("MIME validation keeps the existing PNG, JPEG and WebP extension fallback", () => {
  assert.equal(inferImageMimeType({ name: "x.bin", type: "image/png" }), "image/png");
  assert.equal(inferImageMimeType({ name: "x.JPEG", type: "" }), "image/jpeg");
  assert.equal(inferImageMimeType({ name: "x.webp", type: "application/octet-stream" }), "image/webp");
  assert.equal(inferImageMimeType({ name: "x.gif", type: "image/gif" }), "");
});

test("local file owns identity, preview, dimensions, resolution and payload", async () => {
  const f = make();
  const file = { name: "portrait.png", type: "image/png", size: 12 };

  assert.equal(await f.controller.loadFile(file), true);
  assert.deepEqual(f.calls.modes, ["img2img"]);
  assert.equal(f.getMode(), "img2img");
  assert.equal(f.elements.initImagePreview.src, "blob:reference-1");
  assert.equal(f.elements.initImageStatus.textContent, "アップロード: portrait.png");
  assert.equal(f.elements.width.value, 1152);
  assert.equal(f.elements.height.value, 576);
  assert.deepEqual(f.controller.readPayload(), {
    initImage: "data:image/png;base64,AAAA"
  });
  assert.deepEqual(f.controller.getReference(), {
    sourceKind: "local-file",
    dataUrl: "data:image/png;base64,AAAA",
    imageUrl: "blob:reference-1",
    objectUrl: "blob:reference-1",
    imageId: null,
    filename: "portrait.png",
    mimeType: "image/png",
    width: 2048,
    height: 1024,
    maskKey: "local-mask-key"
  });
});

test("unsupported, oversized and unreadable files preserve the current source", async () => {
  const f = make({ readDimensions: async () => { throw new Error("broken"); } });
  assert.equal(await f.controller.loadFile({ name: "x.gif", type: "image/gif", size: 1 }), false);
  assert.equal(await f.controller.loadFile({ name: "x.png", type: "image/png", size: 21 }), false);
  assert.equal(await f.controller.loadFile({ name: "x.png", type: "image/png", size: 2 }), false);
  assert.deepEqual(f.calls.errors, [
    "参照画像はPNG・JPEG・WebPを選択してください",
    "参照画像は20MB以下にしてください",
    "参照画像を読み込めませんでした: broken"
  ]);
  assert.equal(f.controller.hasReference(), false);
  assert.deepEqual(f.calls.revoked, []);
});

test("history replacement revokes the local object URL and clear resets preview and inpaint", async () => {
  const f = make();
  await f.controller.loadFile({ name: "local.png", type: "image/png", size: 1 });
  f.controller.useImage({ id: "history-1", filename: "saved.png", width: 800, height: 1200 }, {
    imageUrl: "/api/images/history-1/original",
    mode: "inpaint"
  });

  assert.deepEqual(f.calls.revoked, ["blob:reference-1"]);
  assert.equal(f.controller.getReference().sourceKind, "history-image");
  assert.equal(f.elements.initImageStatus.textContent, "履歴から使用: saved.png");
  assert.deepEqual(f.controller.readPayload(), { initImageId: "history-1" });
  assert.equal(f.elements.width.value, 768);
  assert.equal(f.elements.height.value, 1152);

  const queried = f.controller.getReference();
  queried.imageId = "mutated";
  assert.equal(f.controller.getReference().imageId, "history-1");
  f.controller.clear();
  assert.equal(f.controller.hasReference(), false);
  assert.equal(f.elements.initImagePreview.src, "");
  assert.equal(f.elements.initImageStatus.textContent, "参照画像が未選択です");
  assert.equal(f.calls.cleared, 1);
  assert.deepEqual(f.removedAttributes, ["src"]);
  assert.deepEqual(f.controller.readPayload(), {});
});

test("late dimension reads cannot overwrite a replacement source", async () => {
  let resolveFirst;
  const firstDimensions = new Promise((resolve) => { resolveFirst = resolve; });
  const f = make({ readDimensions: () => firstDimensions });
  f.controller.setReference({ imageUrl: "/first.png", imageId: "first" });
  f.controller.setReference({ imageUrl: "/second.png", imageId: "second", width: 640, height: 640 });
  resolveFirst({ width: 2000, height: 500 });
  await firstDimensions;
  await Promise.resolve();
  assert.equal(f.controller.getReference().imageId, "second");
  assert.equal(f.controller.getReference().width, 640);
  assert.equal(f.elements.width.value, 1152);
  assert.equal(f.elements.height.value, 1152);
});

test("rollback restore can preserve explicit form size for known and deferred dimensions", async () => {
  let resolveDimensions;
  const dimensions = new Promise((resolve) => { resolveDimensions = resolve; });
  const f = make({ readDimensions: () => dimensions });
  f.elements.width.value = "832";
  f.elements.height.value = "1216";
  f.controller.restoreSnapshot({
    sourceKind: "history-image", imageUrl: "/known.png", imageId: "known", width: 320, height: 240
  }, { mode: "inpaint", syncSize: false });
  assert.equal(f.elements.width.value, "832");
  assert.equal(f.elements.height.value, "1216");

  f.controller.restoreSnapshot({
    sourceKind: "history-image", imageUrl: "/deferred.png", imageId: "deferred"
  }, { mode: "inpaint", syncSize: false });
  resolveDimensions({ width: 1200, height: 800 });
  await dimensions;
  await Promise.resolve();
  assert.equal(f.elements.width.value, "832");
  assert.equal(f.elements.height.value, "1216");
  assert.equal(f.controller.getReference().width, 1200);
});

test("pending local reads are invalidated by newer selections and dispose", async () => {
  const first = {};
  first.promise = new Promise((resolve) => { first.resolve = resolve; });
  const second = {};
  second.promise = new Promise((resolve) => { second.resolve = resolve; });
  let readIndex = 0;
  const f = make({ readFile: () => [first.promise, second.promise][readIndex++] });
  const firstLoad = f.controller.loadFile({ name: "first.png", type: "image/png", size: 1 });
  const secondLoad = f.controller.loadFile({ name: "second.png", type: "image/png", size: 1 });
  second.resolve("data:image/png;base64,SECOND");
  assert.equal(await secondLoad, true);
  first.resolve("data:image/png;base64,FIRST");
  assert.equal(await firstLoad, false);
  assert.equal(f.controller.getReference().filename, "second.png");
  assert.equal(f.controller.readPayload().initImage, "data:image/png;base64,SECOND");

  const pending = {};
  pending.promise = new Promise((resolve) => { pending.resolve = resolve; });
  const disposed = make({ readFile: () => pending.promise });
  const pendingLoad = disposed.controller.loadFile({ name: "pending.png", type: "image/png", size: 1 });
  disposed.controller.dispose();
  pending.resolve("data:image/png;base64,PENDING");
  assert.equal(await pendingLoad, false);
  assert.equal(disposed.controller.hasReference(), false);
  assert.deepEqual(disposed.calls.revoked, []);
});

test("restoring an empty snapshot invalidates a pending first local read", async () => {
  let resolveRead;
  const read = new Promise((resolve) => { resolveRead = resolve; });
  const f = make({ readFile: () => read });
  const pendingLoad = f.controller.loadFile({ name: "pending.png", type: "image/png", size: 1 });

  f.controller.restoreSnapshot(null, { mode: "txt2img" });
  resolveRead("data:image/png;base64,PENDING");

  assert.equal(await pendingLoad, false);
  assert.equal(f.controller.hasReference(), false);
  assert.equal(f.calls.cleared, 0);
  assert.deepEqual(f.calls.revoked, []);
});

test("reference assets remain distinct and runtime snapshots omit live object URLs", async () => {
  const f = make();
  await f.controller.loadFile({ name: "local.png", type: "image/png", size: 1 });
  const snapshot = f.controller.captureSnapshot();
  assert.equal(snapshot.sourceKind, "local-file");
  assert.equal(snapshot.objectUrl, undefined);
  assert.equal(snapshot.imageUrl, snapshot.dataUrl);

  f.controller.setReference({
    sourceKind: "reference-asset",
    imageUrl: "/api/reference-assets/asset-1/original",
    imageId: "asset-1",
    filename: "asset.png",
    width: 512,
    height: 768
  });
  assert.equal(f.controller.getReference().sourceKind, "reference-asset");
  assert.equal(f.elements.initImageStatus.textContent, "参照アセット: asset.png");

  f.controller.restoreSnapshot(snapshot, { mode: "img2img" });
  assert.equal(f.elements.initImagePreview.src, "data:image/png;base64,AAAA");
  assert.equal(f.controller.getReference().sourceKind, "local-file");
});

test("init wires chooser, drag/drop and preference sync; dispose removes listeners and revokes", async () => {
  const windowTarget = eventTarget();
  const f = make({ windowTarget });
  const file = { name: "drop.png", type: "image/png", size: 1 };
  f.controller.init();
  f.controller.init();
  assert.equal(f.elements.img2imgDropZone.listenerCount("drop"), 2);
  f.elements.chooseInitImageButton.dispatch("click");
  assert.equal(f.calls.inputClicks, 1);

  let prevented = 0;
  f.elements.img2imgDropZone.dispatch("dragover", { preventDefault: () => prevented++ });
  assert.equal(f.elements.img2imgDropZone.classList.contains("dragging"), true);
  f.elements.img2imgDropZone.dispatch("drop", {
    preventDefault: () => prevented++,
    dataTransfer: { files: [file] }
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.controller.hasReference(), true);
  assert.equal(f.elements.img2imgDropZone.classList.contains("dragging"), false);
  assert.equal(prevented, 2);

  f.elements.width.value = "777";
  f.elements.height.value = "999";
  f.elements.syncInitImageSize.checked = false;
  f.elements.syncInitImageSize.dispatch("change");
  assert.equal(f.calls.preferences, 1);
  assert.equal(f.elements.width.value, "777");
  assert.equal(f.elements.height.value, "999");
  f.elements.syncInitImageSize.checked = true;
  f.elements.syncInitImageSize.dispatch("change");
  assert.equal(f.calls.preferences, 2);
  assert.equal(f.elements.width.value, 1024);
  assert.equal(f.elements.height.value, 512);
  f.controller.dispose();
  assert.deepEqual(f.calls.revoked, ["blob:reference-1"]);
  assert.equal(f.elements.img2imgDropZone.listenerCount("drop"), 0);
  assert.equal(windowTarget.listenerCount("beforeunload"), 0);
});

test("app composes the controller through narrow query and callback ports", async () => {
  const source = await fs.readFile("public/app.js", "utf8");
  assert.match(source, /createReferenceImageController\(\{/);
  assert.match(source, /hasInitImage:\s*referenceImageController\.hasReference\(\)/);
  assert.match(source, /referenceImageController\.restoreSnapshot\(snapshot\.initImageReference/);
  assert.match(source, /return referenceImageController\.readPayload\(generationMode\)/);
  assert.match(source, /onClear:\s*inpaintEditor\.reset/);
  assert.doesNotMatch(source, /let initImageReference\s*=/);
  assert.doesNotMatch(source, /async function loadInitImageFile\(/);
});
