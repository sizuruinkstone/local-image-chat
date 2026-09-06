import test from "node:test";
import assert from "node:assert/strict";

import { createCivitaiController } from "../public/features/civitai-controller.js";

class FakeClassList {
  toggle() {}
  add() {}
  remove() {}
}

class FakeElement {
  constructor(value = "") {
    this.value = value;
    this.disabled = false;
    this.textContent = "";
    this.title = "";
    this.listeners = new Map();
    this.classList = new FakeClassList();
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  setAttribute() {}
}

class FakeOption {
  constructor(label, value) { this.label = label; this.textContent = label; this.value = value; }
}

class FakeGroup {
  constructor() { this.children = []; this.label = ""; }
  append(...children) { this.children.push(...children); }
}

class FakeSelect extends FakeElement {
  constructor(value = "") { super(value); this.children = []; }
  replaceChildren() { this.children = []; }
  append(...children) { this.children.push(...children); }
  get options() { return this.children.flatMap((child) => child.children ?? [child]); }
}

const originalOption = globalThis.Option;
globalThis.Option = FakeOption;
test.after(() => { globalThis.Option = originalOption; });

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  const writes = [];
  return {
    writes,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, String(value)); writes.push([key, String(value)]); }
  };
}

function makeElements() {
  return {
    civitaiUrl: new FakeElement("https://civitai.com/models/123"),
    civitaiCategory: Object.assign(new FakeElement("character"), {
      selectedOptions: [{ textContent: "キャラクター" }]
    }),
    civitaiFolder: new FakeSelect("Characters"),
    civitaiFolderFavorite: new FakeElement(),
    civitaiFolderPath: new FakeElement(),
    civitaiNewFolder: new FakeElement(),
    civitaiNewFolderRow: new FakeElement(),
    civitaiToken: new FakeElement("secret-token"),
    inspectCivitaiButton: new FakeElement(),
    installCivitaiButton: new FakeElement(),
    refreshCivitaiRegistrationsButton: new FakeElement(),
    civitaiStatus: new FakeElement()
  };
}

function metadata() {
  return {
    modelName: "Hero",
    versionName: "v1",
    modelType: "LORA",
    baseModel: "Illustrious",
    file: { name: "hero.safetensors", sizeKB: 1024 },
    trainedWords: ["hero"],
    outfitPresets: []
  };
}

function harness({ postJson, getJson, openModal, library } = {}) {
  const elements = makeElements();
  const storage = memoryStorage();
  const session = memoryStorage({ "localImageChat.civitaiToken": "restored-token" });
  const calls = [];
  const controller = createCivitaiController({
    elements,
    document: { createElement: () => new FakeGroup() },
    storage,
    sessionStorage: session,
    getJson: getJson ?? (async (url) => {
      calls.push(["folders", url]);
      return { folders: ["Characters"], recommended: {}, defaults: {} };
    }),
    postJson: postJson ?? (async (url, payload) => {
      calls.push([url, payload]);
      if (url.endsWith("/inspect")) return { metadata: metadata() };
      if (url.endsWith("/check-duplicate")) return { duplicate: false };
      if (url.endsWith("/install")) return { entry: { modelName: "Hero" }, folder: "Characters" };
      return { total: 1, updated: 1, failed: 0 };
    }),
    openModal: openModal ?? (() => ({ promise: Promise.resolve(null) })),
    confirmModal: async () => true,
    toast: { success() {}, error() {}, warning() {}, info() {} },
    formatFileSize: () => "1 MB",
    runtimePayload: () => { calls.push(["runtime-payload"]); return { runtimeId: "neo" }; },
    getLoraRoot: () => ({ root: "C:/Loras" }),
    library: library ?? { load: async () => { calls.push(["library-load"]); } }
  });
  return { controller, elements, storage, session, calls };
}

test("inspect restores and remembers only the session-scoped Civitai token", async () => {
  const { controller, elements, storage, session } = harness();
  controller.init();
  assert.equal(elements.civitaiToken.value, "restored-token");
  elements.civitaiToken.value = "new-token";
  assert.equal(await controller.inspect(), true);
  assert.equal(controller.getInspected().modelName, "Hero");
  assert.equal(session.writes.at(-1)[0], "localImageChat.civitaiToken");
  assert.equal(storage.writes.some(([key]) => key.includes("civitaiToken")), false);
});

test("inspect failure clears inspected metadata and preserves an actionable status", async () => {
  const { controller, elements } = harness({
    postJson: async () => { throw new Error("inspect failed"); }
  });
  assert.equal(await controller.inspect(), false);
  assert.equal(controller.getInspected(), null);
  assert.equal(elements.civitaiStatus.textContent, "inspect failed");
});

test("duplicate cancellation stops before install and library reload", async () => {
  const calls = [];
  const { controller, elements } = harness({
    postJson: async (url) => {
      calls.push(url);
      if (url.endsWith("/inspect")) return { metadata: metadata() };
      return { duplicate: true, installed: [], filename: "hero.safetensors" };
    },
    openModal: () => ({ promise: Promise.resolve(null) }),
    library: { load: async () => calls.push("library-load") }
  });
  await controller.inspect();
  elements.civitaiFolder.value = "Characters";
  assert.equal(await controller.install(), false);
  assert.deepEqual(calls, ["/api/civitai/inspect", "/api/civitai/check-duplicate"]);
  assert.equal(elements.civitaiStatus.textContent, "インストールを中止しました。");
});

test("install captures runtime after duplicate choice then reloads folders and library in order", async () => {
  const order = [];
  const { controller, elements } = harness({
    postJson: async (url, payload) => {
      order.push([url, payload]);
      if (url.endsWith("/inspect")) return { metadata: metadata() };
      if (url.endsWith("/check-duplicate")) return { duplicate: false };
      return { entry: { modelName: "Hero" }, folder: "Characters" };
    },
    getJson: async () => {
      order.push(["folders"]);
      return { folders: ["Characters"], recommended: {}, defaults: {} };
    },
    library: { load: async () => order.push(["library"]) }
  });
  // Replace only the injected payload callback's observable effect through the default harness call list.
  await controller.inspect();
  elements.civitaiFolder.value = "Characters";
  assert.equal(await controller.install(), true);
  const install = order.find(([url]) => url === "/api/civitai/install");
  assert.equal(install[1].runtimeId, "neo");
  assert.deepEqual(order.slice(-2), [["folders"], ["library"]]);
});

test("install failure and refresh failure never reload the installed catalog", async () => {
  let libraryLoads = 0;
  let failInstall = true;
  const { controller, elements } = harness({
    postJson: async (url) => {
      if (url.endsWith("/inspect")) return { metadata: metadata() };
      if (url.endsWith("/check-duplicate")) return { duplicate: false };
      if (url.endsWith("/install") && failInstall) throw new Error("download failed");
      if (url.endsWith("/refresh-registrations")) throw new Error("refresh failed");
      return {};
    },
    library: { load: async () => { libraryLoads += 1; } }
  });
  await controller.inspect();
  elements.civitaiFolder.value = "Characters";
  assert.equal(await controller.install(), false);
  assert.equal(libraryLoads, 0);
  assert.equal(elements.civitaiStatus.textContent, "download failed");
  failInstall = false;
  assert.equal(await controller.refreshRegistrations(), false);
  assert.equal(libraryLoads, 0);
  assert.equal(elements.civitaiStatus.textContent, "一括再解析に失敗しました: refresh failed");
});

test("registration refresh reloads the library only after a successful response", async () => {
  const order = [];
  const { controller, elements } = harness({
    postJson: async (url, payload) => {
      order.push([url, payload]);
      return { total: 2, updated: 2, failed: 0 };
    },
    library: { load: async () => order.push(["library-load"]) }
  });
  elements.civitaiToken.value = "session-token";
  assert.equal(await controller.refreshRegistrations(), true);
  assert.deepEqual(order.map(([name]) => name), ["/api/civitai/refresh-registrations", "library-load"]);
  assert.equal(elements.civitaiStatus.textContent, "2件すべての衣装・Trigger Wordsを更新しました。");
});
