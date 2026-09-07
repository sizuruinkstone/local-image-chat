import { createPromptLoraCoordinator } from "./prompt-lora-coordinator.js";
import {
  PROMPT_FIELDS, normalizeSections, normalizeAppliedTriggerWords, buildFinalPrompt,
  activeTriggersForSources, appendTriggersToRawPrompt
} from "../structured-prompt.js";
import { outfitSourceLoraName } from "../lora-outfit-selection.js";
import { recipeParameterPatch } from "../core/generation-settings.js";

const copy = (value) => structuredClone(value);

// Canonical editor state for the new entry. There is no legacy form mirror.
// Selection/source/disabled remain owned by the existing coordinator.
export function createGenerationDraft({ parameters = {}, getCatalog = () => [] } = {}) {
  let prompt = {
    rawPrompt: "", rawPromptOverride: false, negativePrompt: "",
    structuredPrompt: normalizeSections({}), appliedTriggerWords: []
  };
  let settings = { ...parameters };
  let rawDraftInitialized = false;
  let description = "";
  let details = new Map(); // Payload annotations only, never a selection owner.
  const coordinator = createPromptLoraCoordinator({
    preserveSelectionOrder: true,
    getCatalog,
    readPromptSources: () => prompt.rawPromptOverride
      ? [{ key: "raw", value: prompt.rawPrompt }]
      : PROMPT_FIELDS.map((key) => ({ key, value: prompt.structuredPrompt[key] })),
    writePromptSource: (key, value) => {
      if (key === "raw") prompt.rawPrompt = value;
      else prompt.structuredPrompt[key] = value;
    }
  });
  const sourceName = (id) => outfitSourceLoraName(id) || String(id ?? "");
  function positive() {
    const triggers = activeTriggersForSources(prompt.appliedTriggerWords, (id) =>
      !coordinator.isSelected(sourceName(id)) || !coordinator.isDisabled(sourceName(id)));
    const value = prompt.rawPromptOverride
      ? appendTriggersToRawPrompt(prompt.rawPrompt, triggers.filter((trigger) =>
        trigger.sourceLoraIds.some((id) => coordinator.isSelected(sourceName(id)))))
      : buildFinalPrompt(prompt.structuredPrompt, triggers);
    return coordinator.removeDisabledTags(value);
  }
  function readPrompt() {
    return copy({
      ...prompt, prompt: positive(),
      rawPrompt: prompt.rawPromptOverride ? prompt.rawPrompt : "",
      loraNotices: coordinator.getNotices()
    });
  }
  function readLoras() {
    return coordinator.selectionSnapshot().map((selection) => ({
      ...copy(details.get(selection.name) ?? {}), ...selection
    }));
  }
  function restorePrompt(recipe) {
    const sections = recipe.structuredPrompt;
    const raw = sections
      ? (recipe.rawPromptOverride ? recipe.rawPrompt || recipe.prompt || "" : "")
      : recipe.prompt ?? "";
    prompt = {
      rawPrompt: raw, rawPromptOverride: Boolean(String(raw).trim()),
      negativePrompt: recipe.negativePrompt ?? "",
      structuredPrompt: normalizeSections(sections),
      appliedTriggerWords: sections ? normalizeAppliedTriggerWords(recipe.appliedTriggerWords) : []
    };
    rawDraftInitialized = prompt.rawPromptOverride;
    description = recipe.description ?? "";
  }
  return {
    readPrompt, readLoras, positive,
    readParameters: () => copy(settings),
    readDescription: () => description,
    setDescription(value) { description = String(value ?? ""); },
    setPrompt(value) {
      if (value.mode === "raw" && !prompt.rawPromptOverride) {
        if (!rawDraftInitialized) prompt.rawPrompt = positive();
        rawDraftInitialized = true;
        prompt.rawPromptOverride = true;
      } else if (value.mode === "structured") prompt.rawPromptOverride = false;
      if (value.positive !== undefined) {
        rawDraftInitialized = true;
        prompt.rawPrompt = String(value.positive);
        prompt.rawPromptOverride = true;
      }
      if (value.negative !== undefined) prompt.negativePrompt = String(value.negative);
      if (value.sections !== undefined) {
        prompt.structuredPrompt = normalizeSections(value.sections);
        prompt.rawPromptOverride = false;
      }
      coordinator.syncFromPrompt();
    },
    setParameters(patch) { settings = { ...settings, ...copy(patch) }; },
    addLora(name, weight, metadata = {}) {
      details.set(name, copy(metadata));
      coordinator.setSelected(name, true, weight);
    },
    setLoraWeight: (name, weight) => coordinator.setWeight(name, weight),
    removeLora(name) { coordinator.setSelected(name, false); details.delete(name); },
    toggleLora: (name) => coordinator.toggleDisabled(name),
    reorderLoras: (names) => coordinator.reorderSelection(names),
    syncLoras: () => coordinator.syncFromPrompt(),
    restorePrompt,
    applyGenerated(data) {
      prompt.negativePrompt = data.negativePrompt ?? "";
      if (prompt.rawPromptOverride) {
        prompt.rawPrompt = data.prompt ?? "";
        prompt.rawPromptOverride = Boolean(prompt.rawPrompt.trim());
      }
    },
    reuse(recipe, image) {
      restorePrompt(recipe);
      settings = { ...settings, ...recipeParameterPatch(recipe, image) };
      details = new Map((recipe.loras ?? []).map((lora) => [lora.name, copy(lora)]));
      coordinator.restoreRecipeSelection(recipe.loras ?? []);
      coordinator.syncFromPrompt();
    },
    capture() {
      return copy({ prompt, rawDraftInitialized, settings, description, details: [...details], selection: coordinator.captureState() });
    },
    restore(saved) {
      const value = copy(saved);
      prompt = value.prompt;
      rawDraftInitialized = value.rawDraftInitialized ?? prompt.rawPromptOverride;
      settings = value.settings;
      description = value.description;
      details = new Map(value.details);
      coordinator.restoreState(value.selection);
    },
    dispose: () => coordinator.cancelScheduledSync()
  };
}
