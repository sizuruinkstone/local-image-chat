import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import { createAppBootstrap, registerServiceWorker } from "../public/app/bootstrap.js";

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler);
    },
    emit(type) {
      for (const handler of [...(listeners.get(type) ?? [])]) handler();
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0;
    }
  };
}

function controller(name, order) {
  return {
    init: () => order.push(`${name}:init`),
    dispose: () => order.push(`${name}:dispose`)
  };
}

test("startup preserves config, restore, fetch, monitor, listener, controller and view order exactly once", async () => {
  const order = [];
  const lifecycle = eventTarget();
  const primaryTarget = eventTarget();
  const pre = controller("runtime", order);
  const navigation = controller("navigation", order);
  let initialFetches = 0;
  let monitorStarts = 0;
  const bootstrap = createAppBootstrap({
    lifecycleTarget: lifecycle,
    preConfigControllers: [pre],
    restoreConfig: async (listen) => {
      order.push("config");
      listen(primaryTarget, "config-change", () => {});
    },
    restorePreferences: () => order.push("preferences"),
    registerPwa: () => order.push("pwa"),
    prepareInitialUi: () => order.push("prepare-ui"),
    loadInitialData: async () => { initialFetches += 1; order.push("initial-fetch"); },
    finalizeInitialState: () => order.push("initial-render"),
    startAppMonitors: () => { monitorStarts += 1; order.push("monitor"); },
    bindPrimaryListeners: (listen) => { listen(primaryTarget, "primary", () => {}); order.push("primary-listeners"); },
    controllers: [navigation],
    bindFeatureListeners: () => order.push("feature-listeners"),
    activateInitialView: () => order.push("saved-view"),
    bindLateListeners: () => order.push("late-listeners"),
    lifecycleControllers: [pre, navigation],
    teardown: [() => order.push("teardown")]
  });

  const first = bootstrap.start();
  const second = bootstrap.start();
  assert.strictEqual(first, second);
  await first;
  assert.deepEqual(order, [
    "runtime:init", "config", "preferences", "pwa", "prepare-ui", "initial-fetch",
    "initial-render", "monitor", "primary-listeners", "navigation:init",
    "feature-listeners", "saved-view", "late-listeners"
  ]);
  assert.equal(initialFetches, 1);
  assert.equal(monitorStarts, 1);
  assert.equal(lifecycle.listenerCount("beforeunload"), 1);
  assert.equal(primaryTarget.listenerCount("config-change"), 1);
  assert.equal(primaryTarget.listenerCount("primary"), 1);
});

test("page teardown removes app listeners and disposes owners without coupling navigation to monitors", async () => {
  const order = [];
  const lifecycle = eventTarget();
  const target = eventTarget();
  const navigation = controller("navigation", order);
  const queue = controller("queue", order);
  let monitorStarts = 0;
  const bootstrap = createAppBootstrap({
    lifecycleTarget: lifecycle,
    preConfigControllers: [],
    restoreConfig: async () => {},
    restorePreferences: () => {},
    registerPwa: () => {},
    prepareInitialUi: () => {},
    loadInitialData: async () => {},
    finalizeInitialState: () => {},
    startAppMonitors: () => { monitorStarts += 1; },
    bindPrimaryListeners: (listen) => listen(target, "click", () => {}),
    controllers: [navigation, queue],
    bindFeatureListeners: () => {},
    activateInitialView: () => {},
    bindLateListeners: () => {},
    lifecycleControllers: [navigation, queue]
  });
  await bootstrap.start();
  navigation.dispose();
  assert.equal(monitorStarts, 1);
  assert.equal(target.listenerCount("click"), 1);

  lifecycle.emit("beforeunload");
  lifecycle.emit("beforeunload");
  assert.equal(target.listenerCount("click"), 0);
  assert.equal(lifecycle.listenerCount("beforeunload"), 0);
  assert.deepEqual(order, [
    "navigation:init", "queue:init", "navigation:dispose", "queue:dispose", "navigation:dispose"
  ]);
});

test("PWA registration keeps the same URL and best-effort failure semantics", async () => {
  const calls = [];
  registerServiceWorker({ navigator: {} });
  registerServiceWorker({
    navigator: { serviceWorker: { register: async (url) => calls.push(url) } }
  });
  await Promise.resolve();
  assert.deepEqual(calls, ["/sw.js"]);

  const warnings = [];
  registerServiceWorker({
    navigator: { serviceWorker: { register: async () => { throw new Error("blocked"); } } },
    onError: (message) => warnings.push(message)
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(warnings, ["[PWA] Service Workerを登録できません: blocked"]);
});

test("app composition records the characterized controller and initial fetch order", async () => {
  const source = await fs.readFile("public/app.js", "utf8");
  const preConfig = source.match(/const preConfigControllers = \[([\s\S]*?)\];/)?.[1]
    .match(/[A-Za-z][A-Za-z0-9]+/g);
  const initOrder = source.match(/const controllerInitOrder = \[([\s\S]*?)\];/)?.[1]
    .match(/[A-Za-z][A-Za-z0-9]+/g);
  assert.deepEqual(preConfig, [
    "runtimeController", "checkpointSetController", "loraLibrary", "civitaiController"
  ]);
  assert.deepEqual(initOrder, [
    "navigation", "samplerPicker", "settingsNavigation", "discordSettings", "storageSettings",
    "aiShare", "queueController", "imageState", "studioController", "comparisonController",
    "historyController", "experimentController", "referenceImageController", "inpaintEditor",
    "ipAdapterController"
  ]);

  const initialLoad = source.match(/async function loadInitialData\(\) \{([\s\S]*?)\n\}/)?.[1] ?? "";
  for (const call of [
    "checkHealth()", "runtimeController.loadCheckpoints()", "loadLoras()", "loadHistory()",
    "civitaiController.loadFolders()", "loraLibrary.loadRoot()", "loadExperiments()",
    "checkpointSetController.load()", "loadDiscordSettings()", "loadPromptTemplate()",
    "loadShareState()", "loadSamplerOptions()", "loadStorageSettings()", "ipAdapterController.loadOptions()"
  ]) {
    assert.equal(initialLoad.split(call).length - 1, 1, `${call} should occur once in initial load`);
  }
  assert.match(source, /startAppMonitors:\s*\(\) => queueController\.startPolling\(\)/);
  assert.match(source, /managePageLifecycle:\s*false/);
  assert.match(source, /lifecycleControllers:\s*\[\.\.\.preConfigControllers, \.\.\.controllerInitOrder, settingsUpdate\]/);
  assert.equal((source.match(/await appBootstrap\.start\(\)/g) ?? []).length, 1);
});
