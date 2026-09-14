import assert from "node:assert/strict";
import test from "node:test";
import { createComparisonController } from "../public/features/comparison-controller.js";

class Element {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.listeners = new Map();
    this.attributes = new Map();
    this.className = "";
    this.textContent = "";
    this.title = "";
    this.disabled = false;
    this.hidden = false;
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
  addEventListener(type, listener) {
    const values = this.listeners.get(type) ?? new Set();
    values.add(listener);
    this.listeners.set(type, values);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  querySelector() { return this.navButton ?? null; }
  async emit(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) {
      await listener({ target: this, stopPropagation() {}, preventDefault() {}, ...event });
    }
  }
}

const ELEMENT_NAMES = [
  "compareSelectionButton", "compareSelectionBadge", "compareTray", "compareTrayCount",
  "compareTrayOpenButton", "compareTrayClearButton", "compareTrayItems", "imageCompareMessage",
  "imageCompareGalleryButton", "imageCompareStartButton", "galleryCompareModeButton",
  "galleryCompareModeBar", "galleryCompareModeCount", "galleryCompareModeMessage",
  "galleryCompareClearButton", "galleryCompareExitButton", "mainNav",
  "studioMainCompareButton", "studioCompareButton"
];

function entry(id) {
  return {
    image: { id, seed: Number(id), thumbnailUrl: `/thumb-${id}.webp`, originalUrl: `/original-${id}.png` },
    generation: { id: `generation-${id}`, title: `Image ${id}`, comparedParameter: "cfgScale" }
  };
}

function fixture() {
  const elements = Object.fromEntries(ELEMENT_NAMES.map((name) => [name, new Element()]));
  elements.mainNav.navButton = new Element("button");
  const documentControls = [];
  const document = {
    createElement: (tag) => new Element(tag),
    querySelectorAll: (selector) => selector === "[data-compare-image-id]"
      ? documentControls.filter((item) => item.kind !== "checkbox")
      : selector === ".historyCompareCheck" ? documentControls.filter((item) => item.kind === "checkbox") : []
  };
  const calls = { toast: [], views: [], post: [], best: [], order: [], open: [] };
  let inspection = null;
  let finalImage = null;
  let compareOptions = null;
  const controller = createComparisonController({
    document, elements,
    postJson: async (url, body) => { calls.post.push([url, body]); calls.order.push("post"); },
    toast: {
      info: (message) => calls.toast.push(["info", message]),
      warning: (message) => calls.toast.push(["warning", message]),
      success: (message) => calls.toast.push(["success", message]),
      error: (message) => calls.toast.push(["error", message])
    },
    generationTitle: (generation) => generation.title,
    getStudioInspection: () => inspection,
    getStudioFinalImage: () => finalImage,
    onOpenGallery: () => calls.views.push("gallery"),
    onHistoryReload: async () => { calls.order.push("history"); },
    onSetExperimentBest: async (experimentId, imageId) => {
      calls.best.push([experimentId, imageId]);
      calls.order.push("best");
    },
    openCompareViewFn: async (options) => { compareOptions = options; calls.open.push(options.entries); return "closed"; }
  });
  return {
    controller, elements, calls, documentControls,
    getCompareOptions: () => compareOptions,
    setInspection: (value) => { inspection = value; },
    setFinalImage: (value) => { finalImage = value; }
  };
}

test("selection is image-ID normalized, ordered, limited to four, removable, and clearable", async () => {
  const f = fixture();
  const entries = [entry(1), entry(2), entry(3), entry(4), entry(5)];
  for (const item of entries.slice(0, 4)) assert.equal(f.controller.toggle(item.image, item.generation), true);
  assert.deepEqual(f.controller.getSelection().map((item) => String(item.image.id)), ["1", "2", "3", "4"]);
  assert.equal(f.controller.isSelected("1"), true);
  assert.equal(f.controller.toggle(entries[4].image, entries[4].generation), false);
  assert.equal(f.controller.getSelection().length, 4);
  assert.deepEqual(f.calls.toast.at(-1), ["warning", "比較は最大4枚までです"]);

  const firstRemove = f.elements.compareTrayItems.children[0].children[2];
  await firstRemove.emit("click");
  assert.deepEqual(f.controller.getSelection().map((item) => String(item.image.id)), ["2", "3", "4"]);
  f.controller.clear();
  assert.deepEqual(f.controller.getSelection(), []);
  assert.equal(f.elements.compareTray.classList.contains("hidden"), true);
});

test("selection and tray use thumbnails only and keep 0/1/2 entry states", () => {
  const f = fixture();
  assert.equal(f.elements.imageCompareMessage.textContent, "");
  f.controller.sync();
  assert.equal(f.elements.imageCompareMessage.textContent, "比較する画像がありません");
  const first = entry(1);
  f.controller.toggle(first.image, first.generation);
  assert.equal(f.elements.imageCompareMessage.textContent, "あと1枚追加すると比較できます");
  assert.equal(f.elements.compareTrayItems.children[0].children[0].src, "/thumb-1.webp");
  assert.equal(f.calls.open.length, 0, "Gallery selection and tray do not open comparison or request originals");
  const second = entry(2);
  f.controller.toggle(second.image, second.generation);
  assert.equal(f.elements.imageCompareStartButton.disabled, false);
  assert.match(f.elements.imageCompareMessage.textContent, /2枚を選択中/);
});

test("sync keeps Studio, card, and Gallery checkbox controls aligned; init/dispose own listeners", async () => {
  const f = fixture();
  const selected = entry(7);
  const cardButton = new Element("button");
  cardButton.dataset.compareImageId = "7";
  const checkbox = new Element("input");
  checkbox.kind = "checkbox";
  checkbox.dataset.compareImageId = "7";
  f.documentControls.push(cardButton, checkbox);
  f.setInspection(selected);
  f.setFinalImage(selected.image);
  f.controller.init();
  f.controller.init();
  assert.equal(f.elements.compareTrayOpenButton.listeners.get("click").size, 1);
  f.controller.toggle(selected.image, selected.generation);
  f.controller.setGalleryMode(true);
  assert.equal(cardButton.attributes.get("aria-pressed"), "true");
  assert.equal(f.elements.studioMainCompareButton.attributes.get("aria-pressed"), "true");
  assert.equal(f.elements.studioCompareButton.attributes.get("aria-pressed"), "true");
  assert.equal(checkbox.checked, true);
  assert.equal(checkbox.hidden, false);
  f.controller.dispose();
  f.controller.dispose();
  assert.equal(f.elements.compareTrayOpenButton.listeners.get("click").size, 0);
});

test("compare view receives a defensive four-entry snapshot and vote records best before History reload", async () => {
  const f = fixture();
  const entries = [entry(1), entry(2), entry(3), entry(4), entry(5)];
  await f.controller.openEntries(entries, { experimentId: "experiment-1", parameter: "steps" });
  assert.deepEqual(f.calls.open[0].map((item) => String(item.image.id)), ["1", "2", "3", "4"]);
  await f.getCompareOptions().onVote({ winnerImageId: 2, result: "b" });
  assert.deepEqual(f.calls.post, [["/api/comparisons", {
    imageIds: [1, 2, 3, 4], winnerImageId: 2, result: "b", parameter: "steps"
  }]]);
  assert.deepEqual(f.calls.best, [["experiment-1", 2]]);
  assert.deepEqual(f.calls.order, ["post", "best", "history"]);
  assert.equal(f.controller.getSelection().length, 0, "external Experiment comparison does not replace Gallery selection");
});
