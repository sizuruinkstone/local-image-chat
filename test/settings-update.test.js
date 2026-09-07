import assert from "node:assert/strict";
import test from "node:test";

import { createSettingsUpdate } from "../public/features/settings-update.js";
import { PREFERENCE_KEYS, createPreferences } from "../public/core/preferences.js";

function eventTarget(extra = {}) {
  const listeners = new Map();
  return {
    value: "",
    textContent: "",
    disabled: false,
    ...extra,
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler);
    },
    async emit(type) {
      await Promise.all([...(listeners.get(type) ?? [])].map((handler) => handler()));
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0;
    },
    replaceChildren(...children) {
      this.children = children;
      this.textContent = children.map((child) => child.textContent ?? "").join("");
    },
    append(...children) {
      this.children = [...(this.children ?? []), ...children];
    }
  };
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    values
  };
}

function fixture(overrides = {}) {
  const elements = {
    githubToken: eventTarget(),
    checkUpdateButton: eventTarget(),
    applyUpdateButton: eventTarget(),
    updateStatusButton: eventTarget(),
    versionContractStatus: eventTarget(),
    updateStatus: eventTarget()
  };
  const local = memoryStorage();
  const session = memoryStorage({ [PREFERENCE_KEYS.githubToken]: "saved-token" });
  const calls = { posts: [], status: 0, open: 0 };
  const responses = overrides.responses ?? [
    { updateAvailable: true, currentVersion: "3.0.0", latestVersion: "3.1.0" },
    { applied: true, latestVersion: "3.1.0" }
  ];
  const document = {
    createTextNode: (textContent) => ({ textContent }),
    createElement: (tagName) => ({ tagName, textContent: "" })
  };
  const controller = createSettingsUpdate({
    elements,
    document,
    preferences: createPreferences({ storage: local, session }),
    postJson: async (url, body) => { calls.posts.push([url, body]); return responses.shift(); },
    fetchImpl: overrides.fetchImpl ?? (async () => ({ ok: true, json: async () => ({ version: "3.0.0" }) })),
    describeRuntime: () => "PID 42",
    onStatusChanged: () => calls.status++,
    onOpenSettings: () => calls.open++
  });
  return { controller, elements, local, session, calls };
}

test("session token restore, update check/apply and listener lifecycle stay single-owner", async () => {
  const f = fixture();
  f.controller.restoreSessionSecret();
  assert.equal(f.elements.githubToken.value, "saved-token");
  assert.equal(f.local.values.has(PREFERENCE_KEYS.githubToken), false);
  f.controller.init();
  f.controller.init();
  assert.equal(f.elements.checkUpdateButton.listenerCount("click"), 1);
  assert.equal(f.elements.updateStatusButton.listenerCount("click"), 1);

  f.elements.githubToken.value = "next-token";
  await f.controller.checkForUpdate();
  assert.equal(f.elements.updateStatus.textContent, "v3.0.0 → v3.1.0へ更新できます。");
  assert.equal(f.controller.getConnectionStatus(), "更新あり");
  assert.equal(f.elements.applyUpdateButton.disabled, false);
  await f.controller.applyUpdate();
  assert.equal(f.elements.updateStatus.textContent, "v3.1.0へ更新しました。start.batを閉じて再起動してください。");
  assert.deepEqual(f.calls.posts, [
    ["/api/update/check", { token: "next-token" }],
    ["/api/update/apply", { token: "next-token" }]
  ]);
  assert.equal(f.session.values.get(PREFERENCE_KEYS.githubToken), "next-token");

  f.controller.dispose();
  f.controller.dispose();
  assert.equal(f.elements.checkUpdateButton.listenerCount("click"), 0);
  assert.equal(f.elements.updateStatusButton.listenerCount("click"), 0);
});

test("update status shortcut opens settings and issues one manual check", async () => {
  const f = fixture();
  f.controller.init();
  await f.elements.updateStatusButton.emit("click");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.calls.open, 1);
  assert.equal(f.calls.posts.length, 1);
});

test("version contract compares static and server versions without blocking on failure", async () => {
  const matching = fixture();
  await matching.controller.loadVersionContract("3.0.0", {});
  assert.equal(matching.elements.versionContractStatus.textContent, "Version 3.0.0　最新ファイルを使用中");
  assert.equal(matching.elements.versionContractStatus.children.at(-1).textContent, "PID 42");

  const mismatch = fixture({ fetchImpl: async () => ({ ok: true, json: async () => ({ version: "3.2.0" }) }) });
  await mismatch.controller.loadVersionContract("3.0.0", {});
  assert.match(mismatch.elements.versionContractStatus.textContent, /画面 3\.2\.0 \/ サーバー 3\.0\.0/);

  const failed = fixture({ fetchImpl: async () => { throw new Error("offline"); } });
  await failed.controller.loadVersionContract("3.0.0", {});
  assert.equal(failed.elements.versionContractStatus.textContent, "画面バージョンを確認できません。");
});

test("update failures keep manual semantics and never add automatic retry", async () => {
  const f = fixture({ responses: [] });
  f.controller.init();
  f.controller.getUpdateInfo();
  const failure = new Error("check failed");
  const failed = createSettingsUpdate({
    elements: f.elements,
    document: { createTextNode: (textContent) => ({ textContent }), createElement: () => ({}) },
    preferences: createPreferences({ storage: f.local, session: f.session }),
    postJson: async () => { throw failure; },
    describeRuntime: () => ""
  });
  await failed.checkForUpdate();
  assert.equal(f.elements.updateStatus.textContent, "check failed");
  assert.equal(failed.getConnectionStatus(), "未確認");
});
