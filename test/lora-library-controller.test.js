import test from "node:test";
import assert from "node:assert/strict";

import { createLoraLibrary } from "../public/features/lora-library.js";

class FakeTarget {
  constructor() {
    this.listeners = new Map();
    this.disabled = false;
    this.value = "";
    this.textContent = "";
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type, extra = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener({ target: this, ...extra });
  }

  count(type) {
    return this.listeners.get(type)?.size ?? 0;
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createHarness(overrides = {}) {
  const refreshLorasButton = new FakeTarget();
  const loraStatus = new FakeTarget();
  const published = [];
  const requests = [];
  const controller = createLoraLibrary({
    elements: { refreshLorasButton, loraStatus },
    storage: { getItem: () => null, setItem() {} },
    getJson: async (url) => {
      requests.push(["get", url]);
      return { loras: [{ name: "A", displayName: "A", category: "character" }] };
    },
    postJson: async (url, payload) => {
      requests.push(["post", url, payload]);
      return { loras: [{ name: "B", displayName: "B", category: "style" }] };
    },
    patchJson: async (url, payload) => {
      requests.push(["patch", url, payload]);
      return { entry: { displayName: "A" }, loras: [] };
    },
    runtime: {
      getState: () => ({ activeRuntime: { label: "Neo" }, switching: false }),
      getContext: () => ({ runtimeId: "neo" }),
      isCurrent: () => true,
      apiUrl: (path) => `/neo${path}`,
      payload: () => ({ runtimeId: "neo" }),
      getGenerationBusy: () => false
    },
    resolveProfile: () => null,
    getCompatibility: () => ({ level: "compatible", label: "互換", message: "" }),
    onCatalogPublished: (items) => published.push(items.map((item) => item.name)),
    ...overrides
  });
  return { controller, refreshLorasButton, loraStatus, published, requests };
}

test("LoRA catalog load publishes authoritative items and refresh uses the runtime route", async () => {
  const { controller, loraStatus, published, requests } = createHarness();

  assert.equal(await controller.load(), true);
  assert.deepEqual(controller.getItems().map((item) => item.name), ["A"]);
  assert.deepEqual(published, [["A"]]);
  assert.match(loraStatus.textContent, /1個を検出/);

  assert.equal(await controller.load(true), true);
  assert.deepEqual(controller.getItems().map((item) => item.name), ["B"]);
  assert.deepEqual(requests.at(-1), ["post", "/neo/api/loras/refresh", { runtimeId: "neo" }]);
});

test("failed load preserves the previous catalog and reports the error", async () => {
  const { controller, loraStatus } = createHarness({
    getJson: async () => { throw new Error("offline"); }
  });
  controller.setItems([{ name: "kept", displayName: "Kept" }]);

  assert.equal(await controller.load(), false);
  assert.equal(controller.findByName("kept")?.displayName, "Kept");
  assert.equal(loraStatus.textContent, "LoRA一覧を取得できません: offline");
});

test("late load and disposed load cannot replace a newer catalog", async () => {
  const first = deferred();
  const second = deferred();
  let call = 0;
  const { controller } = createHarness({
    getJson: () => (++call === 1 ? first.promise : second.promise)
  });
  controller.init();
  const oldLoad = controller.load();
  const newLoad = controller.load();
  second.resolve({ loras: [{ name: "new", displayName: "New" }] });
  await newLoad;
  first.resolve({ loras: [{ name: "old", displayName: "Old" }] });
  assert.equal(await oldLoad, false);
  assert.equal(controller.getItems()[0].name, "new");

  const pending = deferred();
  const disposed = createHarness({ getJson: () => pending.promise }).controller;
  disposed.init();
  const request = disposed.load();
  disposed.dispose();
  pending.resolve({ loras: [{ name: "ignored", displayName: "Ignored" }] });
  assert.equal(await request, false);
  assert.deepEqual(disposed.getItems(), []);
});

test("folder selection state restores without exposing mutable internal sets", () => {
  const { controller } = createHarness();
  controller.restoreState({
    selectedFolder: "Characters/Heroes",
    expandedFolders: new Set(["Characters"]),
    pinnedName: "A",
    activeCategory: "all"
  });
  const state = controller.getState();
  assert.equal(state.selectedFolder, "Characters/Heroes");
  assert.deepEqual([...state.expandedFolders], ["Characters"]);
  state.expandedFolders.add("external");
  assert.equal(controller.getState().expandedFolders.has("external"), false);
});

test("metadata ensure/save/move use registry uid and reload only after the editor closes", async () => {
  const calls = [];
  const { controller } = createHarness({
    postJson: async (url, payload) => {
      calls.push(["post", url, payload]);
      if (url.endsWith("/ensure")) return { entry: { uid: "uid-a", displayName: "A" } };
      return { moved: ["A.safetensors"], loras: [{ name: "Moved/A", displayName: "A" }] };
    },
    patchJson: async (url, payload) => {
      calls.push(["patch", url, payload]);
      return { entry: { uid: "uid-a", displayName: "Edited" }, loras: [{ name: "A", displayName: "Edited" }] };
    },
    getJson: async (url) => {
      calls.push(["get", url]);
      return { loras: [{ name: "final", displayName: "Final" }] };
    },
    getInstallFolders: () => ["Characters"],
    reloadInstallFolders: async () => { calls.push(["reload-folders"]); },
    openEditor: async ({ entry, folders, onSave, onMove }) => {
      calls.push(["editor", entry.uid, folders]);
      await onSave({ displayName: "Edited" });
      await onMove("Characters");
      calls.push(["editor-closed"]);
    },
    withBusy: async (_button, _label, callback) => callback(),
    toast: { success() {}, error(message) { assert.fail(message); } }
  });

  await controller.editMetadata({ name: "A\\Variant", displayName: "A" }, new FakeTarget());
  assert.deepEqual(calls.slice(0, 4), [
    ["post", "/api/loras/registry/ensure", { relativeName: "A/Variant", displayName: "A" }],
    ["editor", "uid-a", ["Characters"]],
    ["patch", "/api/loras/uid-a", { displayName: "Edited" }],
    ["post", "/api/loras/uid-a/move", { folder: "Characters", confirm: true }]
  ]);
  assert.ok(calls.findIndex(([name]) => name === "editor-closed") < calls.findIndex(([name]) => name === "get"));
  assert.deepEqual(calls.at(-1), ["reload-folders"]);
  assert.equal(controller.getItems()[0].name, "final");
});

test("init and dispose own the refresh listener without duplication", async () => {
  let loads = 0;
  const { controller, refreshLorasButton } = createHarness({
    postJson: async () => {
      loads += 1;
      return { loras: [] };
    }
  });
  controller.init();
  controller.init();
  assert.equal(refreshLorasButton.count("click"), 1);
  refreshLorasButton.dispatch("click");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loads, 1);
  controller.dispose();
  assert.equal(refreshLorasButton.count("click"), 0);
  refreshLorasButton.dispatch("click");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(loads, 1);
});
