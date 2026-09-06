import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const ELEMENT_NAMES = [
  "storageTargetOutputDir", "storagePlanButton", "storageReserveButton", "storageCancelButton",
  "storageCurrentOutputDir", "storagePendingOutputDir", "storageOutputSource", "storageFavoritesFollow",
  "storageLastMigration", "storagePlanSummary", "storageStatus"
];

class Node {
  constructor() {
    this.value = ""; this.textContent = ""; this.title = ""; this.disabled = false;
    this.listeners = new Map();
  }
  addEventListener(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== fn)); }
  async emit(type) { for (const fn of this.listeners.get(type) ?? []) await fn(); }
  listenerCount(type) { return this.listeners.get(type)?.length ?? 0; }
}

function settings(overrides = {}) {
  return {
    currentOutputDir: "C:\\images\\current", pendingOutputDir: null, pendingStatus: null,
    source: "stored", editable: true, favorites: { followsOutputDir: true }, lastMigration: null,
    ...overrides
  };
}

function plan(overrides = {}) {
  return {
    valid: true, restartRequired: true, targetOutputDir: "D:\\images\\next",
    sourceFiles: 1234, sourceBytes: 2 * 1024 ** 3, availableBytesKnown: true,
    availableBytes: 10 * 1024 ** 3, existingTargetFiles: 0, ...overrides
  };
}

function make(overrides = {}) {
  const elements = Object.fromEntries(ELEMENT_NAMES.map((name) => [name, new Node()]));
  const calls = { get: [], post: [], patch: [], confirm: [], order: [] };
  let getIndex = 0;
  const getResults = overrides.getResults ?? [overrides.getResult ?? settings()];
  const dependencies = {
    elements,
    getJson: async (url) => {
      calls.get.push(url); calls.order.push("get");
      const result = getResults[Math.min(getIndex, getResults.length - 1)]; getIndex += 1;
      if (result instanceof Error) throw result;
      return result;
    },
    postJson: async (url, body) => {
      calls.post.push([url, body]); calls.order.push("post");
      if (overrides.postResult instanceof Error) throw overrides.postResult;
      return overrides.postResult;
    },
    patchJson: async (url, body) => {
      calls.patch.push([url, body]); calls.order.push("patch");
      if (overrides.patchResult instanceof Error) throw overrides.patchResult;
      return overrides.patchResult;
    },
    confirmModal: async (...args) => {
      calls.confirm.push(args); calls.order.push("confirm");
      return overrides.confirmed ?? false;
    }
  };
  return { elements, calls, dependencies };
}

async function makeLegacy(appPath, overrides = {}) {
  const source = await fs.readFile(appPath, "utf8");
  const stateStart = source.indexOf("let storageSettingsState = null;");
  const functionStart = source.indexOf("async function loadStorageSettings()");
  const functionEnd = source.indexOf("async function loadInitImageFile(", functionStart);
  const listenerStart = source.indexOf('elements.storageTargetOutputDir.addEventListener("input", invalidateStoragePlan)');
  const listenerEnd = source.indexOf('elements.titleGenerationMode.addEventListener', listenerStart);
  assert.ok(stateStart >= 0 && functionStart > stateStart && functionEnd > functionStart && listenerStart >= 0 && listenerEnd > listenerStart,
    "legacy Storage settings blocks should exist in snapshot");
  const f = make(overrides);
  const context = { ...f.dependencies };
  const program = `${source.slice(stateStart, source.indexOf("const elements", stateStart))}\n${source.slice(functionStart, functionEnd)}\n${source.slice(listenerStart, listenerEnd)}\n` +
    "globalThis.legacy = { load: loadStorageSettings, render: renderStorageSettings, invalidate: invalidateStoragePlan, plan: planStorageMigration, reserve: reserveStorageMigration, cancel: cancelStorageMigration, describe: describeStoragePlan };";
  vm.runInNewContext(program, context, { filename: appPath });
  return { ...f, controller: context.legacy };
}

async function makeController(overrides = {}) {
  const f = make(overrides);
  const module = await import("../public/features/settings-storage.js");
  return { ...f, controller: module.createStorageSettings(f.dependencies) };
}

async function makeActive(overrides = {}) {
  try { await fs.access("public/features/settings-storage.js"); return makeController(overrides); }
  catch { return makeLegacy("public/app.js", overrides); }
}

test("Storage load renders paths, source, favorites, migration result, and pending guidance", async () => {
  const f = await makeActive({ getResult: settings({
    pendingOutputDir: "D:\\images\\pending", pendingStatus: "pending",
    lastMigration: { status: "completed", copiedFiles: 1500, copiedBytes: 1536 }
  }) });
  f.elements.storageTargetOutputDir.value = "keep-unless-pending";
  await f.controller.load();
  assert.deepEqual(f.calls.get, ["/api/storage/settings"]);
  assert.equal(f.elements.storageTargetOutputDir.value, "D:\\images\\pending");
  assert.equal(f.elements.storageCurrentOutputDir.textContent, "C:\\images\\current");
  assert.equal(f.elements.storagePendingOutputDir.textContent, "D:\\images\\pending");
  assert.equal(f.elements.storagePendingOutputDir.title, "D:\\images\\pending");
  assert.equal(f.elements.storageOutputSource.textContent, "この画面で保存した設定");
  assert.equal(f.elements.storageFavoritesFollow.textContent, "追従する（output/favorite）");
  assert.match(f.elements.storageLastMigration.textContent, /1,500ファイル \/ 1\.5 KB/);
  assert.match(f.elements.storageStatus.textContent, /移行を予約しています/);
  assert.equal(f.elements.storageTargetOutputDir.disabled, true);
  assert.equal(f.elements.storageCancelButton.disabled, false);
});

test("Storage env lock and load failure disable every action with exact guidance", async () => {
  const env = await makeActive({ getResult: settings({ source: "env", editable: false, favorites: { followsOutputDir: false } }) });
  await env.controller.load();
  assert.equal(env.elements.storageTargetOutputDir.title, "LOCAL_IMAGE_CHAT_OUTPUT_DIRを変更して再起動してください");
  assert.match(env.elements.storageStatus.textContent, /環境変数で固定されています/);
  assert.equal(env.elements.storageFavoritesFollow.textContent, "追従しない（LOCAL_IMAGE_CHAT_FAVORITES_DIR）");
  for (const name of ["storageTargetOutputDir", "storagePlanButton", "storageReserveButton", "storageCancelButton"]) assert.equal(env.elements[name].disabled, true);

  const failed = await makeActive({ getResult: new Error("offline") });
  await failed.controller.load();
  assert.equal(failed.elements.storageStatus.textContent, "保存先設定を取得できません: offline");
  for (const name of ["storageTargetOutputDir", "storagePlanButton", "storageReserveButton", "storageCancelButton"]) assert.equal(failed.elements[name].disabled, true);
});

test("Storage plan trims the target, gates controls while busy, and renders valid and same-path plans", async () => {
  let resolvePlan;
  const f = await makeActive({ postResult: new Promise((resolve) => { resolvePlan = resolve; }) });
  await f.controller.load();
  f.elements.storageTargetOutputDir.value = "  D:\\images\\next  ";
  const pending = f.controller.plan();
  assert.equal(f.elements.storageTargetOutputDir.disabled, true);
  assert.equal(f.elements.storagePlanButton.disabled, true);
  assert.equal(f.elements.storageReserveButton.disabled, true);
  assert.match(f.elements.storageStatus.textContent, /確認中/);
  resolvePlan(plan());
  await pending;
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.post)), [["/api/storage/plan", { targetOutputDir: "D:\\images\\next" }]]);
  assert.match(f.elements.storagePlanSummary.textContent, /コピー対象 1,234ファイル \/ 2\.00 GB/);
  assert.match(f.elements.storagePlanSummary.textContent, /空き容量 10\.00 GB/);
  assert.equal(f.elements.storageReserveButton.disabled, false);

  const same = await makeActive({ postResult: plan({ restartRequired: false }) });
  await same.controller.load(); same.elements.storageTargetOutputDir.value = "D:\\images\\next"; await same.controller.plan();
  assert.equal(same.elements.storagePlanSummary.textContent, "現在と同じ保存先です。変更はありません。");
  assert.equal(same.elements.storageReserveButton.disabled, true);
});

test("Storage invalid plan, request failure, and input invalidation cannot enable reserve", async () => {
  const invalid = await makeActive({ postResult: plan({ valid: false, error: "marker mismatch" }) });
  await invalid.controller.load(); invalid.elements.storageTargetOutputDir.value = "D:\\bad"; await invalid.controller.plan();
  assert.equal(invalid.elements.storagePlanSummary.textContent, "marker mismatch");
  assert.equal(invalid.elements.storageReserveButton.disabled, true);
  invalid.controller.invalidate();
  assert.match(invalid.elements.storagePlanSummary.textContent, /もう一度/);
  assert.equal(invalid.elements.storageReserveButton.disabled, true);

  const failed = await makeActive({ postResult: new Error("unsafe target") });
  await failed.controller.load(); failed.elements.storageTargetOutputDir.value = "D:\\bad"; await failed.controller.plan();
  assert.match(failed.elements.storagePlanSummary.textContent, /専用marker付き/);
  assert.equal(failed.elements.storageStatus.textContent, "unsafe target");
  assert.equal(failed.elements.storageReserveButton.disabled, true);
});

test("Storage reserve cancellation sends no request; confirmation patches, reloads, then gives restart guidance", async () => {
  const cancelled = await makeActive({ postResult: plan(), confirmed: false });
  await cancelled.controller.load(); cancelled.elements.storageTargetOutputDir.value = "D:\\images\\next";
  await cancelled.controller.plan(); await cancelled.controller.reserve();
  assert.equal(cancelled.calls.patch.length, 0);
  assert.equal(cancelled.calls.confirm.length, 1);

  const reserved = await makeActive({ postResult: plan(), confirmed: true, getResults: [settings(), settings({ pendingOutputDir: "D:\\images\\next", pendingStatus: "pending" })] });
  await reserved.controller.load(); reserved.elements.storageTargetOutputDir.value = "D:\\images\\next";
  await reserved.controller.plan(); reserved.calls.order.length = 0; await reserved.controller.reserve();
  assert.deepEqual(JSON.parse(JSON.stringify(reserved.calls.patch)), [["/api/storage/settings", { targetOutputDir: "D:\\images\\next", confirmMigration: true }]]);
  assert.deepEqual(reserved.calls.order, ["confirm", "patch", "get"]);
  assert.match(reserved.elements.storageStatus.textContent, /サーバーを終了して再起動してください/);
  assert.equal(reserved.elements.storageReserveButton.disabled, true);
});

test("Storage cancel confirmation sends no request; confirmed cancel reloads before final old-path guidance", async () => {
  const current = settings({ pendingOutputDir: "D:\\images\\next", pendingStatus: "failed" });
  const cancelled = await makeActive({ getResult: current, confirmed: false });
  await cancelled.controller.load(); await cancelled.controller.cancel();
  assert.equal(cancelled.calls.patch.length, 0);

  const confirmed = await makeActive({ confirmed: true, getResults: [current, settings()] });
  await confirmed.controller.load(); confirmed.calls.order.length = 0; await confirmed.controller.cancel();
  assert.deepEqual(JSON.parse(JSON.stringify(confirmed.calls.patch)), [["/api/storage/settings", { cancelPending: true }]]);
  assert.deepEqual(confirmed.calls.order, ["confirm", "patch", "get"]);
  assert.equal(confirmed.elements.storageStatus.textContent, "移行予約を解除しました。現在の保存先は変更していません。");
});

test("extracted Storage controller owns exactly four listeners and can reinitialize", async (t) => {
  try { await fs.access("public/features/settings-storage.js"); }
  catch { return t.skip("Phase 6 controller has not been extracted yet"); }
  const f = await makeController(); f.controller.init(); f.controller.init();
  for (const [name, event] of [["storageTargetOutputDir", "input"], ["storagePlanButton", "click"], ["storageReserveButton", "click"], ["storageCancelButton", "click"]]) {
    assert.equal(f.elements[name].listenerCount(event), 1);
  }
  f.controller.dispose();
  for (const [name, event] of [["storageTargetOutputDir", "input"], ["storagePlanButton", "click"], ["storageReserveButton", "click"], ["storageCancelButton", "click"]]) {
    assert.equal(f.elements[name].listenerCount(event), 0);
  }
});
