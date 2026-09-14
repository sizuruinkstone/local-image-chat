import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import { createIpAdapterController } from "../public/features/ip-adapter-controller.js";

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
  const attributes = new Map();
  const target = {
    value: "",
    textContent: "",
    disabled: false,
    checked: false,
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
      attributes.set(name, String(value));
      if (name === "src") target.src = String(value);
    },
    getAttribute(name) {
      if (name === "src") return target.src || null;
      return attributes.get(name) ?? null;
    },
    removeAttribute(name) {
      attributes.delete(name);
      if (name === "src") target.src = "";
    }
  };
  return target;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function availableOptions(overrides = {}) {
  return {
    available: true,
    family: "sdxl",
    module: "CLIP-ViT-H (IPAdapter)",
    model: "ip-adapter-plus_sdxl_vit-h",
    message: "IP-Adapterを利用できます",
    ...overrides
  };
}

function make(overrides = {}) {
  const calls = {
    urls: [], errors: [], toasts: [], revoked: [], availability: [], scroll: [], inputClicks: 0
  };
  const elements = {
    generationSettingsDetails: eventTarget({ open: false }),
    ipAdapterDetails: eventTarget({ open: false, scrollIntoView: (value) => calls.scroll.push(value) }),
    ipAdapterEnabled: eventTarget(),
    ipAdapterInput: eventTarget({ files: [], click: () => calls.inputClicks++ }),
    ipAdapterDropZone: eventTarget(),
    chooseIpAdapterButton: eventTarget(),
    clearIpAdapterButton: eventTarget(),
    ipAdapterPreview: eventTarget({ src: "" }),
    ipAdapterEmpty: eventTarget(),
    ipAdapterStatus: eventTarget(),
    ipAdapterModel: eventTarget({ title: "" }),
    ipAdapterWeight: eventTarget({ value: "0.65" }),
    ipAdapterGuidanceStart: eventTarget({ value: "0" }),
    ipAdapterGuidanceEnd: eventTarget({ value: "1" }),
    ipAdapterWeightValue: eventTarget(),
    ipAdapterGuidanceStartValue: eventTarget(),
    ipAdapterGuidanceEndValue: eventTarget()
  };
  let supported = overrides.supported ?? true;
  let switching = overrides.switching ?? false;
  let busy = overrides.busy ?? false;
  let currentContext = overrides.context ?? { runtimeId: "reforge", generation: 1 };
  const getJson = overrides.getJson ?? (async () => availableOptions());
  let objectUrlIndex = 0;
  const windowTarget = eventTarget();
  const controller = createIpAdapterController({
    elements,
    getJson: async (url) => { calls.urls.push(url); return getJson(url); },
    runtimeApiUrl: (path) => `${path}?runtimeId=${currentContext.runtimeId}`,
    runtimeRequestContext: () => currentContext,
    isRuntimeContextCurrent: (context) => context === currentContext,
    runtimeSupports: (feature) => feature === "ipAdapter" && supported,
    isRuntimeSwitching: () => switching,
    getGenerationBusy: () => busy,
    showError: (message) => calls.errors.push(message),
    clearError: () => {},
    toast: { info: (message) => calls.toasts.push(message) },
    shorten: (value, length) => String(value).slice(0, length),
    originalImageUrl: (image) => image.originalUrl || `/api/images/${image.id}/original`,
    onAvailabilityChange: (value) => calls.availability.push(value),
    readFile: overrides.readFile ?? (async () => "data:application/octet-stream;base64,AAAA"),
    createObjectUrl: () => `blob:ip-${++objectUrlIndex}`,
    revokeObjectUrl: (url) => calls.revoked.push(url),
    requestFrame: (callback) => callback(),
    prefersReducedMotion: () => true,
    windowTarget,
    maxReferenceBytes: overrides.maxReferenceBytes ?? 20,
    managePageLifecycle: overrides.managePageLifecycle ?? true
  });
  return {
    controller, elements, calls, windowTarget,
    setSupported: (value) => { supported = value; },
    setSwitching: (value) => { switching = value; },
    setBusy: (value) => { busy = value; },
    setContext: (value) => { currentContext = value; }
  };
}

test("options use runtime URL and descriptor capability, then render fixed model metadata", async () => {
  const f = make();
  assert.equal(await f.controller.loadOptions(), true);
  assert.deepEqual(f.calls.urls, ["/api/reforge/ip-adapter/options?runtimeId=reforge"]);
  assert.equal(f.controller.isAvailable(), true);
  assert.equal(f.elements.ipAdapterModel.textContent, "ip-adapter-plus_sdxl_vit-h");
  assert.equal(f.elements.ipAdapterModel.title, "ip-adapter-plus_sdxl_vit-h");
  assert.equal(f.elements.chooseIpAdapterButton.disabled, false);
  assert.deepEqual(f.controller.getOptions(), availableOptions());
});

test("unsupported runtime excludes UI and payload based on features, never labels", async () => {
  const f = make({ supported: false });
  await f.controller.loadOptions();
  assert.equal(f.controller.isAvailable(), false);
  assert.equal(f.elements.ipAdapterModel.textContent, "利用不可");
  assert.equal(f.elements.ipAdapterStatus.textContent, "選択したRuntimeではIP-Adapterを利用できません");
  assert.equal(f.elements.chooseIpAdapterButton.disabled, true);
  assert.equal(f.controller.setReference({ referenceImageId: "asset-1" }), false);
  assert.deepEqual(f.controller.readPayload(), {});
  assert.deepEqual(f.calls.errors, ["選択したRuntimeではIP-Adapterを利用できません"]);
});

test("request token rejects stale options responses within the same runtime context", async () => {
  const first = deferred();
  const second = deferred();
  let index = 0;
  const f = make({ getJson: () => [first.promise, second.promise][index++] });
  const firstLoad = f.controller.loadOptions();
  const secondLoad = f.controller.loadOptions();
  second.resolve(availableOptions({ model: "new-model" }));
  assert.equal(await secondLoad, true);
  first.resolve(availableOptions({ model: "stale-model" }));
  assert.equal(await firstLoad, false);
  assert.equal(f.controller.getOptions().model, "new-model");
});

test("history/reference asset identity enables payload and preserves numeric DOM semantics", async () => {
  const f = make();
  await f.controller.loadOptions();
  assert.equal(f.controller.setCurrentImageAsReference({
    id: "asset-123", filename: "asset.png", thumbnailUrl: "/thumb.webp"
  }, { focus: true }), true);
  assert.deepEqual(f.controller.readPayload(), {
    ipAdapter: {
      enabled: true,
      weight: 0.65,
      guidanceStart: 0,
      guidanceEnd: 1,
      referenceImageId: "asset-123"
    }
  });
  assert.equal(f.elements.ipAdapterPreview.src, "/thumb.webp");
  assert.equal(f.elements.generationSettingsDetails.open, true);
  assert.equal(f.elements.ipAdapterDetails.open, true);
  assert.deepEqual(f.calls.scroll, [{ behavior: "auto", block: "nearest" }]);

  f.elements.ipAdapterWeight.value = "2";
  f.elements.ipAdapterGuidanceStart.value = "0.25";
  f.elements.ipAdapterGuidanceEnd.value = "0.75";
  f.controller.syncNumbers();
  assert.deepEqual(f.controller.readPayload().ipAdapter, {
    enabled: true,
    weight: 2,
    guidanceStart: 0.25,
    guidanceEnd: 0.75,
    referenceImageId: "asset-123"
  });
});

test("local file validation and object URL replacement/clear lifecycle are preserved", async () => {
  const f = make();
  await f.controller.loadOptions();
  assert.equal(await f.controller.loadFile({ name: "x.gif", type: "image/gif", size: 1 }), false);
  assert.equal(await f.controller.loadFile({ name: "x.png", type: "image/png", size: 21 }), false);
  assert.equal(await f.controller.loadFile({ name: "x.png", type: "image/png", size: 2 }), true);
  assert.equal(f.elements.ipAdapterPreview.src, "blob:ip-1");
  assert.equal(f.controller.readPayload().ipAdapter.referenceImage, "data:image/png;base64,AAAA");

  const snapshot = f.controller.getSnapshot();
  assert.equal(snapshot.previewUrl, "data:image/png;base64,AAAA");
  assert.doesNotMatch(snapshot.previewUrl, /^blob:/);
  assert.equal(f.controller.setReference({
    dataUrl: snapshot.referenceImage,
    previewUrl: "blob:ip-2",
    objectUrl: "blob:ip-2",
    label: "same.png"
  }), true);
  assert.deepEqual(f.calls.revoked, ["blob:ip-2"]);
  assert.equal(f.elements.ipAdapterPreview.src, "blob:ip-1");

  f.controller.setCurrentImageAsReference({ id: "history-2", filename: "history.png" });
  assert.deepEqual(f.calls.revoked, ["blob:ip-2", "blob:ip-1"]);
  assert.equal(f.controller.restoreSnapshot(snapshot), true);
  assert.equal(f.elements.ipAdapterPreview.src, "data:image/png;base64,AAAA");
  assert.equal(f.controller.readPayload().ipAdapter.referenceImage, "data:image/png;base64,AAAA");
  f.controller.clearReference();
  assert.equal(f.controller.hasReference(), false);
  assert.equal(f.elements.ipAdapterPreview.src, "");
  assert.deepEqual(f.calls.toasts, ["IP-Adapter参照を解除しました"]);
  assert.deepEqual(f.calls.errors, [
    "IP-Adapter参照画像はPNG・JPEG・WebPを選択してください",
    "参照画像は20MB以下にしてください"
  ]);
});

test("pending local reads cannot overwrite replacements or retain URLs after dispose", async () => {
  const first = deferred();
  const second = deferred();
  let readIndex = 0;
  const f = make({ readFile: () => [first.promise, second.promise][readIndex++] });
  await f.controller.loadOptions();
  const firstLoad = f.controller.loadFile({ name: "first.png", type: "image/png", size: 1 });
  const secondLoad = f.controller.loadFile({ name: "second.png", type: "image/png", size: 1 });
  second.resolve("data:image/png;base64,SECOND");
  assert.equal(await secondLoad, true);
  first.resolve("data:image/png;base64,FIRST");
  assert.equal(await firstLoad, false);
  assert.equal(f.controller.readPayload().ipAdapter.referenceImage, "data:image/png;base64,SECOND");
  assert.equal(f.elements.ipAdapterPreview.src, "blob:ip-2");
  assert.deepEqual(f.calls.revoked, ["blob:ip-1"]);

  const pending = deferred();
  const disposed = make({ readFile: () => pending.promise });
  await disposed.controller.loadOptions();
  const pendingLoad = disposed.controller.loadFile({ name: "pending.png", type: "image/png", size: 1 });
  disposed.controller.dispose();
  pending.resolve("data:image/png;base64,PENDING");
  assert.equal(await pendingLoad, false);
  assert.equal(disposed.controller.hasReference(), false);
  assert.deepEqual(disposed.calls.revoked, ["blob:ip-1"]);
});

test("enable requires reference; runtime unavailability disables stale state and payload", async () => {
  const responses = [availableOptions(), availableOptions({ available: false, message: "このRuntimeでは利用不可" })];
  const f = make({ getJson: async () => responses.shift() });
  await f.controller.loadOptions();
  f.elements.ipAdapterEnabled.checked = true;
  assert.equal(f.controller.toggleEnabled(), false);
  assert.equal(f.calls.errors.at(-1), "IP-Adapter参照画像を選択してください");
  f.controller.setReference({ imageUrl: "/outputs/reference.png", label: "reference" });
  assert.notDeepEqual(f.controller.readPayload(), {});
  await f.controller.loadOptions();
  assert.equal(f.controller.captureState().state.enabled, false);
  assert.equal(f.controller.getSnapshot().referenceImageUrl, "/outputs/reference.png");
  assert.deepEqual(f.controller.readPayload(), {});
  assert.equal(f.elements.ipAdapterStatus.textContent, "このRuntimeでは利用不可");
});

test("metadata, recipe and runtime snapshots expose narrow restore ports", async () => {
  const f = make();
  await f.controller.loadOptions();
  assert.equal(f.controller.restoreRecipe({
    ipAdapter: {
      enabled: true,
      referenceImageUrl: "/outputs/ip-reference.png",
      weight: 0.8,
      guidanceStart: 0.1,
      guidanceEnd: 0.9
    }
  }), true);
  assert.deepEqual(f.controller.readPayload().ipAdapter, {
    enabled: true,
    weight: 0.8,
    guidanceStart: 0.1,
    guidanceEnd: 0.9,
    referenceImageUrl: "/outputs/ip-reference.png"
  });
  const runtimeSnapshot = f.controller.captureState();
  f.controller.clearReference({ silent: true });
  f.controller.restoreState(runtimeSnapshot);
  assert.equal(f.controller.getSnapshot().referenceImageUrl, "/outputs/ip-reference.png");
  assert.equal(f.controller.restoreSnapshot({
    enabled: true,
    referenceImage: "data:image/png;base64,BBBB",
    weight: 0.5,
    guidanceStart: 0.2,
    guidanceEnd: 0.8
  }), true);
  assert.equal(f.controller.readPayload().ipAdapter.referenceImage, "data:image/png;base64,BBBB");
  assert.equal(f.controller.restoreSnapshot({
    enabled: true,
    referenceImageId: "history-9",
    weight: 0.45,
    guidanceStart: 0,
    guidanceEnd: 1
  }), true);
  assert.equal(f.controller.readPayload().ipAdapter.referenceImageId, "history-9");
  assert.equal(f.controller.restoreRecipe({ ipAdapter: null }), false);
  assert.deepEqual(f.controller.readPayload(), {});
});

test("rollback capture remains restorable after owned local URL revocation and while unsupported", async () => {
  const f = make();
  await f.controller.loadOptions();
  await f.controller.loadFile({ name: "local.png", type: "image/png", size: 2 });
  const rollback = f.controller.captureState();
  assert.equal(rollback.state.previewUrl, "data:image/png;base64,AAAA");
  assert.doesNotMatch(rollback.state.previewUrl, /^blob:/);

  f.controller.setCurrentImageAsReference({ id: "history-2", filename: "history.png" });
  assert.deepEqual(f.calls.revoked, ["blob:ip-1"]);
  f.setSupported(false);
  assert.equal(f.controller.restoreState(rollback), true);
  assert.equal(f.elements.ipAdapterPreview.src, "data:image/png;base64,AAAA");
  assert.equal(f.controller.getSnapshot().referenceImage, "data:image/png;base64,AAAA");
  assert.deepEqual(f.controller.readPayload(), {});

  f.setSupported(true);
  assert.equal(f.controller.restoreState(rollback), true);
  assert.equal(f.controller.readPayload().ipAdapter.referenceImage, "data:image/png;base64,AAAA");
});

test("full rollback invalidates pending option loads while metadata restore leaves current capability load authoritative", async () => {
  const firstPending = deferred();
  const secondPending = deferred();
  const responses = [
    Promise.resolve(availableOptions()),
    firstPending.promise,
    secondPending.promise
  ];
  const f = make({ getJson: () => responses.shift() });
  await f.controller.loadOptions();
  f.controller.setReference({ imageUrl: "/outputs/original.png", label: "original" });
  const rollback = f.controller.captureState();

  const staleFullLoad = f.controller.loadOptions();
  assert.equal(f.controller.restoreState(rollback), true);
  firstPending.resolve(availableOptions({ available: false, model: "stale", message: "stale unavailable" }));
  assert.equal(await staleFullLoad, false);
  assert.equal(f.controller.getOptions().model, rollback.options.model);
  assert.equal(f.controller.captureState().state.enabled, true);
  assert.equal(f.controller.readPayload().ipAdapter.referenceImageUrl, "/outputs/original.png");

  const retained = f.controller.getSnapshot();
  const currentCapabilityLoad = f.controller.loadOptions();
  assert.equal(f.controller.restoreSnapshot(retained), true);
  secondPending.resolve(availableOptions({ available: false, model: "current", message: "current unavailable" }));
  assert.equal(await currentCapabilityLoad, true);
  assert.equal(f.controller.getOptions().model, "current");
  assert.equal(f.controller.getSnapshot().referenceImageUrl, "/outputs/original.png");
  assert.equal(f.controller.captureState().state.enabled, false);
  assert.deepEqual(f.controller.readPayload(), {});
});

test("init owns chooser/drop/numeric listeners and dispose invalidates requests", async () => {
  const pending = deferred();
  const f = make({ getJson: () => pending.promise });
  f.controller.init();
  f.controller.init();
  assert.equal(f.elements.ipAdapterDropZone.listenerCount("drop"), 2);
  assert.equal(f.elements.ipAdapterWeight.listenerCount("input"), 1);
  f.elements.chooseIpAdapterButton.dispatch("click");
  assert.equal(f.calls.inputClicks, 1);
  const loading = f.controller.loadOptions();
  f.controller.dispose();
  pending.resolve(availableOptions({ model: "after-dispose" }));
  assert.equal(await loading, false);
  assert.equal(f.elements.ipAdapterDropZone.listenerCount("drop"), 0);
  assert.equal(f.windowTarget.listenerCount("beforeunload"), 0);
});

test("app-owned page lifecycle can disable the controller beforeunload listener", () => {
  const f = make({ managePageLifecycle: false });
  f.controller.init();
  assert.equal(f.windowTarget.listenerCount("beforeunload"), 0);
  f.controller.dispose();
});

test("app composes IP-Adapter through runtime feature, snapshot and payload ports", async () => {
  const source = await fs.readFile("public/app.js", "utf8");
  assert.match(source, /createIpAdapterController\(\{/);
  assert.match(source, /runtimeSupports,/);
  assert.match(source, /ipAdapter:\s*ipAdapterController\.captureState\(\)/);
  assert.match(source, /ipAdapterController\.restoreState\(snapshot\.ipAdapter/);
  assert.match(source, /ipAdapterController\.restoreRecipe\(recipe\)/);
  assert.match(source, /return ipAdapterController\.readPayload\(\)/);
  assert.match(source, /managePageLifecycle:\s*false/);
  assert.doesNotMatch(source, /let ipAdapter(?:Options|State|ObjectUrl)\s*=/);
  assert.doesNotMatch(source, /function setIpAdapterReference\(/);
});
