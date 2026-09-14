import { normalizeSectionProfiles, profileSections, profileRaw } from "../section-profiles.js";
import {
  withCheckpointStyle, checkpointStyleProfile, isCheckpointStyleSource,
  checkpointPositiveTriggers, checkpointNegativeTriggers
} from "../checkpoint-style-profiles.js";
import { createPromptLoraCoordinator } from "./prompt-lora-coordinator.js";
import {
  PROMPT_FIELDS, normalizeSections, normalizeAppliedTriggerWords, buildFinalPrompt,
  activeTriggersForSources, appendTriggersToRawPrompt, syncTriggerWords, triggerKey, removeTriggersForLora
} from "../structured-prompt.js";
import { outfitSourceLoraName, outfitStateSourceId } from "../lora-outfit-selection.js";
import { recipeParameterPatch } from "../core/generation-settings.js";

const copy = (value) => structuredClone(value);

// Canonical editor state for the new entry. There is no legacy form mirror.
// Selection/source/disabled remain owned by the existing coordinator.
export function createGenerationDraft({ parameters = {}, getCatalog = () => [], getCheckpoint = () => null } = {}) {
  let prompt = {
    rawPrompt: "", rawPromptOverride: false, negativePrompt: "",
    structuredPrompt: normalizeSections({}), appliedTriggerWords: [], sectionProfiles: {}
  };
  let settings = { ...parameters };
  let rawDraftInitialized = false;
  let description = "";
  let disabledCheckpointTriggers = new Set();
  let details = new Map(); // Payload annotations only, never a selection owner.
  const coordinator = createPromptLoraCoordinator({
    preserveSelectionOrder: true,
    preserveZeroWeights: true,
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
  const checkpointManagementId = (kind, trigger) => `${trigger.sourceId}:${kind}:${triggerKey(trigger.text)}`;
  function checkpointRows(kind) {
    const rows = kind === "positive" ? checkpointPositiveTriggers(getCheckpoint()) : checkpointNegativeTriggers(getCheckpoint());
    return rows.map(trigger => {
      const managementId = checkpointManagementId(kind, trigger);
      return {...trigger, managementId, enabled: !disabledCheckpointTriggers.has(managementId)};
    });
  }
  function managedTriggers() {
    return withCheckpointStyle(prompt.appliedTriggerWords, getCheckpoint()).flatMap(trigger=>{
      const sources=trigger.sourceLoraIds ?? [];
      const activeSources=sources.filter(id=>!isCheckpointStyleSource(id)||!disabledCheckpointTriggers.has(`${id}:positive:${triggerKey(trigger.text)}`));
      if(sources.length&&!activeSources.length)return [];
      return [{...trigger,sourceLoraIds:activeSources}];
    });
  }
  function finalNegative() { return appendTriggersToRawPrompt(prompt.negativePrompt, checkpointRows("negative")); }
  function positive() {
    const triggers = [
      ...activeTriggersForSources(prompt.appliedTriggerWords, (id) =>
        !coordinator.isSelected(sourceName(id)) || !coordinator.isDisabled(sourceName(id))),
      ...checkpointRows("positive").filter(trigger => trigger.enabled)
    ];
    const value = prompt.rawPromptOverride
      ? appendTriggersToRawPrompt(profileRaw(prompt.rawPrompt,prompt.sectionProfiles), triggers.filter((trigger) =>
        trigger.sourceLoraIds.some((id) => isCheckpointStyleSource(id) || coordinator.isSelected(sourceName(id)))))
      : buildFinalPrompt(profileSections(prompt.structuredPrompt,prompt.sectionProfiles), triggers);
    return coordinator.removeDisabledTags(value);
  }
  function readPrompt() {
    return copy({
      ...prompt, appliedTriggerWords: managedTriggers(), checkpointStyle: checkpointStyleProfile(getCheckpoint()),
      checkpointPositiveTriggers: checkpointRows("positive"), checkpointNegativeTriggers: checkpointRows("negative"),
      prompt: positive(), finalNegativePrompt: finalNegative(),
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
      negativePrompt: recipe.userNegativePrompt ?? recipe.negativePrompt ?? "",
      structuredPrompt: normalizeSections(sections),
      sectionProfiles: normalizeSectionProfiles(recipe.sectionProfiles),
      appliedTriggerWords: sections ? normalizeAppliedTriggerWords(recipe.appliedTriggerWords) : []
    };
    disabledCheckpointTriggers = new Set();
    rawDraftInitialized = prompt.rawPromptOverride;
    description = recipe.description ?? "";
  }
  return {
    readPrompt, readLoras, positive, finalNegative,
    applyScene(update) {
      prompt.structuredPrompt = normalizeSections(update.sections);
      prompt.sectionProfiles = normalizeSectionProfiles(update.profiles);
      prompt.rawPromptOverride = update.rawPromptOverride;
      prompt.appliedTriggerWords = normalizeAppliedTriggerWords(update.triggers).flatMap(trigger =>
        trigger.sourceLoraIds.filter(isCheckpointStyleSource).reduce((items,id)=>removeTriggersForLora(items,id),[trigger]));
      if (update.userNegativePrompt?.trim()) prompt.negativePrompt = update.userNegativePrompt;
      if (update.replaceLoras) {
        details = new Map(update.loras.map(item => [item.name,copy(item)]));
      }
      // Scene no-op LoRAs must survive even when their original inline field
      // was replaced. Pin the committed selection before later Prompt sync.
      coordinator.restoreState({selected:update.loras.map(item=>[item.name,item.weight]),sources:update.loras.map(item=>[item.name,'ui']),disabled:update.loras.filter(item=>item.enabled === false).map(item=>item.name)});
    },
    readParameters: () => copy(settings),
    readDescription: () => description,
    setDescription(value) { description = String(value ?? ""); },
    setPrompt(value) {
      if (value.mode === "raw" && !prompt.rawPromptOverride) {
        if (!rawDraftInitialized) prompt.rawPrompt = coordinator.removeDisabledTags(buildFinalPrompt(prompt.structuredPrompt));
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
    setSectionProfile(field,value) {
      prompt.sectionProfiles=normalizeSectionProfiles({...prompt.sectionProfiles,[field]:value});
    },
    setManagedTriggerEnabled(target, enabled) {
      if (!target || typeof target !== "object") throw new Error("Unknown managed Trigger Word");
      if (target.kind === "applied") {
        const trigger=prompt.appliedTriggerWords.find(item=>item.id===target.id);
        if(!trigger)throw new Error("Managed Trigger Word is no longer available");
        trigger.enabled=enabled===true;
        return;
      }
      if(target.kind === "section-profile"){
        const profile=prompt.sectionProfiles[target.field];
        const key=triggerKey(target.key);
        if(!profile||!key)throw new Error("Managed Trigger Word is no longer available");
        const disabled=new Set(profile.disabledTriggerKeys ?? []);
        if(enabled===true)disabled.delete(key);else disabled.add(key);
        prompt.sectionProfiles=normalizeSectionProfiles({...prompt.sectionProfiles,[target.field]:{...profile,disabledTriggerKeys:[...disabled]}});
        return;
      }
      if(target.kind === "checkpoint-positive"||target.kind === "checkpoint-negative"){
        const kind=target.kind.slice("checkpoint-".length);
        const current=checkpointRows(kind).find(trigger=>trigger.managementId===target.id);
        if(!current)throw new Error("Managed Trigger Word is no longer available");
        if(enabled===true)disabledCheckpointTriggers.delete(target.id);else disabledCheckpointTriggers.add(target.id);
        return;
      }
      throw new Error("Unknown managed Trigger Word");
    },
    setParameters(patch) { settings = { ...settings, ...copy(patch) }; },
    addLora(name, weight, metadata = {}) {
      details.set(name, copy(metadata));
      coordinator.setSelected(name, true, weight);
    },
    addManagedTriggers(name, registry) {
      const incoming=syncTriggerWords([], [{...registry,id:name}]).triggers;
      for(const trigger of incoming){
        const existing=prompt.appliedTriggerWords.find(item=>triggerKey(item.text)===triggerKey(trigger.text));
        if(existing) existing.sourceLoraIds=[...new Set([...existing.sourceLoraIds,name])];
        else prompt.appliedTriggerWords.push(trigger);
      }
    },
    setLoraOutfit(name, choiceId, words) {
      prompt.appliedTriggerWords=prompt.appliedTriggerWords.flatMap(trigger=>{
        const removed=trigger.sourceLoraIds.filter(id=>outfitSourceLoraName(id)===name);
        return removed.reduce((remaining,id)=>removeTriggersForLora(remaining,id),[trigger]);
      });
      if(choiceId){
        const incoming=syncTriggerWords([], [{id:outfitStateSourceId(name,choiceId),targetField:"appearance",triggerWords:words}]).triggers;
        for(const trigger of incoming){
          const existing=prompt.appliedTriggerWords.find(item=>triggerKey(item.text)===triggerKey(trigger.text));
          if(existing){existing.sourceLoraIds=[...new Set([...existing.sourceLoraIds,...trigger.sourceLoraIds])];existing.targetField="appearance";}
          else prompt.appliedTriggerWords.push(trigger);
        }
      }
    },
    setLoraWeight: (name, weight) => coordinator.setWeight(name, weight),
    removeLora(name) { coordinator.setSelected(name, false); details.delete(name); prompt.appliedTriggerWords=prompt.appliedTriggerWords.flatMap(trigger=>{
        const ids=trigger.sourceLoraIds.filter(id=>sourceName(id)===name);
        return ids.reduce((remaining,id)=>removeTriggersForLora(remaining,id),[trigger]);
      }); },
    toggleLora: (name) => coordinator.toggleDisabled(name),
    reorderLoras: (names) => coordinator.reorderSelection(names),
    syncLoras: () => coordinator.syncFromPrompt(),
    restorePrompt,
    applyGenerated(data) {
      // The response contains the Final Negative sent to generation. Keep the
      // user's editable Negative body separate from that derived value.
      if (prompt.rawPromptOverride && !managedTriggers().length && !Object.keys(normalizeSectionProfiles(prompt.sectionProfiles)).length) {
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
      return copy({ prompt, rawDraftInitialized, settings, description, details: [...details], selection: coordinator.captureState(), disabledCheckpointTriggers:[...disabledCheckpointTriggers] });
    },
    restore(saved) {
      const value = copy(saved);
      prompt = value.prompt;
      rawDraftInitialized = value.rawDraftInitialized ?? prompt.rawPromptOverride;
      settings = value.settings;
      description = value.description;
      details = new Map(value.details);
      disabledCheckpointTriggers = new Set(value.disabledCheckpointTriggers ?? []);
      coordinator.restoreState(value.selection);
    },
    dispose: () => coordinator.cancelScheduledSync()
  };
}
