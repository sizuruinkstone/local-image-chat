import test from "node:test";
import assert from "node:assert/strict";
import { createPromptLoraCoordinator } from "../public/features/prompt-lora-coordinator.js";

function fixture(options = {}) {
  let catalog = [{ name: "Characters/alice" }, { name: "Style/ink" }];
  const fields = { raw: "" };
  const events = [];
  const timers = new Map();
  let timerId = 0;
  let c;
  c = createPromptLoraCoordinator({
    getCatalog: () => catalog,
    readPromptSources: () => Object.entries(fields).map(([key, value]) => ({ key, value })),
    writePromptSource: (key, value) => { fields[key] = value; events.push(`write:${key}`); },
    afterPromptWrite: () => events.push("mirror"),
    setCachedWeight: (name, weight) => events.push(`cache:${name}:${weight}`),
    persistWeights: () => events.push("save"),
    renderNotices: () => events.push("notice"),
    renderLoras: () => { events.push("library"); if (options.reenter) c.syncFromPrompt(); },
    renderSelection: () => events.push("selection"),
    setTimer: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; },
    clearTimer: (id) => timers.delete(id),
    ...options
  });
  return { c, fields, events, timers, catalog: (value) => { catalog = value; } };
}

test("UI add does not insert a tag; tagged UI selection retains both then ui", () => {
  const { c, fields } = fixture();
  c.setSelected("Characters/alice", true, .7);
  assert.equal(fields.raw, "");
  c.syncFromPrompt();
  assert.equal(c.getSource("Characters/alice"), "ui");
  fields.raw = "<lora:alice:0.9>";
  c.syncFromPrompt();
  assert.equal(c.getSource("Characters/alice"), "both");
  assert.equal(c.getWeight("Characters/alice"), .9);
  fields.raw = "portrait";
  c.syncFromPrompt();
  assert.equal(c.getSource("Characters/alice"), "ui");
  assert.equal(c.isSelected("Characters/alice"), true);
});

test("Prompt-only selection follows direct tag deletion; notices precede persistence and rendering", () => {
  const { c, fields, events } = fixture();
  fields.raw = "<lora:alice:.65>";
  c.syncFromPrompt();
  assert.deepEqual(events, ["notice", "cache:Characters/alice:0.65", "save", "library", "selection"]);
  assert.equal(c.getSource("Characters/alice"), "prompt");
  fields.raw = "";
  c.syncFromPrompt();
  assert.equal(c.selectedCount(), 0);
});

test("UI removal removes tags across active sources and clears source and disabled", () => {
  const { c, fields } = fixture();
  fields.raw = "portrait, <lora:alice:.5>";
  fields.extra = "<lora:Characters/alice:.8>, blue";
  c.syncFromPrompt();
  c.toggleDisabled("Characters/alice");
  assert.equal(c.setSelected("Characters/alice", false).removedTags, 2);
  assert.equal(fields.raw, "portrait");
  assert.equal(fields.extra, "blue");
  assert.equal(c.isDisabled("Characters/alice"), false);
  assert.equal(c.selectedCount(), 0);
});

test("UI weight edits only existing tags, preserves suffix and unrelated text", () => {
  const { c, fields } = fixture();
  fields.raw = "portrait, <lora:alice:0.5:0.2>, <lora:ink:1>";
  c.syncFromPrompt();
  c.setWeight("Characters/alice", .8, { syncPrompt: true });
  assert.equal(fields.raw, "portrait, <lora:alice:0.8:0.2>, <lora:ink:1>");
  c.setWeight("missing", 1, { syncPrompt: true });
  assert.doesNotMatch(fields.raw, /missing/);
});

test("profile or library slider weight without tag rewrite loses to next Prompt sync", () => {
  const { c, fields } = fixture();
  fields.raw = "<lora:alice:.5>";
  c.syncFromPrompt();
  c.setWeight("Characters/alice", .9, { syncPrompt: false });
  assert.equal(c.getWeight("Characters/alice"), .9);
  c.syncFromPrompt();
  assert.equal(c.getWeight("Characters/alice"), .5);
});

test("disabled remains selected and text is unchanged while effective tags are removed", () => {
  const { c, fields } = fixture();
  fields.raw = "portrait, <lora:alice:.5>";
  c.syncFromPrompt();
  c.toggleDisabled("Characters/alice");
  c.syncFromPrompt();
  assert.equal(c.selectionSnapshot()[0].enabled, false);
  assert.equal(c.removeDisabledTags(fields.raw), "portrait");
  assert.match(fields.raw, /<lora:/);
});

test("checkpoint restore replaces selected only and keeps legacy source/disabled semantics", () => {
  const { c, fields } = fixture();
  fields.raw = "<lora:alice:.5>";
  c.syncFromPrompt();
  c.toggleDisabled("Characters/alice");
  const missing = c.restoreCheckpointSelection([{ name: "Characters/alice", weight: .9 }, { name: "missing", weight: 1 }]);
  assert.deepEqual(missing, ["missing"]);
  assert.equal(c.getWeight("Characters/alice"), .9);
  assert.equal(c.getSource("Characters/alice"), "prompt");
  assert.equal(c.isDisabled("Characters/alice"), true);
  c.syncFromPrompt();
  assert.equal(c.getWeight("Characters/alice"), .5);
});

test("recipe restore resets source/disabled, filters exact installed identity, then Prompt wins", () => {
  const { c, fields } = fixture();
  c.setSelected("Style/ink", true, 1);
  c.toggleDisabled("Style/ink");
  c.restoreRecipeSelection([
    { name: "Characters/alice", weight: .8, source: "ui", enabled: false },
    { name: "ink", weight: 1, source: "recipe" }
  ]);
  assert.deepEqual(c.getSelectedNames(), ["Characters/alice"]);
  assert.equal(c.isDisabled("Style/ink"), false);
  fields.raw = "<lora:alice:.6>";
  c.syncFromPrompt();
  assert.equal(c.getSource("Characters/alice"), "both");
  assert.equal(c.getWeight("Characters/alice"), .6);
  assert.equal(c.isDisabled("Characters/alice"), true);
});

test("catalog refresh reads current library catalog and prunes selected without a catalog mirror", () => {
  const { c, fields, catalog } = fixture();
  fields.raw = "<lora:alice:.5>";
  c.syncFromPrompt();
  c.toggleDisabled("Characters/alice");
  catalog([{ name: "Style/ink" }]);
  c.pruneMissing();
  c.syncFromPrompt();
  assert.equal(c.selectedCount(), 0);
  assert.equal(c.isDisabled("Characters/alice"), true);
  assert.equal(c.getNotices()[0].type, "unresolved");
  catalog([]);
  assert.equal(c.syncFromPrompt(), false);
});

test("ambiguous names stay unselected, exact identity resolves, duplicate final tag wins", () => {
  const { c, fields, catalog } = fixture();
  catalog([{ name: "A/dup" }, { name: "B/dup" }]);
  fields.raw = "<lora:dup:.2>, <lora:A/dup:.4>, <lora:A/dup:.8>";
  c.syncFromPrompt();
  assert.deepEqual(c.getSelectedNames(), ["A/dup"]);
  assert.equal(c.getWeight("A/dup"), .8);
  assert.deepEqual(c.getNotices().map((n) => n.type), ["duplicate", "ambiguous"]);
});

test("re-entrant render cannot duplicate persistence or recurse", () => {
  const { c, fields, events } = fixture({ reenter: true });
  fields.raw = "<lora:alice:.5>";
  c.syncFromPrompt();
  assert.equal(events.filter((e) => e === "save").length, 1);
  assert.equal(events.filter((e) => e === "selection").length, 1);
  assert.equal(c.getSource("Characters/alice"), "prompt");
});

test("debounce coalesces input and explicit restore cancels pending sync", () => {
  const { c, timers } = fixture();
  c.scheduleSync();
  c.scheduleSync();
  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].delay, 400);
  c.restoreRecipeSelection([]);
  assert.equal(timers.size, 0);
});

test("snapshot and query copies cannot mutate ownership; runtime restore is silent", () => {
  const { c, events } = fixture();
  c.setSelected("Characters/alice", true, .7);
  c.toggleDisabled("Characters/alice");
  const state = c.captureState();
  c.getSelectedEntries()[0][1] = 2;
  c.selectionSnapshot()[0].source = "prompt";
  assert.equal(c.getWeight("Characters/alice"), .7);
  assert.equal(c.getSource("Characters/alice"), "ui");
  c.setSelected("Characters/alice", false);
  events.length = 0;
  c.restoreState(state);
  assert.equal(c.isDisabled("Characters/alice"), true);
  assert.deepEqual(events, []);
});

test("multi-field rewrite does not reconcile partially written Prompt through callbacks", () => {
  let c;
  const fields = { character: "<lora:alice:.5>", extra: "<lora:alice:.9>" };
  let saved = 0;
  let mirrors = 0;
  c = createPromptLoraCoordinator({
    getCatalog: () => [{ name: "alice" }],
    readPromptSources: () => Object.entries(fields).map(([key, value]) => ({ key, value })),
    writePromptSource: (key, value) => { fields[key] = value; c.syncFromPrompt(); },
    afterPromptWrite: () => { mirrors++; c.syncFromPrompt(); },
    persistWeights: () => saved++
  });
  c.setSelected("alice", true, .7);
  c.setWeight("alice", .8);
  assert.deepEqual(Object.values(fields), ["<lora:alice:0.8>", "<lora:alice:0.8>"]);
  assert.equal(c.getSource("alice"), "ui");
  assert.equal(saved, 0);
  assert.equal(mirrors, 1);
  c.syncFromPrompt();
  assert.equal(c.getSource("alice"), "both");
  assert.equal(saved, 1);
});

test("dialog replacement retains accepted entries even when catalog changed during modal", () => {
  const { c, catalog } = fixture();
  c.setSelected("Characters/alice", true, .7);
  const working = c.getSelectedEntries();
  catalog([]);
  c.replaceSelection(working);
  assert.equal(c.getWeight("Characters/alice"), .7);
});

test("notice arrays do not expose internal mutable state", () => {
  const { c, fields } = fixture();
  fields.raw = "<lora:alice:.5>, <lora:alice:.8>";
  c.syncFromPrompt();
  c.getNotices()[0].weights[0] = 999;
  assert.deepEqual(c.getNotices()[0].weights, [.5, .8]);
});

test("Prompt restore/apply ports are separate synchronous steps with no selection mutation", () => {
  const events = [];
  const { c } = fixture({
    applyPromptSnapshot: (...args) => events.push(["apply", ...args]),
    restorePromptSnapshot: (recipe) => events.push(["restore", recipe.prompt])
  });
  c.setSelected("Characters/alice", true, .7);
  c.applyPromptSnapshot("set prompt", "set negative");
  c.restorePromptSnapshot({ prompt: "recipe prompt" });
  assert.deepEqual(events, [["apply", "set prompt", "set negative"], ["restore", "recipe prompt"]]);
  assert.equal(c.getWeight("Characters/alice"), .7);
});
