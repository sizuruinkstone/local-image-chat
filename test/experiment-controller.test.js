import assert from "node:assert/strict";
import test from "node:test";
import { createExperimentController } from "../public/features/experiment-controller.js";

class Element {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.listeners = new Map();
    this.className = "";
    this.textContent = "";
    this.title = "";
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.dataset = {};
    this.classList = {
      values: new Set(),
      add: (...names) => names.forEach((name) => this.classList.values.add(name)),
      remove: (...names) => names.forEach((name) => this.classList.values.delete(name)),
      contains: (name) => this.classList.values.has(name),
      toggle: (name, force) => {
        const active = force === undefined ? !this.classList.values.has(name) : Boolean(force);
        if (active) this.classList.values.add(name); else this.classList.values.delete(name);
        return active;
      }
    };
  }
  get options() { return this.children; }
  addEventListener(type, listener) {
    const values = this.listeners.get(type) ?? new Set();
    values.add(listener);
    this.listeners.set(type, values);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this[name] = String(value); }
  async emit(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) await listener({ target: this, ...event });
  }
}

const ELEMENT_NAMES = [
  "experimentParameter", "experimentTarget", "experimentTargetRow", "experimentValues",
  "experimentFixSeed", "runExperimentButton", "cancelExperimentButton", "openExperimentsButton",
  "refreshExperimentsButton", "experimentStatus", "experimentProgress", "experimentBadge", "experimentGrid"
];

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function makeExperiment(overrides = {}) {
  return {
    id: "experiment-1", name: "CFG comparison", status: "running", parameter: "cfgScale",
    target: "", values: [5, 7], total: 2, completed: 0, fixedSeed: 10,
    runs: [
      { index: 1, value: 5, status: "running", imageIds: [] },
      { index: 2, value: 7, status: "queued", imageIds: [] }
    ],
    ...overrides
  };
}

function fixture() {
  const elements = Object.fromEntries(ELEMENT_NAMES.map((name) => [name, new Element()]));
  elements.experimentParameter.value = "steps";
  elements.experimentValues.value = "20, 30";
  elements.experimentFixSeed.checked = true;
  const document = { createElement: (tag) => new Element(tag) };
  const calls = { get: [], post: [], patch: [], delete: [], toast: [], order: [], compare: [], modal: [], seed: [] };
  let getHandler = async () => ({ experiments: [], parameters: {}, limits: { maxImages: 8, hardLimit: 12 } });
  let postHandler = async () => ({});
  let historyEntries = [];
  let form = {
    parameter: "steps", target: "", values: "20, 30", fixSeed: true, seed: "-1",
    description: "night city", positivePrompt: "", mode: "txt2img", hasInitImage: false
  };
  let modalChoice = null;
  const controller = createExperimentController({
    document, elements,
    getJson: async (url) => { calls.get.push(url); calls.order.push(`get:${url}`); return getHandler(url); },
    postJson: async (url, body) => { calls.post.push([url, body]); calls.order.push(`post:${url}`); return postHandler(url, body); },
    patchJson: async (url, body) => { calls.patch.push([url, body]); return {}; },
    deleteJson: async (url) => { calls.delete.push(url); calls.order.push(`delete:${url}`); return { removedGenerations: 2, removedImages: 2 }; },
    toast: {
      info: (message) => calls.toast.push(["info", message]),
      warning: (message) => calls.toast.push(["warning", message]),
      success: (message) => calls.toast.push(["success", message]),
      error: (message) => calls.toast.push(["error", message])
    },
    openModal: (config) => { calls.modal.push(config); return { promise: Promise.resolve(modalChoice) }; },
    confirmModal: async () => true,
    promptModal: async () => null,
    withBusy: async (_button, _label, action) => action(),
    clearError: () => calls.order.push("clear"),
    getFormSnapshot: () => ({ ...form }),
    setSeed: (seed) => { calls.seed.push(seed); form.seed = String(seed); },
    getSelectedLoraOptions: () => [],
    syncLorasFromPrompt: () => calls.order.push("sync-loras"),
    shouldRequestPrompt: () => false,
    requestPrompt: async () => {},
    getRuntimePayload: () => ({ runtimeId: "reforge" }),
    getContentRating: () => "general",
    getTitlePayload: () => ({ titleMode: "date" }),
    getPromptPayload: () => ({ prompt: "1girl", negativePrompt: "low quality" }),
    getSelectedLoras: () => [{ name: "sample", weight: 0.8 }],
    getPromptBoosts: () => ["quality"],
    getInitImagePayload: () => ({}),
    getInpaintPayload: () => ({}),
    getIpAdapterPayload: () => ({ ipAdapter: null }),
    getSettings: (overrides) => ({ width: 512, seed: form.seed, ...overrides }),
    onQueuePolling: () => calls.order.push("queue"),
    getHistoryEntries: () => historyEntries,
    loadHistory: async () => { calls.order.push("history"); },
    openComparison: async (entries, context) => calls.compare.push([entries, context]),
    openImageModal: () => {},
    toggleFavorite: async () => {},
    onShowExperiments: () => calls.order.push("show"),
    onCloseQueuePanel: () => calls.order.push("close-queue"),
    random: () => 0.5,
    sleep: async () => {}
  });
  return {
    controller, elements, calls,
    setGetHandler: (handler) => { getHandler = handler; },
    setPostHandler: (handler) => { postHandler = handler; },
    setHistoryEntries: (entries) => { historyEntries = entries; },
    setForm: (patch) => { form = { ...form, ...patch }; },
    setModalChoice: (choice) => { modalChoice = choice; }
  };
}

test("run fixes seed, owns baseRequest assembly, starts queue observation, and rejects a second active run", async () => {
  const f = fixture();
  const status = deferred();
  f.setPostHandler(async (url) => url === "/api/experiments"
    ? { experiment: makeExperiment() }
    : {});
  f.setGetHandler(async (url) => {
    if (url === "/api/experiments/experiment-1") return status.promise;
    return { experiments: [], parameters: {}, limits: { maxImages: 8, hardLimit: 12 } };
  });
  await f.controller.run();
  const [url, payload] = f.calls.post[0];
  assert.equal(url, "/api/experiments");
  assert.equal(payload.fixedSeed, Math.floor(0.5 * 4294967295));
  assert.deepEqual(f.calls.seed, [payload.fixedSeed]);
  assert.deepEqual(payload.values, ["20", "30"]);
  assert.equal(payload.baseRequest.runtimeId, "reforge");
  assert.equal(payload.baseRequest.mode, "txt2img");
  assert.equal(payload.baseRequest.settings.candidateCount, 1);
  assert.equal(payload.baseRequest.settings.hiresEnabled, false);
  assert.deepEqual(f.calls.order.slice(-3), ["post:/api/experiments", "queue", "get:/api/experiments/experiment-1"]);
  await f.controller.run();
  assert.equal(f.calls.post.filter(([path]) => path === "/api/experiments").length, 1);
  assert.deepEqual(f.calls.toast.at(-1), ["warning", "別の比較実験が実行中です。完了または中断してから開始してください"]);
  status.resolve({ experiment: makeExperiment({ status: "done", completed: 2, runs: [] }) });
  await new Promise((resolve) => setImmediate(resolve));
});

test("restore uses one monitor; terminal refresh order is History then Experiments and clears active state", async () => {
  const f = fixture();
  const terminal = deferred();
  let listCalls = 0;
  f.setGetHandler(async (url) => {
    if (url === "/api/experiments?limit=50") {
      listCalls += 1;
      return listCalls < 3
        ? { experiments: [makeExperiment()], parameters: {}, limits: { maxImages: 8 } }
        : { experiments: [makeExperiment({ status: "done", completed: 2, runs: [] })], parameters: {}, limits: { maxImages: 8 } };
    }
    return terminal.promise;
  });
  await f.controller.load();
  await f.controller.load();
  assert.equal(f.calls.get.filter((url) => url === "/api/experiments/experiment-1").length, 1);
  terminal.resolve({ experiment: makeExperiment({ status: "done", completed: 2, runs: [] }) });
  await new Promise((resolve) => setImmediate(resolve));
  const historyIndex = f.calls.order.indexOf("history");
  const reloadIndex = f.calls.order.findIndex((item, index) => index > historyIndex && item === "get:/api/experiments?limit=50");
  assert.ok(historyIndex >= 0 && reloadIndex > historyIndex);
  assert.equal(f.controller.getActiveExperimentId(), null);
  assert.equal(f.controller.isPolling(), false);
});

test("dispose invalidates an in-flight monitor and re-init can restore one cleanly", async () => {
  const f = fixture();
  const firstStatus = deferred();
  f.setGetHandler(async (url) => url === "/api/experiments?limit=50"
    ? { experiments: [makeExperiment()], parameters: {}, limits: { maxImages: 8 } }
    : firstStatus.promise);
  f.controller.init();
  await f.controller.load();
  assert.equal(f.controller.isPolling(), true);
  const statusBeforeDispose = f.elements.experimentStatus.textContent;

  f.controller.dispose();
  firstStatus.resolve({ experiment: makeExperiment({ status: "done", completed: 2, runs: [] }) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.controller.isPolling(), false);
  assert.equal(f.controller.getActiveExperimentId(), null);
  assert.equal(f.elements.experimentStatus.textContent, statusBeforeDispose);
  assert.equal(f.calls.order.includes("history"), false, "disposed monitor invokes no refresh callbacks");

  const secondStatus = deferred();
  let listCalls = 0;
  f.setGetHandler(async (url) => {
    if (url === "/api/experiments?limit=50") {
      listCalls += 1;
      return { experiments: [makeExperiment({ status: listCalls === 1 ? "running" : "done" })], parameters: {}, limits: { maxImages: 8 } };
    }
    return secondStatus.promise;
  });
  f.controller.init();
  await f.controller.load();
  assert.equal(f.controller.isPolling(), true);
  secondStatus.resolve({ experiment: makeExperiment({ status: "done", completed: 2, runs: [] }) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.calls.order.filter((item) => item === "history").length, 1);
  assert.equal(f.controller.isPolling(), false);
  assert.equal(f.controller.getActiveExperimentId(), null);
});

test("cancel targets only the active experiment and relies on the existing monitor", async () => {
  const f = fixture();
  const status = deferred();
  f.setGetHandler(async (url) => url === "/api/experiments?limit=50"
    ? { experiments: [makeExperiment()], parameters: {}, limits: { maxImages: 8 } }
    : status.promise);
  f.setPostHandler(async () => ({}));
  await f.controller.load();
  await f.controller.cancel();
  assert.deepEqual(f.calls.post, [["/api/experiments/experiment-1/cancel", {}]]);
  assert.equal(f.calls.get.filter((url) => url === "/api/experiments/experiment-1").length, 1, "cancel creates no second monitor");
  status.resolve({ experiment: makeExperiment({ status: "cancelled", runs: [] }) });
  await new Promise((resolve) => setImmediate(resolve));
});

test("delete delegates stop-before-delete to backend, applies image query, then reloads History and Experiments", async () => {
  const f = fixture();
  f.setModalChoice("all");
  f.setGetHandler(async () => ({ experiments: [], parameters: {}, limits: { maxImages: 8 } }));
  await f.controller.remove(makeExperiment({ status: "running" }));
  assert.deepEqual(f.calls.delete, ["/api/experiments/experiment-1?deleteImages=1"]);
  assert.equal(f.calls.post.some(([url]) => url.endsWith("/cancel")), false, "backend DELETE owns stop-before-delete");
  const deleteIndex = f.calls.order.indexOf("delete:/api/experiments/experiment-1?deleteImages=1");
  const historyIndex = f.calls.order.indexOf("history");
  const loadIndex = f.calls.order.indexOf("get:/api/experiments?limit=50");
  assert.ok(deleteIndex >= 0 && historyIndex > deleteIndex && loadIndex > historyIndex);
});

test("entry cache fetches missing results once, feeds Compare without selection ownership, and renders recovery", async () => {
  const f = fixture();
  const experiment = makeExperiment({
    status: "done", completed: 2,
    runs: [
      { index: 1, value: 5, status: "done", imageIds: ["image-1"] },
      { index: 2, value: 7, status: "done", imageIds: ["image-2"], recovered: true, retryInfo: { retryReasonLabel: "VRAM不足", originalSettings: { width: 896 }, retrySettings: { width: 832 } } }
    ]
  });
  f.setHistoryEntries([{ generation: { experimentId: experiment.id }, image: { id: "image-1" } }]);
  f.setGetHandler(async (url) => {
    assert.equal(url, "/api/experiments/experiment-1/history");
    return { generations: [{ id: "g2", experimentId: experiment.id, images: [{ id: "image-2", thumbnailUrl: "/thumb.webp" }] }] };
  });
  const first = await f.controller.ensureEntries(experiment);
  const second = await f.controller.ensureEntries(experiment);
  assert.deepEqual(first.map((entry) => entry.image.id), ["image-1", "image-2"]);
  assert.deepEqual(second.map((entry) => entry.image.id), ["image-1", "image-2"]);
  assert.equal(f.calls.get.length, 1);
  await f.controller.compare(experiment);
  assert.deepEqual(f.calls.compare[0][0].map((entry) => entry.image.id), ["image-1", "image-2"]);
  assert.deepEqual(f.calls.compare[0][1], { experimentId: "experiment-1", parameter: "cfgScale" });
  f.controller.renderProgress(experiment);
  const recoveredRow = f.elements.experimentProgress.children[2];
  const badge = recoveredRow.children[2];
  assert.equal(badge.textContent, "設定を下げて再試行");
  assert.match(badge.title, /width: 896 → 832/);
});
