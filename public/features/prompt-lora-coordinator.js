import {
  buildLoraNotices,
  describeLoraNotices,
  parseLoraTags,
  reconcilePromptLoras,
  removeLoraTags,
  replaceLoraWeight
} from "../lora-tags.js";

// Owns generation selection, never the installed catalog or form DOM.
// Form ports choose Raw vs Structured; only those active sources are reconciled.
// Callbacks are synchronous. Reconciliation/rewrite callbacks may request a
// sync but cannot recursively apply a second reconciliation mid-update.
export function createPromptLoraCoordinator({
  getCatalog,
  readPromptSources,
  writePromptSource,
  afterPromptWrite = () => {},
  setCachedWeight = () => {},
  persistWeights = () => {},
  renderLoras = () => {},
  renderSelection = () => {},
  renderNotices = () => {},
  applyPromptSnapshot,
  restorePromptSnapshot,
  debounceMs = 400,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  preserveSelectionOrder = false
}) {
  const selected = new Map();
  const sources = new Map();
  const disabled = new Set();
  let notices = [];
  let syncTimer = null;
  let reconciling = false;
  let writingPrompt = false;

  function copyNotice(notice) {
    return {
      ...notice,
      ...(Array.isArray(notice?.weights) ? { weights: [...notice.weights] } : {}),
      ...(Array.isArray(notice?.candidates) ? { candidates: [...notice.candidates] } : {})
    };
  }

  function selectionSnapshot() {
    return [...selected].map(([name, weight]) => ({
      name,
      weight,
      source: sources.get(name) ?? "ui",
      enabled: !disabled.has(name)
    }));
  }

  function cancelScheduledSync() {
    if (syncTimer !== null) clearTimer(syncTimer);
    syncTimer = null;
  }

  function rewritePrompt(name, transform) {
    if (writingPrompt) return 0;
    writingPrompt = true;
    let changes = 0;
    try {
      for (const source of readPromptSources()) {
        const result = transform(source.value, name);
        const text = typeof result === "string" ? result : result.text;
        const count = typeof result === "string" ? Number(text !== source.value) : result.removed;
        if (!count || text === source.value) continue;
        writePromptSource(source.key, text);
        changes += count;
      }
      if (changes) afterPromptWrite();
      return changes;
    } finally {
      writingPrompt = false;
    }
  }

  function setWeight(name, weight, { syncPrompt = true } = {}) {
    const value = Number(weight);
    setCachedWeight(name, value);
    if (selected.has(name)) selected.set(name, value);
    if (syncPrompt) rewritePrompt(name, (text) => replaceLoraWeight(text, name, value));
    return value;
  }

  function updateSelectedWeight(name, weight) {
    if (selected.has(name)) selected.set(name, Number(weight));
  }

  // The LoRA-change dialog already owns its temporary working copy. Unlike a
  // checkpoint restore, accepting it did not re-filter against a newer catalog.
  function replaceSelection(entries) {
    cancelScheduledSync();
    selected.clear();
    for (const [name, weight] of entries) {
      selected.set(name, Number(weight));
      setCachedWeight(name, Number(weight));
    }
  }

  function setSelected(name, isSelected, weight) {
    if (isSelected) {
      selected.set(name, Number(weight));
      const source = sources.get(name);
      sources.set(name, source === "prompt" || source === "both" ? "both" : "ui");
      return { removedTags: 0 };
    }
    selected.delete(name);
    sources.delete(name);
    disabled.delete(name);
    return { removedTags: rewritePrompt(name, (text) => removeLoraTags(text, name)) };
  }

  function syncFromPrompt() {
    cancelScheduledSync();
    if (reconciling || writingPrompt || !getCatalog().length) return false;
    reconciling = true;
    try {
      const text = readPromptSources().map((source) => source.value).join("\n");
      const result = reconcilePromptLoras(parseLoraTags(text), selectionSnapshot(), getCatalog());
      notices = buildLoraNotices(result);
      renderNotices(describeLoraNotices(result));
      if (!result.changed) return false;
      if (preserveSelectionOrder) {
        const order = new Map([...selected.keys()].map((name, index) => [name, index]));
        result.selected.sort((left, right) => (order.get(left.name) ?? Infinity) - (order.get(right.name) ?? Infinity));
      }
      selected.clear();
      sources.clear();
      for (const item of result.selected) {
        selected.set(item.name, item.weight);
        sources.set(item.name, item.source);
        setCachedWeight(item.name, item.weight);
      }
      persistWeights();
      renderLoras();
      renderSelection();
      return true;
    } finally {
      reconciling = false;
    }
  }

  function scheduleSync() {
    cancelScheduledSync();
    syncTimer = setTimer(syncFromPrompt, debounceMs);
  }

  function captureState() {
    return {
      selected: [...selected],
      sources: [...sources],
      disabled: [...disabled]
    };
  }

  function restoreState(snapshot) {
    cancelScheduledSync();
    selected.clear();
    sources.clear();
    disabled.clear();
    for (const [name, weight] of snapshot?.selected ?? []) selected.set(name, weight);
    for (const [name, source] of snapshot?.sources ?? []) sources.set(name, source);
    for (const name of snapshot?.disabled ?? []) disabled.add(name);
  }

  function restoreCheckpointSelection(loras = []) {
    cancelScheduledSync();
    selected.clear();
    const missing = [];
    const catalog = getCatalog();
    for (const lora of loras) {
      if (!catalog.some((item) => item.name === lora.name)) {
        missing.push(lora.name);
        continue;
      }
      selected.set(lora.name, Number(lora.weight));
      setCachedWeight(lora.name, Number(lora.weight));
    }
    return missing;
  }

  function restoreRecipeSelection(loras = []) {
    cancelScheduledSync();
    selected.clear();
    sources.clear();
    disabled.clear();
    const catalog = getCatalog();
    for (const lora of loras) {
      if (!catalog.some((item) => item.name === lora.name)) continue;
      selected.set(lora.name, Number(lora.weight));
      sources.set(lora.name, ["ui", "prompt", "both"].includes(lora.source) ? lora.source : "ui");
      setCachedWeight(lora.name, Number(lora.weight));
      if (lora.enabled === false) disabled.add(lora.name);
    }
  }

  function pruneMissing() {
    const available = new Set(getCatalog().map((item) => item.name));
    for (const name of selected.keys()) if (!available.has(name)) selected.delete(name);
  }

  function removeDisabledTags(prompt) {
    let result = String(prompt ?? "");
    for (const name of disabled) result = removeLoraTags(result, name).text;
    return result;
  }

  return {
    selectionSnapshot,
    getSelectedEntries: () => [...selected],
    getSelectedNames: () => [...selected.keys()],
    getSelectedOptions: (labelForName) => [...selected.keys()].map((name) => ({ value: name, label: labelForName(name) })),
    getWeight: (name) => selected.get(name),
    getSource: (name) => sources.get(name) ?? "ui",
    getNotices: () => notices.map(copyNotice),
    isSelected: (name) => selected.has(name),
    isDisabled: (name) => disabled.has(name),
    selectedCount: () => selected.size,
    fingerprintEntries: () => [...selected],
    setSelected,
    setWeight,
    updateSelectedWeight,
    replaceSelection,
    reorderSelection(names) {
      if (names.length !== selected.size || new Set(names).size !== selected.size || names.some((name) => !selected.has(name))) throw new Error("LoRA order must contain every selected LoRA exactly once");
      const values = names.map((name) => [name, selected.get(name)]);
      selected.clear();
      for (const [name, weight] of values) selected.set(name, weight);
    },
    rewriteWeightToPrompt: (name, weight) => rewritePrompt(
      name,
      (text) => replaceLoraWeight(text, name, weight)
    ),
    toggleDisabled(name) {
      if (disabled.has(name)) disabled.delete(name);
      else disabled.add(name);
      return !disabled.has(name);
    },
    syncFromPrompt,
    scheduleSync,
    cancelScheduledSync,
    captureState,
    restoreState,
    restoreCheckpointSelection,
    restoreRecipeSelection,
    // Prompt and selection are separate steps because the existing recipe
    // workflow restores unrelated settings between them. It remains in app.
    applyPromptSnapshot: (...args) => applyPromptSnapshot(...args),
    restorePromptSnapshot: (recipe) => restorePromptSnapshot(recipe),
    pruneMissing,
    removeDisabledTags
  };
}
