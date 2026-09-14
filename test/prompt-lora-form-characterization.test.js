import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import * as structured from "../public/structured-prompt.js";
import * as outfits from "../public/lora-outfit-selection.js";
import { mergePromptValue } from "../public/prompt-import.js";
import { createPromptLoraCoordinator } from "../public/features/prompt-lora-coordinator.js";

// Exercise the actual form adapter functions without bootstrapping unrelated
// runtime/history/provider features. Only rendering and persistence are spies.
const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const functions = [
  "setPromptFields", "markPromptAsCurrent", "readStructuredSections", "writeStructuredSections",
  "buildCombinedPrompt", "currentPositivePrompt", "removeDisabledLoraTags", "syncRawPromptFromSections",
  "handleStructuredPromptInput", "handleRawPromptInput", "positivePromptSources", "writePromptSource",
  "useStructuredPrompt", "applyImportedPrompt", "applyRawPromptImport", "applyImportedTriggerWords",
  "restorePromptFieldsFromRecipe", "clearBothPrompts", "resolveLoraTriggerText", "loraTriggerSources",
  "loraOutfitTriggerSources", "splitFirstTriggerWord", "triggerSourceLoraName", "activeAppliedTriggerWords",
  "isAutomaticLoraTrigger", "automaticRawLoraTriggers", "importedTriggerSources", "syncAppliedTriggerWords"
];
const declarations = functions.map((name) => {
  const match = app.match(new RegExp(`^function ${name}\\([^]*?^}`, "m"));
  assert.ok(match, `form boundary function ${name} exists`);
  return match[0];
}).join("\n");

function fixture() {
  const fields = Object.fromEntries(structured.PROMPT_FIELDS.map((field) => [field, { value: "" }]));
  const events = [];
  let undo;
  const profile = {
    category: "character", presets: [
      { id: "identity", triggerWords: "alice, blue eyes" },
      { id: "dress", name: "Dress", triggerWords: "alice, blue eyes, red dress" }
    ], addons: [{ id: "hat", name: "Hat", triggerWords: "black hat" }]
  };
  const catalog = [{ name: "alice", registry: { triggerWords: "alice" }, profile }];
  const context = vm.createContext({
    ...structured, ...outfits, mergePromptValue,
    elements: { prompt: { value: "" }, negativePrompt: { value: "" }, structuredPromptPreview: {} },
    appliedTriggerWords: [], rawPromptOverride: false, rawPromptOverrideSource: "manual",
    settingPromptProgrammatically: false, promptDescription: "", clearedPromptSnapshot: null,
    IMPORT_SOURCE_PREFIX: "import:",
    promptFieldElement: (field) => fields[field],
    revealFilledPromptFields() {}, renderPromptFieldPreviews() {}, renderPromptModeState() {},
    renderRawTriggerNotice() {}, syncPromptClearButtons() {},
    setPromptMode: (mode) => events.push(`tab:${mode}`),
    scheduleLoraSync: () => events.push("schedule"),
    renderTriggerLists: () => events.push("triggers"),
    loraTriggers: new Map(), loraOutfitSelections: new Map(), loraPresetSelections: new Map(),
    findLoraByName: (name) => catalog.find((item) => item.name === name),
    resolveProfile: (lora) => lora?.profile,
    toast: { info: (_message, options) => { undo = options?.action?.onSelect; }, success() {} }
  });
  vm.runInContext(declarations, context);
  const c = createPromptLoraCoordinator({
    getCatalog: () => catalog,
    readPromptSources: () => context.positivePromptSources(),
    writePromptSource: (key, value) => context.writePromptSource(key, value),
    afterPromptWrite: () => context.syncRawPromptFromSections(),
    renderSelection: () => context.syncAppliedTriggerWords()
  });
  context.promptLoraCoordinator = c;
  return { x: context, c, fields, events, catalog, undo: () => undo() };
}

test("manual Raw wins across Structured edits and UI LoRA changes until explicit release", () => {
  const { x, c, fields } = fixture();
  fields.character.value = "structured portrait";
  x.handleStructuredPromptInput();
  assert.equal(x.elements.prompt.value, "structured portrait");
  x.elements.prompt.value = "raw portrait, <lora:alice:.5>";
  x.handleRawPromptInput();
  c.syncFromPrompt();
  fields.character.value = "edited structured";
  x.handleStructuredPromptInput();
  c.setWeight("alice", .8, { syncPrompt: true });
  assert.match(x.currentPositivePrompt(), /^raw portrait, <lora:alice:0.8>/);
  assert.equal(fields.character.value, "edited structured");
  x.useStructuredPrompt();
  assert.match(x.currentPositivePrompt(), /edited structured/);
  assert.doesNotMatch(x.currentPositivePrompt(), /raw portrait/);
});

test("structured import append/replace only changes provided fields and preserves Raw priority", () => {
  const { x, fields } = fixture();
  fields.character.value = "old character";
  fields.style.value = "old style";
  x.setPromptFields("manual raw", "bad", "");
  const parsed = { hasSections: true, sections: { character: "new character" }, triggerWords: [], negativePrompt: "blur" };
  x.applyImportedPrompt(parsed, "append");
  assert.equal(fields.character.value, "old character, new character");
  assert.equal(x.currentPositivePrompt(), "manual raw");
  x.applyImportedPrompt(parsed, "replace");
  assert.equal(fields.character.value, "new character");
  assert.equal(fields.style.value, "old style");
  assert.equal(x.elements.negativePrompt.value, "blur");
  assert.equal(x.rawPromptOverride, true);
});

test("Raw fallback import uses combined prompt for append and switches to Raw", () => {
  const { x, fields } = fixture();
  fields.character.value = "alice portrait";
  x.applyRawPromptImport("sunset", "append");
  assert.equal(x.currentPositivePrompt(), "alice portrait, sunset");
  x.applyRawPromptImport("night", "replace");
  assert.equal(x.currentPositivePrompt(), "night");
  assert.equal(fields.character.value, "alice portrait");
});

test("recipe Structured and legacy Raw restore preserve explicit priority", () => {
  const { x, fields } = fixture();
  x.restorePromptFieldsFromRecipe({ structuredPrompt: { character: "structured" }, rawPromptOverride: false, prompt: "server final", appliedTriggerWords: [] });
  assert.equal(x.currentPositivePrompt(), "structured");
  x.restorePromptFieldsFromRecipe({ structuredPrompt: { character: "retained" }, rawPromptOverride: true, rawPrompt: "raw snapshot", prompt: "server final" });
  assert.equal(x.currentPositivePrompt(), "raw snapshot");
  assert.equal(fields.character.value, "retained");
  x.restorePromptFieldsFromRecipe({ prompt: "legacy raw" });
  assert.equal(x.currentPositivePrompt(), "legacy raw");
  assert.equal(fields.character.value, "");
});

test("manual trigger update and metadata character default follow existing priority", () => {
  const { x, c, catalog } = fixture();
  c.setSelected("alice", true, .7);
  x.loraTriggers.set("alice", "manual words");
  x.syncAppliedTriggerWords();
  assert.match(x.currentPositivePrompt(), /manual words/);
  catalog[0].registry.characterTriggerWords = "registry character";
  x.syncAppliedTriggerWords();
  assert.equal(x.resolveLoraTriggerText("alice"), "registry character");
  assert.match(x.currentPositivePrompt(), /alice/);
});

test("outfit apply/remove preserves edited trigger weight and independent imported source", () => {
  const { x, c } = fixture();
  c.setSelected("alice", true, .7);
  x.loraOutfitSelections.set("alice", "preset:dress");
  x.syncAppliedTriggerWords();
  assert.match(x.currentPositivePrompt(), /red dress/);
  const base = x.appliedTriggerWords.find((item) => item.text === "alice");
  base.weight = 1.3;
  x.applyImportedTriggerWords([{ field: "style", text: "watercolor", weight: 1 }], "append");
  x.loraOutfitSelections.set("alice", "");
  x.syncAppliedTriggerWords();
  assert.doesNotMatch(x.currentPositivePrompt(), /red dress/);
  assert.match(x.currentPositivePrompt(), /alice:1.3/);
  c.toggleDisabled("alice");
  assert.doesNotMatch(x.currentPositivePrompt(), /alice/);
  assert.match(x.currentPositivePrompt(), /watercolor/);
});

test("clear and undo preserve selection and trigger frames while restoring form priority", () => {
  const { x, c, fields, undo } = fixture();
  c.setSelected("alice", true, .7);
  x.syncAppliedTriggerWords();
  fields.style.value = "pencil";
  x.setPromptFields("raw sketch", "blur", "description");
  x.clearBothPrompts();
  assert.equal(c.isSelected("alice"), true);
  assert.equal(x.rawPromptOverride, false);
  assert.match(x.currentPositivePrompt(), /alice/);
  assert.equal(fields.style.value, "");
  undo();
  assert.match(x.currentPositivePrompt(), /^raw sketch/);
  assert.equal(fields.style.value, "pencil");
  assert.equal(x.elements.negativePrompt.value, "blur");
});

test("app form rollback port restores Recipe-mutated rating and persistent LoRA caches", () => {
  const rollbackFunctions = ["captureFormState", "replaceMap", "restoreFormState"]
    .map((name) => {
      const match = app.match(new RegExp(`^function ${name}\\([^]*?^}`, "m"));
      assert.ok(match, `rollback boundary function ${name} exists`);
      return match[0];
    }).join("\n");
  const persisted = [];
  const context = vm.createContext({
    captureRuntimeFormState: () => ({ prompt: "before" }),
    restoreRuntimeFormState: (value, options) => { context.restoredForm = value; context.restoreOptions = options; },
    selectedContentRating: () => context.rating,
    setContentRating: (value) => { context.rating = value; persisted.push("rating"); },
    loraWeights: new Map([["alice", 0.7]]),
    loraTriggers: new Map([["alice", "before trigger"]]),
    loraNegativeWords: new Map([["alice", "before negative"]]),
    loraOutfitSelections: new Map([["alice", "preset:dress"]]),
    saveLoraWeights: () => persisted.push("weights"),
    saveLoraTriggers: () => persisted.push("triggers"),
    saveLoraNegativeWords: () => persisted.push("negative"),
    saveLoraOutfitSelections: () => persisted.push("outfits"),
    renderLoras() {}, renderSelectedLoraSummary() {}, renderTriggerLists() {}, renderPromptFieldPreviews() {},
    rating: "general", restoredForm: null
  });
  vm.runInContext(rollbackFunctions, context);
  const snapshot = context.captureFormState();
  context.rating = "nsfw";
  context.loraWeights.set("alice", 1.2);
  context.loraTriggers.set("alice", "after trigger");
  context.loraNegativeWords.clear();
  context.loraOutfitSelections.set("alice", "");

  assert.equal(context.restoreFormState(snapshot), true);
  assert.equal(context.rating, "general");
  assert.deepEqual([...context.loraWeights], [["alice", 0.7]]);
  assert.deepEqual([...context.loraTriggers], [["alice", "before trigger"]]);
  assert.deepEqual([...context.loraNegativeWords], [["alice", "before negative"]]);
  assert.deepEqual([...context.loraOutfitSelections], [["alice", "preset:dress"]]);
  assert.deepEqual(context.restoredForm, { prompt: "before" });
  assert.deepEqual(JSON.parse(JSON.stringify(context.restoreOptions)), { syncReferenceSize: false });
  assert.deepEqual(persisted, ["rating", "weights", "triggers", "negative", "outfits"]);
});

test("runtime form snapshot deeply isolates applied trigger sources and repeatedly restores form semantics", () => {
  const runtimeFunctions = ["copyAppliedTriggerWords", "captureRuntimeFormState", "restoreRuntimeFormState"]
    .map((name) => {
      const match = app.match(new RegExp(`^function ${name}\\([^]*?^}`, "m"));
      assert.ok(match, `runtime form function ${name} exists`);
      return match[0];
    }).join("\n");
  const referenceRestores = [];
  const writtenSections = [];
  const modeRestores = [];
  const context = vm.createContext({
    elements: {
      prompt: { value: "raw before" },
      negativePrompt: { value: "negative before" },
      width: { value: "896" },
      seedFixedToggle: { checked: true }
    },
    promptDescription: "description before",
    appliedTriggerWords: [{
      text: "alice",
      weight: 1.1,
      targetField: "character",
      sourceLoraIds: ["alice", "outfit:alice:preset:dress"]
    }],
    rawPromptOverride: true,
    rawPromptOverrideSource: "generated",
    promptMode: "raw",
    generationMode: "inpaint",
    readStructuredSections: () => ({ character: "structured before", style: "ink" }),
    writeStructuredSections: (value) => writtenSections.push({ ...value }),
    setPromptMode: (value) => { context.promptMode = value; },
    syncRawPromptFromSections() {}, renderPromptModeState() {},
    referenceImageController: {
      captureSnapshot: () => null,
      restoreSnapshot: (value, options) => referenceRestores.push([value, options])
    },
    setGenerationMode: (value) => { context.generationMode = value; modeRestores.push(value); },
    syncSamplerLabels() {}, handleCandidateCountChange() {}, handleImg2ImgDenoisingInput() {},
    inpaintEditor: { savePreferences() {} }
  });
  vm.runInContext(runtimeFunctions, context);

  const snapshot = context.captureRuntimeFormState();
  context.appliedTriggerWords[0].text = "live mutation";
  context.appliedTriggerWords[0].sourceLoraIds.push("live-source");
  assert.equal(snapshot.appliedTriggerWords[0].text, "alice");
  assert.deepEqual([...snapshot.appliedTriggerWords[0].sourceLoraIds], [
    "alice", "outfit:alice:preset:dress"
  ]);

  context.rawPromptOverride = false;
  context.rawPromptOverrideSource = "manual";
  context.promptMode = "structured";
  context.generationMode = "txt2img";
  context.restoreRuntimeFormState(snapshot);
  context.appliedTriggerWords[0].text = "restored mutation";
  context.appliedTriggerWords[0].sourceLoraIds.length = 0;
  context.restoreRuntimeFormState(snapshot);

  assert.equal(context.appliedTriggerWords[0].text, "alice");
  assert.deepEqual([...context.appliedTriggerWords[0].sourceLoraIds], [
    "alice", "outfit:alice:preset:dress"
  ]);
  assert.equal(context.rawPromptOverride, true);
  assert.equal(context.rawPromptOverrideSource, "generated");
  assert.equal(context.promptMode, "raw");
  assert.equal(context.generationMode, "inpaint");
  assert.deepEqual(writtenSections.at(-1), { character: "structured before", style: "ink" });
  assert.deepEqual(JSON.parse(JSON.stringify(referenceRestores)), [
    [null, { mode: "inpaint", syncSize: true }],
    [null, { mode: "inpaint", syncSize: true }]
  ]);
  assert.deepEqual(modeRestores, ["inpaint", "inpaint"]);
});
