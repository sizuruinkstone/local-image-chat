import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

class Element {
  constructor(tagName = "div") {
    this.tagName = tagName; this.children = []; this.dataset = {}; this.listeners = new Map();
    this.disabled = false; this.title = ""; this.textContent = ""; this.attributes = new Map();
    this.classList = {
      values: new Set(),
      add: (...names) => names.forEach((name) => this.classList.values.add(name)),
      toggle: (name, force) => force ? this.classList.values.add(name) : this.classList.values.delete(name)
    };
  }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  removeEventListener(type, fn) { if (this.listeners.get(type) === fn) this.listeners.delete(type); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  async click() { return this.listeners.get("click")?.({ stopPropagation() {} }); }
}

function fixture(overrides = {}) {
  const nodes = [];
  const document = {
    createElement: (tagName) => { const node = new Element(tagName); nodes.push(node); return node; },
    querySelectorAll: (selector) => {
      const match = selector.match(/^\[data-([a-z-]+)="(.+)"\]$/);
      if (!match) return [];
      const key = match[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      return nodes.filter((node) => String(node.dataset[key]) === match[2]);
    }
  };
  const calls = { patch: [], post: [], get: [], order: [], errors: [], toast: [], sleeps: [] };
  const favoriteFinalButton = document.createElement("button");
  const finalDiscordStatus = document.createElement("span");
  const finalDiscordGenerationStatus = document.createElement("span");
  let finalImage = overrides.finalImage ?? null;
  const dependencies = {
    document, CSS: { escape: String }, favoriteFinalButton, finalDiscordStatus, finalDiscordGenerationStatus,
    getFinalImage: () => finalImage,
    patchJson: async (url, body) => { calls.patch.push([url, body]); calls.order.push("patch"); return overrides.patchResult; },
    postJson: async (url, body) => { calls.post.push([url, body]); return overrides.postResult; },
    getJson: async (url) => {
      calls.get.push(url);
      const result = overrides.getResults?.shift();
      if (result instanceof Error) throw result;
      return result;
    },
    sleep: (ms) => new Promise((resolve) => calls.sleeps.push({ ms, resolve })),
    showError: (message) => calls.errors.push(message),
    toast: { error: (...args) => calls.toast.push(args) },
    onPreferencesChanged: () => calls.order.push("preferences"),
    reloadHistory: async () => { calls.order.push("history"); },
    reloadStudioRecent: async () => { calls.order.push("studio"); }
  };
  return { nodes, document, calls, dependencies, favoriteFinalButton, finalDiscordStatus,
    finalDiscordGenerationStatus, setFinalImage: (image) => { finalImage = image; } };
}

async function makeLegacy(overrides = {}) {
  const source = await fs.readFile("public/app.js", "utf8");
  const start = source.indexOf("async function toggleFavorite(image, button)");
  const end = source.indexOf("async function loadHistory(", start);
  assert.ok(start >= 0 && end > start, "legacy image state block should exist before extraction");
  const f = fixture(overrides);
  const context = {
    ...f.dependencies,
    imageFavorites: new Map(), discordStates: new Map(), discordGenerationStates: new Map(),
    discordWatchers: new Set(), discordGenerationWatchers: new Set(), preferenceData: {},
    renderPreferenceSummary: f.dependencies.onPreferencesChanged,
    loadHistory: f.dependencies.reloadHistory, loadStudioRecent: f.dependencies.reloadStudioRecent,
    DISCORD_STATUS_LABELS: { sending: "★ Discord送信中…", sent: "★ Discord送信済み", failed: "★ Favorite済み・Discord送信失敗" },
    DISCORD_GENERATION_STATUS_LABELS: { sending: "★ 生成通知送信中…", sent: "★ 生成通知送信済み", failed: "★ 生成通知送信失敗" },
    finalImage: f.dependencies.getFinalImage(), elements: {
      finalDiscordStatus: f.finalDiscordStatus, finalDiscordGenerationStatus: f.finalDiscordGenerationStatus
    }
  };
  const program = `${source.slice(start, end)}\nglobalThis.api = { toggleFavorite, rememberImageFavorites, applyImageFavorite, renderFavoriteButton, createFavoriteButton, applyDiscordState, applyDiscordGenerationState, rememberDiscordStates, createDiscordStatusNode, createDiscordGenerationStatusNode, renderDiscordStatusNode, renderDiscordGenerationStatusNode, getFavorite: (id, fallback) => imageFavorites.has(id) ? imageFavorites.get(id) === true : Boolean(fallback) };`;
  vm.runInNewContext(program, context, { filename: "public/app.js" });
  return { ...f, controller: context.api };
}

async function makeController(overrides = {}) {
  const f = fixture(overrides);
  const { createImageState } = await import("../public/features/image-state.js");
  return { ...f, controller: createImageState(f.dependencies) };
}

async function makeActive(overrides = {}) {
  try { await fs.access("public/features/image-state.js"); return makeController(overrides); }
  catch { return makeLegacy(overrides); }
}

async function waitFor(predicate) {
  for (let index = 0; index < 40 && !predicate(); index += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.ok(predicate());
}

test("favorite state synchronizes every button with the same image ID", async () => {
  const f = await makeActive();
  const image = { id: "same", favorite: false };
  const first = f.controller.createFavoriteButton(image);
  const second = f.controller.createFavoriteButton({ id: "same", favorite: false }, { style: "label" });
  f.controller.applyImageFavorite("same", true);
  assert.equal(first.attributes.get("aria-pressed"), "true");
  assert.equal(second.textContent, "★ Favorite");
  assert.ok(first.classList.values.has("active") && second.classList.values.has("active"));
});

test("favorite toggle preserves request, object identity, unset PATCH, and async callback order", async () => {
  const image = { id: "one", favorite: true };
  const f = await makeActive({ patchResult: {
    image: { id: "one", favorite: false, discord: { status: "not_sent", error: "" } }, preferences: { favoriteCount: 0 }
  } });
  const button = f.controller.createFavoriteButton(image);
  await f.controller.toggleFavorite(image, button);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.patch)), [["/api/history/one/favorite", { favorite: false }]]);
  assert.equal(image.favorite, false);
  assert.deepEqual(f.calls.order, ["patch", "preferences", "history", "studio"]);
  assert.equal(button.disabled, false);
});

test("favorite and generation notification watchers are separate, deduplicated, and clean up", async () => {
  const results = [
    { discord: { status: "sent", error: "" } },
    { discord: { status: "failed", error: "generation failed" } }
  ];
  const f = await makeActive({ getResults: results });
  f.controller.applyDiscordState("same", { status: "sending", error: "" });
  f.controller.applyDiscordState("same", { status: "sending", error: "" });
  f.controller.applyDiscordGenerationState("same", { status: "sending", error: "" });
  f.controller.applyDiscordGenerationState("same", { status: "sending", error: "" });
  await waitFor(() => f.calls.sleeps.length === 2);
  assert.deepEqual(f.calls.sleeps.map((entry) => entry.ms), [1200, 1200]);
  f.calls.sleeps.forEach((entry) => entry.resolve());
  await waitFor(() => f.calls.get.length === 2);
  assert.deepEqual(f.calls.get.sort(), ["/api/history/same/discord", "/api/history/same/discord/generation"].sort());
  assert.equal(f.calls.toast.length, 1);
  f.controller.applyDiscordState("same", { status: "sending", error: "" });
  await waitFor(() => f.calls.sleeps.length === 3);
});

test("watch failure retains sending UI and releases the watcher", async () => {
  const f = await makeActive({ getResults: [new Error("offline")] });
  const node = f.controller.createDiscordStatusNode({ id: "failed-watch", discord: { status: "sending", error: "" } });
  f.controller.applyDiscordState("failed-watch", { status: "sending", error: "" });
  await waitFor(() => f.calls.sleeps.length === 1); f.calls.sleeps[0].resolve();
  await waitFor(() => f.calls.get.length === 1);
  assert.equal(node.className, "discordStatus status-sending");
  f.controller.applyDiscordState("failed-watch", { status: "sending", error: "" });
  await waitFor(() => f.calls.sleeps.length === 2);
});

test("only failed notification UI offers retry and uses its own endpoint", async () => {
  const f = await makeActive({ postResult: { discord: { status: "sending", error: "" } } });
  const sent = f.controller.createDiscordStatusNode({ id: "sent", discord: { status: "sent", error: "" } });
  const sending = f.controller.createDiscordGenerationStatusNode({ id: "sending", discordGeneration: { status: "sending", error: "" } });
  const failed = f.controller.createDiscordGenerationStatusNode({ id: "failed", discordGeneration: { status: "failed", error: "boom" } });
  assert.equal(sent.children.length, 1);
  assert.equal(sending.children.length, 1);
  assert.equal(failed.children.length, 2);
  await failed.children[1].click();
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.post)), [["/api/history/failed/discord/generation/send", {}]]);
});

test("fixed final badges refresh only when the current final image ID matches", async () => {
  const f = await makeActive({ finalImage: { id: "final" } });
  f.controller.applyDiscordState("other", { status: "failed", error: "wrong" });
  assert.equal(f.finalDiscordStatus.dataset.discordImage, undefined);
  f.controller.applyDiscordState("final", { status: "sent", error: "" });
  assert.equal(f.finalDiscordStatus.dataset.discordImage, "final");
  assert.equal(f.finalDiscordStatus.className, "discordStatus status-sent");
});

test("final presentation seeds sending badges without starting notification watchers", async () => {
  const image = {
    id: "presented",
    favorite: true,
    discord: { status: "sending", error: "" },
    discordGeneration: { status: "sending", error: "" }
  };
  const f = await makeController({ finalImage: image });
  f.controller.bindPresentation(image);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.favoriteFinalButton.textContent, "★ Favorite");
  assert.equal(f.finalDiscordStatus.className, "discordStatus status-sending");
  assert.equal(f.finalDiscordGenerationStatus.className, "discordStatus status-sending");
  assert.deepEqual(f.calls.sleeps, []);
  assert.deepEqual(f.calls.get, []);
});
