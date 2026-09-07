import * as http from "../core/http-client.js";
import { createRuntimeService } from "../core/runtime-service.js";
import { createGenerationDraft } from "./generation-draft.js";
import { buildGenerationRequest } from "../core/generation-request.js";
import { settingsWithCheckpoint, RECIPE_PARAMETER_KEYS } from "../core/generation-settings.js";
import { createRecentHistoryService } from "../core/recent-history-service.js";
import { createGenerationController } from "./generation-controller.js";
import { normalizeManualTitle, DEFAULT_TITLE_MODE } from "../history-title.js";
import { PROMPT_FIELDS } from "../structured-prompt.js";
import { createStudioSession } from "../core/studio-session.js";
import {findProfileForLora, createRegistryProfile} from "../lora-profiles.js";
import {listLoraOutfitChoices} from "../lora-outfit-selection.js";

const clone = (value) => structuredClone(value);
const parameterKeys = new Set([...RECIPE_PARAMETER_KEYS, "inpaintFullRes", "seed", "candidateCount"]);
function memoryStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) };
}

// Public DOM-free generation workspace. Construct once per app, never per panel.
// Production Studio uses this contract; legacy rollback keeps its own adapters.
export function createGenerateWorkspace({
  transport = { ...http, fetch: (...args) => globalThis.fetch(...args) },
  storage = globalThis.localStorage ?? memoryStorage(), timing,
  confirmRecovery = async () => false, persistSession = false
} = {}) {
  let disposed = false;
  let ready = false;
  let initPromise;
  let generation;
  let catalogs = { loras: [], samplers: [], schedulers: [] };
  let catalogRevision = 0;
  let catalogLoading = false;
  let catalogError = "";
  const favoriteWrites = new Map();
  let recipeRevision = 0;
  let reusing = false;
  let selectingModel = false;
  let maxSelected = 4;
  let defaultWeight = 0.7;
  let title = "";
  let contentRating = "general";
  let autoRetry = false;
  let cancelRequested = false;
  let lifecycle = { phase: "idle", job: null, error: null };
  let completed = null;
  let currentImage = null;
  let creation = {mode: "txt2img", source: null, mask: null, ipAdapter: null};
  const session = createStudioSession(storage);
  let restoring = true, persistenceError = "";
  const listeners = new Set();
  const draft = createGenerationDraft({ getCatalog: () => catalogs.loras });
  function getSnapshot() {
    return clone({ ready, runtime: runtime.getState(), catalogs,
      catalogState: { version: catalogRevision, loading: catalogLoading, error: catalogError, pendingFavorites: [...favoriteWrites.keys()] },
      prompt: draft.readPrompt(), parameters: draft.readParameters(), loras: draft.readLoras(),
      description: draft.readDescription(), title, contentRating, autoRetry,
      generation: { ...lifecycle, ...generation.getState(), cancelRequested },
      completed, currentImage, creation, persistenceError, recent: history.getState(), reusing, selectingModel });
  }
  function emit() {
    if (disposed) return;
    if (persistSession && ready && !restoring && !runtime.getState().switching && !selectingModel) {
      const saved = {draft: draft.capture(), runtimeId: runtime.getState().activeRuntimeId,
        checkpoint: runtime.getState().selectedCheckpoint?.title, completed, currentImage,
        activeJobId: ["done","failed","cancelled"].includes(lifecycle.job?.status) ? null : generation.getState().activeJobId, title, contentRating,
        creation: {mode: "txt2img", source: creation.source?.imageId ? creation.source : null, mask: null,
          ipAdapter: creation.ipAdapter?.referenceImageId ? creation.ipAdapter : null}};
      persistenceError = session.write(saved) ? "" : "制作状態を保存できません。ブラウザの保存容量・設定を確認してください。";
    }
    for (const listener of [...listeners]) {
      // A view failure must not change a committed Job or Runtime transaction.
      try { listener(getSnapshot()); } catch { /* isolate presentation subscribers */ }
    }
  }
  const error = (message) => {
    if (disposed) return;
    lifecycle = { ...lifecycle, error: message };
    emit();
  };
  function editable() {
    if (disposed) throw new Error("Workspace is disposed");
    if (!ready) throw new Error("Initialize the workspace first");
    if (generation.isBusy() || runtime.getState().switching || reusing || selectingModel) {
      throw new Error("Workspace is busy");
    }
  }
  function canGenerate() {
    editable();
    if (!runtime.isRuntimeSelectable(runtime.getState().activeRuntime) || !runtime.runtimeSupports(creation.mode)) {
      throw new Error(`Runtime does not support ${creation.mode} generation`);
    }
  }
  function weightValue(value) {
    if (!Number.isFinite(Number(value))) throw new Error("LoRA weight must be finite");
    return Number(value);
  }
  async function loadCatalogs(context = runtime.runtimeRequestContext()) {
    const revision = ++catalogRevision;
    catalogLoading = true; catalogError = ""; emit();
    try {
      const [loras, sampling] = await Promise.all([
        transport.getJson(runtime.runtimeApiUrl("/api/loras")),
        transport.getJson(runtime.runtimeApiUrl("/api/samplers"))
      ]);
      if (disposed || revision !== catalogRevision || !runtime.isRuntimeContextCurrent(context)) return false;
      catalogs = { loras: loras.loras ?? [], samplers: sampling.samplers ?? [], schedulers: sampling.schedulers ?? [] };
      draft.syncLoras();
      emit();
      return true;
    } catch (cause) {
      if (!disposed && revision === catalogRevision && runtime.isRuntimeContextCurrent(context)) { catalogError = cause.message; error(cause.message); }
      return false;
    } finally {
      if (!disposed && revision === catalogRevision) { catalogLoading = false; emit(); }
    }
  }
  async function setLoraFavorite(name, favorite) {
    if (disposed) throw new Error("Workspace is disposed");
    const item = catalogs.loras.find((lora) => lora.name === name);
    if (!item) throw new Error("Unknown LoRA");
    const context = runtime.runtimeRequestContext();
    const previous = favoriteWrites.get(name) ?? Promise.resolve();
    const pending = previous.catch(() => {}).then(async () => {
      if (disposed || !runtime.isRuntimeContextCurrent(context)) return false;
      let entry = catalogs.loras.find((lora) => lora.name === name)?.registry;
      if (!entry?.uid) entry = (await transport.postJson("/api/loras/registry/ensure", { relativeName: String(item.name).replaceAll("\\", "/"), displayName: item.displayName ?? "" })).entry;
      if (disposed || !runtime.isRuntimeContextCurrent(context)) return false;
      const response = await transport.fetch(`/api/loras/${encodeURIComponent(entry.uid)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ favorite: favorite === true }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      if (disposed || !runtime.isRuntimeContextCurrent(context)) return false;
      // PATCH's legacy catalog may belong to ReForge. Merge only the returned registry entry.
      catalogRevision += 1; catalogLoading = false;
      catalogs = { ...catalogs, loras: catalogs.loras.map((lora) => lora.name === name ? { ...lora, registry: { ...lora.registry, ...entry, ...data.entry, favorite: favorite === true } } : lora) };
      return true;
    });
    favoriteWrites.set(name, pending); emit();
    try { return await pending; }
    finally { if (favoriteWrites.get(name) === pending) favoriteWrites.delete(name); emit(); }
  }
  const runtime = createRuntimeService({
    storage, getJson: transport.getJson, postJson: transport.postJson,
    getGenerationBusy: () => generation?.isBusy() || selectingModel,
    showError: error,
    captureExternalSnapshot: () => ({ draft: draft.capture(), catalogs: clone(catalogs) }),
    restoreExternalSnapshot(saved) { draft.restore(saved.draft); catalogs = saved.catalogs; },
    loadExternalResources: (context) => [loadCatalogs(context)],
    onRuntimeUiChange: emit, onCheckpointCatalogChange: emit,
    onCheckpointSelectionSync: emit, onCheckpointSelectionFailure: (cause) => error(cause.message)
  });
  const history = createRecentHistoryService({ getJson: transport.getJson, onData: emit, onError: emit });
  const noop = () => {};
  const form = {
    readAutoRetry: () => autoRetry,
    getActiveRuntime: () => runtime.getState().activeRuntime,
    readContentRating: () => contentRating,
    readDescription: draft.readDescription,
    readCurrentPositivePrompt: draft.positive,
    readMode: () => creation.mode,
    readCandidateCount: () => draft.readParameters().candidateCount ?? 1,
    shouldRequestPrompt: (description) => Boolean(description) && !draft.positive().trim(),
    readRuntimePayload: runtime.runtimePayload,
    readTitlePayload: () => ({ title, titleMode: DEFAULT_TITLE_MODE, titleTemplate: "" }),
    readPromptPayload: draft.readPrompt,
    readSelectedLoras: () => { draft.syncLoras(); return draft.readLoras(); },
    readPromptBoosts: () => [],
    readInitImagePayload: () => creation.mode === "txt2img" || !creation.source ? {} : creation.source.imageId ? {initImageId: creation.source.imageId} : {initImage: creation.source.dataUrl},
    readInpaintPayload: () => creation.mode === "inpaint" ? {maskImage: creation.mask} : {},
    readIpAdapterPayload: () => creation.ipAdapter?.enabled ? {ipAdapter: creation.ipAdapter} : {}, readDerivationPayload: () => ({}),
    runtimeForGeneration: runtime.runtimeForGeneration, runtimeSupportsHires: value => value?.features?.hires === true,
    readRuntimePayloadFor: value => ({runtimeId: value.id}),
    readCurrentHiresSettings: () => Object.fromEntries(Object.entries(draft.readParameters()).filter(([key]) => key.startsWith("hires"))),
    readSettings: (overrides) => settingsWithCheckpoint(draft.readParameters(), runtime.getState().selectedCheckpoint, overrides)
  };
  async function requestPrompt(description) {
    const data = await transport.postJson("/api/prompt", { description, promptBoosts: [] });
    if (disposed) throw new Error("Workspace is disposed");
    draft.setPrompt({ positive: data.prompt, negative: data.negative_prompt });
    emit();
    return data;
  }
  generation = createGenerationController({ form, transport, timing,
    owners: {
      startQueuePolling: noop, // This service monitors its own Job; global Queue is a separate owner.
      requestPrompt, getLastGeneration: () => completed,
      hasReference: () => Boolean(creation.source), hasMask: () => Boolean(creation.mask),
      getSelectedCandidate: () => currentImage,
      presentFinal(record, image) { if (!disposed) { completed = clone(record); currentImage = clone(image); lifecycle = {...lifecycle, phase: "succeeded"}; emit(); } },
      syncLorasFromPrompt: draft.syncLoras, applyIpMetadata: noop,
      applyGeneratedPrompt: (data) => { if (!disposed) draft.applyGenerated(data); },
      setCandidates(record, images) {
        if (disposed) return;
        completed = clone(record);
        currentImage = clone(images?.[0] ?? null);
        lifecycle = { ...lifecycle, phase: "succeeded", error: null };
        emit();
      },
      loadHistory: () => disposed ? undefined : history.load()
    },
    ui: {
      onStateChange: emit,
      setJobProgress(job) {
        if (disposed) return;
        if (["done", "failed", "cancelled"].includes(job.status)) cancelRequested = false;
        lifecycle = { ...lifecycle, job: clone(job), phase: job.status === "failed" || job.status === "cancelled"
          ? job.status : "running" };
        emit();
      },
      showJob: noop, setCancelDisabled: noop, hideJob: noop,
      confirmRecovery, onRecoveryAccepted: noop,
      showError(message) {
        if (disposed) return;
        cancelRequested = false;
        lifecycle = { ...lifecycle, phase: lifecycle.job?.status === "cancelled" ? "cancelled" : "failed" };
        error(message);
      },
      clearError() { if (!disposed) lifecycle = { ...lifecycle, error: null }; },
      showEmpty: noop, restoreMode: noop,
      prepareCandidates() { cancelRequested = false; lifecycle = { phase: "preparing", job: null, error: null }; emit(); },
      setLoadingText: noop, setExplanation: noop, showResults: noop, presentBuiltPrompt: emit
    }
  });
  async function initialize() {
    if (disposed) throw new Error("Workspace is disposed");
    if (initPromise) return initPromise;
    initPromise = (async () => {
      runtime.init();
      const config = await transport.getJson("/api/config");
      let live;
      try { live = await transport.getJson("/api/runtimes"); } catch { /* same config fallback as legacy */ }
      if (disposed) return false;
      maxSelected = config.lora?.maxSelected ?? 4;
      defaultWeight = config.lora?.defaultWeight ?? 0.7;
      draft.setParameters({ seed: -1, candidateCount: 1, noiseSchedule: "Automatic",
        ...Object.fromEntries(Object.entries(config.defaults ?? {}).filter(([key]) => parameterKeys.has(key))) });
      runtime.configure(live?.runtimes ?? config.runtimes, live?.defaultRuntimeId ?? config.defaultRuntimeId);
      const results = await Promise.all([runtime.loadCheckpoints(), loadCatalogs(), history.load()]);
      if (disposed) return false;
      ready = results[0] && results[1]; // History failure does not prevent creating an image.
      const saved = persistSession ? session.read() : null;
      if (ready && saved) {
        if (saved.runtimeId && saved.runtimeId !== runtime.getState().activeRuntimeId) await runtime.selectRuntime(saved.runtimeId);
        if (saved.checkpoint && runtime.getState().installedCheckpoints.some(item => item.title === saved.checkpoint)) await runtime.selectCheckpoint(saved.checkpoint);
        try { draft.restore(saved.draft); creation = {...creation, ...saved.creation}; completed = saved.completed ?? null; currentImage = saved.currentImage ?? null; title = saved.title ?? ""; contentRating = saved.contentRating ?? "general"; }
        catch { error("保存された制作状態を読み込めませんでした。既存データは保持されています。"); }
      }
      restoring = false;
      if (ready && saved?.activeJobId) void generation.reattach(saved.activeJobId);
      emit();
      return ready;
    })();
    try { return await initPromise; }
    catch (cause) { error(cause.message); throw cause; }
    finally { if (!ready) initPromise = null; }
  }
  async function reuseMetadata(recipe, image) {
    // Only the latest asynchronous metadata action may commit. User edits also
    // invalidate a pending fetch; this method itself is short after Runtime settles.
    editable();
    const version = ++recipeRevision;
    reusing = true;
    emit();
    try {
      if (!image || image.seed === undefined) throw new Error("Recipe reuse requires an image seed");
      const target = runtime.runtimeForGeneration(recipe);
      if (!target) throw new Error("履歴のRuntimeは現在利用できません");
      if (!await runtime.selectRuntime(target.id)) return false;
      if (disposed || version !== recipeRevision) return false;
      const saved = draft.capture(); // Successful Runtime selection is already committed.
      try {
        draft.reuse(recipe, image);
        title = normalizeManualTitle(recipe.title);
        contentRating = recipe.contentRating === "nsfw" ? "nsfw" : "general";
      } catch (cause) { draft.restore(saved); throw cause; }
      return { applied: true, scope: "prompt-parameters-loras", excluded: ["checkpoint", "mode", "source", "mask", "ipAdapter", "derivation"] };
    } finally {
      if (version === recipeRevision) reusing = false;
      emit();
    }
  }
  function mutate(callback) { editable(); recipeRevision += 1; callback(); emit(); }
  return {
    initialize, getSnapshot,
    loraPromptChoices(name) {
      const item = catalogs.loras.find(lora => lora.name === name);
      return listLoraOutfitChoices(findProfileForLora(item) ?? createRegistryProfile(item));
    },
    async applyCheckpointSet(set) {
      editable(); selectingModel = true; const version = ++recipeRevision; emit();
      try {
        if (!runtime.getState().installedCheckpoints.some(item => item.title === set.checkpoint)) throw new Error("セットのCheckpointは現在のRuntimeにありません");
        if (runtime.getState().selectedCheckpoint?.title !== set.checkpoint && !await runtime.selectCheckpoint(set.checkpoint)) return false;
        if (disposed || version !== recipeRevision) return false;
        const saved = draft.capture();
        try {
          for (const lora of set.loras ?? []) if (!catalogs.loras.some(item => item.name === lora.name)) throw new Error(`LoRAがありません: ${lora.name}`);
          draft.setParameters(Object.fromEntries(Object.entries(set.settings ?? {}).filter(([key]) => parameterKeys.has(key))));
          if (set.prompt) draft.setPrompt({positive: set.prompt});
          if (set.negativePrompt !== undefined) draft.setPrompt({negative: set.negativePrompt});
          for (const lora of draft.readLoras()) draft.removeLora(lora.name);
          for (const lora of set.loras ?? []) draft.addLora(lora.name, weightValue(lora.weight), {triggerWords: "", negativeWords: ""});
        } catch (cause) { draft.restore(saved); throw cause; }
        return true;
      } finally { selectingModel = false; emit(); }
    },
    setCreation(patch) {
      if (patch.mode && !["txt2img", "img2img", "inpaint"].includes(patch.mode)) throw new Error("Unknown creation mode");
      if (patch.mode && patch.mode !== "txt2img" && !runtime.getState().activeRuntime?.features?.[patch.mode]) throw new Error("現在のRuntimeではこの編集modeを利用できません");
      if (patch.ipAdapter?.enabled && !runtime.getState().activeRuntime?.features?.ipAdapter) throw new Error("現在のRuntimeではIP-Adapterを利用できません");
      mutate(() => { creation = {...creation, ...clone(patch)}; });
    },
    finishHires() { editable(); return generation.finishSelected(); },
    setLoraFavorite,
    async refreshLoras() {
      if (disposed) throw new Error("Workspace is disposed");
      // Finish local registry writes before fetching a fresh shared catalog.
      await Promise.allSettled([...favoriteWrites.values()]);
      if (disposed) return false;
      return loadCatalogs();
    },
    async refreshCatalogs() {
      if (!ready) return initialize();
      editable();
      selectingModel = true; emit();
      try { const results = await Promise.all([runtime.loadCheckpoints(), loadCatalogs()]); return results.every(Boolean); }
      finally { selectingModel = false; emit(); }
    },
    subscribe(listener) {
      if (disposed) throw new Error("Workspace is disposed");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setPrompt: (value) => mutate(() => draft.setPrompt(value)),
    setDescription: (value) => mutate(() => draft.setDescription(value)),
    setParameters(patch) {
      if (Object.keys(patch).some((key) => !parameterKeys.has(key))) throw new Error("Unknown generation parameter");
      mutate(() => draft.setParameters(patch));
    },
    setAutoRetry: (value) => mutate(() => { autoRetry = value === true; }),
    addLora(name, weight = defaultWeight, { includeTriggers = true } = {}) {
      const item = catalogs.loras.find((lora) => lora.name === name);
      if (!item) throw new Error("Unknown LoRA");
      const selected = draft.readLoras();
      if (!selected.some((lora) => lora.name === name) && selected.length >= maxSelected) throw new Error("Too many LoRAs");
      mutate(() => draft.addLora(name, weightValue(weight), { triggerWords: includeTriggers ? item.registry?.triggerWords ?? "" : "", negativeWords: "" }));
    },
    setLoraWeight(name, weight) {
      if (!draft.readLoras().some((lora) => lora.name === name)) throw new Error("LoRA is not selected");
      mutate(() => draft.setLoraWeight(name, weightValue(weight)));
    },
    removeLora: (name) => mutate(() => draft.removeLora(name)),
    toggleLora: (name) => mutate(() => draft.toggleLora(name)),
    reorderLoras: (names) => mutate(() => draft.reorderLoras(names)),
    insertLoraTrigger(name, field, choiceId = "") {
      const item = catalogs.loras.find((lora) => lora.name === name);
      const choices = choiceId ? listLoraOutfitChoices(findProfileForLora(item) ?? createRegistryProfile(item)) : [];
      const text = choiceId ? choices.find(choice => choice.id === choiceId)?.prompt : item?.registry?.triggerWords?.trim();
      if (!text) throw new Error("Trigger words are unavailable");
      mutate(() => {
        const prompt = draft.readPrompt();
        const append = (value) => `${value}${value.trim() ? ", " : ""}${text}`;
        if (field === "raw" && prompt.rawPromptOverride) draft.setPrompt({ positive: append(prompt.rawPrompt) });
        else if (PROMPT_FIELDS.includes(field) && !prompt.rawPromptOverride) draft.setPrompt({ sections: { ...prompt.structuredPrompt, [field]: append(prompt.structuredPrompt[field]) } });
        else throw new Error("Choose a section in the current Prompt mode");
      });
    },
    async selectRuntime(id) {
      editable(); recipeRevision += 1;
      const selected = await runtime.selectRuntime(id);
      if (selected) {
        const features = runtime.getState().activeRuntime?.features ?? {};
        if (!features[creation.mode]) creation.mode = "txt2img";
        if (!features.ipAdapter) creation.ipAdapter = null;
        emit();
      }
      return selected;
    },
    async selectModel(title) {
      editable(); recipeRevision += 1;
      if (!runtime.getState().installedCheckpoints.some((item) => item.title === title)) throw new Error("Unknown model");
      lifecycle = { ...lifecycle, error: null };
      selectingModel = true; emit();
      try { return await runtime.selectCheckpoint(title); }
      finally { selectingModel = false; emit(); }
    },
    buildRequest() {
      canGenerate();
      draft.syncLoras();
      return clone(buildGenerationRequest(form, draft.readDescription(), Number(form.readCandidateCount())));
    },
    async generate() { canGenerate(); recipeRevision += 1; return generation.generateCandidates(); },
    async cancel() {
      if (disposed || cancelRequested || !generation.getState().activeJobId || ["done", "failed", "cancelled"].includes(lifecycle.job?.status)) return;
      cancelRequested = true; emit();
      return generation.cancel();
    },
    async loadRecent(filter) { if (disposed) throw new Error("Workspace is disposed"); const pending = history.load(filter); emit(); return pending; },
    reuseMetadata,
    async reuseImage(imageId) {
      editable();
      const version = ++recipeRevision;
      const data = await transport.getJson(`/api/history/${encodeURIComponent(imageId)}/recipe`);
      if (disposed || version !== recipeRevision) return false;
      return reuseMetadata(data, data.selectedImage);
    },
    selectImage(imageId) {
      if (disposed) throw new Error("Workspace is disposed");
      const image = completed?.images?.find((item) => item.id === imageId);
      if (!image) throw new Error("Unknown completed image");
      currentImage = clone(image); emit();
    },
    dispose() {
      disposed = true; ready = false; recipeRevision += 1; catalogRevision += 1;
      generation.dispose(); runtime.dispose(); history.dispose(); draft.dispose(); listeners.clear();
    }
  };
}
