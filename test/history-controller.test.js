import assert from "node:assert/strict";
import test from "node:test";
import { createHistoryController, mergeHistoryGenerations } from "../public/features/history-controller.js";

class Element {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.listeners = new Map();
    this.attributes = new Map();
    this.className = "";
    this.textContent = "";
    this.value = "";
    this.hidden = false;
    this.disabled = false;
    this.open = false;
    this.classList = {
      values: new Set(),
      add: (...names) => names.forEach((name) => this.classList.values.add(name)),
      remove: (...names) => names.forEach((name) => this.classList.values.delete(name)),
      toggle: (name, force) => {
        const active = force === undefined ? !this.classList.values.has(name) : Boolean(force);
        if (active) this.classList.values.add(name); else this.classList.values.delete(name);
        return active;
      }
    };
  }
  addEventListener(type, listener) {
    const values = this.listeners.get(type) ?? new Set();
    values.add(listener);
    this.listeners.set(type, values);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  querySelectorAll(selector) {
    const match = selector.match(/^\[data-([a-z-]+)\]$/);
    if (!match) return [];
    const key = match[1].replace(/-([a-z])/g, (_value, letter) => letter.toUpperCase());
    return walk(this).filter((node) => node.dataset[key] !== undefined);
  }
  showModal() { this.open = true; }
  close() { this.open = false; }
  remove() { this.removed = true; }
  async emit(type, event = {}) {
    const target = event.target ?? { closest: () => null };
    for (const listener of this.listeners.get(type) ?? []) {
      await listener({ target, stopPropagation() {}, preventDefault() {}, ...event });
    }
  }
}

function walk(root) {
  const result = [];
  for (const child of root.children ?? []) result.push(child, ...walk(child));
  return result;
}

const ELEMENT_NAMES = [
  "refreshHistoryButton", "historyLoadMoreButton", "historyGrid", "galleryFilterButton",
  "galleryFilterCloseButton", "galleryFilterDialog", "gallerySort", "galleryAllButton",
  "galleryFavoriteButton", "galleryKindFilter", "galleryCheckpoint", "galleryLora",
  "galleryPeriod", "gallerySearch", "galleryTagSearch", "galleryTagOptions",
  "gallerySelectedTags", "galleryRatingFilter", "galleryRatingDialogFilter",
  "galleryFilterSummary", "galleryFilterDialogSummary", "resetGalleryFilterButton"
];

const generation = {
  id: "generation-1",
  title: "History",
  createdAt: "2026-09-06T00:00:00.000Z",
  settings: { checkpoint: "model.safetensors" },
  images: [
    { id: "image-1", thumbnailUrl: "/thumb-1.webp", originalUrl: "/original-1.png", seed: 1 },
    { id: "image-2", thumbnailUrl: "/thumb-2.webp", originalUrl: "/original-2.png", seed: 2 }
  ]
};

function fixture() {
  const elements = Object.fromEntries(ELEMENT_NAMES.map((name) => [name, new Element()]));
  elements.gallerySort.value = "newest";
  const documentListeners = new Map();
  const document = {
    body: new Element("body"),
    createElement: (tag) => new Element(tag),
    addEventListener(type, listener) {
      const values = documentListeners.get(type) ?? new Set();
      values.add(listener);
      documentListeners.set(type, values);
    },
    removeEventListener(type, listener) { documentListeners.get(type)?.delete(listener); }
  };
  const calls = { get: [], errors: [], remembered: [], studio: [], rendered: 0, modal: [] };
  const responses = [];
  const getJson = async (url) => {
    calls.get.push(url);
    if (url === "/api/history/preferences") return { favoriteCount: 1 };
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return response;
  };
  const imageState = {
    rememberImageFavorites: (items) => calls.remembered.push(["favorite", items]),
    rememberDiscordStates: (items) => calls.remembered.push(["discord", items]),
    createFavoriteButton: () => new Element("button"),
    createDiscordStatusNode: () => new Element("span"),
    createDiscordGenerationStatusNode: () => new Element("span")
  };
  const controller = createHistoryController({
    document, elements, getJson,
    patchJson: async () => ({}), deleteJson: async () => ({}), imageState,
    toast: {
      error: (message) => calls.errors.push(message),
      info() {},
      warning() {}
    },
    showError: (message) => calls.errors.push(message),
    confirmModal: async () => false,
    openImageModal: (...args) => calls.modal.push(args),
    copyToClipboard: async () => {}, flashLabel() {},
    generationTitle: (item) => item.title,
    formatCheckpointBadge: (value) => value,
    formatDate: () => "DATE", shorten: (value) => value,
    getStudioHistoryFilter: () => "all",
    onStudioRecentData: (items) => calls.studio.push(items),
    onRendered: () => { calls.rendered += 1; }
  });
  return { controller, document, documentListeners, elements, calls, responses };
}

test("append merges a split generation by image id without duplicates and keeps generation order", () => {
  const merged = mergeHistoryGenerations(
    [generation],
    [
      { ...generation, images: [generation.images[1], { id: "image-3" }] },
      { id: "generation-2", images: [{ id: "image-4" }] }
    ]
  );
  assert.deepEqual(merged.map((item) => item.id), ["generation-1", "generation-2"]);
  assert.deepEqual(merged[0].images.map((image) => image.id), ["image-1", "image-2", "image-3"]);
  assert.notEqual(merged[0].images, generation.images, "cached input is not mutated");
});

test("initial and append loads preserve image cursor paging, cache, ports, and thumbnail delivery", async () => {
  const f = fixture();
  f.responses.push({ generations: [generation], nextCursor: "image-2", hasMore: true, total: 4 });
  await f.controller.load();
  assert.deepEqual(f.calls.get, ["/api/history?limit=20", "/api/history/preferences"]);
  assert.equal(f.controller.getState().cursor, "image-2");
  assert.equal(f.elements.historyGrid.children.length, 2);
  const firstPreview = f.elements.historyGrid.children[0].children[0].children[0];
  assert.equal(firstPreview.src, "/thumb-1.webp");
  assert.deepEqual(f.calls.modal, [], "list rendering does not request originals");
  await f.elements.historyGrid.children[0].emit("click");
  assert.deepEqual(f.calls.modal, [], "Gallery opens image together with metadata");
  assert.equal(f.document.body.children[0].className, "detailModal");
  assert.ok(walk(f.document.body).some(node => node.className === "detailImage" && node.src === "/original-1.png"));

  f.responses.push({
    generations: [{ ...generation, images: [generation.images[1], { id: "image-3", thumbnailUrl: "/thumb-3.webp" }] }],
    nextCursor: null,
    hasMore: false,
    total: 4
  });
  await f.controller.loadMore();
  assert.equal(f.calls.get.at(-1), "/api/history?limit=20&cursor=image-2");
  assert.deepEqual(f.controller.getGenerations()[0].images.map((image) => image.id), ["image-1", "image-2", "image-3"]);
  assert.equal(f.controller.getState().hasMore, false);
  assert.equal(f.calls.remembered.length, 4, "Favorite and Discord state ports receive each rendered snapshot");
  assert.equal(f.calls.studio.length, 2);
});

test("local filters retain the cached page while favorite and rating changes reset backend paging", async () => {
  const f = fixture();
  f.responses.push({ generations: [generation], nextCursor: "image-2", hasMore: true, total: 2 });
  await f.controller.load();
  const beforeLocalFilter = f.calls.get.length;
  f.controller.setFilter({ query: "missing" });
  assert.equal(f.calls.get.length, beforeLocalFilter);
  assert.equal(f.controller.getGenerations()[0], generation);
  assert.equal(f.elements.historyGrid.children[0].textContent, "条件に一致する画像がありません");

  f.responses.push({ generations: [], nextCursor: null, hasMore: false, total: 0 });
  f.controller.setFilter({ kind: "favorite" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(f.calls.get.includes("/api/history?limit=20&favorites=1"));
  assert.ok(f.calls.get.includes("/api/history/preferences"));
  assert.equal(f.controller.getState().cursor, null);

  f.responses.push({ generations: [], nextCursor: null, hasMore: false, total: 0 });
  f.controller.setFilter({ rating: "nsfw" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(f.calls.get.includes("/api/history?limit=20&favorites=1&rating=nsfw"));
});

test("initial and append failures keep cache; empty success renders the unfiltered empty state", async () => {
  const f = fixture();
  f.responses.push({ generations: [generation], nextCursor: "image-2", hasMore: true, total: 3 });
  await f.controller.load();
  f.responses.push(new Error("initial failed"));
  await f.controller.load();
  assert.equal(f.controller.getGenerations()[0].id, "generation-1");
  assert.equal(f.elements.historyGrid.textContent, "履歴を取得できません: initial failed");

  f.responses.push(new Error("append failed"));
  await f.controller.load({ append: true });
  assert.equal(f.controller.getGenerations()[0].images.length, 2);
  assert.equal(f.calls.errors.at(-1), "追加の履歴を取得できません: append failed");
  assert.equal(f.controller.getState().cursor, "image-2");

  f.responses.push({ generations: [], nextCursor: null, hasMore: false, total: 0 });
  await f.controller.load();
  assert.equal(f.elements.historyGrid.children[0].textContent, "生成すると画像とレシピがここへ保存されます");
});

test("dispose closes an open detail and removes its document listener", () => {
  const f = fixture();
  f.controller.init();
  f.controller.openDetail(generation, generation.images[0]);
  const overlay = f.document.body.children[0];
  assert.equal(overlay.removed, undefined);
  assert.equal(f.documentListeners.get("keydown")?.size, 1);

  f.controller.dispose();
  f.controller.dispose();
  assert.equal(overlay.removed, true);
  assert.equal(f.documentListeners.get("keydown")?.size, 0);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('latest Gallery filter wins over an older in-flight response and cursor', async () => {
  const f = fixture();
  const old = deferred();
  f.responses.push(old.promise);
  const initial = f.controller.load();
  f.responses.push({ generations: [], nextCursor: 'new-cursor', hasMore: true, total: 0 });
  f.controller.setFilter({ rating: 'nsfw' });
  await new Promise(resolve => setImmediate(resolve));
  old.resolve({ generations: [generation], nextCursor: 'old-cursor', hasMore: false, total: 2 });
  await initial;
  assert.equal(f.controller.getState().cursor, 'new-cursor');
  assert.deepEqual(f.controller.getGenerations(), []);
});

test('reset during append ignores the stale append failure and keeps latest results', async () => {
  const f = fixture();
  f.responses.push({ generations: [generation], nextCursor: 'page-2', hasMore: true, total: 4 });
  await f.controller.load();
  const old = deferred(); f.responses.push(old.promise);
  const append = f.controller.loadMore();
  f.responses.push({ generations: [], nextCursor: null, hasMore: false, total: 0 });
  f.controller.setFilter({ rating: 'general' });
  await new Promise(resolve => setImmediate(resolve));
  old.reject(new Error('stale failure')); await append;
  assert.deepEqual(f.calls.errors, []);
  assert.deepEqual(f.controller.getGenerations(), []);
  assert.equal(f.controller.getState().hasMore, false);
});

test('Studio recent ignores an older response after a newer filter finishes', async () => {
  const f = fixture(); const old = deferred();
  f.responses.push(old.promise);
  const first = f.controller.loadStudioRecent('all');
  f.responses.push({ generations: [] });
  await f.controller.loadStudioRecent('favorite');
  old.resolve({ generations: [generation] }); await first;
  assert.deepEqual(f.calls.studio, [[]]);
});


test('Gallery detail next image retains a single dialog and uses its own seed', async () => {
  const f = fixture();
  f.controller.render([generation]);
  f.controller.openDetail(generation, generation.images[0]);
  const first = f.document.body.children[0];
  await walk(first).find(node => node.className === 'detailNext').emit('click');
  assert.equal(first.removed, true);
  const current = f.document.body.children.at(-1);
  assert.ok(walk(current).some(node => node.className === 'detailImage' && node.src === '/original-2.png'));
  assert.ok(walk(current).some(node => node.tagName === 'DD' && node.textContent === '2'));
  assert.equal(f.documentListeners.get('keydown').size, 1);
});

test('failed initial Gallery request remains retryable without appending stale pages', async () => {
  const f = fixture();
  f.responses.push({ generations: [generation], hasMore: false, nextCursor: null });
  await f.controller.load();
  f.responses.push(new Error('refresh failed'));
  await f.controller.load();
  assert.equal(f.elements.historyLoadMoreButton.hidden, false);
  assert.equal(f.elements.historyLoadMoreButton.textContent, '再試行');
  f.responses.push({ generations: [], hasMore: false, nextCursor: null });
  await f.controller.loadMore();
  assert.deepEqual(f.controller.getGenerations(), []);
});
