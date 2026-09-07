import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { createSamplerPicker } from "../public/features/sampler-picker.js";
import {
  SAMPLER_PRESETS, buildOptionSections, describeSamplerPreset, isActivePreset,
  isFavoriteOption, rememberRecentOption, toggleFavoriteOption
} from "../public/option-picker.js";

class Node {
  constructor() {
    this.children = []; this.listeners = new Map(); this.value = ""; this.textContent = "";
    this.classList = { values: new Set(), toggle: (key, on) => on ? this.classList.values.add(key) : this.classList.values.delete(key) };
  }
  addEventListener(k, fn) { this.listeners.set(k, [...(this.listeners.get(k) ?? []), fn]); }
  removeEventListener(k, fn) { this.listeners.set(k, (this.listeners.get(k) ?? []).filter((x) => x !== fn)); }
  fire(k) { for (const fn of this.listeners.get(k) ?? []) fn({ target: this }); }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = [...items]; }
  setAttribute(k, v) { this[k] = v; }
}

function make({ response = { samplers: ["Euler a", "DDIM"], schedulers: ["Automatic", "Karras"] }, current = true } = {}) {
  const names = ["samplerName", "scheduler", "samplerPickerValue", "schedulerPickerValue", "samplerPresets", "samplerPickerButton", "schedulerPickerButton"];
  const elements = Object.fromEntries(names.map((name) => [name, new Node()]));
  elements.samplerName.value = "Euler a"; elements.scheduler.value = "Automatic";
  const values = new Map(); let modal;
  const controller = createSamplerPicker({
    elements, document: { createElement: () => new Node() },
    storage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
    getJson: async () => response instanceof Error ? Promise.reject(response) : response,
    openModal: (config) => { modal = config; return { promise: Promise.resolve(null) }; },
    runtimeApiUrl: (path) => `/runtime${path}`, runtimeRequestContext: () => ({ token: 1 }),
    isRuntimeContextCurrent: () => current
  });
  return { controller, elements, values, modal: () => modal };
}

async function makeLegacy(path, options = {}) {
  const source = await fs.readFile(path, "utf8");
  const start = source.indexOf("// ---- Sampler / Scheduler の選択UI ----");
  const end = source.indexOf("// ---- 使用中LoRA（生成画面） ----", start);
  assert.ok(start >= 0 && end > start, "legacy sampler block should exist in snapshot");
  const f = make(options);
  const context = {
    elements: f.elements,
    document: { createElement: () => new Node() },
    localStorage: {
      getItem: (key) => f.values.get(key) ?? null,
      setItem: (key, value) => f.values.set(key, value)
    },
    readJsonStorage(key, fallback) {
      try { return JSON.parse(this.localStorage.getItem(key) ?? "null") ?? fallback; }
      catch { return fallback; }
    },
    getJson: async () => options.response instanceof Error ? Promise.reject(options.response) : (options.response ?? { samplers: ["Euler a", "DDIM"], schedulers: ["Automatic", "Karras"] }),
    runtimeApiUrl: (path) => `/runtime${path}`,
    runtimeRequestContext: () => ({ token: 1 }),
    isRuntimeContextCurrent: () => options.current ?? true,
    openModal: (config) => { context.modal = config; return { promise: Promise.resolve(null) }; },
    SAMPLER_PRESETS, buildOptionSections, describeSamplerPreset, isActivePreset,
    isFavoriteOption, rememberRecentOption, toggleFavoriteOption
  };
  context.readJsonStorage = context.readJsonStorage.bind(context);
  const program = `let samplerOptions = { samplers: [], schedulers: [] };\n${source.slice(start, end)}\n`
    + `globalThis.legacy = { loadOptions: loadSamplerOptions, syncLabels: syncSamplerLabels, applyValue: applySamplerValue, openPicker: openSamplerPicker, getOptions: () => ({ samplers: [...samplerOptions.samplers], schedulers: [...samplerOptions.schedulers] }), setOptions: (value) => { samplerOptions = { samplers: [...(value?.samplers ?? [])], schedulers: [...(value?.schedulers ?? [])] }; } };`;
  vm.runInNewContext(program, context, { filename: path });
  return { controller: context.legacy, elements: f.elements, values: f.values, modal: () => context.modal };
}

async function paritySnapshot(factory) {
  const f = await factory();
  await f.controller.loadOptions();
  f.values.set("localImageChat.samplerRecent", JSON.stringify(["ddim", "Euler a"]));
  f.controller.applyValue("sampler", "DDIM");
  f.elements.scheduler.value = "Recipe scheduler";
  f.controller.syncLabels();
  const pending = f.controller.openPicker("sampler"); const body = new Node();
  f.modal().build(body, () => {}); await pending;
  return {
    catalog: f.controller.getOptions(),
    sampler: f.elements.samplerName.value,
    scheduler: f.elements.scheduler.value,
    samplerLabel: f.elements.samplerPickerValue.textContent,
    schedulerLabel: f.elements.schedulerPickerValue.textContent,
    recent: JSON.parse(f.values.get("localImageChat.samplerRecent")),
    modalTitle: f.modal().title,
    modalRows: body.children[1].children.filter((node) => node.className === "optionPickerRow").map((row) => row.children[0].textContent)
  };
}

test("saved pre-extraction app and controller have executable sampler parity", async (t) => {
  const legacyPath = process.env.SAMPLER_LEGACY_APP_PATH;
  if (!legacyPath) return t.skip("set SAMPLER_LEGACY_APP_PATH to run saved-baseline parity");
  const legacy = await paritySnapshot(() => makeLegacy(legacyPath));
  const extracted = await paritySnapshot(async () => make());
  assert.deepEqual(extracted, JSON.parse(JSON.stringify(legacy)));
});

test("catalog load synchronizes current labels and presets", async () => {
  const f = make();
  assert.equal(await f.controller.loadOptions(), true);
  assert.deepEqual(f.controller.getOptions(), { samplers: ["Euler a", "DDIM"], schedulers: ["Automatic", "Karras"] });
  assert.equal(f.elements.samplerPickerValue.textContent, "Euler a");
  assert.equal(f.elements.samplerPresets.children.length, 3);
  assert.equal(f.elements.samplerPresets.children[2].classList.values.has("active"), true);
});

test("current runtime failure falls back to empty catalog without changing form", async () => {
  const f = make({ response: new Error("offline") });
  assert.equal(await f.controller.loadOptions(), true);
  assert.deepEqual(f.controller.getOptions(), { samplers: [], schedulers: [] });
  assert.equal(f.elements.samplerName.value, "Euler a");
});

test("stale runtime success or failure preserves catalog and skips UI sync", async () => {
  for (const response of [{ samplers: ["stale"], schedulers: [] }, new Error("stale")]) {
    const f = make({ response, current: false });
    f.controller.setOptions({ samplers: ["kept"], schedulers: ["kept scheduler"] });
    assert.equal(await f.controller.loadOptions({ token: 0 }), false);
    assert.deepEqual(f.controller.getOptions(), { samplers: ["kept"], schedulers: ["kept scheduler"] });
    assert.equal(f.elements.samplerPresets.children.length, 0);
  }
});

test("individual choice preserves counterpart and writes only kind recent key", () => {
  const f = make();
  f.values.set("localImageChat.samplerRecent", JSON.stringify(["ddim", "Euler a"]));
  f.controller.applyValue("sampler", "DDIM");
  assert.equal(f.elements.scheduler.value, "Automatic");
  assert.deepEqual(JSON.parse(f.values.get("localImageChat.samplerRecent")), ["DDIM", "Euler a"]);
  assert.equal(f.values.has("localImageChat.schedulerRecent"), false);
});

test("malformed and non-array saved lists are ignored", async () => {
  const f = make({ response: { samplers: [], schedulers: [] } });
  f.values.set("localImageChat.samplerFavorites", "{broken");
  f.values.set("localImageChat.samplerRecent", JSON.stringify({ value: "wrong shape" }));
  await f.controller.loadOptions();
  const pending = f.controller.openPicker("sampler"); const body = new Node();
  f.modal().build(body, () => {}); await pending;
  const rows = body.children[1].children.filter((node) => node.className === "optionPickerRow");
  assert.deepEqual(rows.map((row) => row.children[0].textContent), ["Euler a"]);
});

test("preset applies both values and both recent keys", () => {
  const f = make();
  f.controller.syncLabels();
  f.elements.samplerPresets.children[0].fire("click");
  assert.equal(f.elements.samplerName.value, "DPM++ 2M SDE");
  assert.equal(f.elements.scheduler.value, "Karras");
  assert.deepEqual(JSON.parse(f.values.get("localImageChat.schedulerRecent")), ["Karras"]);
});

test("picker includes saved values with empty catalog and persists favorite", async () => {
  const f = make({ response: { samplers: [], schedulers: [] } });
  f.values.set("localImageChat.samplerFavorites", JSON.stringify(["Favorite"]));
  f.values.set("localImageChat.samplerRecent", JSON.stringify(["Recent"]));
  await f.controller.loadOptions();
  const pending = f.controller.openPicker("sampler"); const body = new Node();
  f.modal().build(body, () => {}); await pending;
  const list = body.children[1];
  const rows = list.children.filter((node) => node.className === "optionPickerRow");
  assert.ok(rows.some((row) => row.children[0].textContent === "Recent"));
  const current = rows.find((row) => row.children[0].textContent === "Euler a");
  current.children[1].fire("click");
  assert.ok(JSON.parse(f.values.get("localImageChat.samplerFavorites")).includes("Euler a"));
});

test("init/dispose own exactly two click listeners and allow reinit", () => {
  const f = make(); f.controller.init(); f.controller.init();
  assert.equal(f.elements.samplerPickerButton.listeners.get("click").length, 1);
  f.controller.dispose();
  assert.equal(f.elements.samplerPickerButton.listeners.get("click").length, 0);
  f.controller.init();
  assert.equal(f.elements.schedulerPickerButton.listeners.get("click").length, 1);
});

test("runtime snapshot transfer clones catalog arrays", () => {
  const f = make(); const input = { samplers: ["Euler"], schedulers: ["Karras"] };
  f.controller.setOptions(input); input.samplers.push("outside");
  const output = f.controller.getOptions(); output.samplers.push("outside");
  assert.deepEqual(f.controller.getOptions(), { samplers: ["Euler"], schedulers: ["Karras"] });
});

test("external profile or recipe form changes become labels only on explicit sync", () => {
  const f = make(); f.controller.syncLabels();
  f.elements.samplerName.value = "Profile sampler";
  f.elements.scheduler.value = "Recipe scheduler";
  assert.equal(f.elements.samplerPickerValue.textContent, "Euler a");
  f.controller.syncLabels();
  assert.equal(f.elements.samplerPickerValue.textContent, "Profile sampler");
  assert.equal(f.elements.schedulerPickerValue.textContent, "Recipe scheduler");
});

test("init and dispose perform no catalog request", () => {
  const f = make(); f.controller.init(); f.controller.dispose();
  assert.deepEqual(f.controller.getOptions(), { samplers: [], schedulers: [] });
});

test("app delegates sampler ownership and keeps profile/runtime sync ports", async () => {
  const [app, feature] = await Promise.all([
    fs.readFile("public/app.js", "utf8"),
    fs.readFile("public/features/sampler-picker.js", "utf8")
  ]);
  assert.match(app, /createSamplerPicker\(\{/);
  assert.match(app, /const controllerInitOrder = \[[\s\S]*?samplerPicker[\s\S]*?\];/);
  assert.match(app, /samplerPicker\.getOptions\(\)/);
  assert.match(app, /samplerPicker\.setOptions\(snapshot\.samplerOptions\)/);
  assert.match(app, /syncSamplerLabels\(\)/);
  assert.doesNotMatch(app, /const SAMPLER_STORAGE|function openSamplerPicker/);
  for (const key of ["localImageChat.samplerFavorites", "localImageChat.samplerRecent", "localImageChat.schedulerFavorites", "localImageChat.schedulerRecent"]) {
    assert.match(feature, new RegExp(key.replaceAll(".", "\\.")));
  }
});
