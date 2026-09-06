import assert from "node:assert/strict";
import { createNavigation } from "../public/features/navigation.js";
import test from "node:test";
import * as router from "../public/view-router.js";

function node(dataset = {}) {
  const listeners = new Map();
  const classes = new Set();
  const attributes = new Map();
  return {
    dataset, value: "preserved", classes, attributes,
    classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); } },
    setAttribute: (key, value) => attributes.set(key, value),
    removeAttribute: (key) => attributes.delete(key),
    addEventListener(type, fn) { const set = listeners.get(type) ?? new Set(); set.add(fn); listeners.set(type, set); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    emit(type, event = {}) { for (const fn of listeners.get(type) ?? []) fn(event); },
    listenerCount: (type) => listeners.get(type)?.size ?? 0
  };
}

function fixture({ hash = "", saved = null } = {}) {
  const body = node();
  const views = Object.fromEntries(router.APP_VIEWS.map(v => [v, node()]));
  const buttons = router.APP_VIEWS.map(view => node({ view }));
  const mainNav = node();
  mainNav.querySelectorAll = () => buttons;
  const writes = [], reads = [], replacements = [], entries = [];
  const browser = node();
  browser.location = { hash };
  browser.history = { replaceState(...args) { replacements.push(args); browser.location.hash = args[2]; } };
  const storage = {
    getItem(key) { reads.push(key); return saved; },
    setItem(key, value) { writes.push([key, value]); saved = value; }
  };
  let cached = false, loading = false;
  const navigation = createNavigation({ body, mainNav, views, browser, storage,
    onGalleryEnter() { if (!cached && !loading) entries.push(["gallery", body.dataset.currentView]); },
    onCompareEnter() { entries.push(["compare-entry", body.dataset.currentView], ["experiments", body.dataset.currentView]); }
  });
  return { navigation, body, views, buttons, mainNav, browser, writes, reads, replacements, entries,
    cached(value) { cached = value; }, loading(value) { loading = value; },
    hash(value) { browser.location.hash = value; browser.emit("hashchange"); },
    click(view) { mainNav.emit("click", { target: { closest: () => ({ dataset: { view } }) } }); }
  };
}

for (const [hash, saved, expected] of [
  ["#gallery", "settings", "gallery"], ["# COMPARE ", "settings", "compare"],
  ["", "settings", "settings"], ["#unknown", "gallery", "gallery"],
  ["#unknown", "unknown", "generate"], ["", null, "generate"], ["", "unknown", "generate"]
]) {
  test(`initial resolution ${hash}/${saved} -> ${expected}, without URL/storage writes`, () => {
    const f = fixture({ hash, saved });
    f.navigation.init();
    assert.equal(f.navigation.getCurrentView(), "generate");
    f.navigation.showView(f.navigation.loadInitialView(), { remember: false });
    assert.equal(f.navigation.getCurrentView(), expected);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.replacements, []);
    assert.equal(f.browser.location.hash, hash);
    assert.equal(f.reads.length, router.viewFromHash(hash) ? 0 : 1);
  });
}

for (const view of router.APP_VIEWS) {
  test(`${view}: click updates only visibility/nav/current/hash/storage`, () => {
    const f = fixture(); f.navigation.init(); f.click(view);
    assert.equal(f.navigation.getCurrentView(), view);
    assert.equal(f.body.dataset.currentView, view);
    for (const name of router.APP_VIEWS) {
      assert.equal(f.views[name].classes.has("hidden"), name !== view);
      assert.equal(f.views[name].value, "preserved");
    }
    for (const button of f.buttons) {
      assert.equal(button.classes.has("active"), button.dataset.view === view);
      assert.equal(button.attributes.get("aria-current"), button.dataset.view === view ? "page" : undefined);
    }
    assert.deepEqual(f.writes, [["localImageChat.view", view]]);
    assert.deepEqual(f.replacements, [[null, "", `#${view}`]]);
  });
}

test("same normalized hash is not replaced; same showView still runs callbacks", () => {
  const f = fixture({ hash: "#COMPARE" });
  f.navigation.showView("compare"); f.navigation.showView("compare");
  assert.deepEqual(f.replacements, []);
  assert.equal(f.writes.length, 2);
  assert.deepEqual(f.entries.map(e => e[0]), ["compare-entry", "experiments", "compare-entry", "experiments"]);
});

test("hashchange, Back-equivalent and Forward-equivalent preserve storage and do not add history", () => {
  const f = fixture(); f.navigation.init();
  for (const hash of ["#gallery", "#compare", "#gallery", "#compare"]) {
    f.hash(hash); assert.equal(f.navigation.getCurrentView(), hash.slice(1));
  }
  const count = f.entries.length;
  f.hash("#compare"); f.hash("#invalid"); f.hash("");
  assert.equal(f.entries.length, count);
  assert.equal(f.navigation.getCurrentView(), "compare");
  assert.deepEqual(f.writes, []); assert.deepEqual(f.replacements, []);
});

test("unknown explicit view falls back to generate; unrelated click does nothing", () => {
  const f = fixture(); f.navigation.init();
  f.mainNav.emit("click", { target: { closest: () => null } });
  assert.deepEqual(f.writes, []);
  f.navigation.showView("unknown");
  assert.equal(f.navigation.getCurrentView(), "generate");
  assert.deepEqual(f.writes, [["localImageChat.view", "generate"]]);
});

test("gallery cache/loading guards, compare callback order, no generate/settings callbacks", () => {
  const f = fixture();
  f.navigation.showView("gallery");
  f.cached(true); f.navigation.showView("gallery");
  f.cached(false); f.loading(true); f.navigation.showView("gallery");
  f.navigation.showView("compare"); f.navigation.showView("settings"); f.navigation.showView("generate");
  assert.deepEqual(f.entries, [["gallery", "gallery"], ["compare-entry", "compare"], ["experiments", "compare"]]);
});

test("one init attaches exactly one click and hashchange listener; views retain their objects", () => {
  const f = fixture(); const original = { ...f.views };
  f.navigation.init();
  assert.equal(f.mainNav.listenerCount("click"), 1);
  assert.equal(f.browser.listenerCount("hashchange"), 1);
  for (const view of [...router.APP_VIEWS, "generate"]) f.click(view);
  for (const view of router.APP_VIEWS) assert.strictEqual(f.views[view], original[view]);
});

test("repeated init and dispose only manage the two navigation listeners", () => {
  const f = fixture();
  f.navigation.init(); f.navigation.init();
  f.click("compare");
  assert.equal(f.entries.length, 2);
  assert.equal(f.mainNav.listenerCount("click"), 1);
  assert.equal(f.browser.listenerCount("hashchange"), 1);
  f.navigation.dispose(); f.navigation.dispose();
  assert.equal(f.mainNav.listenerCount("click"), 0);
  assert.equal(f.browser.listenerCount("hashchange"), 0);
  f.hash("#gallery"); f.click("settings");
  assert.equal(f.navigation.getCurrentView(), "compare");
  assert.equal(f.entries.length, 2);
  f.navigation.init(); f.hash("#gallery");
  assert.equal(f.navigation.getCurrentView(), "gallery");
  assert.equal(f.entries.length, 3);
});

test("view round trips preserve form fields, reference/result objects and app lifetime listeners", () => {
  const f = fixture();
  const state = {
    prompt: "test prompt", settings: { seed: "123" }, runtime: "forge-neo-anima",
    checkpoint: "model", loras: ["lora"], img2img: { image: "source" },
    inpaint: { mask: "mask" }, ipAdapter: { weight: 0.7 }, result: { id: "result" },
    queue: ["job"], history: ["image"], compare: ["image"]
  };
  f.views.generate.form = state;
  const snapshot = structuredClone(state);
  let monitorTicks = 0;
  f.browser.addEventListener("monitor-tick", () => monitorTicks++);
  f.navigation.init();
  for (const view of [...router.APP_VIEWS, "generate"]) {
    f.click(view); f.browser.emit("monitor-tick");
    assert.strictEqual(f.views.generate.form, state);
    assert.deepEqual(state, snapshot);
  }
  f.navigation.dispose(); f.browser.emit("monitor-tick");
  assert.equal(monitorTicks, 6);
  assert.equal(f.browser.listenerCount("monitor-tick"), 1);
});
