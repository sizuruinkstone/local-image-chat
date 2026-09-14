import assert from "node:assert/strict";
import test from "node:test";
import { createImageModal } from "../public/features/image-modal.js";
import { createStudioController } from "../public/features/studio-controller.js";

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
    this.src = "";
    this.alt = "";
    this.disabled = false;
    this.scrollCalls = [];
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
  get firstElementChild() { return this.children[0] ?? null; }
  addEventListener(type, listener) {
    const values = this.listeners.get(type) ?? new Set();
    values.add(listener);
    this.listeners.set(type, values);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { if (name === "src") this.src = ""; else this.attributes.delete(name); }
  querySelector(selector) {
    if (selector.startsWith(".")) return walk(this).find((node) => node.className === selector.slice(1)) ?? null;
    return null;
  }
  querySelectorAll(selector) {
    const match = selector.match(/^\[data-([a-z-]+)\]$/);
    if (!match) return [];
    const key = match[1].replace(/-([a-z])/g, (_value, letter) => letter.toUpperCase());
    return walk(this).filter((node) => node.dataset[key] !== undefined);
  }
  scrollIntoView(options) { this.scrollCalls.push(options); }
  async emit(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) await listener({ target: this, preventDefault() {}, stopPropagation() {}, ...event });
  }
}

function walk(root) {
  const result = [];
  for (const child of root.children ?? []) { result.push(child, ...walk(child)); }
  return result;
}

const ELEMENT_NAMES = [
  "candidateGrid", "candidateSummary", "finishButton", "lockCompositionButton", "finalResult",
  "resultImage", "seedText", "resolutionText", "downloadLink", "finalEyebrow", "finalTitle",
  "emptyState", "loading", "resultContent", "favoriteFinalButton", "reuseFinalButton",
  "finalIpAdapterButton", "sendFinalToImg2ImgButton", "sendFinalToInpaintButton",
  "regenerateFinalButton", "openInGalleryButton", "studioOutputStats", "studioGenerationStatus",
  "studioGenerationTime", "studioResolution", "studioSeed", "studioSampler", "studioCfg", "studioSteps",
  "studioRecentCount", "studioRecentList", "studioHistoryAllButton", "studioHistoryFavoriteButton",
  "studioMetadataEmpty", "studioMetadataContent", "studioMetaModel", "studioMetaCheckpoint",
  "studioMetaScheduler", "studioMetaSampler", "studioMetaSteps", "studioMetaCfg", "studioMetaSeed",
  "studioMetaLoraCount", "studioMetaResolution", "studioMetaLoras", "studioMetaCreated", "studioMetaVram",
  "studioMetaModelHash", "studioMetaParameterSampler", "studioMetaParameterSteps",
  "studioMetaParameterCfg", "studioMetaParameterSeed", "studioMetaWidth", "studioMetaHeight",
  "studioMetaBatchCount", "studioMetaBatchSize", "studioMetaHires", "studioMetaDenoising",
  "studioMetaVae", "studioMetaClipSkip", "studioMetaPositive", "studioMetaNegative",
  "studioCopyPromptButton", "studioCopyNegativeButton", "studioCopyMetadataButton",
  "studioOpenDetailButton", "studioLoadRecipeButton", "studioCompareButton", "studioMetadataButton",
  "studioMainPreview", "studioMainImage", "studioMainFavoriteButton", "studioMainCompareButton",
  "studioMainIpAdapterButton", "studioMainMetadataButton", "studioMainRegenerateButton"
];

function fixture() {
  const documentListeners = new Map();
  const body = new Element("body");
  const document = {
    body,
    createElement: (tag) => new Element(tag),
    addEventListener: (type, listener) => documentListeners.set(type, listener),
    removeEventListener: (type, listener) => { if (documentListeners.get(type) === listener) documentListeners.delete(type); }
  };
  const elements = Object.fromEntries(ELEMENT_NAMES.map((name) => [name, new Element()]));
  for (const name of ["emptyState", "loading", "finalResult", "studioMainPreview", "studioMetadataContent", "studioMainIpAdapterButton", "finalIpAdapterButton"]) {
    elements[name].classList.add("hidden");
  }
  const calls = { modal: [], copies: [], flashes: [], warnings: [], errors: [], actions: [], favorites: [], intervals: [], clears: [], state: 0 };
  let hiresAvailable = true;
  const imageState = {
    resolveImageFavorite: (image) => Boolean(image.favorite),
    renderFavoriteButton: (button, favorite) => { button.textContent = favorite ? "★" : "☆"; },
    createFavoriteButton: (image) => { const button = new Element("button"); button.dataset.favoriteImage = image.id; return button; },
    toggleFavorite: (image) => calls.favorites.push(image.id),
    bindPresentation: (image) => calls.actions.push(["bind", image.id])
  };
  const controller = createStudioController({
    document, elements, imageState,
    openImageModal: (...args) => calls.modal.push(args),
    copyToClipboard: async (text) => calls.copies.push(text),
    flashLabel: (...args) => calls.flashes.push(args),
    toast: { warning: (message) => calls.warnings.push(message), error: (message) => calls.errors.push(message) },
    formatCheckpointBadge: (value) => value ? `Model:${value}` : "--",
    formatDate: (value) => value ? "DATE" : "",
    readFormStats: () => ({ width: "512", height: "768", seed: "-1", sampler: "Euler", cfg: "7", steps: "20" }),
    syncGenerationSettingsSummary: () => calls.actions.push(["summary"]),
    isHiresAvailable: () => hiresAvailable,
    syncCompareControl: (_button, id) => calls.actions.push(["sync-compare", id]),
    onHistoryFilterChange: async (filter) => calls.actions.push(["filter", filter]),
    onOpenDetail: (...args) => calls.actions.push(["detail", ...args]),
    onLoadRecipe: (...args) => calls.actions.push(["recipe", ...args]),
    onUseAsReference: (...args) => calls.actions.push(["reference", ...args]),
    onToggleCompare: (...args) => calls.actions.push(["compare", ...args]),
    onRegenerate: (...args) => calls.actions.push(["regenerate", ...args]),
    onUseFinalAsImg2Img: (...args) => calls.actions.push(["img2img", ...args]),
    onUseFinalAsInpaint: (...args) => calls.actions.push(["inpaint", ...args]),
    onOpenFinalInGallery: (...args) => calls.actions.push(["gallery", ...args]),
    onFocusSetting: (id) => calls.actions.push(["focus", id]),
    onStateChanged: () => { calls.state += 1; },
    now: () => 10_000,
    setIntervalFn: (fn, ms) => { const token = { fn, ms }; calls.intervals.push(token); return token; },
    clearIntervalFn: (token) => calls.clears.push(token)
  });
  return { controller, elements, calls, document, documentListeners, setHiresAvailable: (value) => { hiresAvailable = value; } };
}

const candidates = [
  { id: "image-0001", seed: 11, width: 512, height: 768, thumbnailUrl: "/thumb-1.webp", originalUrl: "/original-1.png", favorite: false },
  { id: "image-0002", seed: 22, width: 768, height: 512, thumbnailUrl: "/thumb-2.webp", originalUrl: "/original-2.png", favorite: true }
];
const generation = {
  id: "generation-1", title: "Result", mode: "txt2img", createdAt: "2026-09-06T01:02:00.000Z",
  prompt: "1girl", negativePrompt: "low quality", images: candidates,
  settings: { width: 512, height: 768, samplerName: "DPM++", scheduler: "Karras", steps: 28, cfgScale: 6.5, checkpoint: "model.safetensors", seed: 11, candidateCount: 2 }
};

test("candidate list uses thumbnails, selects one original explicitly, and preserves selection across recent rendering", async () => {
  const f = fixture();
  f.controller.setCandidates(generation, candidates);
  assert.equal(f.elements.candidateGrid.children.length, 2);
  assert.equal(f.elements.candidateGrid.children[0].children[0].src, "/thumb-1.webp");
  assert.equal(f.elements.candidateGrid.children[1].children[0].src, "/thumb-2.webp");
  assert.equal(f.elements.studioMainImage.src, "/original-1.png");
  assert.equal(f.controller.getSelectedCandidate(), candidates[0]);
  assert.ok(f.elements.candidateGrid.children[0].classList.contains("selected"));
  await f.elements.candidateGrid.children[1].children[0].emit("click");
  assert.equal(f.controller.getSelectedCandidate(), candidates[1]);
  assert.equal(f.elements.studioMainImage.src, "/original-2.png");
  f.controller.renderRecent([generation]);
  assert.equal(f.controller.getSelectedCandidate(), candidates[1], "rendering another view does not reset result selection");
  assert.equal(f.calls.intervals.length, 0, "result display starts no polling or timer");
});

test("candidate selection updates the main preview without changing loading or final panel visibility", () => {
  const f = fixture();
  f.elements.loading.classList.remove("hidden");
  f.elements.finalResult.classList.remove("hidden");
  f.controller.setCandidates(generation, candidates);
  assert.equal(f.elements.studioMainImage.src, "/original-1.png");
  assert.ok(!f.elements.studioMainPreview.classList.contains("hidden"));
  assert.ok(!f.elements.loading.classList.contains("hidden"));
  assert.ok(!f.elements.finalResult.classList.contains("hidden"));
});

test("starting a new attempt clears volatile selection but retains the prior candidate snapshot until success", () => {
  const f = fixture();
  f.controller.setCandidates(generation, candidates);
  f.controller.presentFinal(generation, candidates[0], { eyebrow: "DONE", title: "Final" });
  const priorCards = [...f.elements.candidateGrid.children];
  const priorSummary = f.elements.candidateSummary.textContent;
  f.controller.resetForGeneration();
  assert.equal(f.controller.getLastGeneration(), generation);
  assert.deepEqual(f.elements.candidateGrid.children, priorCards);
  assert.equal(f.elements.candidateSummary.textContent, priorSummary);
  assert.equal(f.controller.getSelectedCandidate(), null);
  assert.equal(f.controller.getFinalImage(), null);
  assert.equal(f.controller.getFinalGeneration(), null);
  assert.equal(f.controller.getInspection(), null);
  assert.equal(f.elements.studioMainImage.src, "");
  assert.ok(f.elements.studioMainPreview.classList.contains("hidden"));
});

test("thumbnail failure falls back to original once, then placeholder without cache busting", async () => {
  const f = fixture();
  f.controller.setCandidates(generation, [candidates[0]]);
  const image = f.elements.candidateGrid.children[0].children[0];
  assert.equal(image.loading, "eager");
  assert.equal(image.decoding, "async");
  await image.emit("error");
  assert.equal(image.src, "/original-1.png");
  assert.equal(image.dataset.originalFallback, "true");
  await image.emit("error");
  assert.equal(image.src, "/image-placeholder.svg");
  await image.emit("error");
  assert.equal(image.src, "/image-placeholder.svg");
  assert.doesNotMatch(image.src, /[?&](?:t|cache|v)=/);
});

test("final result keeps thumbnail delivery and fetches original only for zoom and download", async () => {
  const f = fixture(); f.controller.init();
  f.controller.presentFinal(generation, candidates[0], { eyebrow: "DONE", title: "Final" });
  assert.equal(f.elements.resultImage.src, "/thumb-1.webp");
  assert.equal(f.elements.downloadLink.href, "/original-1.png");
  assert.equal(f.controller.getFinalImage(), candidates[0]);
  assert.equal(f.controller.getFinalGeneration(), generation);
  assert.deepEqual(f.calls.modal, []);
  await f.elements.resultImage.emit("click");
  assert.deepEqual(f.calls.modal, [["/original-1.png", "Result"]]);
  assert.deepEqual(f.calls.actions[0], ["bind", "image-0001"]);
});

test("inspection renders stored metadata, explicit unavailable values, and copy actions", async () => {
  const f = fixture(); f.controller.init();
  f.controller.inspect(generation, candidates[0], { showOnCanvas: true });
  assert.equal(f.elements.studioMetaResolution.textContent, "512×768");
  assert.equal(f.elements.studioMetaSeed.textContent, "11");
  assert.equal(f.elements.studioMetaModel.textContent, "Model:model.safetensors");
  assert.equal(f.elements.studioMetaModelHash.textContent, "--");
  assert.equal(f.elements.studioMetaPositive.textContent, "1girl");
  assert.equal(f.elements.studioMetaNegative.textContent, "low quality");
  await f.elements.studioCopyPromptButton.emit("click");
  await new Promise((resolve) => setImmediate(resolve));
  await f.elements.studioCopyMetadataButton.emit("click");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.calls.copies[0], "1girl");
  assert.match(f.calls.copies[1], /Seed: 11/);
  assert.match(f.calls.copies[1], /Size: 512x768/);
  assert.equal(f.calls.flashes.length, 2);
  f.controller.resetForGeneration();
  await f.elements.studioCopyPromptButton.emit("click");
  assert.equal(f.calls.warnings.at(-1), "コピーする画像を選択してください");
});

test("runtime availability and explicit actions stay behind narrow callbacks", async () => {
  const f = fixture(); f.controller.init(); f.setHiresAvailable(false);
  f.controller.setCandidates(generation, candidates);
  f.controller.syncWorkflowAvailability({ ipAdapterAvailable: true });
  assert.equal(f.elements.finishButton.disabled, true);
  f.setHiresAvailable(true);
  f.controller.syncWorkflowAvailability({ ipAdapterAvailable: true });
  assert.equal(f.elements.finishButton.disabled, false);
  assert.equal(f.elements.studioMainIpAdapterButton.disabled, false);
  f.controller.updateGenerationState(true, "生成中");
  assert.equal(f.elements.studioMainIpAdapterButton.disabled, true);
  f.controller.updateGenerationState(false);
  assert.equal(f.elements.studioMainIpAdapterButton.disabled, false, "busy transition preserves the latest IP-Adapter capability");
  await f.elements.studioMainCompareButton.emit("click");
  await f.elements.studioMainIpAdapterButton.emit("click");
  await f.elements.studioLoadRecipeButton.emit("click");
  await f.elements.studioMainRegenerateButton.emit("click");
  assert.deepEqual(f.calls.actions.filter(([name]) => ["compare", "reference", "recipe", "regenerate"].includes(name)).map(([name]) => name),
    ["compare", "reference", "recipe", "regenerate"]);
});

test("empty and favorite recent states render without network watchers, while init/dispose own listeners", async () => {
  const f = fixture(); f.controller.init(); f.controller.init();
  assert.equal(f.elements.resultImage.listeners.get("click").size, 1);
  f.controller.renderRecent([]);
  assert.equal(f.elements.studioRecentCount.textContent, "0件");
  assert.equal(f.elements.studioRecentList.children[0].textContent, "生成履歴はまだありません");
  await f.controller.setHistoryFilter("favorite");
  f.controller.renderRecent([]);
  assert.equal(f.elements.studioRecentList.children[0].textContent, "お気に入りの画像はまだありません");
  assert.equal(f.calls.intervals.length, 0);
  f.controller.dispose(); f.controller.dispose();
  assert.equal(f.elements.resultImage.listeners.get("click").size, 0);
});

test("generation elapsed timer is singular and is stopped without adding a result watcher", () => {
  const f = fixture();
  f.controller.updateGenerationState(true, "生成中");
  f.controller.updateGenerationState(true, "生成中");
  assert.equal(f.calls.intervals.length, 1);
  assert.equal(f.calls.intervals[0].ms, 1000);
  f.controller.updateGenerationState(false);
  assert.equal(f.calls.clears.length, 1);
  assert.equal(f.elements.studioGenerationStatus.textContent, "READY");
});

test("shared image modal loads the requested original and releases it on close", async () => {
  const f = fixture();
  const modal = createImageModal({ document: f.document });
  modal.open("/original.png", "Original");
  const overlay = f.document.body.children[0];
  assert.equal(overlay.querySelector(".imageModalImg").src, "/original.png");
  assert.equal(overlay.querySelector(".imageModalImg").alt, "Original");
  assert.equal(f.documentListeners.has("keydown"), true);
  await f.documentListeners.get("keydown")({ key: "Escape" });
  assert.equal(overlay.classList.contains("hidden"), true);
  assert.equal(overlay.querySelector(".imageModalImg").src, "");
  assert.equal(f.documentListeners.has("keydown"), false);
});
