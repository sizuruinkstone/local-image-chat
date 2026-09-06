import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const BOOLEAN_FIELDS = [
  ["discordAutoSend", "autoSend"],
  ["discordIncludePrompt", "includePrompt"],
  ["discordIncludeMetadata", "includeMetadata"],
  ["discordGenerationAutoSend", "generationAutoSend"],
  ["discordGenerationIncludeImage", "generationIncludeImage"],
  ["discordGenerationIncludeTitle", "generationIncludeTitle"],
  ["discordGenerationIncludeModel", "generationIncludeModel"],
  ["discordGenerationIncludeSeed", "generationIncludeSeed"],
  ["discordGenerationIncludeDuration", "generationIncludeDuration"]
];

class Node {
  constructor() {
    this.checked = false; this.disabled = false; this.placeholder = ""; this.textContent = ""; this.value = "";
    this.listeners = new Map();
  }
  addEventListener(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== fn)); }
  async emit(type) { await Promise.all((this.listeners.get(type) ?? []).map((fn) => fn())); }
  listenerCount(type) { return this.listeners.get(type)?.length ?? 0; }
}

function make(overrides = {}) {
  const elements = Object.fromEntries([
    ...BOOLEAN_FIELDS.map(([element]) => element), "discordWebhook", "saveDiscordSettingsButton",
    "clearDiscordWebhookButton", "sendDiscordTestButton", "discordSettingsStatus"
  ].map((name) => [name, new Node()]));
  const calls = { get: [], patch: [], post: [], busy: [], toast: [], summary: [] };
  const dependencies = {
    elements,
    getJson: async (url) => { calls.get.push(url); if (overrides.getError) throw overrides.getError; return overrides.getResult; },
    patchJson: async (url, body) => { calls.patch.push([url, body]); if (overrides.patchError) throw overrides.patchError; return overrides.patchResult; },
    postJson: async (url, body) => { calls.post.push([url, body]); if (overrides.postError) throw overrides.postError; return overrides.postResult; },
    withBusy: async (button, label, action) => { calls.busy.push([button, label]); return action(); },
    toast: {
      success: (message) => calls.toast.push(["success", message]),
      error: (message) => calls.toast.push(["error", message]),
      info: (message) => calls.toast.push(["info", message])
    },
    confirmModal: async (...args) => { calls.confirm = args; return overrides.confirmed ?? false; },
    onSummaryChanged: () => calls.summary.push(elements.discordSettingsStatus.textContent)
  };
  return { elements, calls, dependencies };
}

async function makeLegacy(appPath, overrides = {}) {
  const source = await fs.readFile(appPath, "utf8");
  const functionStart = source.indexOf("async function loadDiscordSettings()");
  const functionEnd = source.indexOf("async function loadHistory(", functionStart);
  const listenerStart = source.indexOf('elements.saveDiscordSettingsButton.addEventListener("click", saveDiscordSettings)');
  const listenerEnd = source.indexOf('elements.checkUpdateButton.addEventListener', listenerStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart && listenerStart >= 0 && listenerEnd > listenerStart,
    "legacy Discord settings blocks should exist in snapshot");
  const f = make(overrides);
  const context = {
    ...f.dependencies,
    syncSettingsConnectionSummary: f.dependencies.onSummaryChanged
  };
  const program = `${source.slice(functionStart, functionEnd)}\n${source.slice(listenerStart, listenerEnd)}\n` +
    "globalThis.legacy = { load: loadDiscordSettings, render: renderDiscordSettingsStatus, save: saveDiscordSettings, sendTest: sendDiscordTestNotification, clear: clearDiscordWebhook };";
  vm.runInNewContext(program, context, { filename: appPath });
  return { ...f, controller: context.legacy };
}

async function makeController(overrides = {}) {
  const f = make(overrides);
  const module = await import("../public/features/settings-discord.js");
  return { ...f, controller: module.createDiscordSettings(f.dependencies) };
}

async function makeActive(overrides = {}) {
  try {
    await fs.access("public/features/settings-discord.js");
    return makeController(overrides);
  } catch {
    return makeLegacy("public/app.js", overrides);
  }
}

function settings(overrides = {}) {
  return {
    autoSend: true, includePrompt: false, includeMetadata: true,
    generationAutoSend: false, generationIncludeImage: true, generationIncludeTitle: false,
    generationIncludeModel: true, generationIncludeSeed: false, generationIncludeDuration: true,
    webhookConfigured: true, webhookEditable: true, storedWebhookConfigured: true,
    webhookSource: "stored", webhookHint: "https://discord.com/api/webhooks/***",
    webhookUrl: "must-never-render", ...overrides
  };
}

test("legacy Discord load maps all nine choices, renders only safe status, and preserves summary ordering", async () => {
  const f = await makeActive({ getResult: { settings: settings() } });
  await f.controller.load();
  assert.deepEqual(BOOLEAN_FIELDS.map(([element]) => f.elements[element].checked),
    [true, false, true, false, true, false, true, false, true]);
  assert.equal(f.elements.discordSettingsStatus.textContent,
    "送信先: https://discord.com/api/webhooks/***（この画面で保存）Favorite ON・生成通知 OFF");
  assert.doesNotMatch(f.elements.discordSettingsStatus.textContent, /must-never-render/);
  assert.equal(f.elements.discordWebhook.disabled, false);
  assert.equal(f.elements.discordWebhook.placeholder, "https://discord.com/api/webhooks/…");
  assert.equal(f.elements.clearDiscordWebhookButton.disabled, false);
  assert.deepEqual(f.calls.summary, [f.elements.discordSettingsStatus.textContent, f.elements.discordSettingsStatus.textContent]);
});

test("Discord load failure reports the error and still refreshes the app-owned summary once", async () => {
  const f = await makeActive({ getError: new Error("offline") });
  await f.controller.load();
  assert.equal(f.elements.discordSettingsStatus.textContent, "Discord設定を取得できません: offline");
  assert.deepEqual(f.calls.summary, ["Discord設定を取得できません: offline"]);
});

test("Discord save sends the exact DTO and clears the webhook input only after success", async () => {
  const next = settings({ autoSend: false });
  const f = await makeActive({ patchResult: { settings: next } });
  BOOLEAN_FIELDS.forEach(([element], index) => { f.elements[element].checked = index % 2 === 0; });
  f.elements.discordWebhook.value = "secret-input";
  await f.controller.save();
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.patch)), [["/api/discord/settings", {
    autoSend: true, includePrompt: false, includeMetadata: true,
    generationAutoSend: false, generationIncludeImage: true, generationIncludeTitle: false,
    generationIncludeModel: true, generationIncludeSeed: false, generationIncludeDuration: true,
    webhookUrl: "secret-input"
  }]]);
  assert.equal(f.elements.discordWebhook.value, "");
  assert.equal(f.calls.busy[0][1], "保存中…");
  assert.deepEqual(f.calls.toast.at(-1), ["success", "Discord設定を保存しました"]);

  const failed = await makeActive({ patchError: new Error("rejected") });
  failed.elements.discordWebhook.value = "keep-on-failure";
  await failed.controller.save();
  assert.equal(failed.elements.discordWebhook.value, "keep-on-failure");
  assert.deepEqual(failed.calls.toast.at(-1), ["error", "rejected"]);
});

test("Discord test and clear keep busy, confirmation, cancellation, and input semantics", async () => {
  const f = await makeActive({ postResult: {}, patchResult: { settings: settings({ webhookConfigured: false }) } });
  await f.controller.sendTest();
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.post)), [["/api/discord/test", {}]]);
  assert.equal(f.calls.busy[0][1], "送信中…");
  assert.deepEqual(f.calls.toast.at(-1), ["success", "Discordへテスト通知を送信しました"]);

  f.elements.discordWebhook.value = "unchanged";
  await f.controller.clear();
  assert.equal(f.calls.patch.length, 0);
  assert.equal(f.elements.discordWebhook.value, "unchanged");

  const confirmed = await makeActive({ confirmed: true, patchResult: { settings: settings({ webhookConfigured: false }) } });
  confirmed.elements.discordWebhook.value = "clear-after-success";
  await confirmed.controller.clear();
  assert.deepEqual(JSON.parse(JSON.stringify(confirmed.calls.patch)), [["/api/discord/settings", { clearWebhook: true }]]);
  assert.equal(confirmed.elements.discordWebhook.value, "");
  assert.deepEqual(confirmed.calls.toast.at(-1), ["info", "Discordの送信先を削除しました"]);

  const failed = await makeActive({ confirmed: true, patchError: new Error("cannot clear") });
  failed.elements.discordWebhook.value = "keep-after-clear-failure";
  await failed.controller.clear();
  assert.equal(failed.elements.discordWebhook.value, "keep-after-clear-failure");
  assert.deepEqual(failed.calls.toast.at(-1), ["error", "cannot clear"]);
});

test("extracted Discord controller owns exactly three listeners and can reinitialize", async (t) => {
  try { await fs.access("public/features/settings-discord.js"); }
  catch { return t.skip("Phase 5 controller has not been extracted yet"); }
  const f = await makeController();
  f.controller.init(); f.controller.init();
  for (const button of [f.elements.saveDiscordSettingsButton, f.elements.clearDiscordWebhookButton, f.elements.sendDiscordTestButton]) {
    assert.equal(button.listenerCount("click"), 1);
  }
  f.controller.dispose();
  for (const button of [f.elements.saveDiscordSettingsButton, f.elements.clearDiscordWebhookButton, f.elements.sendDiscordTestButton]) {
    assert.equal(button.listenerCount("click"), 0);
  }
});
