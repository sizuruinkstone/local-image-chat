import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

class Node {
  constructor({ dataset = {}, tagName = "DIV" } = {}) {
    this.dataset = dataset; this.tagName = tagName; this.value = ""; this.textContent = "";
    this.hidden = false; this.open = false; this.disabled = false; this.children = []; this.attributes = new Map();
    this.listeners = new Map(); this.classList = { values: new Set(), toggle: (name, on) => on ? this.classList.values.add(name) : this.classList.values.delete(name) };
  }
  addEventListener(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== fn)); }
  emit(type, event = {}) { for (const fn of this.listeners.get(type) ?? []) fn(event); }
  listenerCount(type) { return this.listeners.get(type)?.length ?? 0; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = [...items]; }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  matches(selector) { return selector.includes(this.tagName.toLowerCase()); }
  querySelector(selector) { return this.children.find((child) => child.matches?.(selector)) ?? null; }
  scrollIntoView(options) { this.scrollOptions = options; }
  focus(options) { this.focusOptions = options; }
}

function make({ reducedMotion = false } = {}) {
  const categoryButtons = ["general", "lora", "history", "connection", "appInfo"].map((id) => new Node({ dataset: { settingsCategory: id }, tagName: "BUTTON" }));
  const panels = ["general", "lora", "history", "connection", "appInfo"].map((id) => new Node({ dataset: { settingsCategory: id }, tagName: "SECTION" }));
  const targetInput = new Node({ tagName: "INPUT" });
  const details = new Node({ tagName: "DETAILS" }); details.append(targetInput);
  const documentNodes = new Map([["settingsLoraDetails", details]]);
  const elements = {
    settingsCategoryNav: new Node(), settingsCategorySelect: new Node(), settingsCategoryTitle: new Node(),
    settingsCategoryDescription: new Node(), settingsContent: new Node(), settingsSearch: new Node(), settingsSearchResults: new Node()
  };
  elements.settingsCategoryNav.querySelectorAll = () => categoryButtons;
  elements.settingsContent.querySelectorAll = () => panels;
  const document = { createElement: () => new Node({ tagName: "P" }), getElementById: (id) => documentNodes.get(id) ?? null };
  const window = { matchMedia: () => ({ matches: reducedMotion }) };
  return { elements, categoryButtons, panels, details, targetInput, document, window,
    clickCategory(id) { elements.settingsCategoryNav.emit("click", { target: { closest: () => categoryButtons.find((button) => button.dataset.settingsCategory === id) ?? null } }); },
    selectCategory(id) { elements.settingsCategorySelect.value = id; elements.settingsCategorySelect.emit("change"); },
    search(value) { elements.settingsSearch.value = value; elements.settingsSearch.emit("input"); },
    clickSearchResult(button) { elements.settingsSearchResults.emit("click", { target: { closest: () => button } }); }
  };
}

async function makeLegacy(appPath, options = {}) {
  const source = await fs.readFile(appPath, "utf8");
  const start = source.indexOf("const SETTINGS_CATEGORIES =");
  const constantsEnd = source.indexOf("let storageSettingsState", start);
  const functionStart = source.indexOf("function settingsCategoryById", constantsEnd);
  const functionEnd = source.indexOf("function syncSettingsConnectionSummary()", functionStart);
  const listenerStart = source.indexOf("elements.settingsCategoryNav.addEventListener", constantsEnd);
  const listenerEnd = source.indexOf("// 生成結果", listenerStart);
  assert.ok(start >= 0 && constantsEnd > start && functionStart >= 0 && functionEnd > functionStart && listenerStart >= 0 && listenerEnd > listenerStart, "legacy settings shell blocks should exist in snapshot");
  const f = make(options);
  const context = { ...f, elements: f.elements, document: f.document, window: f.window, requestAnimationFrame: (fn) => fn() };
  const program = `${source.slice(start, constantsEnd)}\n${source.slice(functionStart, functionEnd)}\n${source.slice(listenerStart, listenerEnd)}\nglobalThis.legacy = { activate: activateSettingsCategory, normalize: normalizeSettingsSearch, render: renderSettingsSearchResults, active: () => activeSettingsCategory, categories: SETTINGS_CATEGORIES };`;
  vm.runInNewContext(program, context, { filename: appPath });
  return { ...f, controller: context.legacy };
}

async function makeController(options = {}) {
  const f = make(options);
  const module = await import("../public/features/settings-navigation.js");
  const controller = module.createSettingsNavigation({ elements: f.elements, document: f.document, window: f.window, requestAnimationFrame: (fn) => fn() });
  return { ...f, controller };
}

function makeActive(options = {}) {
  const legacyPath = process.env.SETTINGS_LEGACY_APP_PATH;
  return legacyPath ? makeLegacy(legacyPath, options) : makeController(options);
}

function snapshot(f) {
  f.controller.init?.();
  f.clickCategory("lora");
  const afterNav = { active: f.controller.active?.() ?? f.controller.active, title: f.elements.settingsCategoryTitle.textContent, loraPanelHidden: f.panels[1].hidden, loraButtonSelected: f.categoryButtons[1].attributes.get("aria-selected") };
  f.selectCategory("history");
  f.search("LoRA 衣装");
  const matches = f.elements.settingsSearchResults.children.map((button) => [button.textContent, button.children.map((child) => child.textContent), button.dataset.settingsSearchCategory, button.dataset.settingsSearchTarget]);
  const result = f.elements.settingsSearchResults.children[0];
  f.clickSearchResult(result);
  return JSON.parse(JSON.stringify({ categoryCount: f.controller.categories?.length ?? f.controller.categories?.().length, afterNav, matches, clearedSearch: f.elements.settingsSearch.value, searchHidden: f.elements.settingsSearchResults.hidden, searchExpanded: f.elements.settingsSearch.attributes.get("aria-expanded"), targetOpen: f.details.open, targetScroll: f.details.scrollOptions, focus: f.targetInput.focusOptions }));
}

test("saved pre-extraction app executes Settings category, narrow select, search, and target navigation", async () => {
  const f = await makeActive();
  const result = snapshot(f);
  assert.equal(result.categoryCount, 9);
  assert.deepEqual(result.afterNav, { active: "lora", title: "LoRA", loraPanelHidden: false, loraButtonSelected: "true" });
  assert.equal(result.matches.length, 1);
  assert.deepEqual(result.matches[0].slice(1), [["LoRA管理", "LoRA"], "lora", "settingsLoraDetails"]);
  assert.equal(result.clearedSearch, "");
  assert.equal(result.searchHidden, true);
  assert.equal(result.searchExpanded, "false");
  assert.equal(result.targetOpen, true);
  assert.deepEqual(result.targetScroll, { behavior: "smooth", block: "start" });
  assert.deepEqual(result.focus, { preventScroll: true });
});

test("Settings search uses normalized AND terms, aria state, and the no-match message", async () => {
  const f = await makeActive();
  f.controller.init?.();
  f.search("  CHECKPOINT   プロフィール ");
  assert.equal(f.elements.settingsSearchResults.children.length, 1);
  assert.equal(f.elements.settingsSearchResults.children[0].dataset.settingsSearchTarget, "checkpointDetails");
  f.search("存在しない設定");
  assert.equal(f.elements.settingsSearchResults.hidden, false);
  assert.equal(f.elements.settingsSearch.attributes.get("aria-expanded"), "true");
  assert.equal(f.elements.settingsSearchResults.children[0].textContent, "一致する設定がありません");
});

test("Settings target navigation honors reduced motion and ignores unknown categories", async () => {
  const f = await makeActive({ reducedMotion: true });
  f.controller.init?.();
  f.controller.activate("missing");
  assert.equal(f.controller.active(), "general");
  f.controller.activate("lora", { targetId: "settingsLoraDetails", focus: true });
  assert.deepEqual(JSON.parse(JSON.stringify(f.details.scrollOptions)), { behavior: "auto", block: "start" });
});

test("extracted Settings controller matches the saved legacy behavior when supplied", async (t) => {
  try { await fs.access("public/features/settings-navigation.js"); }
  catch { return t.skip("Phase 4 controller has not been extracted yet"); }
  const legacyPath = process.env.SETTINGS_LEGACY_APP_PATH;
  if (!legacyPath) return t.skip("set SETTINGS_LEGACY_APP_PATH to a saved pre-extraction app.js for parity");
  const [legacy, extracted] = await Promise.all([makeLegacy(legacyPath), makeController()]);
  assert.deepEqual(snapshot(extracted), snapshot(legacy));
});

test("extracted Settings controller owns exactly four listeners and can reinitialize", async (t) => {
  try { await fs.access("public/features/settings-navigation.js"); }
  catch { return t.skip("Phase 4 controller has not been extracted yet"); }
  const f = await makeController(); f.controller.init(); f.controller.init();
  for (const [element, event] of [[f.elements.settingsCategoryNav, "click"], [f.elements.settingsCategorySelect, "change"], [f.elements.settingsSearch, "input"], [f.elements.settingsSearchResults, "click"]]) assert.equal(element.listenerCount(event), 1);
  f.controller.dispose();
  for (const [element, event] of [[f.elements.settingsCategoryNav, "click"], [f.elements.settingsCategorySelect, "change"], [f.elements.settingsSearch, "input"], [f.elements.settingsSearchResults, "click"]]) assert.equal(element.listenerCount(event), 0);
});
