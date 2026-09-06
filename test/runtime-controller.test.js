import test from "node:test";
import assert from "node:assert/strict";
import { createRuntimeController } from "../public/features/runtime-controller.js";

class FakeOption {
  constructor(text, value) {
    this.text = text;
    this.value = value;
    this.disabled = false;
    this.title = "";
  }
}

class FakeControl {
  constructor() {
    this.value = "";
    this.textContent = "";
    this.disabled = false;
    this.options = [];
    this.listeners = new Map();
  }
  replaceChildren(...children) { this.options = children; }
  append(child) { this.options.push(child); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(overrides = {}) {
  const values = new Map();
  const elements = {
    runtimeSelect: new FakeControl(),
    checkpointSelect: new FakeControl(),
    refreshCheckpointsButton: new FakeControl(),
    checkpointStatus: new FakeControl()
  };
  const controller = createRuntimeController({
    elements,
    storage: {
      getItem: (key) => values.has(key) ? values.get(key) : null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key)
    },
    getJson: async () => ({ checkpoints: [], activeCheckpoint: "" }),
    postJson: async () => ({ checkpoints: [], activeCheckpoint: "" }),
    ...overrides
  });
  return { controller, elements, values };
}

const runtimes = [
  { id: "reforge", label: "ReForge", available: true, features: { txt2img: true, hires: true } },
  { id: "forge-neo-anima", label: "Forge Neo", provider: "forge-neo", available: true,
    features: { txt2img: true, hires: false } }
];

test.before(() => { globalThis.Option = FakeOption; });

test("restores a selectable runtime and falls back from unknown or disabled saved IDs", () => {
  const saved = fixture();
  saved.values.set("localImageChat.runtimeId", "forge-neo-anima");
  saved.controller.init();
  saved.controller.configure(runtimes, "reforge");
  assert.equal(saved.controller.getState().activeRuntimeId, "forge-neo-anima");

  const disabled = fixture();
  disabled.values.set("localImageChat.runtimeId", "missing-runtime");
  disabled.controller.init();
  disabled.controller.configure([
    { ...runtimes[0], available: false },
    runtimes[1]
  ], "reforge");
  assert.equal(disabled.controller.getState().activeRuntimeId, "forge-neo-anima");
});

test("keeps selected and active checkpoints distinct and resolves legacy aliases", async () => {
  const { controller, elements } = fixture({
    getJson: async () => ({
      checkpoints: [{
        title: "models/Example.safetensors [abc123]",
        modelName: "example_model",
        filename: "C:\\models\\Example.safetensors"
      }],
      activeCheckpoint: "C:\\models\\Example.ckpt"
    }),
    postJson: async () => ({ checkpoint: "models/Other.safetensors [def456]" })
  });
  controller.init();
  controller.configure(runtimes, "forge-neo-anima");
  await controller.loadCheckpoints();
  assert.equal(controller.findCheckpoint("Example.pt [ABC123]").modelName, "example_model");
  elements.checkpointSelect.value = "Other.safetensors";
  elements.checkpointSelect.options.push(new FakeOption("Other.safetensors", "Other.safetensors"));
  await controller.selectCheckpoint();
  assert.equal(controller.getState().activeCheckpoint.title, "models/Example.safetensors [abc123]");
  assert.equal(controller.getState().selectedCheckpoint.title, "models/Other.safetensors [def456]");
});

test("newest refresh wins when responses complete in reverse order", async () => {
  const first = deferred();
  const second = deferred();
  let calls = 0;
  const { controller } = fixture({ postJson: () => (++calls === 1 ? first.promise : second.promise) });
  controller.init();
  controller.configure(runtimes, "reforge");
  const a = controller.refreshCheckpoints();
  const b = controller.refreshCheckpoints();
  second.resolve({ checkpoints: [{ title: "new" }], activeCheckpoint: "new" });
  assert.equal(await b, true);
  first.resolve({ checkpoints: [{ title: "old" }], activeCheckpoint: "old" });
  assert.equal(await a, false);
  assert.equal(controller.getState().selectedCheckpoint.title, "new");
});

test("failed runtime switch restores external state and the previous runtime", async () => {
  const order = [];
  const { controller } = fixture({
    captureExternalSnapshot: () => ({ prompt: "before" }),
    restoreExternalSnapshot: (snapshot) => order.push(["restore", snapshot.prompt]),
    getJson: async () => { order.push(["checkpoint"]); return { checkpoints: [] }; },
    loadExternalResources: () => [Promise.resolve(true), Promise.resolve(false), Promise.resolve(true)]
  });
  controller.init();
  controller.configure(runtimes, "reforge");
  assert.equal(await controller.selectRuntime("forge-neo-anima"), false);
  assert.equal(controller.getState().activeRuntimeId, "reforge");
  assert.deepEqual(order.at(-1), ["restore", "before"]);
});

test("rollback restores resources, renders dependent checkpoint state, then restores form", async () => {
  const order = [];
  let form = "edited";
  const { controller } = fixture({
    captureExternalSnapshot: () => ({ form: "prompt" }),
    restoreExternalSnapshot: () => order.push("resources"),
    onCheckpointCatalogChange: () => order.push("render"),
    onRuntimeUiChange: () => { form = "runtime-render"; },
    finalizeExternalRestore: () => { order.push("form"); form = "prompt"; },
    loadExternalResources: () => [Promise.reject(new Error("sampler failed"))]
  });
  controller.init();
  controller.configure(runtimes, "reforge");
  order.length = 0;
  assert.equal(await controller.selectRuntime("forge-neo-anima"), false);
  assert.deepEqual(order.slice(-3), ["resources", "render", "form"]);
  assert.equal(form, "prompt");
  assert.equal(controller.getState().switching, false);
});

test("catalog load and refresh share ordering so a delayed GET cannot overwrite refresh", async () => {
  const load = deferred();
  const { controller } = fixture({
    getJson: () => load.promise,
    postJson: async () => ({ checkpoints: [{ title: "fresh" }], activeCheckpoint: "fresh" })
  });
  controller.init();
  controller.configure(runtimes, "reforge");
  const stale = controller.loadCheckpoints();
  assert.equal(await controller.refreshCheckpoints(), true);
  load.resolve({ checkpoints: [{ title: "stale" }], activeCheckpoint: "stale" });
  assert.equal(await stale, false);
  assert.equal(controller.getState().selectedCheckpoint.title, "fresh");
});

test("stale health and checkpoint selection callbacks are suppressed", async () => {
  const selected = deferred();
  let selectionCallbacks = 0;
  const { controller, elements } = fixture({
    postJson: () => selected.promise,
    onCheckpointSelectionChange: async () => { selectionCallbacks += 1; }
  });
  controller.init();
  controller.configure(runtimes, "reforge");
  const oldHealth = controller.beginHealthRequest();
  const newHealth = controller.beginHealthRequest();
  assert.equal(await controller.applyHealth({ reforge: { ok: false } }, oldHealth), false);
  assert.equal(await controller.applyHealth({ reforge: { ok: true } }, newHealth), true);

  controller.updateActiveCheckpoint("one");
  elements.checkpointSelect.options.push(new FakeOption("two", "two"));
  elements.checkpointSelect.value = "two";
  const pending = controller.selectCheckpoint();
  controller.dispose();
  selected.resolve({ checkpoint: "two" });
  assert.equal(await pending, false);
  assert.equal(selectionCallbacks, 0);
  assert.equal(controller.getState().activeCheckpoint.title, "one");
});

test("health active checkpoint cannot overwrite a newer catalog result", async () => {
  const { controller } = fixture({
    getJson: async () => ({ checkpoints: [{ title: "catalog" }], activeCheckpoint: "catalog" })
  });
  controller.init();
  controller.configure(runtimes, "forge-neo-anima");
  const health = controller.beginHealthRequest();
  await controller.loadCheckpoints();
  assert.equal(controller.updateActiveCheckpoint("old-health", health), false);
  assert.equal(controller.getState().activeCheckpoint.title, "catalog");
});

test("health fallback adopts the completed runtime context", async () => {
  const { controller } = fixture({ loadExternalResources: () => [Promise.resolve(true)] });
  controller.init();
  controller.configure(runtimes, "reforge");
  const request = controller.beginHealthRequest();
  assert.equal(await controller.applyHealth({
    reforge: { ok: false, error: "offline" },
    "forge-neo-anima": { ok: true }
  }, request), true);
  assert.equal(controller.getState().activeRuntimeId, "forge-neo-anima");
  assert.equal(controller.isHealthRequestCurrent(request), true);
});

test("dispose and re-init suppress an old response without damaging new state", async () => {
  const old = deferred();
  let current = old.promise;
  const catalogs = [];
  const { controller } = fixture({
    postJson: () => current,
    onCheckpointCatalogChange: (state) => catalogs.push(state.selectedCheckpoint?.title ?? "")
  });
  controller.init();
  controller.configure(runtimes, "reforge");
  const stale = controller.refreshCheckpoints();
  controller.dispose();
  controller.init();
  current = Promise.resolve({ checkpoints: [{ title: "new" }], activeCheckpoint: "new" });
  assert.equal(await controller.refreshCheckpoints(), true);
  const callbackCount = catalogs.length;
  old.resolve({ checkpoints: [{ title: "old" }], activeCheckpoint: "old" });
  assert.equal(await stale, false);
  assert.equal(catalogs.length, callbackCount);
  assert.equal(controller.getState().selectedCheckpoint.title, "new");
});
