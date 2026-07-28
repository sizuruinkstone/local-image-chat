import {
  LORA_PROFILES,
  createRegistryProfile,
  findProfileForLora,
  getPreset,
  getProfile
} from "./lora-profiles.js";
import {
  CHECKPOINT_PROFILES,
  assessLoraCompatibility,
  getCheckpointProfile,
  inferCheckpointProfile
} from "./checkpoint-profiles.js";
import { confirmModal, copyToClipboard, flashLabel, openModal, toast, withBusy } from "./ui-kit.js";
import { openLoraEditor } from "./lora-editor.js";
import { describeRetryInfo, openCompareView } from "./compare-view.js";
import { buildMetadataText, buildPromptText } from "./metadata-format.js";
import { buildQueuePanel, summarizeQueue } from "./queue-view.js";
import {
  NEW_FOLDER_VALUE,
  buildFolderGroups,
  isFavoriteFolder,
  normalizeFavorites,
  normalizeFolder,
  normalizeFolderMemory,
  pickInitialFolder,
  rememberRecentFolder,
  toggleFavoriteFolder
} from "./civitai-folders.js";
import {
  compatibilityFilterAllows,
  getRecommendedWeight,
  hasLoraPreview,
  isCompatibilityFilter,
  resolveLoraPreviewUrl,
  shouldApplyRecommendedWeight
} from "./lora-preview.js";
import {
  APP_VIEWS,
  hashForView,
  normalizeAppView,
  viewFromHash
} from "./view-router.js";
import {
  SAMPLER_PRESETS,
  buildOptionSections,
  describeSamplerPreset,
  isActivePreset,
  isFavoriteOption,
  rememberRecentOption,
  toggleFavoriteOption
} from "./option-picker.js";
import {
  MAX_CANDIDATE_COUNT,
  MIN_CANDIDATE_COUNT,
  PRESET_CATEGORY_LABELS,
  buildCharacterPresets,
  buildGroups,
  buildLoraCatalog,
  buildOutfitPresets,
  clampCandidateCount,
  filterPresets,
  isValidCandidateCount,
  splitTriggerPreview
} from "./preset-catalog.js";
import {
  collectCheckpoints,
  collectLoras,
  describeGalleryFilter,
  filterGalleryEntries,
  toGalleryEntries
} from "./gallery-filter.js";
import {
  buildLoraNotices,
  describeLoraNotices,
  hasLoraTag,
  parseLoraTags,
  reconcilePromptLoras,
  removeLoraTags,
  replaceLoraWeight
} from "./lora-tags.js";
import {
  DEFAULT_GROK_INSTRUCTIONS,
  buildGrokRequestText,
  mergePromptValue,
  parseAiPromptOutput
} from "./prompt-import.js";
import {
  PROMPT_FIELDS,
  PROMPT_FIELD_LABELS,
  appendTriggersToRawPrompt,
  buildFinalPrompt,
  formatTriggerWord,
  hasSectionContent,
  normalizeAppliedTriggerWords,
  normalizeSections,
  normalizeTriggerWeight,
  pendingTriggerWords,
  syncTriggerWords,
  triggerKey,
  triggersForField
} from "./structured-prompt.js";

const PROFILE_STORAGE_VERSION = 3;
const MAX_INIT_IMAGE_BYTES = 20 * 1024 * 1024;

const elements = Object.fromEntries(
  [
    "health", "healthButton", "description", "promptButton", "generateButton",
    "prompt", "negativePrompt", "width", "height", "steps", "cfgScale", "seed",
    "samplerName", "scheduler", "noiseSchedule", "candidateCount", "hiresScale", "hiresSteps",
    "hiresDenoising", "hiresUpscaler", "emptyState", "loading", "loadingText",
    "resultTab",
    "resultContent", "candidateSection", "candidateGrid", "candidateSummary",
    "selectedSeedText", "finishButton", "finalResult", "resultImage", "seedText",
    "resolutionText", "downloadLink", "explanation", "error", "loraSearch",
    "loraList", "loraStatus", "loraSelectedCount", "selectedLoraSummary",
    "loraCompatibilityFilter", "loraPreview",
    "refreshLorasButton", "loraCategories", "versionText", "jobBar", "jobMessage",
    "checkpointDetails", "checkpointSelect", "refreshCheckpointsButton", "checkpointStatus",
    "checkpointFamilyBadge", "checkpointProfileSelect", "checkpointAutoApply",
    "checkpointProfileSummary", "checkpointSetSelect", "checkpointSetAutoApply",
    "saveCheckpointSetButton", "applyCheckpointSetButton", "renameCheckpointSetButton",
    "duplicateCheckpointSetButton", "deleteCheckpointSetButton", "checkpointSetStatus",
    "jobProgressText", "jobProgress", "cancelJobButton", "stylePreset",
    "compositionPreset", "lightingPreset", "moodPreset", "outfitOverride", "applyPreferenceButton",
    "clearPromptPartsButton", "promptPartsSummary", "compositionLockStatus",
    "unlockCompositionButton", "lockCompositionButton", "favoriteFinalButton",
    "reuseFinalButton", "civitaiDetails", "civitaiUrl", "civitaiCategory",
    "civitaiFolder", "civitaiFolderFavorite", "civitaiFolderPath",
    "civitaiNewFolder", "civitaiNewFolderRow",
    "loraRootPath", "loraRootBadge", "openLoraRootButton", "autoRetryOnFailure",
    "experimentDetails", "experimentBadge", "experimentParameter", "experimentTarget",
    "experimentTargetRow", "experimentValues", "experimentFixSeed", "runExperimentButton",
    "cancelExperimentButton", "openExperimentsButton", "experimentStatus", "experimentProgress",
    "civitaiToken", "inspectCivitaiButton", "installCivitaiButton",
    "refreshCivitaiRegistrationsButton",
    "civitaiPreview", "civitaiStatus", "updateStatusButton", "updateDetails",
    "githubToken", "checkUpdateButton", "applyUpdateButton", "updateStatus",
    "refreshHistoryButton", "preferenceSummary", "historyGrid",
    "compareSelectionButton", "experimentGrid", "refreshExperimentsButton",
    "txt2imgModeButton", "img2imgModeButton", "inpaintModeButton", "img2imgPanel", "img2imgDropZone",
    "initImageInput", "initImageEmpty", "initImagePreview", "chooseInitImageButton",
    "clearInitImageButton", "initImageStatus", "img2imgPreset", "img2imgDenoising",
    "img2imgDenoisingValue", "img2imgResizeMode", "syncInitImageSize", "img2imgSettings",
    "inpaintPanel", "inpaintCanvasStage", "inpaintMaskEmpty", "inpaintBaseImage",
    "inpaintMaskCanvas", "maskStatus", "maskPaintButton", "maskEraseButton",
    "maskUndoButton", "maskRedoButton", "maskClearButton", "maskBrushSize",
    "maskBrushSizeValue", "inpaintDenoising", "inpaintDenoisingValue", "maskBlur",
    "inpaintFill", "inpaintFullRes", "inpaintFullResPadding",
    "sendFinalToImg2ImgButton", "sendFinalToInpaintButton", "finalEyebrow", "finalTitle",
    "queueIndicator", "queueIndicatorText", "clearPromptButton", "clearNegativePromptButton",
    "clearPromptsButton", "clearSeedButton", "clearCivitaiUrlButton",
    "promptDetails", "structuredPromptTabButton", "rawPromptTabButton",
    "structuredPromptPanel", "rawPromptPanel", "structuredPromptPreview",
    "rawPromptNotice", "rawPromptNoticeText", "useStructuredPromptButton",
    "rawTriggerNotice", "rawTriggerNoticeText", "appendTriggersToRawButton",
    "promptCharacter", "promptAppearance", "promptComposition", "promptSituation",
    "promptStyle", "promptExtra",
    "triggerListCharacter", "triggerListAppearance", "triggerListComposition",
    "triggerListSituation", "triggerListStyle", "triggerListExtra",
    "discordDetails", "discordAutoSend", "discordWebhook", "discordIncludePrompt",
    "discordIncludeMetadata", "saveDiscordSettingsButton", "clearDiscordWebhookButton",
    "discordSettingsStatus", "finalDiscordStatus", "importAiPromptButton", "loraSyncNotice",
    "copyGrokShareButton", "updateShareCsvButton", "shareBarStatus",
    "mainNav", "viewGenerate", "viewGallery", "viewCompare", "viewSettings",
    "generateActions", "generateProgress", "generateProgressText", "cancelGenerateButton",
    "showCombinedPromptButton", "compareShortcutDetails", "compareShortcutParameter",
    "compareShortcutValues", "compareShortcutButton",
    "generationSettingsDetails", "advancedSettingsDetails", "samplerPresets",
    "samplerPickerButton", "samplerPickerValue", "schedulerPickerButton", "schedulerPickerValue",
    "loraUseDetails", "loraUseCount", "usedLoraList", "addLoraButton",
    "addCivitaiLoraButton", "candidateCountDown", "candidateCountUp",
    "pickCharacterButton", "pickOutfitButton", "regenerateFinalButton", "openInGalleryButton", "galleryKindFilter", "galleryCheckpoint", "galleryLora",
    "galleryPeriod", "gallerySearch", "galleryFilterSummary", "resetGalleryFilterButton",
    "mobileAccessDetails", "mobileAccessStatus",
    "promptTemplateDetails", "grokInstructions", "grokSetupDoc", "grokLoraCsv",
    "copyGrokTemplateButton", "saveGrokTemplateButton", "generateLoraCsvButton",
    "resetGrokInstructionsButton", "grokTemplateStatus"
  ].map((id) => [id, document.getElementById(id)])
);

// 用途別プロンプトの入力欄・トリガーワード表示枠と、要素IDの対応。
const PROMPT_FIELD_ELEMENTS = {
  character: "promptCharacter",
  appearance: "promptAppearance",
  composition: "promptComposition",
  situation: "promptSituation",
  style: "promptStyle",
  extra: "promptExtra"
};

const DISCORD_STATUS_LABELS = {
  sending: "★ Discord送信中…",
  sent: "★ Discord送信済み",
  failed: "★ Favorite済み・Discord送信失敗"
};

// 画像IDごとのDiscord送信状態。履歴の再描画で作り直されるバッジもここから読む。
const discordStates = new Map();
const discordWatchers = new Set();

// LoRAトリガーワード一覧の開閉状態（項目ごと）。既定は折りたたみ。
const triggerPanelOpen = new Map();
const TRIGGER_PREVIEW_COUNT = 2;
// トップレベル画面と、その表示領域の要素ID。
// 初期化（画面復元）より前に評価されている必要があるため、ここで定義する。
const VIEW_ELEMENTS = {
  generate: "viewGenerate",
  gallery: "viewGallery",
  compare: "viewCompare",
  settings: "viewSettings"
};

// AI出力から取り込んだトリガーワードの由来ID（LoRA名と混ざらない形にする）。
const IMPORT_SOURCE_PREFIX = "import:";
// プロンプト入力中に同期を走らせすぎないための待ち時間。
const LORA_SYNC_DEBOUNCE = 400;
let loraSyncTimer = null;
// AI共有CSVの自動更新も、続けて走らせない。
const SHARE_SYNC_DEBOUNCE = 1500;
let shareSyncTimer = null;

const TRIGGER_LIST_ELEMENTS = {
  character: "triggerListCharacter",
  appearance: "triggerListAppearance",
  composition: "triggerListComposition",
  situation: "triggerListSituation",
  style: "triggerListStyle",
  extra: "triggerListExtra"
};

let promptDescription = "";
let selectedCandidate = null;
let lastGeneration = null;
let settingPromptProgrammatically = false;
// 用途別プロンプト（分割入力）とRaw Promptの状態。
// rawPromptOverride が true の間は、分割入力ではなくRaw Promptを生成へ使う。
let appliedTriggerWords = [];
let rawPromptOverride = false;
let rawPromptOverrideSource = "manual";
let promptMode = "structured";
let installedLoras = [];
let loraConfig = { defaultWeight: 0.7, maxSelected: 4 };
let activeJobId = null;
let compositionLock = null;
let finalImage = null;
let finalGeneration = null;
let preferenceData = { favoriteCount: 0, topTags: [], topLoras: [], topSettings: [] };
let preferenceBoosts = [];
let inspectedCivitai = null;
let civitaiFolders = [];
let civitaiFolderDefaults = { character: "Characters", style: "Style", body: "Body", pose: "Pose" };
let civitaiRecommendedFolders = {};
let civitaiRecentFolders = normalizeFolderMemory(readJsonStorage("localImageChat.civitaiRecentFolders"));
let civitaiFavoriteFolders = normalizeFavorites(readJsonStorage("localImageChat.civitaiFavoriteFolders", []));
const CIVITAI_NEW_FOLDER = NEW_FOLDER_VALUE;
let updateInfo = null;
let loraRootInfo = { root: "", source: "", label: "", warning: "" };
let knownExperiments = [];
let experimentParameters = {};
let experimentLimits = { maxImages: 8, hardLimit: 12 };
let activeExperimentId = null;
let experimentPolling = false;
let checkpointSets = [];
// 「ユーザーが編集中か」を判定するための、最後に適用した設定のスナップショット。
let appliedSettingsFingerprint = null;
let historyEntries = [];
// 表示中のトップレベル画面。生成の進行状況はサーバー側のジョブが持つので、
// ここを切り替えても生成は止まらない。
let currentView = "generate";
// ギャラリーの絞り込み条件（画面側だけの状態。履歴データは変えない）。
let galleryFilter = { kind: "all", checkpoint: "", lora: "", period: "", query: "" };
// Sampler / Scheduler の候補一覧（ReForgeから取得、失敗時は既定値）。
let samplerOptions = { samplers: [], schedulers: [] };
// 直近に取得した履歴。絞り込みのたびに取り直さないよう保持する。
let lastHistoryGenerations = [];
// 選択したまま「今回は使わない」LoRA（ON/OFF）。選択自体は保持する。
const disabledLoras = new Set();
const compareSelection = new Map();
// 次の生成が「どの派生操作から来たか」を履歴へ残すための一時情報。
let pendingDerivation = null;
let installedCheckpoints = [];
let activeCheckpoint = null;
let activeLoraCategory = loadLoraCategory();
let pinnedLoraName = null;
let displayedLoraName = null;
// Seedの「ランダム」はアプリ全体で-1。空欄と同じ扱いにはしない。
const RANDOM_SEED = "-1";
// ヘッダー右上のキュー表示。サーバーのジョブ状態が正で、画面はそれを映すだけ。
// 起動処理より前に評価されるよう、定数もここへ置く。
const QUEUE_POLL_INTERVAL = 1200;
// 完了・失敗の表示を少し残してから停止する（1.2秒 × 8回 ≒ 10秒）。
const QUEUE_IDLE_TICKS = 8;
const QUEUE_TERMINAL_STATUSES = ["done", "completed", "failed", "cancelled"];
let queueSnapshot = { generation: [], comparison: [], summary: { activeCount: 0 } };
let queuePolling = false;
let queuePanel = null;
let queueSeenTerminal = null;
// Clear PromptsのUndo用スナップショット。
let clearedPromptSnapshot = null;
// Seedクリアボタンの表示同期（setupClearableFieldsで実体を入れる）。
let syncSeedClearButton = () => {};
let generationMode = "txt2img";
let initImageReference = null;
let defaultInpaintFullRes = true;
let maskDrawing = false;
let maskLastPoint = null;
let maskTool = "paint";
let maskSourceKey = "";
let maskUndoStack = [];
let maskRedoStack = [];
const MAX_MASK_HISTORY = 12;
const selectedLoras = new Map();
// LoRAごとの選択元: "ui"（UI操作）/ "prompt"（プロンプト内タグ）/ "both"
const loraSelectionSources = new Map();
// 直近のLoRAタグ同期で出た警告（重複・未インストールなど）。履歴へも保存する。
let loraSyncNotices = [];
const loraWeights = loadLoraWeights();
const loraTriggers = loadLoraTriggers();
const loraNegativeWords = loadStringMap("localImageChat.loraNegativeWords");
const loraProfileAssignments = loadStringMap("localImageChat.loraProfileAssignments");
const loraPresetSelections = loadStringMap("localImageChat.loraPresetSelections");
const loraAddonSelections = loadStringMap("localImageChat.loraAddonSelections");
const checkpointProfileAssignments = loadStringMap("localImageChat.checkpointProfileAssignments");

await loadConfig();
initializeCheckpointControls();
loadImg2ImgPreferences();
loadInpaintPreferences();
loadPromptPartSelections();
restoreSessionSecrets();
registerServiceWorker();
setupPromptFieldAccordions();
setPromptMode(promptMode);
renderTriggerLists();
renderPromptModeState();
syncRawPromptFromSections();
await Promise.all([
  checkHealth(), loadCheckpoints(), loadLoras(), loadHistory(), loadCivitaiFolders(), loadLoraRoot(),
  loadExperiments(), loadCheckpointSets(), loadDiscordSettings(), loadPromptTemplate(),
  loadShareState(), loadSamplerOptions()
]);
markSettingsApplied();
setGenerationMode("txt2img");
updateGenerateButton();
setupClearableFields();
// 再読み込み後も、サーバー側で走っているジョブを拾って右上へ表示する。
startQueuePolling();

elements.healthButton.addEventListener("click", checkHealth);
elements.promptButton.addEventListener("click", buildPrompt);
elements.generateButton.addEventListener("click", generateCandidates);
elements.finishButton.addEventListener("click", finishSelected);
elements.mainNav.addEventListener("click", (event) => {
  const button = event.target.closest("[data-view]");
  if (button) showView(button.dataset.view);
});
window.addEventListener("hashchange", () => {
  const view = viewFromHash(location.hash);
  if (view && view !== currentView) showView(view, { remember: false });
});
// 生成結果（Hires仕上げ）画像のクリックで拡大モーダルを開く。
elements.resultImage.addEventListener("click", () => {
  if (finalImage) openImageModal(finalImage.imageUrl, elements.finalTitle.textContent || `Seed ${finalImage.seed}`);
});
elements.txt2imgModeButton.addEventListener("click", () => setGenerationMode("txt2img"));
elements.img2imgModeButton.addEventListener("click", () => setGenerationMode("img2img"));
elements.inpaintModeButton.addEventListener("click", () => setGenerationMode("inpaint"));
elements.chooseInitImageButton.addEventListener("click", () => elements.initImageInput.click());
elements.initImageInput.addEventListener("change", () => {
  const [file] = elements.initImageInput.files ?? [];
  if (file) void loadInitImageFile(file);
});
elements.clearInitImageButton.addEventListener("click", clearInitImageReference);
elements.img2imgPreset.addEventListener("change", handleImg2ImgPresetChange);
elements.img2imgDenoising.addEventListener("input", handleImg2ImgDenoisingInput);
elements.img2imgResizeMode.addEventListener("change", saveImg2ImgPreferences);
elements.syncInitImageSize.addEventListener("change", () => {
  saveImg2ImgPreferences();
  if (elements.syncInitImageSize.checked && initImageReference?.width && initImageReference?.height) {
    syncResolutionToReference(initImageReference.width, initImageReference.height);
  }
});
elements.maskPaintButton.addEventListener("click", () => setMaskTool("paint"));
elements.maskEraseButton.addEventListener("click", () => setMaskTool("erase"));
elements.maskUndoButton.addEventListener("click", undoMask);
elements.maskRedoButton.addEventListener("click", redoMask);
elements.maskClearButton.addEventListener("click", () => clearMask());
elements.maskBrushSize.addEventListener("input", updateMaskBrushSize);
elements.inpaintDenoising.addEventListener("input", handleInpaintSettingsChange);
for (const element of [
  elements.maskBlur, elements.inpaintFill, elements.inpaintFullRes, elements.inpaintFullResPadding
]) {
  element.addEventListener("change", handleInpaintSettingsChange);
}
elements.inpaintMaskCanvas.addEventListener("pointerdown", beginMaskStroke);
elements.inpaintMaskCanvas.addEventListener("pointermove", continueMaskStroke);
for (const eventName of ["pointerup", "pointercancel", "pointerleave"]) {
  elements.inpaintMaskCanvas.addEventListener(eventName, endMaskStroke);
}
for (const eventName of ["dragenter", "dragover"]) {
  elements.img2imgDropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.img2imgDropZone.classList.add("dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  elements.img2imgDropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.img2imgDropZone.classList.remove("dragging");
  });
}
elements.img2imgDropZone.addEventListener("drop", (event) => {
  const [file] = event.dataTransfer?.files ?? [];
  if (file) void loadInitImageFile(file);
});
elements.lockCompositionButton.addEventListener("click", lockSelectedComposition);
elements.reuseFinalButton.addEventListener("click", () => {
  if (finalGeneration && finalImage) activateCompositionLock(finalGeneration, finalImage);
});
elements.favoriteFinalButton.addEventListener("click", () => {
  if (finalImage) void toggleFavorite(finalImage, elements.favoriteFinalButton);
});
elements.sendFinalToImg2ImgButton.addEventListener("click", () => {
  if (finalImage) useImageForImg2Img(finalImage);
});
elements.sendFinalToInpaintButton.addEventListener("click", () => {
  if (finalImage) useImageForInpaint(finalImage);
});
elements.regenerateFinalButton.addEventListener("click", () => {
  if (finalGeneration && finalImage) regenerateWithSameSeed(finalGeneration, finalImage);
});
elements.openInGalleryButton.addEventListener("click", () => {
  showView("gallery");
  if (finalGeneration && finalImage) openHistoryDetail(finalGeneration, finalImage);
});
elements.unlockCompositionButton.addEventListener("click", unlockComposition);
elements.cancelJobButton.addEventListener("click", cancelActiveJob);
elements.queueIndicator.addEventListener("click", openQueuePanel);
elements.clearPromptsButton.addEventListener("click", clearBothPrompts);
elements.candidateCount.addEventListener("change", normalizeCandidateCount);
elements.description.addEventListener("input", handleDescriptionChange);
elements.prompt.addEventListener("input", handleRawPromptInput);
elements.negativePrompt.addEventListener("input", () => {
  markPromptAsCurrent();
  renderPromptFieldPreviews();
});
elements.structuredPromptTabButton.addEventListener("click", () => setPromptMode("structured"));
elements.rawPromptTabButton.addEventListener("click", () => setPromptMode("raw"));
elements.useStructuredPromptButton.addEventListener("click", useStructuredPrompt);
elements.appendTriggersToRawButton.addEventListener("click", appendTriggersToRaw);
for (const field of PROMPT_FIELDS) {
  promptFieldElement(field).addEventListener("input", handleStructuredPromptInput);
}
elements.loraSearch.addEventListener("input", renderLoras);
elements.loraCompatibilityFilter.value = loadLoraCompatibilityFilter();
elements.loraCompatibilityFilter.addEventListener("change", () => {
  saveLoraCompatibilityFilter();
  renderLoras();
});
elements.refreshLorasButton.addEventListener("click", () => loadLoras(true));
elements.refreshCheckpointsButton.addEventListener("click", loadCheckpoints);
elements.checkpointSelect.addEventListener("change", switchSelectedCheckpoint);
elements.checkpointProfileSelect.addEventListener("change", handleCheckpointProfileChange);
elements.checkpointSetSelect.addEventListener("change", syncCheckpointSetControls);
elements.checkpointSetAutoApply.addEventListener("change", toggleCheckpointSetAutoApply);
elements.saveCheckpointSetButton.addEventListener("click", saveCurrentCheckpointSet);
elements.applyCheckpointSetButton.addEventListener("click", () => void applyCheckpointSet(selectedCheckpointSet()));
elements.renameCheckpointSetButton.addEventListener("click", renameCheckpointSet);
elements.duplicateCheckpointSetButton.addEventListener("click", duplicateCheckpointSet);
elements.deleteCheckpointSetButton.addEventListener("click", deleteCheckpointSet);
elements.checkpointAutoApply.addEventListener("change", () => {
  localStorage.setItem("localImageChat.checkpointAutoApply", String(elements.checkpointAutoApply.checked));
});
elements.openLoraRootButton.addEventListener("click", openLoraRootFolder);
elements.experimentParameter.addEventListener("change", syncExperimentTargetVisibility);
elements.runExperimentButton.addEventListener("click", runExperiment);
elements.cancelExperimentButton.addEventListener("click", cancelExperiment);
elements.openExperimentsButton.addEventListener("click", () => openGalleryExperiments());
elements.inspectCivitaiButton.addEventListener("click", inspectCivitai);
elements.installCivitaiButton.addEventListener("click", installCivitai);
elements.refreshCivitaiRegistrationsButton.addEventListener("click", refreshCivitaiRegistrations);
elements.civitaiUrl.addEventListener("input", () => {
  inspectedCivitai = null;
  elements.installCivitaiButton.disabled = true;
});
elements.civitaiCategory.addEventListener("change", () => applyCategoryFolder(elements.civitaiCategory.value));
elements.civitaiFolder.addEventListener("change", onCivitaiFolderChange);
elements.civitaiFolderFavorite.addEventListener("click", toggleCivitaiFolderFavorite);
elements.civitaiNewFolder.addEventListener("input", refreshCivitaiFolderHint);
elements.copyGrokShareButton.addEventListener("click", copyGrokShare);
elements.updateShareCsvButton.addEventListener("click", updateShareCsv);
elements.importAiPromptButton.addEventListener("click", openAiPromptImport);
elements.copyGrokTemplateButton.addEventListener("click", copyGrokTemplate);
elements.saveGrokTemplateButton.addEventListener("click", () => void savePromptTemplate());
elements.generateLoraCsvButton.addEventListener("click", updateLoraCsvFromInstalled);
elements.resetGrokInstructionsButton.addEventListener("click", resetGrokInstructions);
elements.saveDiscordSettingsButton.addEventListener("click", saveDiscordSettings);
elements.clearDiscordWebhookButton.addEventListener("click", clearDiscordWebhook);
elements.checkUpdateButton.addEventListener("click", checkForUpdate);
elements.applyUpdateButton.addEventListener("click", applyUpdate);
elements.updateStatusButton.addEventListener("click", () => {
  elements.updateDetails.open = true;
  elements.updateDetails.scrollIntoView({ behavior: "smooth", block: "center" });
  void checkForUpdate();
});
elements.refreshHistoryButton.addEventListener("click", loadHistory);
elements.refreshExperimentsButton.addEventListener("click", () => void openGalleryExperiments());
elements.galleryKindFilter.addEventListener("click", (event) => {
  const button = event.target.closest("[data-gallery-kind]");
  if (button) setGalleryFilter({ kind: button.dataset.galleryKind });
});
for (const element of [elements.galleryCheckpoint, elements.galleryLora, elements.galleryPeriod]) {
  element.addEventListener("change", () => setGalleryFilter({
    checkpoint: elements.galleryCheckpoint.value,
    lora: elements.galleryLora.value,
    period: elements.galleryPeriod.value
  }));
}
elements.gallerySearch.addEventListener("input", () => setGalleryFilter({ query: elements.gallerySearch.value }));
elements.resetGalleryFilterButton.addEventListener("click", resetGalleryFilter);
elements.samplerPickerButton.addEventListener("click", () => void openSamplerPicker("sampler"));
elements.schedulerPickerButton.addEventListener("click", () => void openSamplerPicker("scheduler"));
elements.showCombinedPromptButton.addEventListener("click", showCombinedPrompt);
elements.compareShortcutButton.addEventListener("click", sendToCompare);
elements.compareShortcutDetails.addEventListener("toggle", () => {
  if (elements.compareShortcutDetails.open) syncCompareShortcut();
});
elements.compareShortcutParameter.addEventListener("change", () => {
  // 実体は比較画面のフォーム。ここは入り口なので、値だけ渡す。
  elements.experimentParameter.value = elements.compareShortcutParameter.value;
  syncExperimentTargetVisibility();
});
elements.compareShortcutValues.addEventListener("input", () => {
  elements.experimentValues.value = elements.compareShortcutValues.value;
});
elements.cancelGenerateButton.addEventListener("click", cancelActiveJob);
elements.addLoraButton.addEventListener("click", () => void openLoraPicker());
elements.pickCharacterButton.addEventListener("click", () => void openCharacterPicker());
elements.pickOutfitButton.addEventListener("click", () => void openOutfitPicker());
elements.candidateCountDown.addEventListener("click", () => stepCandidateCount(-1));
elements.candidateCountUp.addEventListener("click", () => stepCandidateCount(1));
elements.candidateCount.addEventListener("input", handleCandidateCountChange);
elements.candidateCount.addEventListener("blur", normalizeCandidateCount);
elements.addCivitaiLoraButton.addEventListener("click", () => {
  showView("settings");
  elements.civitaiDetails.open = true;
  elements.civitaiDetails.scrollIntoView({ behavior: "smooth", block: "start" });
  elements.civitaiUrl.focus();
});
elements.compareSelectionButton.addEventListener("click", compareCurrentSelection);
showView(loadInitialView(), { remember: false });
elements.applyPreferenceButton.addEventListener("click", applyPreferenceTags);
elements.clearPromptPartsButton.addEventListener("click", clearPromptParts);
for (const element of [
  elements.stylePreset, elements.compositionPreset, elements.lightingPreset, elements.moodPreset,
  elements.outfitOverride
]) {
  element.addEventListener(element.tagName === "INPUT" ? "input" : "change", handlePromptPartChange);
}
elements.loraCategories.addEventListener("click", (event) => {
  const button = event.target.closest("[data-lora-category]");
  if (!button) return;
  activeLoraCategory = button.dataset.loraCategory;
  localStorage.setItem("localImageChat.loraCategory", activeLoraCategory);
  renderLoras();
});

async function loadConfig() {
  const response = await fetch("/api/config");
  const { defaults, lora, version } = await response.json();
  loraConfig = { ...loraConfig, ...lora };
  if (version) elements.versionText.textContent = `v${version}`;
  for (const [key, value] of Object.entries(defaults)) {
    if (!elements[key]) continue;
    if (key === "inpaintFullRes") {
      defaultInpaintFullRes = value !== false;
      elements.inpaintFullRes.checked = defaultInpaintFullRes;
    } else {
      elements[key].value = value;
    }
  }
  const savedCount = localStorage.getItem("localImageChat.candidateCount");
  if (["1", "2", "3", "4"].includes(savedCount)) elements.candidateCount.value = savedCount;
  elements.autoRetryOnFailure.checked = localStorage.getItem("localImageChat.autoRetry") === "true";
  elements.autoRetryOnFailure.addEventListener("change", () => {
    localStorage.setItem("localImageChat.autoRetry", String(elements.autoRetryOnFailure.checked));
  });
  syncSamplerLabels();
}

function setGenerationMode(mode) {
  generationMode = ["img2img", "inpaint"].includes(mode) ? mode : "txt2img";
  const isImg2Img = generationMode === "img2img";
  const isInpaint = generationMode === "inpaint";
  const usesSource = isImg2Img || isInpaint;
  elements.txt2imgModeButton.classList.toggle("active", !usesSource);
  elements.txt2imgModeButton.setAttribute("aria-pressed", String(!usesSource));
  elements.img2imgModeButton.classList.toggle("active", isImg2Img);
  elements.img2imgModeButton.setAttribute("aria-pressed", String(isImg2Img));
  elements.inpaintModeButton.classList.toggle("active", isInpaint);
  elements.inpaintModeButton.setAttribute("aria-pressed", String(isInpaint));
  elements.img2imgPanel.classList.toggle("hidden", !usesSource);
  elements.img2imgSettings.classList.toggle("hidden", !isImg2Img);
  elements.inpaintPanel.classList.toggle("hidden", !isInpaint);
  if (isInpaint && initImageReference) void initializeInpaintEditor(initImageReference);
  updateGenerateButton();
}

// ---- トップレベル画面（生成 / ギャラリー / 比較 / 設定） ----

// 画面の切り替えは表示の出し分けだけ。生成ジョブはサーバー側で進み続けるので、
// ギャラリーや設定へ移動しても中断・再実行は起きない。
function showView(view, { remember = true } = {}) {
  currentView = normalizeAppView(view);
  for (const name of APP_VIEWS) {
    elements[VIEW_ELEMENTS[name]].classList.toggle("hidden", name !== currentView);
  }
  for (const button of elements.mainNav.querySelectorAll("[data-view]")) {
    const active = button.dataset.view === currentView;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  if (remember) {
    localStorage.setItem("localImageChat.view", currentView);
    if (viewFromHash(location.hash) !== currentView) {
      history.replaceState(null, "", hashForView(currentView));
    }
  }
  // 表示のたびに最新化する（生成は止めない）。
  if (currentView === "gallery") void loadHistory();
  if (currentView === "compare") renderExperimentCards();
}

function loadInitialView() {
  return viewFromHash(location.hash)
    ?? normalizeAppView(localStorage.getItem("localImageChat.view"));
}

// 旧APIの呼び出し（生成完了時など）を新しい画面切替へ橋渡しする。
function setResultTab(tab) {
  showView(tab === "gallery" ? "gallery" : "generate");
}

async function loadInitImageFile(file) {
  clearError();
  const mimeType = inferImageMimeType(file);
  if (!mimeType) {
    return showError("参照画像はPNG・JPEG・WebPを選択してください");
  }
  if (file.size > MAX_INIT_IMAGE_BYTES) {
    return showError("参照画像は20MB以下にしてください");
  }

  try {
    const loadedDataUrl = await fileToDataUrl(file);
    const dataUrl = loadedDataUrl.replace(/^data:[^;]*;/, `data:${mimeType};`);
    const dimensions = await imageDimensions(dataUrl);
    setImageReference({
      dataUrl,
      imageUrl: dataUrl,
      imageId: null,
      filename: file.name,
      ...dimensions
    }, { mode: generationMode === "inpaint" ? "inpaint" : "img2img" });
  } catch (error) {
    showError(`参照画像を読み込めませんでした: ${error.message}`);
  }
}

function inferImageMimeType(file) {
  if (["image/png", "image/jpeg", "image/webp"].includes(file.type)) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  return extension === "png"
    ? "image/png"
    : ["jpg", "jpeg"].includes(extension)
      ? "image/jpeg"
      : extension === "webp"
        ? "image/webp"
        : "";
}

function useImageForImg2Img(image) {
  setImageReference({
    dataUrl: null,
    imageUrl: image.imageUrl,
    imageId: image.id,
    filename: image.filename,
    width: image.width,
    height: image.height
  }, { scroll: true, mode: "img2img" });
}

function useImageForInpaint(image) {
  setImageReference({
    dataUrl: null,
    imageUrl: image.imageUrl,
    imageId: image.id,
    filename: image.filename,
    width: image.width,
    height: image.height
  }, { scroll: true, mode: "inpaint" });
}

function setImageReference(reference, { scroll = false, mode = "img2img" } = {}) {
  reference.maskKey = reference.imageId ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  initImageReference = reference;
  setGenerationMode(mode);
  elements.initImagePreview.src = reference.imageUrl;
  elements.initImagePreview.classList.remove("hidden");
  elements.initImageEmpty.classList.add("hidden");
  elements.initImageStatus.textContent = reference.imageId
    ? `履歴から使用: ${reference.filename ?? reference.imageId}`
    : `アップロード: ${reference.filename ?? "参照画像"}`;
  elements.clearInitImageButton.disabled = false;
  elements.initImageInput.value = "";

  if (reference.width && reference.height) {
    if (elements.syncInitImageSize.checked) syncResolutionToReference(reference.width, reference.height);
  } else {
    void imageDimensions(reference.imageUrl).then(({ width, height }) => {
      if (initImageReference !== reference) return;
      initImageReference.width = width;
      initImageReference.height = height;
      if (elements.syncInitImageSize.checked) syncResolutionToReference(width, height);
    }).catch(() => {});
  }

  if (scroll) elements.img2imgPanel.scrollIntoView({ behavior: "smooth", block: "center" });
}

function clearInitImageReference() {
  initImageReference = null;
  elements.initImageInput.value = "";
  elements.initImagePreview.removeAttribute("src");
  elements.initImagePreview.classList.add("hidden");
  elements.initImageEmpty.classList.remove("hidden");
  elements.initImageStatus.textContent = "参照画像が未選択です";
  elements.clearInitImageButton.disabled = true;
  resetInpaintEditor();
}

function syncResolutionToReference(sourceWidth, sourceHeight) {
  const width = Number(sourceWidth);
  const height = Number(sourceHeight);
  if (!(width > 0 && height > 0)) return;
  const longEdge = Math.min(1536, Math.max(512, Math.max(
    Number(elements.width.value) || 896,
    Number(elements.height.value) || 1152
  )));
  const ratio = width / height;
  const targetWidth = ratio >= 1 ? longEdge : longEdge * ratio;
  const targetHeight = ratio >= 1 ? longEdge / ratio : longEdge;
  elements.width.value = clampRound(targetWidth, 256, 1536, 64);
  elements.height.value = clampRound(targetHeight, 256, 1536, 64);
}

function handleImg2ImgPresetChange() {
  if (!elements.img2imgPreset.value) return;
  elements.img2imgDenoising.value = elements.img2imgPreset.value;
  updateImg2ImgDenoisingDisplay();
  saveImg2ImgPreferences();
}

function handleImg2ImgDenoisingInput() {
  const value = Number(elements.img2imgDenoising.value).toFixed(2);
  const presetExists = [...elements.img2imgPreset.options]
    .some((option) => option.value && Number(option.value).toFixed(2) === value);
  elements.img2imgPreset.value = presetExists ? value : "";
  updateImg2ImgDenoisingDisplay();
  saveImg2ImgPreferences();
}

function updateImg2ImgDenoisingDisplay() {
  elements.img2imgDenoisingValue.value = Number(elements.img2imgDenoising.value).toFixed(2);
}

function loadImg2ImgPreferences() {
  const denoising = Number(localStorage.getItem("localImageChat.img2imgDenoising"));
  if (Number.isFinite(denoising) && denoising >= 0.05 && denoising <= 0.95) {
    elements.img2imgDenoising.value = denoising;
  }
  const resizeMode = localStorage.getItem("localImageChat.img2imgResizeMode");
  if (["0", "1", "2"].includes(resizeMode)) elements.img2imgResizeMode.value = resizeMode;
  elements.syncInitImageSize.checked = localStorage.getItem("localImageChat.syncInitImageSize") !== "false";
  handleImg2ImgDenoisingInput();
}

function saveImg2ImgPreferences() {
  localStorage.setItem("localImageChat.img2imgDenoising", elements.img2imgDenoising.value);
  localStorage.setItem("localImageChat.img2imgResizeMode", elements.img2imgResizeMode.value);
  localStorage.setItem("localImageChat.syncInitImageSize", String(elements.syncInitImageSize.checked));
}

function loadInpaintPreferences() {
  const saved = {
    inpaintDenoising: localStorage.getItem("localImageChat.inpaintDenoising"),
    maskBlur: localStorage.getItem("localImageChat.maskBlur"),
    inpaintFill: localStorage.getItem("localImageChat.inpaintFill"),
    inpaintFullResPadding: localStorage.getItem("localImageChat.inpaintFullResPadding")
  };
  if (Number(saved.inpaintDenoising) >= 0.05 && Number(saved.inpaintDenoising) <= 0.95) {
    elements.inpaintDenoising.value = saved.inpaintDenoising;
  }
  if (saved.maskBlur !== null && Number(saved.maskBlur) >= 0 && Number(saved.maskBlur) <= 64) {
    elements.maskBlur.value = saved.maskBlur;
  }
  if (["0", "1", "2", "3"].includes(saved.inpaintFill)) {
    elements.inpaintFill.value = saved.inpaintFill;
  }
  if (
    saved.inpaintFullResPadding !== null
    && Number(saved.inpaintFullResPadding) >= 0
    && Number(saved.inpaintFullResPadding) <= 256
  ) {
    elements.inpaintFullResPadding.value = saved.inpaintFullResPadding;
  }
  const fullRes = localStorage.getItem("localImageChat.inpaintFullRes");
  elements.inpaintFullRes.checked = fullRes === null ? defaultInpaintFullRes : fullRes !== "false";
  handleInpaintSettingsChange();
  updateMaskBrushSize();
  setMaskTool("paint");
  updateMaskHistoryButtons();
}

function handleInpaintSettingsChange() {
  elements.inpaintDenoisingValue.value = Number(elements.inpaintDenoising.value).toFixed(2);
  localStorage.setItem("localImageChat.inpaintDenoising", elements.inpaintDenoising.value);
  localStorage.setItem("localImageChat.maskBlur", elements.maskBlur.value);
  localStorage.setItem("localImageChat.inpaintFill", elements.inpaintFill.value);
  localStorage.setItem("localImageChat.inpaintFullRes", String(elements.inpaintFullRes.checked));
  localStorage.setItem("localImageChat.inpaintFullResPadding", elements.inpaintFullResPadding.value);
}

function updateMaskBrushSize() {
  elements.maskBrushSizeValue.value = elements.maskBrushSize.value;
}

function setMaskTool(tool) {
  maskTool = tool === "erase" ? "erase" : "paint";
  const painting = maskTool === "paint";
  elements.maskPaintButton.classList.toggle("active", painting);
  elements.maskPaintButton.setAttribute("aria-pressed", String(painting));
  elements.maskEraseButton.classList.toggle("active", !painting);
  elements.maskEraseButton.setAttribute("aria-pressed", String(!painting));
}

async function initializeInpaintEditor(reference) {
  const sourceKey = reference.maskKey ?? reference.imageId ?? reference.imageUrl;
  if (maskSourceKey === sourceKey && elements.inpaintMaskCanvas.width) return;
  maskSourceKey = sourceKey;
  elements.inpaintBaseImage.src = reference.imageUrl;
  try {
    await waitForImage(elements.inpaintBaseImage);
  } catch {
    if (maskSourceKey === sourceKey) elements.maskStatus.textContent = "画像を表示できませんでした";
    return;
  }
  if (maskSourceKey !== sourceKey) return;

  const width = elements.inpaintBaseImage.naturalWidth;
  const height = elements.inpaintBaseImage.naturalHeight;
  elements.inpaintMaskCanvas.width = width;
  elements.inpaintMaskCanvas.height = height;
  elements.inpaintCanvasStage.classList.add("hasImage");
  elements.inpaintBaseImage.classList.remove("hidden");
  elements.inpaintMaskCanvas.classList.remove("hidden");
  elements.inpaintMaskEmpty.classList.add("hidden");
  maskUndoStack = [];
  maskRedoStack = [];
  clearMask(false);
  elements.maskStatus.textContent = `${width}×${height}・未塗り`;
}

function waitForImage(image) {
  if (image.complete && image.naturalWidth) return Promise.resolve();
  return new Promise((resolve, reject) => {
    image.addEventListener("load", resolve, { once: true });
    image.addEventListener("error", () => reject(new Error("画像読込エラー")), { once: true });
  });
}

function resetInpaintEditor() {
  maskSourceKey = "";
  maskUndoStack = [];
  maskRedoStack = [];
  maskDrawing = false;
  maskLastPoint = null;
  elements.inpaintBaseImage.removeAttribute("src");
  elements.inpaintBaseImage.classList.add("hidden");
  elements.inpaintMaskCanvas.width = 0;
  elements.inpaintMaskCanvas.height = 0;
  elements.inpaintMaskCanvas.classList.add("hidden");
  elements.inpaintMaskEmpty.classList.remove("hidden");
  elements.inpaintCanvasStage.classList.remove("hasImage");
  elements.maskStatus.textContent = "画像を選択してください";
  updateMaskHistoryButtons();
}

function beginMaskStroke(event) {
  if (!elements.inpaintMaskCanvas.width) return;
  event.preventDefault();
  elements.inpaintMaskCanvas.setPointerCapture?.(event.pointerId);
  pushMaskUndo();
  maskRedoStack = [];
  maskDrawing = true;
  maskLastPoint = maskPointFromEvent(event);
  drawMaskLine(maskLastPoint, maskLastPoint);
  updateMaskHistoryButtons();
}

function continueMaskStroke(event) {
  if (!maskDrawing || !maskLastPoint) return;
  event.preventDefault();
  const nextPoint = maskPointFromEvent(event);
  drawMaskLine(maskLastPoint, nextPoint);
  maskLastPoint = nextPoint;
}

function endMaskStroke(event) {
  if (!maskDrawing) return;
  event.preventDefault();
  maskDrawing = false;
  maskLastPoint = null;
  elements.maskStatus.textContent = maskHasWhitePixels() ? "修正範囲あり" : "未塗り";
  updateMaskHistoryButtons();
}

function maskPointFromEvent(event) {
  const rect = elements.inpaintMaskCanvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * elements.inpaintMaskCanvas.width / rect.width,
    y: (event.clientY - rect.top) * elements.inpaintMaskCanvas.height / rect.height
  };
}

function drawMaskLine(from, to) {
  const context = elements.inpaintMaskCanvas.getContext("2d", { willReadFrequently: true });
  context.save();
  const color = maskTool === "paint" ? "#ffffff" : "#000000";
  const lineWidth = Number(elements.maskBrushSize.value);
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = lineWidth;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.stroke();
  if (from.x === to.x && from.y === to.y) {
    context.beginPath();
    context.arc(from.x, from.y, lineWidth / 2, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function clearMask(record = true) {
  const canvas = elements.inpaintMaskCanvas;
  if (!canvas.width) return;
  if (record) pushMaskUndo();
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.save();
  context.globalCompositeOperation = "source-over";
  context.fillStyle = "#000000";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.restore();
  if (record) maskRedoStack = [];
  elements.maskStatus.textContent = "未塗り";
  updateMaskHistoryButtons();
}

function captureMaskSnapshot() {
  return elements.inpaintMaskCanvas.width
    ? elements.inpaintMaskCanvas.toDataURL("image/png")
    : null;
}

function pushMaskUndo() {
  const snapshot = captureMaskSnapshot();
  if (!snapshot) return;
  maskUndoStack.push(snapshot);
  if (maskUndoStack.length > MAX_MASK_HISTORY) maskUndoStack.shift();
}

async function undoMask() {
  const snapshot = maskUndoStack.pop();
  if (!snapshot) return;
  const current = captureMaskSnapshot();
  if (current) maskRedoStack.push(current);
  await restoreMaskSnapshot(snapshot);
}

async function redoMask() {
  const snapshot = maskRedoStack.pop();
  if (!snapshot) return;
  const current = captureMaskSnapshot();
  if (current) maskUndoStack.push(current);
  await restoreMaskSnapshot(snapshot);
}

async function restoreMaskSnapshot(dataUrl) {
  const image = new Image();
  image.src = dataUrl;
  await waitForImage(image);
  const canvas = elements.inpaintMaskCanvas;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  elements.maskStatus.textContent = maskHasWhitePixels() ? "修正範囲あり" : "未塗り";
  updateMaskHistoryButtons();
}

function maskHasWhitePixels() {
  const canvas = elements.inpaintMaskCanvas;
  if (!canvas.width) return false;
  const pixels = canvas.getContext("2d", { willReadFrequently: true })
    .getImageData(0, 0, canvas.width, canvas.height).data;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index] > 16) return true;
  }
  return false;
}

function updateMaskHistoryButtons() {
  const available = Boolean(elements.inpaintMaskCanvas.width);
  elements.maskUndoButton.disabled = !available || !maskUndoStack.length;
  elements.maskRedoButton.disabled = !available || !maskRedoStack.length;
  elements.maskClearButton.disabled = !available;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("ファイル読込エラー")));
    reader.readAsDataURL(file);
  });
}

function imageDimensions(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve({
      width: image.naturalWidth,
      height: image.naturalHeight
    }), { once: true });
    image.addEventListener("error", () => reject(new Error("画像形式を認識できません")), { once: true });
    image.src = source;
  });
}

function clampRound(value, minimum, maximum, multiple) {
  return Math.min(maximum, Math.max(minimum, Math.round(value / multiple) * multiple));
}

function initializeCheckpointControls() {
  elements.checkpointProfileSelect.replaceChildren(new Option("自動判定", "auto"));
  for (const profile of CHECKPOINT_PROFILES) {
    elements.checkpointProfileSelect.append(new Option(profile.name, profile.id));
  }
  const savedAutoApply = localStorage.getItem("localImageChat.checkpointAutoApply");
  elements.checkpointAutoApply.checked = savedAutoApply !== "false";
}

async function loadCheckpoints() {
  elements.checkpointStatus.textContent = "ReForgeからCheckpointを取得中…";
  elements.checkpointSelect.disabled = true;
  elements.refreshCheckpointsButton.disabled = true;
  try {
    const data = await getJson("/api/checkpoints");
    installedCheckpoints = data.checkpoints ?? [];
    activeCheckpoint = findCheckpoint(data.activeCheckpoint) ?? (
      data.activeCheckpoint
        ? { title: data.activeCheckpoint, modelName: data.activeCheckpoint, filename: "" }
        : null
    );
    renderCheckpointControls();
    renderCheckpointSetSelect();
    localStorage.setItem("localImageChat.lastCheckpoint", activeCheckpoint?.title ?? "");
    elements.checkpointStatus.textContent = activeCheckpoint
      ? `使用中: ${activeCheckpoint.title}`
      : "使用中のCheckpointを判定できません";
    renderLoras();
    renderSelectedLoraSummary();
  } catch (error) {
    elements.checkpointSelect.replaceChildren(new Option("取得失敗", ""));
    elements.checkpointStatus.textContent = `Checkpoint一覧を取得できません: ${error.message}`;
    renderCheckpointProfileSummary();
  } finally {
    elements.checkpointSelect.disabled = !installedCheckpoints.length;
    elements.refreshCheckpointsButton.disabled = false;
  }
}

function renderCheckpointControls() {
  elements.checkpointSelect.replaceChildren();
  for (const checkpoint of installedCheckpoints) {
    elements.checkpointSelect.append(new Option(checkpoint.title, checkpoint.title));
  }
  if (
    activeCheckpoint
    && !installedCheckpoints.some((checkpoint) => checkpoint.title === activeCheckpoint.title)
  ) {
    elements.checkpointSelect.append(new Option(activeCheckpoint.title, activeCheckpoint.title));
  }
  elements.checkpointSelect.value = activeCheckpoint?.title ?? "";
  elements.checkpointProfileSelect.value = getCheckpointProfileSelection(activeCheckpoint);
  renderCheckpointProfileSummary();
}

async function switchSelectedCheckpoint() {
  const selectedTitle = elements.checkpointSelect.value;
  if (!selectedTitle || selectedTitle === activeCheckpoint?.title) return;
  const previous = activeCheckpoint;
  const selected = installedCheckpoints.find((checkpoint) => checkpoint.title === selectedTitle);
  elements.checkpointSelect.disabled = true;
  elements.refreshCheckpointsButton.disabled = true;
  elements.checkpointStatus.textContent = `切替中: ${selectedTitle}（モデル読込に時間がかかる場合があります）`;
  try {
    const data = await postJson("/api/checkpoints/select", { checkpoint: selectedTitle });
    activeCheckpoint = selected ?? findCheckpoint(data.checkpoint) ?? {
      title: data.checkpoint || selectedTitle,
      modelName: data.checkpoint || selectedTitle,
      filename: ""
    };
    localStorage.setItem("localImageChat.lastCheckpoint", activeCheckpoint.title);
    elements.checkpointProfileSelect.value = getCheckpointProfileSelection(activeCheckpoint);
    const profile = resolveCheckpointProfile(activeCheckpoint);
    if (elements.checkpointAutoApply.checked && profile.settings) applyCheckpointSettings(profile);
    renderCheckpointProfileSummary();
    renderLoras();
    renderSelectedLoraSummary();
    renderCheckpointSetSelect();
    elements.checkpointStatus.textContent = `切替完了: ${activeCheckpoint.title}`;
    // 自動適用ONのLoRAセットがあれば読み込む（編集中なら確認する）。
    await applyAutoCheckpointSet();
    void checkHealth();
  } catch (error) {
    activeCheckpoint = previous;
    elements.checkpointSelect.value = previous?.title ?? "";
    elements.checkpointStatus.textContent = `Checkpoint切替に失敗: ${error.message}`;
  } finally {
    elements.checkpointSelect.disabled = false;
    elements.refreshCheckpointsButton.disabled = false;
  }
}

function handleCheckpointProfileChange() {
  if (!activeCheckpoint) return;
  const selection = elements.checkpointProfileSelect.value;
  if (selection === "auto") checkpointProfileAssignments.delete(activeCheckpoint.title);
  else checkpointProfileAssignments.set(activeCheckpoint.title, selection);
  localStorage.setItem(
    "localImageChat.checkpointProfileAssignments",
    JSON.stringify(Object.fromEntries(checkpointProfileAssignments))
  );
  const profile = resolveCheckpointProfile(activeCheckpoint);
  if (elements.checkpointAutoApply.checked && profile.settings) applyCheckpointSettings(profile);
  renderCheckpointProfileSummary();
  renderLoras();
  renderSelectedLoraSummary();
}

function renderCheckpointProfileSummary() {
  const profile = resolveCheckpointProfile(activeCheckpoint);
  const familyLabels = {
    illustrious: "Illustrious",
    noobai: "NoobAI",
    pony: "Pony",
    sdxl: "SDXL",
    sd15: "SD 1.5",
    unknown: "判定不明"
  };
  elements.checkpointFamilyBadge.textContent = familyLabels[profile.family] ?? profile.family;
  elements.checkpointFamilyBadge.classList.toggle("warning", profile.family === "unknown");
  if (!profile.settings) {
    elements.checkpointProfileSummary.textContent = profile.note;
    return;
  }
  const settings = profile.settings;
  elements.checkpointProfileSummary.textContent = [
    profile.name,
    `${settings.width}×${settings.height}`,
    `${settings.steps} Steps`,
    `CFG ${settings.cfgScale}`,
    settings.samplerName,
    settings.scheduler,
    settings.noiseSchedule && settings.noiseSchedule !== "Automatic" ? settings.noiseSchedule : null,
    profile.note
  ].filter(Boolean).join("・");
}

// 設定値を書き換えたあとは、Sampler/Schedulerの表示も合わせる。
function applyCheckpointSettings(profile) {
  for (const key of ["width", "height", "steps", "cfgScale", "samplerName", "scheduler", "noiseSchedule"]) {
    if (profile.settings[key] !== undefined && elements[key]) elements[key].value = profile.settings[key];
  }
  syncSamplerLabels();
}

function getCheckpointProfileSelection(checkpoint) {
  return checkpointProfileAssignments.get(checkpoint?.title) ?? "auto";
}

function resolveCheckpointProfile(checkpoint = activeCheckpoint) {
  const assigned = checkpointProfileAssignments.get(checkpoint?.title);
  return getCheckpointProfile(assigned) ?? inferCheckpointProfile(checkpoint);
}

function findCheckpoint(name) {
  const identity = checkpointIdentity(name);
  return installedCheckpoints.find((checkpoint) =>
    [checkpoint.title, checkpoint.modelName, checkpoint.filename]
      .some((value) => checkpointIdentity(value) === identity)
  ) ?? installedCheckpoints.find((checkpoint) => {
    const candidate = checkpointIdentity(checkpoint.title);
    return identity && candidate && (identity.includes(candidate) || candidate.includes(identity));
  });
}

function checkpointIdentity(value) {
  return String(value ?? "")
    .replaceAll("\\", "/")
    .split("/")
    .at(-1)
    .replace(/\s*\[[a-f0-9]+\]\s*$/i, "")
    .replace(/\.(?:safetensors|ckpt|pt)$/i, "")
    .trim()
    .toLowerCase();
}

// ---- Checkpoint別LoRAセット ----

function settingsFingerprint() {
  return JSON.stringify({
    settings: readSettings({ candidateCount: elements.candidateCount.value }),
    loras: [...selectedLoras.entries()].sort()
  });
}

function markSettingsApplied() {
  appliedSettingsFingerprint = settingsFingerprint();
}

function hasUnsavedSettingChanges() {
  return appliedSettingsFingerprint !== null && appliedSettingsFingerprint !== settingsFingerprint();
}

async function loadCheckpointSets() {
  try {
    const data = await getJson("/api/checkpoint-lora-sets");
    checkpointSets = data.sets ?? [];
  } catch {
    checkpointSets = [];
  }
  renderCheckpointSetSelect();
}

function setsForActiveCheckpoint() {
  const identity = checkpointIdentity(activeCheckpoint?.title);
  return checkpointSets.filter((set) => checkpointIdentity(set.checkpoint) === identity);
}

function renderCheckpointSetSelect() {
  const select = elements.checkpointSetSelect;
  const current = select.value;
  select.replaceChildren();
  const own = setsForActiveCheckpoint();
  const others = checkpointSets.filter((set) => !own.includes(set));
  select.append(new Option("セットを選択", ""));
  if (own.length) {
    const group = document.createElement("optgroup");
    group.label = "このCheckpoint";
    for (const set of own) group.append(new Option(`${set.name}${set.autoApply ? "（自動適用）" : ""}`, set.id));
    select.append(group);
  }
  if (others.length) {
    const group = document.createElement("optgroup");
    group.label = "他のCheckpoint";
    for (const set of others) group.append(new Option(`${set.name} / ${shorten(set.checkpoint, 22)}`, set.id));
    select.append(group);
  }
  if ([...select.options].some((option) => option.value === current)) select.value = current;
  syncCheckpointSetControls();
}

function selectedCheckpointSet() {
  return checkpointSets.find((set) => set.id === elements.checkpointSetSelect.value) ?? null;
}

function syncCheckpointSetControls() {
  const set = selectedCheckpointSet();
  const disabled = !set;
  for (const key of [
    "applyCheckpointSetButton", "renameCheckpointSetButton",
    "duplicateCheckpointSetButton", "deleteCheckpointSetButton"
  ]) elements[key].disabled = disabled;
  elements.checkpointSetAutoApply.checked = set?.autoApply === true;
  elements.checkpointSetAutoApply.disabled = disabled;
  elements.checkpointSetStatus.textContent = set
    ? `${set.name}: LoRA ${set.loras.length}個・${describeSetSettings(set.settings)}`
    : setsForActiveCheckpoint().length
      ? "セットを選ぶと内容を表示します。"
      : "現在のCheckpoint用のセットはまだありません。";
}

function describeSetSettings(settings = {}) {
  return [
    settings.width && settings.height ? `${settings.width}×${settings.height}` : null,
    settings.steps ? `${settings.steps} Steps` : null,
    settings.cfgScale ? `CFG ${settings.cfgScale}` : null,
    settings.samplerName,
    settings.scheduler
  ].filter(Boolean).join("・") || "設定なし";
}

function currentSetPayload(name) {
  const settings = readSettings({ candidateCount: elements.candidateCount.value });
  return {
    name,
    checkpoint: activeCheckpoint?.title ?? "",
    autoApply: elements.checkpointSetAutoApply.checked,
    loras: readSelectedLoras(),
    settings: {
      samplerName: settings.samplerName,
      scheduler: settings.scheduler,
      noiseSchedule: settings.noiseSchedule,
      steps: settings.steps,
      cfgScale: settings.cfgScale,
      width: settings.width,
      height: settings.height,
      hiresScale: settings.hiresScale,
      hiresSteps: settings.hiresSteps,
      hiresDenoising: settings.hiresDenoising,
      hiresUpscaler: settings.hiresUpscaler
    },
    prompt: elements.prompt.value,
    negativePrompt: elements.negativePrompt.value,
    promptBoosts: readPromptBoosts()
  };
}

async function saveCurrentCheckpointSet() {
  if (!activeCheckpoint?.title) return toast.warning("Checkpointを選択してから保存してください");
  const name = await promptModal("LoRAセットの名前", `${formatCheckpointBadge(activeCheckpoint.title)} 基本セット`, {
    placeholder: "例: NoobAI 基本セット",
    confirmText: "保存"
  });
  if (!name) return;
  await withBusy(elements.saveCheckpointSetButton, "保存中…", async () => {
    try {
      const { set } = await postJson("/api/checkpoint-lora-sets", currentSetPayload(name));
      await loadCheckpointSets();
      elements.checkpointSetSelect.value = set.id;
      syncCheckpointSetControls();
      markSettingsApplied();
      toast.success(`${set.name} を保存しました`);
    } catch (error) {
      toast.error(error.message);
    }
  });
}

// セット適用。ユーザーが編集中の設定を勝手に上書きしない。
async function applyCheckpointSet(set, { silent = false } = {}) {
  if (!set) return false;
  if (!silent && hasUnsavedSettingChanges()) {
    const confirmed = await confirmModal(
      `現在の設定を「${set.name}」で上書きします。編集中の内容は失われます。`,
      { title: "LoRAセットの適用", confirmText: "適用する" }
    );
    if (!confirmed) return false;
  }

  for (const [key, value] of Object.entries(set.settings ?? {})) {
    if (elements[key] && value !== undefined && value !== "") elements[key].value = value;
  }
  syncSamplerLabels();
  selectedLoras.clear();
  const missing = [];
  for (const lora of set.loras ?? []) {
    if (!installedLoras.some((item) => item.name === lora.name)) {
      missing.push(lora.name);
      continue;
    }
    selectedLoras.set(lora.name, Number(lora.weight));
    loraWeights.set(lora.name, Number(lora.weight));
    if (lora.triggerWords) loraTriggers.set(lora.name, lora.triggerWords);
    if (lora.negativeWords) loraNegativeWords.set(lora.name, lora.negativeWords);
  }
  saveLoraWeights();
  saveLoraTriggers();
  saveLoraNegativeWords();
  if (set.prompt || set.negativePrompt) {
    setPromptFields(set.prompt ?? "", set.negativePrompt ?? "", elements.description.value.trim());
  }
  renderLoras();
  renderSelectedLoraSummary();
  markSettingsApplied();
  toast.success(`${set.name}を適用しました${missing.length ? `（未導入のLoRA: ${missing.join(", ")}）` : ""}`);
  if (missing.length) toast.warning(`未導入のLoRAはスキップしました: ${missing.join(", ")}`);
  return true;
}

async function renameCheckpointSet() {
  const set = selectedCheckpointSet();
  if (!set) return;
  const name = await promptModal("セット名を変更", set.name);
  if (!name) return;
  try {
    await patchJson(`/api/checkpoint-lora-sets/${set.id}`, { name });
    await loadCheckpointSets();
    elements.checkpointSetSelect.value = set.id;
    syncCheckpointSetControls();
    toast.success("セット名を変更しました");
  } catch (error) {
    toast.error(error.message);
  }
}

async function duplicateCheckpointSet() {
  const set = selectedCheckpointSet();
  if (!set) return;
  try {
    const { set: created } = await patchJson(`/api/checkpoint-lora-sets/${set.id}`, { duplicate: true });
    await loadCheckpointSets();
    elements.checkpointSetSelect.value = created.id;
    syncCheckpointSetControls();
    toast.success(`${created.name} を作成しました`);
  } catch (error) {
    toast.error(error.message);
  }
}

async function deleteCheckpointSet() {
  const set = selectedCheckpointSet();
  if (!set) return;
  const confirmed = await confirmModal(`LoRAセット「${set.name}」を削除しますか？`, {
    title: "LoRAセットの削除",
    confirmText: "削除する",
    danger: true
  });
  if (!confirmed) return;
  try {
    await deleteJson(`/api/checkpoint-lora-sets/${set.id}`);
    await loadCheckpointSets();
    toast.success("LoRAセットを削除しました");
  } catch (error) {
    toast.error(error.message);
  }
}

async function toggleCheckpointSetAutoApply() {
  const set = selectedCheckpointSet();
  if (!set) return;
  try {
    await patchJson(`/api/checkpoint-lora-sets/${set.id}`, { autoApply: elements.checkpointSetAutoApply.checked });
    await loadCheckpointSets();
    elements.checkpointSetSelect.value = set.id;
    syncCheckpointSetControls();
  } catch (error) {
    toast.error(error.message);
  }
}

// Checkpoint切替後に、自動適用ONのセットがあれば適用する。
async function applyAutoCheckpointSet() {
  const identity = checkpointIdentity(activeCheckpoint?.title);
  const set = checkpointSets.find((item) => item.autoApply && checkpointIdentity(item.checkpoint) === identity);
  if (!set) return;
  elements.checkpointSetSelect.value = set.id;
  syncCheckpointSetControls();
  await applyCheckpointSet(set);
}

function getLoraCompatibility(lora) {
  return assessLoraCompatibility(resolveCheckpointProfile(), lora?.registry?.baseModel);
}

const LORA_SUBCATEGORY_LABELS = {
  character: "キャラクター",
  style: "画風",
  body: "体型",
  pose: "構図・ポーズ"
};

function loadLoraCompatibilityFilter() {
  const stored = localStorage.getItem("localImageChat.loraCompatibilityFilter");
  return isCompatibilityFilter(stored) ? stored : "all";
}

function saveLoraCompatibilityFilter() {
  localStorage.setItem("localImageChat.loraCompatibilityFilter", elements.loraCompatibilityFilter.value);
}

function findLoraByName(name) {
  return installedLoras.find((item) => item.name === name) ?? null;
}

// ホバー・フォーカス時は一時表示。lora未指定なら固定中へ戻す。
function showTransientLoraPreview(lora) {
  if (!lora) return restorePinnedLoraPreview();
  renderLoraPreview(lora, { pinned: pinnedLoraName === lora.name });
}

// クリック時はプレビューを固定する（LoRAの有効化は行わない）。
function pinLoraPreview(lora) {
  if (!lora) return;
  pinnedLoraName = lora.name;
  renderLoraPreview(lora, { pinned: true });
}

function restorePinnedLoraPreview() {
  const pinned = pinnedLoraName ? findLoraByName(pinnedLoraName) : null;
  if (!pinned) pinnedLoraName = null;
  renderLoraPreview(pinned, { pinned: Boolean(pinned) });
}

// 一覧再描画後にプレビュー欄を最新の状態へ同期する。
function refreshLoraPreviewPane() {
  restorePinnedLoraPreview();
}

function renderLoraPreview(lora, { pinned = false } = {}) {
  const pane = elements.loraPreview;
  pane.replaceChildren();
  displayedLoraName = lora?.name ?? null;
  if (!lora) {
    const hint = document.createElement("p");
    hint.className = "loraPreviewHint";
    hint.textContent = "LoRAにカーソルを合わせるか選ぶと、作例画像と詳細をここに表示します。";
    pane.append(hint);
    return;
  }

  const profile = resolveProfile(lora);
  const registry = lora.registry;
  const compatibility = getLoraCompatibility(lora);

  const figure = document.createElement("div");
  figure.className = "loraPreviewImage";
  const url = resolveLoraPreviewUrl(lora);
  if (url) {
    const img = document.createElement("img");
    img.loading = "lazy";
    img.decoding = "async";
    img.alt = `${lora.displayName}の作例`;
    img.src = url;
    img.title = "クリックで拡大";
    img.addEventListener("error", () => {
      figure.replaceChildren(createThumbPlaceholder(lora));
      figure.classList.add("noPreview");
    });
    figure.classList.add("clickable");
    figure.addEventListener("click", () => openImageModal(url, `${lora.displayName}の作例`));
    figure.append(img);
  } else {
    figure.classList.add("noPreview");
    figure.append(createThumbPlaceholder(lora));
  }
  pane.append(figure);

  const header = document.createElement("div");
  header.className = "loraPreviewHeader";
  const title = document.createElement("strong");
  title.className = "loraPreviewTitle";
  title.textContent = lora.displayName;
  header.append(title);
  if (pinned) {
    const badge = document.createElement("span");
    badge.className = "loraPreviewPinned";
    badge.textContent = "固定中";
    header.append(badge);
  }
  pane.append(header);

  const addFieldTo = (target) => (label, value) => {
    if (value === null || value === undefined || value === "") return;
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    if (value instanceof Node) dd.append(value);
    else dd.textContent = String(value);
    target.append(dt, dd);
  };

  // 画像優先のため、主要情報だけを既定で表示する。
  const list = document.createElement("dl");
  list.className = "loraPreviewFields";
  const addField = addFieldTo(list);

  const baseModel = registry?.baseModel ?? profile?.baseModel;
  addField("Base Model", baseModel);
  if (baseModel && activeCheckpoint) {
    const badge = document.createElement("span");
    badge.className = `loraCompatibility ${compatibility.level}`;
    badge.textContent = compatibility.label;
    badge.title = compatibility.message;
    addField("互換性", badge);
  }
  // Civitaiから実際に抽出できた推奨値だけを表示する（fallbackは推奨扱いしない）。
  const recommended = getRecommendedWeight(registry);
  const currentWeight = loraWeights.get(lora.name)
    ?? recommended?.weight ?? profile?.recommendedWeight ?? loraConfig.defaultWeight;
  if (recommended) {
    addField("Recommended Weight", recommended.weight.toFixed(2));
    if (recommended.min != null) addField("Recommended Range", recommended.label);
  }
  addField("現在値", Number(currentWeight).toFixed(2));
  // 実際に生成へ使う現在値（ユーザー編集後）を優先し、無ければ登録時の値。
  const triggerWords = loraTriggers.get(lora.name) || registry?.triggerWords || "";
  if (triggerWords) addField("Trigger Words", createTriggerWordsNode(triggerWords));
  if (list.childElementCount) pane.append(list);

  // 補足情報は既定で折りたたみ、情報量を抑える。
  const moreList = document.createElement("dl");
  moreList.className = "loraPreviewFields";
  const addMore = addFieldTo(moreList);
  addMore("Category", getLoraCategory(lora) === "character" ? "キャラクター" : "画風・体型・構図");
  addMore("Subcategory", LORA_SUBCATEGORY_LABELS[registry?.subcategory] ?? registry?.subcategory);
  const presetCount = profile?.presets
    ? profile.presets.filter((preset) => preset.id !== "identity").length
    : (registry?.outfitPresets?.length ?? 0);
  if (presetCount > 0) addMore("衣装プリセット", `${presetCount}種`);
  addMore("Civitaiモデル", registry?.modelName);
  addMore("Civitaiバージョン", registry?.versionName);
  if (moreList.childElementCount) {
    const more = document.createElement("details");
    more.className = "loraPreviewMore";
    const summary = document.createElement("summary");
    summary.textContent = "詳細情報";
    more.append(summary, moreList);
    pane.append(more);
  }

  const actions = document.createElement("div");
  actions.className = "loraPreviewActions";
  const toggle = document.createElement("button");
  toggle.type = "button";
  const isSelected = selectedLoras.has(lora.name);
  toggle.className = isSelected ? "secondary" : "primary";
  toggle.textContent = isSelected ? "LoRAを解除" : "LoRAを選択";
  toggle.addEventListener("click", () => toggleLoraSelectionFromPreview(lora));
  actions.append(toggle);

  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "secondary";
  edit.textContent = "編集";
  edit.title = "表示名・分類・Trigger Words・推奨Weightなどを編集";
  edit.addEventListener("click", () => void editLoraMetadata(lora, edit));
  actions.append(edit);

  // 推奨値へ戻すボタン（Civitai推奨がある場合だけ）。
  if (recommended && Number(currentWeight).toFixed(2) !== recommended.weight.toFixed(2)) {
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "ghost loraResetWeight";
    reset.textContent = recommended.min != null
      ? `中央値${recommended.weight.toFixed(2)}へ戻す`
      : `推奨${recommended.weight.toFixed(2)}へ戻す`;
    reset.addEventListener("click", () => applyRecommendedWeight(lora));
    actions.append(reset);
  }

  const sourceUrl = profile?.sourceUrl || registry?.sourceUrl;
  if (sourceUrl && sourceUrl !== "#") {
    const link = document.createElement("a");
    link.className = "loraPreviewLink";
    link.href = sourceUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Civitai";
    actions.append(link);
  }
  pane.append(actions);
}

// LoRAメタデータ編集。未登録のLoRAは編集時にregistryへ登録してから扱う。
async function editLoraMetadata(lora, button) {
  await withBusy(button, "準備中…", async () => {
    try {
      const relativeName = String(lora.name ?? "").replaceAll("\\", "/");
      const { entry } = await postJson("/api/loras/registry/ensure", {
        relativeName,
        displayName: lora.displayName ?? ""
      });
      await openLoraEditor({
        lora,
        entry,
        folders: civitaiFolders,
        onSave: async (patch) => {
          const result = await patchJson(`/api/loras/${entry.uid}`, patch);
          if (Array.isArray(result.loras) && result.loras.length) installedLoras = result.loras;
          toast.success(`${result.entry.displayName || result.entry.modelName || "LoRA"} の情報を保存しました`);
        },
        onMove: async (folder) => {
          const result = await postJson(`/api/loras/${entry.uid}/move`, { folder, confirm: true });
          if (Array.isArray(result.loras) && result.loras.length) installedLoras = result.loras;
          toast.success(`${folder} へ移動しました（${result.moved.length}ファイル）`);
        }
      });
      await loadLoras();
      await loadCivitaiFolders();
    } catch (error) {
      toast.error(error.message);
    }
  });
}

// Trigger Wordsは長い場合に折り返しつつ、展開できるようdetailsへ収める。
function createTriggerWordsNode(triggerWords) {
  if (triggerWords.length <= 60) {
    const span = document.createElement("span");
    span.textContent = triggerWords;
    return span;
  }
  const details = document.createElement("details");
  details.className = "loraTriggerWords";
  const summary = document.createElement("summary");
  summary.textContent = `${triggerWords.slice(0, 48)}…`;
  const body = document.createElement("span");
  body.textContent = triggerWords;
  details.append(summary, body);
  return details;
}

// 画像拡大モーダル（LoRA作例・履歴画像で共用）。外部ライブラリを使わず一度だけ生成する。
let imageModalEl = null;

function ensureImageModal() {
  if (imageModalEl) return imageModalEl;
  const overlay = document.createElement("div");
  overlay.className = "imageModal hidden";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "画像の拡大表示");
  const img = document.createElement("img");
  img.className = "imageModalImg";
  img.alt = "";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "imageModalClose";
  close.setAttribute("aria-label", "閉じる");
  close.textContent = "×";
  close.addEventListener("click", closeImageModal);
  overlay.append(img, close);
  // 背景（画像の外側）クリックで閉じる。
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeImageModal();
  });
  document.body.append(overlay);
  imageModalEl = overlay;
  return overlay;
}

function openImageModal(url, alt = "") {
  if (!url) return;
  const overlay = ensureImageModal();
  const img = overlay.querySelector(".imageModalImg");
  img.src = url;
  img.alt = alt;
  overlay.classList.remove("hidden");
  document.addEventListener("keydown", handleImageModalKey);
}

function closeImageModal() {
  if (!imageModalEl || imageModalEl.classList.contains("hidden")) return;
  imageModalEl.classList.add("hidden");
  imageModalEl.querySelector(".imageModalImg").removeAttribute("src");
  document.removeEventListener("keydown", handleImageModalKey);
}

function handleImageModalKey(event) {
  if (event.key === "Escape") closeImageModal();
}

function toggleLoraSelectionFromPreview(lora) {
  const isSelected = selectedLoras.has(lora.name);
  if (!isSelected && selectedLoras.size >= loraConfig.maxSelected) {
    showError(`LoRAは最大${loraConfig.maxSelected}個までです`);
    return;
  }
  if (isSelected) {
    setLoraSelected(lora.name, false);
  } else {
    const weight = loraWeights.get(lora.name) ?? lora.registry?.recommendedWeight ?? loraConfig.defaultWeight;
    setLoraSelected(lora.name, true, weight);
  }
  clearError();
  // 操作したLoRAを固定して詳細を表示したまま一覧を再描画する。
  pinnedLoraName = lora.name;
  renderSelectedLoraSummary();
  renderLoras();
}

// Civitai推奨Weight（範囲なら中央値）へ、スライダー・保存値・選択中の値を同時に戻す。
function applyRecommendedWeight(lora) {
  const recommended = getRecommendedWeight(lora.registry);
  if (!recommended) return;
  loraWeights.set(lora.name, recommended.weight);
  saveLoraWeights();
  if (selectedLoras.has(lora.name)) {
    selectedLoras.set(lora.name, recommended.weight);
    applyLoraWeightToPrompt(lora.name, recommended.weight);
    renderSelectedLoraSummary();
  }
  pinnedLoraName = lora.name;
  renderLoras();
}

async function loadLoras(refresh = false) {
  elements.loraStatus.textContent = refresh ? "ReForgeでLoRAを再読込中…" : "LoRAを取得中…";
  elements.refreshLorasButton.disabled = true;
  try {
    const data = refresh
      ? await postJson("/api/loras/refresh", {})
      : await getJson("/api/loras");
    installedLoras = data.loras ?? [];
    registerDetectedProfiles();
    registerCivitaiDefaults();
    migrateCharacterProfileDefaults();
    const available = new Set(installedLoras.map((item) => item.name));
    for (const name of selectedLoras.keys()) {
      if (!available.has(name)) selectedLoras.delete(name);
    }
    const counts = countLoraCategories();
    elements.loraStatus.textContent = installedLoras.length
      ? `${installedLoras.length}個を検出・キャラ${counts.character}・画風系${counts.direction}`
      : "LoRAが見つかりません。追加後に「再読込」を押してください。";
    renderLoras();
    renderSelectedLoraSummary();
    // AI共有CSVはLoRA一覧に追随させる（失敗しても操作は止めない）。
    scheduleShareCsvSync();
  } catch (error) {
    elements.loraStatus.textContent = `LoRA一覧を取得できません: ${error.message}`;
  } finally {
    elements.refreshLorasButton.disabled = false;
  }
}

function renderLoras() {
  const query = elements.loraSearch.value.trim().toLowerCase();
  const compatibilityFilter = elements.loraCompatibilityFilter.value;
  const matches = installedLoras
    .filter((item) => {
      const category = getLoraCategory(item);
      const matchesCategory = activeLoraCategory === "all"
        || activeLoraCategory === category
        || (activeLoraCategory === "selected" && selectedLoras.has(item.name));
      const matchesSearch = `${item.displayName} ${item.name} ${item.alias} ${item.folder ?? ""}`
        .toLowerCase()
        .includes(query);
      const matchesCompatibility = compatibilityFilterAllows(compatibilityFilter, {
        level: getLoraCompatibility(item).level,
        hasPreview: hasLoraPreview(item)
      });
      return matchesCategory && matchesSearch && matchesCompatibility;
    })
    .sort((left, right) => {
      const leftSelected = selectedLoras.has(left.name) ? 0 : 1;
      const rightSelected = selectedLoras.has(right.name) ? 0 : 1;
      return leftSelected - rightSelected
        || left.displayName.localeCompare(right.displayName, "ja", { numeric: true });
    });

  updateLoraCategoryButtons();
  elements.loraList.replaceChildren();

  const groups = new Map();
  for (const lora of matches) {
    const label = getLoraFolderLabel(lora);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(lora);
  }

  for (const [folder, loras] of groups) {
    const group = document.createElement("details");
    group.className = "loraFolderGroup";
    group.open = true;

    const heading = document.createElement("summary");
    heading.className = "loraFolderHeader";
    const folderName = document.createElement("strong");
    folderName.textContent = folder;
    const count = document.createElement("span");
    count.textContent = `${loras.length}個`;
    heading.append(folderName, count);

    const rows = document.createElement("div");
    rows.className = "loraFolderRows";
    for (const lora of loras) rows.append(createLoraRow(lora));
    group.append(heading, rows);
    elements.loraList.append(group);
  }

  if (!matches.length && installedLoras.length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "一致するLoRAがありません";
    elements.loraList.append(empty);
  }

  refreshLoraPreviewPane();
}

function createLoraRow(lora) {
  const profile = resolveProfile(lora);
  const registry = lora.registry;
  const compatibility = getLoraCompatibility(lora);
  const isCharacter = getLoraCategory(lora) === "character";
  const weight = loraWeights.get(lora.name) ?? registry?.recommendedWeight ?? loraConfig.defaultWeight;
  const row = document.createElement("div");
  row.className = "loraRow";
  if (registry?.baseModel && ["caution", "incompatible"].includes(compatibility.level)) {
    row.classList.add(`compatibility-${compatibility.level}`);
  }

  const choice = document.createElement("label");
  choice.className = "loraChoice";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = selectedLoras.has(lora.name);
  const names = document.createElement("span");
  names.className = "loraNames";
  const title = document.createElement("strong");
  title.textContent = lora.displayName;
  names.append(title);
  // カードはサムネイル・名前・互換性・推奨Weight・追加チェックのみ表示し、
  // プロフィール名や正式名などの補足はプレビュー欄へ集約する。
  const badges = document.createElement("div");
  badges.className = "loraBadges";
  if (registry?.baseModel && activeCheckpoint) {
    const compatibilityBadge = document.createElement("small");
    compatibilityBadge.className = `loraCompatibility ${compatibility.level}`;
    compatibilityBadge.textContent = `${compatibility.label}・${registry.baseModel}`;
    compatibilityBadge.title = compatibility.message;
    badges.append(compatibilityBadge);
  }
  const recommended = getRecommendedWeight(registry);
  if (recommended) {
    const recommendedBadge = document.createElement("small");
    recommendedBadge.className = "loraRecommendedBadge";
    recommendedBadge.textContent = recommended.badge;
    recommendedBadge.title = recommended.min != null
      ? `Civitai推奨Weight範囲 ${recommended.label}`
      : `Civitai推奨Weight ${recommended.display}`;
    badges.append(recommendedBadge);
  }
  if (badges.childElementCount) names.append(badges);
  choice.append(checkbox, names);

  const weightWrap = document.createElement("label");
  weightWrap.className = "loraWeight";
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0.05";
  // プロンプト内タグ・サーバー側と同じ上限（0.05〜2）に合わせる。
  slider.max = "2";
  slider.step = "0.05";
  slider.value = String(weight);
  slider.setAttribute("aria-label", `${lora.displayName}の強度`);
  const output = document.createElement("output");
  output.textContent = Number(weight).toFixed(2);
  weightWrap.append(slider, output);

  const triggerInput = document.createElement("input");
  triggerInput.type = "text";
  triggerInput.className = "loraTrigger";
  triggerInput.placeholder = "Trigger Words（例: modern_anime_render）";
  triggerInput.value = loraTriggers.get(lora.name) ?? "";
  triggerInput.setAttribute("aria-label", `${lora.displayName}のTrigger Words`);

  const negativeInput = document.createElement("input");
  negativeInput.type = "text";
  negativeInput.className = "loraNegative";
  negativeInput.placeholder = isCharacter
    ? "標準衣装の抑制タグ（Negativeへ自動追加）"
    : "このLoRA使用時にNegativeへ追加するタグ";
  negativeInput.value = loraNegativeWords.get(lora.name) ?? "";
  negativeInput.setAttribute("aria-label", `${lora.displayName}のNegative追加タグ`);

  const advanced = document.createElement("details");
  advanced.className = "loraAdvanced";
  const advancedSummary = document.createElement("summary");
  advancedSummary.textContent = isCharacter || profile
    ? "キャラ・衣装・Trigger設定"
    : "Trigger・Negative設定";
  const advancedBody = document.createElement("div");
  advancedBody.className = "loraAdvancedBody";

  const profileControls = document.createElement("div");
  profileControls.className = "loraProfileControls";
  const profileSelect = document.createElement("select");
  profileSelect.className = "loraProfileSelect";
  profileSelect.setAttribute("aria-label", `${lora.displayName}のプロフィール`);
  profileSelect.append(new Option("プロフィール未設定", ""));
  for (const item of LORA_PROFILES) profileSelect.append(new Option(item.name, item.id));
  if (profile && !getProfile(profile.id)) {
    profileSelect.append(new Option(profile.name, profile.id));
  }
  profileSelect.value = profile?.id ?? "";

  const presetSelect = document.createElement("select");
  presetSelect.className = "loraPresetSelect";
  presetSelect.setAttribute("aria-label", `${lora.displayName}の衣装プリセット`);
  fillPresetSelect(presetSelect, profile, loraPresetSelections.get(lora.name));

  const addonSelect = document.createElement("select");
  addonSelect.className = "loraAddonSelect";
  addonSelect.setAttribute("aria-label", `${lora.displayName}の追加衣装`);
  fillAddonSelect(addonSelect, profile, loraAddonSelections.get(lora.name));

  const sourceLink = document.createElement("a");
  sourceLink.className = "loraSourceLink";
  sourceLink.textContent = "配布元";
  sourceLink.target = "_blank";
  sourceLink.rel = "noreferrer";
  sourceLink.href = profile?.sourceUrl ?? registry?.sourceUrl ?? "#";
  sourceLink.classList.toggle("hidden", !profile && !registry);
  if (profile) sourceLink.title = `${profile.baseModel}・${profile.note}`;
  else if (registry) sourceLink.title = `${registry.baseModel}・Civitaiから登録`;
  profileControls.append(profileSelect, presetSelect, addonSelect, sourceLink);

  if (isCharacter || profile) {
    advancedBody.append(profileControls);
  } else if (registry) {
    profileControls.classList.add("sourceOnly");
    profileSelect.classList.add("hidden");
    presetSelect.classList.add("hidden");
    advancedBody.append(profileControls);
  }
  advancedBody.append(triggerInput, negativeInput);
  advanced.append(advancedSummary, advancedBody);

  checkbox.addEventListener("change", () => {
    if (checkbox.checked && selectedLoras.size >= loraConfig.maxSelected) {
      checkbox.checked = false;
      showError(`LoRAは最大${loraConfig.maxSelected}個までです`);
      return;
    }
    setLoraSelected(lora.name, checkbox.checked, Number(slider.value));
    clearError();
    renderSelectedLoraSummary();
    if (activeLoraCategory === "selected" && !checkbox.checked) {
      renderLoras();
    } else {
      updateLoraCategoryButtons();
      // 詳細欄がこのLoRAを表示中なら、選択/解除ボタンを現在の状態へ同期する。
      if (displayedLoraName === lora.name) {
        renderLoraPreview(lora, { pinned: pinnedLoraName === lora.name });
      }
    }
  });

  slider.addEventListener("input", () => {
    const nextWeight = Number(slider.value);
    output.textContent = nextWeight.toFixed(2);
    loraWeights.set(lora.name, nextWeight);
    saveLoraWeights();
    if (selectedLoras.has(lora.name)) {
      selectedLoras.set(lora.name, nextWeight);
      // プロンプトに同じLoRAタグがあれば、そのWeightだけを書き換える。
      applyLoraWeightToPrompt(lora.name, nextWeight);
      renderSelectedLoraSummary();
    }
  });

  triggerInput.addEventListener("input", () => {
    const triggerWords = triggerInput.value.trim();
    if (triggerWords) loraTriggers.set(lora.name, triggerWords);
    else loraTriggers.delete(lora.name);
    saveLoraTriggers();
    scheduleShareCsvSync();
    if (selectedLoras.has(lora.name)) renderSelectedLoraSummary();
  });

  negativeInput.addEventListener("input", () => {
    const negativeWords = negativeInput.value.trim();
    if (negativeWords) loraNegativeWords.set(lora.name, negativeWords);
    else loraNegativeWords.delete(lora.name);
    saveLoraNegativeWords();
    if (selectedLoras.has(lora.name)) renderSelectedLoraSummary();
  });

  profileSelect.addEventListener("change", () => {
    const nextProfile = getProfile(profileSelect.value)
      ?? (profileSelect.value === profile?.id ? profile : null);
    if (!nextProfile) {
      loraProfileAssignments.delete(lora.name);
      loraPresetSelections.delete(lora.name);
      loraAddonSelections.delete(lora.name);
      saveProfileSettings();
      renderLoras();
      return;
    }
    const preset = getPreset(nextProfile, nextProfile.defaultPreset);
    const addon = getAddon(nextProfile, nextProfile.defaultAddon);
    loraProfileAssignments.set(lora.name, nextProfile.id);
    loraPresetSelections.set(lora.name, preset.id);
    if (addon) loraAddonSelections.set(lora.name, addon.id);
    else loraAddonSelections.delete(lora.name);
    applyProfileSelection(lora.name, nextProfile, preset, addon);
    renderLoras();
    renderSelectedLoraSummary();
  });

  presetSelect.addEventListener("change", () => {
    const currentProfile = getProfile(profileSelect.value)
      ?? (profileSelect.value === profile?.id ? profile : null);
    const preset = getPreset(currentProfile, presetSelect.value);
    if (!currentProfile || !preset) return;
    const addon = getAddon(currentProfile, addonSelect.value);
    loraPresetSelections.set(lora.name, preset.id);
    applyProfileSelection(lora.name, currentProfile, preset, addon);
    triggerInput.value = combineTriggerWords(preset.triggerWords, addon?.triggerWords);
    negativeInput.value = addon?.clearNegativeWords ? "" : preset.negativeWords ?? "";
    const presetWeight = getPresetWeight(currentProfile, preset);
    slider.value = String(presetWeight);
    output.textContent = Number(presetWeight).toFixed(2);
    renderSelectedLoraSummary();
  });

  addonSelect.addEventListener("change", () => {
    const currentProfile = getProfile(profileSelect.value)
      ?? (profileSelect.value === profile?.id ? profile : null);
    const preset = getPreset(currentProfile, presetSelect.value);
    const addon = getAddon(currentProfile, addonSelect.value);
    if (!currentProfile || !preset || !addon) return;
    loraAddonSelections.set(lora.name, addon.id);
    applyProfileSelection(lora.name, currentProfile, preset, addon);
    triggerInput.value = combineTriggerWords(preset.triggerWords, addon.triggerWords);
    negativeInput.value = addon.clearNegativeWords ? "" : preset.negativeWords ?? "";
    renderSelectedLoraSummary();
  });

  const thumb = createLoraThumb(lora);
  const main = document.createElement("div");
  main.className = "loraMain";
  main.append(thumb, choice);

  row.append(main, weightWrap, advanced);
  // カードへのホバー・フォーカスで一時プレビュー、外れたら固定中へ戻す。
  // 選択（有効化）はチェックボックスと詳細欄のボタンだけが行う。
  row.addEventListener("mouseenter", () => showTransientLoraPreview(lora));
  row.addEventListener("mouseleave", restorePinnedLoraPreview);
  row.addEventListener("focusin", () => showTransientLoraPreview(lora));
  // 行の外へフォーカスが移った時だけ固定中プレビューへ戻す。
  row.addEventListener("focusout", (event) => {
    if (!row.contains(event.relatedTarget)) restorePinnedLoraPreview();
  });
  return row;
}

function createLoraThumb(lora) {
  const thumb = document.createElement("button");
  thumb.type = "button";
  thumb.className = "loraThumb";
  thumb.setAttribute("aria-label", `${lora.displayName}のプレビューを固定`);
  const url = resolveLoraPreviewUrl(lora);
  if (url) {
    const img = document.createElement("img");
    img.loading = "lazy";
    img.decoding = "async";
    img.alt = "";
    img.src = url;
    // 読み込み失敗時は壊れた画像アイコンを残さずプレースホルダーへ差し替える。
    img.addEventListener("error", () => {
      img.remove();
      thumb.classList.add("noPreview");
      thumb.append(createThumbPlaceholder(lora));
    });
    thumb.append(img);
  } else {
    thumb.classList.add("noPreview");
    thumb.append(createThumbPlaceholder(lora));
  }
  thumb.addEventListener("click", () => pinLoraPreview(lora));
  return thumb;
}

function createThumbPlaceholder(lora) {
  const placeholder = document.createElement("span");
  placeholder.className = "loraThumbPlaceholder";
  placeholder.setAttribute("aria-hidden", "true");
  placeholder.textContent = (lora?.displayName ?? "?").trim().charAt(0) || "?";
  return placeholder;
}

function getLoraCategory(lora) {
  const profile = resolveProfile(lora);
  if (profile) return profile.category === "direction" ? "direction" : "character";
  if (lora.registry?.category) return lora.registry.category;
  return lora.category === "character" ? "character" : "direction";
}

function getLoraFolderLabel(lora) {
  const folder = String(lora.folder ?? "").replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  if (folder) return folder;
  return getLoraCategory(lora) === "character" ? "登録キャラクター" : "未分類（画風など）";
}

function countLoraCategories() {
  return installedLoras.reduce((counts, lora) => {
    counts[getLoraCategory(lora)] += 1;
    return counts;
  }, { character: 0, direction: 0 });
}

function updateLoraCategoryButtons() {
  const counts = countLoraCategories();
  const countByCategory = {
    character: counts.character,
    direction: counts.direction,
    selected: selectedLoras.size,
    all: installedLoras.length
  };
  for (const button of elements.loraCategories.querySelectorAll("[data-lora-category]")) {
    const category = button.dataset.loraCategory;
    const active = category === activeLoraCategory;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
    const count = button.querySelector("span");
    if (count) count.textContent = String(countByCategory[category] ?? 0);
  }
}

function registerDetectedProfiles() {
  let changed = false;
  for (const lora of installedLoras) {
    let profile = getProfile(loraProfileAssignments.get(lora.name));
    if (!profile) {
      profile = findProfileForLora(lora) ?? createRegistryProfile(lora);
      if (profile) {
        loraProfileAssignments.set(lora.name, profile.id);
        changed = true;
      }
    }
    if (!profile) continue;

    const hadPreset = loraPresetSelections.has(lora.name);
    const preset = getPreset(profile, loraPresetSelections.get(lora.name));
    const addon = getAddon(profile, loraAddonSelections.get(lora.name));
    if (!hadPreset) {
      loraPresetSelections.set(lora.name, preset.id);
      changed = true;
    }
    if (profile.addons?.length && !loraAddonSelections.has(lora.name) && addon) {
      loraAddonSelections.set(lora.name, addon.id);
      changed = true;
    }
    const currentTriggerWords = loraTriggers.get(lora.name);
    const shouldRestorePreset = !hadPreset
      && (!currentTriggerWords || currentTriggerWords === lora.registry?.triggerWords);
    if (shouldRestorePreset || !loraWeights.has(lora.name)) {
      loraWeights.set(lora.name, getPresetWeight(profile, preset));
      changed = true;
    }
    if (shouldRestorePreset || !currentTriggerWords) {
      loraTriggers.set(lora.name, combineTriggerWords(preset.triggerWords, addon?.triggerWords));
      changed = true;
    }
    if (shouldRestorePreset) {
      if (addon?.clearNegativeWords) loraNegativeWords.delete(lora.name);
      else if (preset.negativeWords) loraNegativeWords.set(lora.name, preset.negativeWords);
      else loraNegativeWords.delete(lora.name);
      changed = true;
    } else if (!addon?.clearNegativeWords && !loraNegativeWords.has(lora.name) && preset.negativeWords) {
      loraNegativeWords.set(lora.name, preset.negativeWords);
      changed = true;
    }
  }
  if (changed) {
    saveLoraWeights();
    saveLoraTriggers();
    saveLoraNegativeWords();
    saveProfileSettings();
  }
}

function registerCivitaiDefaults() {
  let changed = false;
  for (const lora of installedLoras) {
    const registry = lora.registry;
    if (!registry) continue;
    // 未設定LoRAだけCivitai推奨Weightを初期適用（ユーザー保存済み・再解析では上書きしない）。
    if (shouldApplyRecommendedWeight(loraWeights.has(lora.name), registry.recommendedWeight)) {
      loraWeights.set(lora.name, Number(registry.recommendedWeight));
      changed = true;
    }
    if (!loraTriggers.has(lora.name) && registry.triggerWords) {
      loraTriggers.set(lora.name, registry.triggerWords);
      changed = true;
    }
  }
  if (changed) {
    saveLoraWeights();
    saveLoraTriggers();
  }
}

function migrateCharacterProfileDefaults() {
  const currentVersion = Number(localStorage.getItem("localImageChat.loraProfileVersion") ?? 0);
  if (currentVersion >= PROFILE_STORAGE_VERSION) return;

  for (const lora of installedLoras) {
    const profile = resolveProfile(lora);
    if (!profile?.legacyDefaultPreset) continue;
    const selectedPresetId = loraPresetSelections.get(lora.name);
    if (selectedPresetId && selectedPresetId !== profile.legacyDefaultPreset) continue;

    const legacyPreset = profile.presets.find((preset) => preset.id === profile.legacyDefaultPreset);
    const currentTriggerWords = loraTriggers.get(lora.name);
    if (currentTriggerWords && legacyPreset && currentTriggerWords !== legacyPreset.triggerWords) continue;

    const identityPreset = profile.presets.find((preset) => preset.id === "identity");
    if (!identityPreset) continue;
    loraPresetSelections.set(lora.name, identityPreset.id);
    applyProfilePreset(lora.name, profile, identityPreset);
  }

  localStorage.setItem("localImageChat.loraProfileVersion", String(PROFILE_STORAGE_VERSION));
  saveProfileSettings();
}

function resolveProfile(lora) {
  return getProfile(loraProfileAssignments.get(lora.name))
    ?? findProfileForLora(lora)
    ?? createRegistryProfile(lora);
}

function fillPresetSelect(select, profile, selectedPresetId) {
  select.replaceChildren();
  if (!profile) {
    select.append(new Option("衣装プリセットなし", ""));
    select.disabled = true;
    return;
  }
  select.disabled = false;
  const identityGroup = document.createElement("optgroup");
  identityGroup.label = "キャラのみ";
  const outfitGroup = document.createElement("optgroup");
  outfitGroup.label = profile.category === "direction" ? "キャラクター" : "衣装プリセット";
  for (const preset of profile.presets) {
    const option = new Option(preset.name, preset.id);
    if (preset.id === "identity") identityGroup.append(option);
    else outfitGroup.append(option);
  }
  if (identityGroup.children.length) select.append(identityGroup);
  if (outfitGroup.children.length) select.append(outfitGroup);
  select.value = getPreset(profile, selectedPresetId)?.id ?? profile.defaultPreset;
}

function fillAddonSelect(select, profile, selectedAddonId) {
  select.replaceChildren();
  if (!profile?.addons?.length) {
    select.append(new Option("追加衣装なし", ""));
    select.disabled = true;
    select.classList.add("hidden");
    return;
  }
  select.disabled = false;
  select.classList.remove("hidden");
  for (const addon of profile.addons) select.append(new Option(addon.name, addon.id));
  select.value = getAddon(profile, selectedAddonId)?.id ?? profile.defaultAddon ?? profile.addons[0].id;
}

function getAddon(profile, addonId) {
  if (!profile?.addons?.length) return null;
  return profile.addons.find((addon) => addon.id === addonId)
    ?? profile.addons.find((addon) => addon.id === profile.defaultAddon)
    ?? profile.addons[0];
}

function combineTriggerWords(...values) {
  const seen = new Set();
  return values
    .flatMap((value) => String(value ?? "").split(","))
    .map((word) => word.trim())
    .filter((word) => {
      const normalized = word.toLowerCase();
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .join(", ");
}

function applyProfileSelection(loraName, profile, preset, addon = null) {
  const weight = getPresetWeight(profile, preset);
  loraWeights.set(loraName, weight);
  loraTriggers.set(loraName, combineTriggerWords(preset.triggerWords, addon?.triggerWords));
  if (addon?.clearNegativeWords) loraNegativeWords.delete(loraName);
  else if (preset.negativeWords) loraNegativeWords.set(loraName, preset.negativeWords);
  else loraNegativeWords.delete(loraName);
  if (selectedLoras.has(loraName)) selectedLoras.set(loraName, weight);
  saveLoraWeights();
  saveLoraTriggers();
  saveLoraNegativeWords();
  saveProfileSettings();
}

function applyProfilePreset(loraName, profile, preset) {
  applyProfileSelection(loraName, profile, preset, getAddon(profile, loraAddonSelections.get(loraName)));
}

function getPresetWeight(profile, preset) {
  return Number(preset?.recommendedWeight ?? profile?.recommendedWeight ?? loraConfig.defaultWeight);
}

function renderSelectedLoraSummary() {
  // LoRAの選択・weight・トリガーワード編集はすべてここを通るので、
  // トリガーワード枠の追加・削除もここで同期する。
  syncAppliedTriggerWords();
  renderUsedLoras();
  const items = [...selectedLoras].map(([name, weight]) => {
    const triggerWords = loraTriggers.get(name);
    const suppressesOutfit = Boolean(loraNegativeWords.get(name));
    return `${name} ${Number(weight).toFixed(2)}${triggerWords ? `・${triggerWords}` : ""}${suppressesOutfit ? "・標準衣装を抑制" : ""}`;
  });
  const compatibilityWarnings = [...selectedLoras.keys()]
    .map((name) => installedLoras.find((lora) => lora.name === name))
    .filter(Boolean)
    .map((lora) => ({ lora, compatibility: getLoraCompatibility(lora) }))
    .filter(({ lora, compatibility }) =>
      lora.registry?.baseModel && ["caution", "incompatible"].includes(compatibility.level)
    )
    .map(({ lora, compatibility }) => `${lora.displayName}: ${compatibility.message}`);
  elements.loraSelectedCount.textContent = `${items.length}個選択`;
  elements.selectedLoraSummary.textContent = items.length
    ? `使用: ${items.join(" / ")}${compatibilityWarnings.length ? `\n⚠ ${compatibilityWarnings.join(" / ")}` : ""}`
    : "LoRAなし";
  elements.selectedLoraSummary.classList.toggle("hasCompatibilityWarning", Boolean(compatibilityWarnings.length));
  syncExperimentTargetVisibility();
}

async function checkHealth() {
  elements.health.innerHTML = '<span class="status waiting">Ollama 確認中</span><span class="status waiting">ReForge 確認中</span>';
  try {
    const response = await fetch("/api/health");
    const data = await response.json();
    const ollamaText = data.ollama.ok
      ? `Ollama 接続OK${data.ollama.installed ? "" : "・モデル未検出"}`
      : "Ollama 接続失敗";
    const reforgeText = data.reforge.ok
      ? `ReForge 接続OK・${shorten(data.reforge.checkpoint, 28)}`
      : "ReForge 接続失敗";
    elements.health.innerHTML = [
      status(ollamaText, data.ollama.ok && data.ollama.installed, data.ollama.error),
      status(reforgeText, data.reforge.ok, data.reforge.error)
    ].join("");
  } catch (error) {
    elements.health.innerHTML = status("接続確認に失敗", false, error.message);
  }
}

async function buildPrompt() {
  clearError();
  const description = elements.description.value.trim();
  if (!description) return showError("生成したい画像を日本語で入力してくれ");
  setBusy(true, "日本語からプロンプトを作成中…");
  try {
    const data = await requestPrompt(description);
    elements.explanation.textContent = data.explanation_ja;
    elements.promptDetails.open = true;
    setPromptMode("raw");
  } catch (error) {
    showError(error.message);
  } finally {
    setBusy(false);
  }
}

async function generateCandidates() {
  clearError();
  const description = elements.description.value.trim();
  // 説明文は任意。Promptが空のときだけ、日本語からの自動作成のために必須になる。
  if (!description && !currentPositivePrompt().trim()) {
    return showError("生成したい画像を日本語で入力するか、Promptを入力してくれ");
  }
  if (generationMode !== "txt2img" && !initImageReference) {
    setGenerationMode(generationMode);
    return showError(`${generationMode === "inpaint" ? "部分修正" : "img2img"}の参照画像を選択してください`);
  }
  if (generationMode === "inpaint" && !maskHasWhitePixels()) {
    return showError("修正したい範囲を白く塗ってください");
  }

  // プロンプト内のLoRAタグとUI選択を先に揃えてから、送信内容を組み立てる。
  syncLorasFromPrompt();
  setResultTab("result");
  elements.emptyState.classList.add("hidden");
  elements.finalResult.classList.add("hidden");
  finalImage = null;
  finalGeneration = null;
  selectedCandidate = null;
  const count = Number(elements.candidateCount.value);
  const modeLabel = generationMode === "inpaint"
    ? "部分修正候補"
    : generationMode === "img2img"
      ? "img2img候補"
      : "候補";
  setBusy(true, `${count}枚の${modeLabel}を1枚ずつ生成します…`);

  try {
    if (shouldRequestPrompt(description)) {
      elements.loadingText.textContent = "日本語からプロンプトを作成中…";
      await requestPrompt(description);
    }

    elements.loadingText.textContent = `${count}枚の${modeLabel}を1枚ずつ生成中…`;
    const data = await submitGeneration({
      mode: generationMode,
      description,
      ...readPromptPayload(),
      loras: readSelectedLoras(),
      promptBoosts: readPromptBoosts(),
      ...readInitImagePayload(),
      ...readInpaintPayload(),
      ...readDerivationPayload(),
      settings: readSettings({ candidateCount: count, hiresEnabled: false })
    });

    lastGeneration = {
      mode: data.mode,
      sourceImageId: data.sourceImageId,
      sourceImageUrl: data.sourceImageUrl,
      maskImageUrl: data.maskImageUrl,
      description,
      prompt: data.prompt,
      negativePrompt: data.negativePrompt,
      structuredPrompt: data.structuredPrompt ?? null,
      rawPromptOverride: data.rawPromptOverride === true,
      rawPrompt: data.rawPrompt ?? "",
      appliedTriggerWords: data.appliedTriggerWords ?? [],
      settings: data.settings,
      loras: data.loras,
      images: data.images
    };
    applyGeneratedPromptResult(data, description);
    elements.explanation.textContent = data.explanation;
    renderCandidates(data.images);
    elements.resultContent.classList.remove("hidden");
    await loadHistory();
  } catch (error) {
    showError(error.message);
    if (!lastGeneration) elements.emptyState.classList.remove("hidden");
  } finally {
    setBusy(false);
  }
}

async function finishSelected() {
  if (!selectedCandidate || !lastGeneration) return;
  clearError();
  const isImg2Img = lastGeneration.mode === "img2img";
  const isInpaint = lastGeneration.mode === "inpaint";
  const usesSource = isImg2Img || isInpaint;
  setBusy(true, isInpaint
    ? `Seed ${selectedCandidate.seed} を部分修正の高解像度仕上げ中…`
    : isImg2Img
      ? `Seed ${selectedCandidate.seed} をimg2img高解像度仕上げ中…`
      : `Seed ${selectedCandidate.seed} をHires.fix中…`);

  try {
    const data = await submitGeneration({
      mode: usesSource ? lastGeneration.mode : "txt2img",
      description: lastGeneration.description,
      prompt: lastGeneration.prompt,
      negativePrompt: lastGeneration.negativePrompt,
      ...carryStructuredPrompt(lastGeneration),
      loras: lastGeneration.loras,
      promptBoosts: [],
      parentImageId: selectedCandidate.id,
      ...(usesSource ? { initImageId: selectedCandidate.id } : {}),
      settings: {
        ...lastGeneration.settings,
        candidateCount: 1,
        seed: selectedCandidate.seed,
        hiresEnabled: true,
        hiresScale: elements.hiresScale.value,
        hiresSteps: elements.hiresSteps.value,
        hiresDenoising: elements.hiresDenoising.value,
        hiresUpscaler: elements.hiresUpscaler.value
      }
    });

    presentHiresResult(
      data,
      lastGeneration.description,
      isInpaint ? "INPAINT REFINE COMPLETE" : isImg2Img ? "IMG2IMG REFINE COMPLETE" : "HIRES.FIX COMPLETE",
      isInpaint ? "部分修正・高解像度版" : isImg2Img ? "img2img高解像度版" : "高解像度版"
    );
    await loadHistory();
  } catch (error) {
    showError(error.message);
  } finally {
    setBusy(false);
  }
}

// Hires仕上げ・再生成でも、元の構造化プロンプト情報を履歴へ引き継ぐ。
// 実際に使うPositive Promptは呼び出し側のpromptのままで、ここでは記録用の情報だけ渡す。
function carryStructuredPrompt(source) {
  if (!source?.structuredPrompt) return {};
  return {
    structuredPrompt: source.structuredPrompt,
    rawPromptOverride: source.rawPromptOverride === true,
    rawPrompt: source.rawPrompt ?? "",
    appliedTriggerWords: source.appliedTriggerWords ?? []
  };
}

// 高解像度仕上げの結果を「生成結果」タブへ表示する共通処理。
function presentHiresResult(data, description, eyebrow, title) {
  const finished = data.images[0];
  finalImage = finished;
  finalGeneration = {
    mode: data.mode,
    sourceImageId: data.sourceImageId,
    sourceImageUrl: data.sourceImageUrl,
    maskImageUrl: data.maskImageUrl,
    description,
    prompt: data.prompt,
    negativePrompt: data.negativePrompt,
    structuredPrompt: data.structuredPrompt ?? null,
    rawPromptOverride: data.rawPromptOverride === true,
    rawPrompt: data.rawPrompt ?? "",
    appliedTriggerWords: data.appliedTriggerWords ?? [],
    settings: data.settings,
    loras: data.loras,
    images: data.images
  };
  elements.finalEyebrow.textContent = eyebrow;
  elements.finalTitle.textContent = title;
  elements.resultImage.src = `${finished.imageUrl}?t=${Date.now()}`;
  elements.seedText.textContent = `Seed ${finished.seed}`;
  elements.resolutionText.textContent = `${finished.width} × ${finished.height}`;
  elements.downloadLink.href = finished.imageUrl;
  elements.downloadLink.download = finished.filename;
  elements.favoriteFinalButton.dataset.favoriteImage = finished.id;
  elements.favoriteFinalButton.dataset.favoriteStyle = "label";
  imageFavorites.set(finished.id, Boolean(finished.favorite));
  renderFavoriteButton(elements.favoriteFinalButton, Boolean(finished.favorite));
  if (finished.discord) discordStates.set(finished.id, finished.discord);
  elements.finalDiscordStatus.dataset.discordImage = finished.id;
  renderDiscordStatusNode(elements.finalDiscordStatus, finished.id);
  elements.emptyState.classList.add("hidden");
  elements.resultContent.classList.remove("hidden");
  elements.finalResult.classList.remove("hidden");
  elements.finalResult.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ギャラリー画像を起点に、元画像ベース(img2img)で高解像度仕上げする。
// GPUタイムアウトを避けるため、Hiresの初期値は安全寄りの固定値を使う。
const GALLERY_HIRES_DEFAULTS = { scale: 1.5, steps: 12, denoising: 0.28 };

async function hiresFromGallery(generation, image) {
  const settings = generation.settings ?? {};
  const scale = GALLERY_HIRES_DEFAULTS.scale;
  const steps = GALLERY_HIRES_DEFAULTS.steps;
  const denoising = GALLERY_HIRES_DEFAULTS.denoising;
  const confirmed = await confirmDialog(
    `この画像を高解像度仕上げします（${scale}倍・${steps} steps・Denoising ${denoising}）。よろしいですか？`,
    { confirmText: "Hiresする", cancelText: "キャンセル" }
  );
  if (!confirmed) return;

  clearError();
  setResultTab("result");
  elements.emptyState.classList.add("hidden");
  elements.finalResult.classList.add("hidden");
  setBusy(true, `Seed ${image.seed} を高解像度仕上げ中…`);
  try {
    const data = await submitGeneration({
      mode: "img2img",
      description: generation.description ?? "",
      prompt: generation.prompt ?? "",
      negativePrompt: generation.negativePrompt ?? "",
      ...carryStructuredPrompt(generation),
      loras: generation.loras ?? [],
      promptBoosts: [],
      parentImageId: image.id,
      initImageId: image.id,
      settings: {
        ...settings,
        candidateCount: 1,
        seed: image.seed,
        hiresEnabled: true,
        hiresScale: scale,
        hiresSteps: steps,
        hiresDenoising: denoising,
        hiresUpscaler: settings.hiresUpscaler || elements.hiresUpscaler.value
      }
    });
    presentHiresResult(data, generation.description ?? "", "GALLERY HIRES COMPLETE", "高解像度版");
    await loadHistory();
  } catch (error) {
    showError(error.message);
  } finally {
    setBusy(false);
  }
}

// ---- パラメータ比較（実験） ----

async function loadExperiments() {
  try {
    const data = await getJson("/api/experiments?limit=50");
    experimentParameters = data.parameters ?? {};
    experimentLimits = data.limits ?? experimentLimits;
    knownExperiments = data.experiments ?? [];
  } catch {
    knownExperiments = [];
  }
  renderExperimentParameterSelect();
  renderExperimentBadge();
  restoreExperimentMonitoring();
}

// 起動時やギャラリー再読込時に、未完了の実験が残っていれば監視を復元する。
// サーバー側でジョブが消えた実験は取得時に終端状態へ正規化されるため、ここには出てこない。
function restoreExperimentMonitoring() {
  if (experimentPolling) return;
  const running = knownExperiments.find((item) => item.status === "running");
  if (running) {
    activeExperimentId = running.id;
    void pollExperiment(running.id);
  }
  syncExperimentControls();
}

// 比較実験は同時に1本だけ。実行中は開始ボタンを押せないようにする。
function syncExperimentControls() {
  const running = Boolean(activeExperimentId);
  elements.runExperimentButton.disabled = running;
  elements.cancelExperimentButton.disabled = !running;
}

function renderExperimentParameterSelect() {
  const select = elements.experimentParameter;
  const current = select.value;
  select.replaceChildren();
  for (const [key, definition] of Object.entries(experimentParameters)) {
    select.append(new Option(definition.label, key));
  }
  if (!select.options.length) select.append(new Option("LoRA weight", "loraWeight"));
  if ([...select.options].some((option) => option.value === current)) select.value = current;
  syncExperimentTargetVisibility();
}

function syncExperimentTargetVisibility() {
  const parameter = elements.experimentParameter.value;
  const needsTarget = experimentParameters[parameter]?.needsTarget === true || parameter === "loraWeight";
  elements.experimentTargetRow.classList.toggle("hidden", !needsTarget);
  if (!needsTarget) return;
  const select = elements.experimentTarget;
  const current = select.value;
  select.replaceChildren();
  for (const name of selectedLoras.keys()) {
    const lora = findLoraByName(name);
    select.append(new Option(lora?.displayName ?? name, name));
  }
  if (!select.options.length) select.append(new Option("LoRAを選択してください", ""));
  if ([...select.options].some((option) => option.value === current)) select.value = current;
}

function renderExperimentBadge() {
  const running = knownExperiments.find((item) => item.status === "running");
  elements.experimentBadge.textContent = running
    ? `${running.completed}/${running.total} 生成中`
    : knownExperiments.length
      ? `${knownExperiments.length}件の実験`
      : "未実行";
}

async function runExperiment() {
  clearError();
  if (activeExperimentId) {
    return toast.warning("別の比較実験が実行中です。完了または中断してから開始してください");
  }
  const parameter = elements.experimentParameter.value;
  const definition = experimentParameters[parameter];
  const needsTarget = definition?.needsTarget === true || parameter === "loraWeight";
  const target = needsTarget ? elements.experimentTarget.value : "";
  if (needsTarget && !target) return toast.warning("比較する対象LoRAを選択してください");

  const values = elements.experimentValues.value
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.length < 2) return toast.warning("試す値をカンマ区切りで2つ以上入力してください");
  if (values.length > experimentLimits.maxImages) {
    return toast.warning(`比較生成は最大${experimentLimits.maxImages}枚までです`);
  }
  if (values.length > 4) {
    const confirmed = await confirmModal(
      `${values.length}枚を1枚ずつ順番に生成します。時間がかかりますがよろしいですか？`,
      { title: "比較生成の確認", confirmText: "生成する" }
    );
    if (!confirmed) return;
  }

  const description = elements.description.value.trim();
  if (!description && !currentPositivePrompt().trim()) {
    return toast.warning("生成したい画像を日本語で入力するか、Promptを入力してください");
  }
  if (generationMode !== "txt2img" && !initImageReference) {
    return toast.warning(`${generationMode === "inpaint" ? "部分修正" : "img2img"}の参照画像を選択してください`);
  }

  // Seed固定: -1のままだと値ごとに別Seedになるため、実行前に確定させる。
  let fixedSeed = null;
  if (elements.experimentFixSeed.checked && parameter !== "seed") {
    let seed = Number(elements.seed.value);
    if (!Number.isFinite(seed) || seed < 0) {
      seed = Math.floor(Math.random() * 4294967295);
      elements.seed.value = String(seed);
    }
    fixedSeed = seed;
  }

  syncLorasFromPrompt();
  await withBusy(elements.runExperimentButton, "開始中…", async () => {
    try {
      if (shouldRequestPrompt(description)) {
        elements.experimentStatus.textContent = "日本語からプロンプトを作成中…";
        await requestPrompt(description);
      }
      const baseRequest = {
        mode: generationMode,
        description,
        ...readPromptPayload(),
        loras: readSelectedLoras(),
        promptBoosts: readPromptBoosts(),
        ...readInitImagePayload(),
        ...readInpaintPayload(),
        settings: readSettings({ candidateCount: 1, hiresEnabled: false })
      };
      const { experiment } = await postJson("/api/experiments", {
        baseRequest,
        parameter,
        target,
        values,
        fixedSeed
      });
      activeExperimentId = experiment.id;
      toast.info(`比較生成を開始しました（${experiment.total}枚）`);
      startQueuePolling();
      void pollExperiment(experiment.id);
    } catch (error) {
      elements.experimentStatus.textContent = error.message;
      toast.error(error.message);
    }
  });
  // withBusyがdisabledを元へ戻すため、実行状態を最後に反映し直す。
  syncExperimentControls();
}

async function pollExperiment(experimentId) {
  // 監視は1本だけ。実行中の実験IDは上書きしない。
  if (experimentPolling) return;
  experimentPolling = true;
  activeExperimentId = experimentId;
  syncExperimentControls();
  elements.experimentProgress.classList.remove("hidden");
  try {
    while (true) {
      const { experiment } = await getJson(`/api/experiments/${experimentId}`);
      renderExperimentProgress(experiment);
      if (experiment.status !== "running") {
        elements.experimentStatus.textContent = experiment.status === "cancelled"
          ? `中断しました（完了 ${experiment.completed}/${experiment.total} 枚は履歴に残ります）`
          : `完了: ${experiment.completed}/${experiment.total} 枚`;
        if (experiment.status === "cancelled") toast.warning("比較生成を中断しました");
        else toast.success(`比較生成が完了しました（${experiment.completed}枚）`);
        await loadHistory();
        await loadExperiments();
        return;
      }
      await sleep(1000);
    }
  } catch (error) {
    elements.experimentStatus.textContent = `実験の状態を取得できません: ${error.message}`;
  } finally {
    experimentPolling = false;
    activeExperimentId = null;
    syncExperimentControls();
  }
}

function renderExperimentProgress(experiment) {
  elements.experimentProgress.replaceChildren();
  const heading = document.createElement("strong");
  heading.textContent = `${experiment.name}（${experiment.completed}/${experiment.total}）`;
  elements.experimentProgress.append(heading);
  for (const run of experiment.runs) {
    const row = document.createElement("div");
    row.className = `experimentRun status-${run.status}`;
    const label = document.createElement("span");
    label.textContent = `${run.index}. ${experiment.target ? `${experiment.target} ` : ""}${run.value}`;
    const state = document.createElement("span");
    state.textContent = {
      queued: "待機中", running: run.message || "生成中", done: "完了",
      failed: run.error || "失敗", cancelled: "中止"
    }[run.status] ?? run.status;
    // 中断理由（サーバー再起動によるものなど）はツールチップで確認できる。
    if (run.error) state.title = run.error;
    row.append(label, state);
    // 自動リカバリで設定を下げたrunは、公平な比較にならないことを明示する。
    if (run.recovered) row.append(recoveredBadge(run.retryInfo));
    elements.experimentProgress.append(row);
  }
  const running = experiment.runs.find((run) => run.status === "running");
  elements.experimentStatus.textContent = running
    ? `${running.index} / ${experiment.total} 生成中・${experiment.target ? `${experiment.target}: ` : ""}${running.value}`
    : `${experiment.completed} / ${experiment.total} 完了`;
  renderExperimentBadge();
}

// 「設定を下げて再試行」バッジ。何を下げたかはtitleで確認できる。
function recoveredBadge(retryInfo) {
  const badge = document.createElement("span");
  badge.className = "experimentRecovered";
  badge.textContent = "設定を下げて再試行";
  badge.title = describeRetryInfo(retryInfo) || "自動リカバリのため設定を下げて再試行しました";
  return badge;
}

async function cancelExperiment() {
  if (!activeExperimentId) return;
  await withBusy(elements.cancelExperimentButton, "中断中…", async () => {
    try {
      await postJson(`/api/experiments/${activeExperimentId}/cancel`, {});
    } catch (error) {
      toast.error(error.message);
    }
  });
  syncExperimentControls();
}

async function requestPrompt(description) {
  const data = await postJson("/api/prompt", {
    description,
    promptBoosts: readPromptBoosts()
  });
  setPromptFields(data.prompt, data.negative_prompt, description);
  return data;
}

// Raw Promptへ全文を入れる（AI生成・履歴復元・セット適用など）。
// 空文字を渡した場合は上書きを解除し、分割入力の結合結果へ戻す。
function setPromptFields(prompt, negativePrompt, description, { source = "generated" } = {}) {
  settingPromptProgrammatically = true;
  elements.prompt.value = prompt;
  elements.negativePrompt.value = negativePrompt;
  settingPromptProgrammatically = false;
  rawPromptOverride = Boolean(String(prompt ?? "").trim());
  rawPromptOverrideSource = source;
  promptDescription = description;
  if (!rawPromptOverride) syncRawPromptFromSections();
  syncPromptClearButtons();
  renderPromptModeState();
  renderPromptFieldPreviews();
}

function handleDescriptionChange() {
  const current = elements.description.value.trim();
  if (promptDescription && current !== promptDescription) {
    if (compositionLock) unlockComposition();
    settingPromptProgrammatically = true;
    // 分割入力の内容は消さない。自動生成・上書きしたRaw Promptだけを破棄する。
    elements.prompt.value = "";
    elements.negativePrompt.value = "";
    settingPromptProgrammatically = false;
    rawPromptOverride = false;
    rawPromptOverrideSource = "manual";
    promptDescription = "";
    syncRawPromptFromSections();
    syncPromptClearButtons();
    renderPromptModeState();
  }
}

function markPromptAsCurrent() {
  if (!settingPromptProgrammatically) {
    promptDescription = elements.description.value.trim();
  }
}

// ---- 用途別Positive Prompt（分割入力）とRaw Prompt ----

function promptFieldElement(field) {
  return elements[PROMPT_FIELD_ELEMENTS[field]];
}

function readStructuredSections() {
  const sections = {};
  for (const field of PROMPT_FIELDS) sections[field] = promptFieldElement(field).value;
  return sections;
}

function writeStructuredSections(sections) {
  const normalized = normalizeSections(sections);
  for (const field of PROMPT_FIELDS) promptFieldElement(field).value = normalized[field];
  // 中身が入った項目は開いて見せる（スマホの折りたたみ対策）。
  revealFilledPromptFields();
}

function buildCombinedPrompt() {
  return buildFinalPrompt(readStructuredSections(), appliedTriggerWords);
}

// 生成に使うPositive Prompt。Raw Promptを直接編集していればそちらを優先する。
function currentPositivePrompt() {
  return rawPromptOverride ? elements.prompt.value : buildCombinedPrompt();
}

// Raw Promptは、上書き中でなければ結合結果のミラーとして保つ。
// これで既存コード（elements.prompt.valueを読む箇所）はそのまま動く。
function syncRawPromptFromSections() {
  if (!rawPromptOverride) {
    settingPromptProgrammatically = true;
    elements.prompt.value = buildCombinedPrompt();
    settingPromptProgrammatically = false;
    syncPromptClearButtons();
  }
  const combined = buildCombinedPrompt();
  elements.structuredPromptPreview.textContent = `結合結果: ${combined || "（未入力）"}`;
  renderRawTriggerNotice();
}

function setPromptMode(mode) {
  promptMode = mode === "raw" ? "raw" : "structured";
  const raw = promptMode === "raw";
  elements.structuredPromptPanel.classList.toggle("hidden", raw);
  elements.rawPromptPanel.classList.toggle("hidden", !raw);
  elements.structuredPromptTabButton.classList.toggle("active", !raw);
  elements.rawPromptTabButton.classList.toggle("active", raw);
  elements.structuredPromptTabButton.setAttribute("aria-selected", String(!raw));
  elements.rawPromptTabButton.setAttribute("aria-selected", String(raw));
}

function renderPromptModeState() {
  elements.rawPromptNotice.classList.toggle("hidden", !rawPromptOverride);
  elements.rawPromptNoticeText.textContent = rawPromptOverrideSource === "generated"
    ? "自動生成したRaw Promptを使用中です。分割入力より優先されます。"
    : "Raw Promptを直接編集中です。生成にはこの内容を使います。";
  renderRawTriggerNotice();
}

// Raw Prompt優先中は勝手に差し込まない。追加ボタンだけを出す。
function renderRawTriggerNotice() {
  const pending = rawPromptOverride
    ? pendingTriggerWords(elements.prompt.value, appliedTriggerWords.filter((item) => item.enabled))
    : [];
  elements.rawTriggerNotice.classList.toggle("hidden", !pending.length);
  if (!pending.length) return;
  elements.rawTriggerNoticeText.textContent =
    `このLoRAにはトリガーワードがあります（${pending.map((item) => item.text).join(", ")}）`;
}

function handleStructuredPromptInput() {
  markPromptAsCurrent();
  syncRawPromptFromSections();
  renderPromptFieldPreviews();
  scheduleLoraSync();
}

// 折りたたみ中でも中身が分かるように、見出しへ状態と先頭の内容を出す。
function renderPromptFieldPreviews() {
  for (const element of promptFieldTextareas()) {
    const value = element.value.trim().replace(/\s+/g, " ");
    const preview = document.querySelector(`[data-preview-for="${element.id}"]`);
    if (preview) {
      preview.textContent = value ? `：${value.slice(0, 40)}${value.length > 40 ? "…" : ""}` : "";
    }
    const state = document.querySelector(`[data-state-for="${element.id}"]`);
    if (!state) continue;
    const tags = value.split(",").map((tag) => tag.trim()).filter(Boolean);
    state.textContent = tags.length ? `${tags.length}タグ` : "空";
    state.classList.toggle("filled", tags.length > 0);
  }
}

// 構造化プロンプトの6項目 + Negative Prompt。
function promptFieldTextareas() {
  return [...PROMPT_FIELDS.map((field) => promptFieldElement(field)), elements.negativePrompt];
}

// スマホでは縦に長くなるため、中身のある項目とキャラクターだけ開いておく。
function setupPromptFieldAccordions() {
  if (isNarrowScreen()) {
    for (const block of document.querySelectorAll("[data-prompt-field]")) {
      const field = block.dataset.promptField;
      block.open = field === "character" || Boolean(promptFieldValue(field).trim());
    }
  }
  renderPromptFieldPreviews();
}

function promptFieldValue(field) {
  if (field === "negative") return elements.negativePrompt.value;
  return promptFieldElement(field)?.value ?? "";
}

function isNarrowScreen() {
  return window.matchMedia("(max-width: 520px)").matches;
}

// 履歴復元・インポートで中身が入った項目は開いて見せる。
function revealFilledPromptFields() {
  for (const block of document.querySelectorAll("[data-prompt-field]")) {
    if (promptFieldValue(block.dataset.promptField).trim()) block.open = true;
  }
  renderPromptFieldPreviews();
}

function handleRawPromptInput() {
  if (settingPromptProgrammatically) return;
  markPromptAsCurrent();
  // 直接編集した時点でRaw Prompt優先へ切り替える（勝手に上書きしないため）。
  rawPromptOverride = true;
  rawPromptOverrideSource = "manual";
  renderPromptModeState();
  scheduleLoraSync();
}

// ---- プロンプト内LoRAタグとLoRA選択UIの同期 ----

// 生成に使う側のPositive Prompt入力欄だけを見る。
// Raw Prompt優先中はRaw Prompt、そうでなければ分割入力（Rawはその写し）。
function positivePromptSources() {
  if (rawPromptOverride) return [{ key: "raw", value: elements.prompt.value }];
  return PROMPT_FIELDS.map((field) => ({ key: field, value: promptFieldElement(field).value }));
}

function writePromptSource(key, text) {
  if (key === "raw") {
    settingPromptProgrammatically = true;
    elements.prompt.value = text;
    settingPromptProgrammatically = false;
    return;
  }
  promptFieldElement(key).value = text;
}

function currentSelectionState() {
  return [...selectedLoras].map(([name, weight]) => ({
    name,
    weight,
    source: loraSelectionSources.get(name) ?? "ui"
  }));
}

// 入力のたびに走らせない。少し待ってからまとめて同期する。
function scheduleLoraSync() {
  clearTimeout(loraSyncTimer);
  loraSyncTimer = setTimeout(() => syncLorasFromPrompt(), LORA_SYNC_DEBOUNCE);
}

// プロンプト → UI。プロンプトに書かれたWeightを正としてUI側を合わせる。
function syncLorasFromPrompt() {
  clearTimeout(loraSyncTimer);
  if (!installedLoras.length) return;
  const text = positivePromptSources().map((source) => source.value).join("\n");
  const result = reconcilePromptLoras(parseLoraTags(text), currentSelectionState(), installedLoras);
  loraSyncNotices = buildLoraNotices(result);
  renderLoraSyncNotice(describeLoraNotices(result));
  if (!result.changed) return;

  selectedLoras.clear();
  loraSelectionSources.clear();
  for (const item of result.selected) {
    selectedLoras.set(item.name, item.weight);
    loraSelectionSources.set(item.name, item.source);
    loraWeights.set(item.name, item.weight);
  }
  saveLoraWeights();
  renderLoras();
  renderSelectedLoraSummary();
}

function renderLoraSyncNotice(messages) {
  elements.loraSyncNotice.replaceChildren();
  elements.loraSyncNotice.classList.toggle("hidden", !messages.length);
  for (const message of messages) {
    const line = document.createElement("div");
    line.textContent = `⚠ ${message}`;
    elements.loraSyncNotice.append(line);
  }
}

// UI → プロンプト。既存タグのWeight部分だけを書き換える（末尾へ追加しない）。
function applyLoraWeightToPrompt(name, weight) {
  let changed = false;
  for (const source of positivePromptSources()) {
    const next = replaceLoraWeight(source.value, name, weight);
    if (next === source.value) continue;
    writePromptSource(source.key, next);
    changed = true;
  }
  if (!changed) return false;
  syncRawPromptFromSections();
  syncPromptClearButtons();
  return true;
}

// UIでLoRAを外したとき、プロンプトに残ったタグも消す（UIと生成内容をずらさない）。
function removeLoraTagsFromPrompt(name) {
  let removed = 0;
  for (const source of positivePromptSources()) {
    const result = removeLoraTags(source.value, name);
    if (!result.removed) continue;
    writePromptSource(source.key, result.text);
    removed += result.removed;
  }
  if (!removed) return 0;
  syncRawPromptFromSections();
  syncPromptClearButtons();
  return removed;
}

// チェックボックスとプレビューの選択・解除を1か所に集める。
function setLoraSelected(name, selected, weight) {
  if (selected) {
    selectedLoras.set(name, Number(weight));
    const source = loraSelectionSources.get(name);
    loraSelectionSources.set(name, source === "prompt" || source === "both" ? "both" : "ui");
    return;
  }
  selectedLoras.delete(name);
  loraSelectionSources.delete(name);
  const removed = removeLoraTagsFromPrompt(name);
  if (removed) toast.info(`プロンプト内の <lora:${name}> も削除しました`);
}

// Raw Promptの上書きをやめ、分割入力の結合結果へ戻す。
function useStructuredPrompt() {
  rawPromptOverride = false;
  rawPromptOverrideSource = "manual";
  syncRawPromptFromSections();
  renderPromptModeState();
  toast.info("分割入力の結合結果を使います");
}

function appendTriggersToRaw() {
  const enabled = appliedTriggerWords.filter((item) => item.enabled);
  const next = appendTriggersToRawPrompt(elements.prompt.value, enabled);
  if (next === elements.prompt.value.trim()) return toast.info("追加できるトリガーワードはありません");
  settingPromptProgrammatically = true;
  elements.prompt.value = next;
  settingPromptProgrammatically = false;
  syncPromptClearButtons();
  renderPromptModeState();
  toast.success("Raw Promptへトリガーワードを追加しました");
}

// 選択中LoRAのトリガーワード（手入力欄 → 登録メタデータの順）を読む。
function resolveLoraTriggerText(name) {
  const lora = findLoraByName(name);
  return loraTriggers.get(name) || lora?.registry?.triggerWords || "";
}

function loraTriggerSources() {
  const sources = [...selectedLoras.keys()].map((name) => {
    const lora = findLoraByName(name);
    return {
      id: name,
      subcategory: lora?.registry?.subcategory ?? "",
      category: lora?.registry?.category ?? lora?.category ?? "",
      triggerWords: resolveLoraTriggerText(name)
    };
  });
  return [...sources, ...importedTriggerSources()];
}

// AI出力から取り込んだトリガーワードは、LoRAの選択状態に関係なく残す。
// 供給元を今の枠から作り直すことで、同期で消えないようにする。
function importedTriggerSources() {
  const byField = new Map();
  for (const trigger of appliedTriggerWords) {
    const sourceId = trigger.sourceLoraIds.find((id) => id.startsWith(IMPORT_SOURCE_PREFIX));
    if (!sourceId) continue;
    if (!byField.has(sourceId)) byField.set(sourceId, { id: sourceId, words: [] });
    byField.get(sourceId).words.push({
      text: trigger.text,
      weight: trigger.weight,
      targetField: trigger.targetField
    });
  }
  return [...byField.values()];
}

// LoRAの追加・削除・トリガーワード編集のたびに枠を作り直す。
// Weightと有効/無効はユーザーの操作として保持される。
function syncAppliedTriggerWords() {
  const { triggers } = syncTriggerWords(appliedTriggerWords, loraTriggerSources());
  appliedTriggerWords = triggers;
  renderTriggerLists();
  syncRawPromptFromSections();
}

function renderTriggerLists() {
  for (const field of PROMPT_FIELDS) {
    const container = elements[TRIGGER_LIST_ELEMENTS[field]];
    const triggers = triggersForField(appliedTriggerWords, field);
    container.replaceChildren();
    container.classList.toggle("hidden", !triggers.length);
    if (!triggers.length) continue;
    container.append(createTriggerPanel(field, triggers));
  }
}

// 一覧は常時全面表示しない。既定は折りたたみで、見出しに件数と先頭の語だけ出す。
// Weight編集と削除ボタンは展開したときだけ表示する。
function createTriggerPanel(field, triggers) {
  const panel = document.createElement("details");
  panel.className = "triggerPanel";
  // 再描画（LoRA追加・削除・除外操作）で開閉状態が戻らないように覚えておく。
  panel.open = triggerPanelOpen.get(field) === true;
  panel.addEventListener("toggle", () => triggerPanelOpen.set(field, panel.open));

  const summary = document.createElement("summary");
  summary.className = "triggerPanelSummary";
  const title = document.createElement("span");
  title.className = "triggerPanelTitle";
  title.textContent = `LoRAトリガーワード（${triggers.length}）`;
  const preview = document.createElement("span");
  preview.className = "triggerPanelPreview";
  preview.textContent = describeTriggerPreview(triggers);
  summary.append(title, preview);

  const body = document.createElement("div");
  body.className = "triggerPanelBody";
  for (const trigger of triggers) body.append(createTriggerRow(trigger));

  panel.append(summary, body);
  return panel;
}

// 折りたたみ中でも中身が分かるように、先頭2件と除外件数だけ見せる。
function describeTriggerPreview(triggers) {
  const enabled = triggers.filter((item) => item.enabled);
  const disabledCount = triggers.length - enabled.length;
  const notes = [];
  if (enabled.length) {
    const shown = enabled.slice(0, TRIGGER_PREVIEW_COUNT).map((item) => item.text);
    const rest = triggers.length - shown.length;
    notes.push(`${shown.join(", ")}${rest > 0 ? ` ほか${rest}件` : ""}`);
  }
  if (disabledCount) notes.push(`${disabledCount}件を除外中`);
  return notes.join("・");
}

function createTriggerRow(trigger) {
  const row = document.createElement("div");
  row.className = "triggerRow";
  row.classList.toggle("disabled", !trigger.enabled);

  const text = document.createElement("span");
  text.className = "triggerText";
  text.textContent = trigger.text;
  const source = document.createElement("small");
  source.className = "triggerSource";
  const sourceNames = trigger.sourceLoraIds.map((name) => findLoraByName(name)?.displayName ?? name);
  source.textContent = sourceNames.join(" / ");
  source.title = `由来LoRA: ${sourceNames.join(" / ")}`;

  const weightLabel = document.createElement("label");
  weightLabel.className = "triggerWeight";
  weightLabel.append("Weight");
  const weightInput = document.createElement("input");
  weightInput.type = "number";
  weightInput.min = "0.05";
  weightInput.max = "2";
  weightInput.step = "0.05";
  weightInput.value = String(trigger.weight);
  weightInput.disabled = !trigger.enabled;
  weightInput.setAttribute("aria-label", `${trigger.text}のトリガーワードWeight`);
  weightLabel.append(weightInput);

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "triggerToggle";
  toggle.textContent = trigger.enabled ? "×" : "↺";
  toggle.title = trigger.enabled
    ? "このトリガーワードだけを今回の生成から外す"
    : "このトリガーワードを使う";
  toggle.setAttribute("aria-label", `${trigger.text}を${trigger.enabled ? "外す" : "戻す"}`);

  // LoRA本体のWeightとは別管理。ここを変えても<lora:...>のweightは動かない。
  weightInput.addEventListener("input", () => {
    trigger.weight = normalizeTriggerWeight(weightInput.value);
    syncRawPromptFromSections();
  });
  weightInput.addEventListener("change", () => {
    weightInput.value = String(trigger.weight);
  });
  toggle.addEventListener("click", () => {
    trigger.enabled = !trigger.enabled;
    renderTriggerLists();
    syncRawPromptFromSections();
  });

  row.append(text, source, weightLabel, toggle);
  return row;
}

// 生成リクエストへ載せるプロンプト一式（履歴の復元に必要な情報も含む）。
function readPromptPayload() {
  const sections = readStructuredSections();
  return {
    prompt: currentPositivePrompt(),
    negativePrompt: elements.negativePrompt.value,
    structuredPrompt: sections,
    rawPromptOverride,
    rawPrompt: rawPromptOverride ? elements.prompt.value : "",
    appliedTriggerWords: appliedTriggerWords.map((trigger) => ({ ...trigger })),
    // LoRAタグ同期の警告（重複・未インストールなど）も履歴へ残す。
    loraNotices: loraSyncNotices.map((notice) => ({ ...notice }))
  };
}

// 生成結果の確定プロンプトを画面へ戻す。
// 分割入力を使っていた場合は、その内容をRaw Promptで上書きしない。
function applyGeneratedPromptResult(data, description) {
  if (rawPromptOverride) {
    setPromptFields(data.prompt, data.negativePrompt, description, { source: rawPromptOverrideSource });
    return;
  }
  settingPromptProgrammatically = true;
  elements.negativePrompt.value = data.negativePrompt;
  settingPromptProgrammatically = false;
  promptDescription = description;
  syncRawPromptFromSections();
  syncPromptClearButtons();
}

// ---- AI出力の一括インポート ----

// AI回答を貼り付け、解析結果を確認してから各欄へ反映する。
function openAiPromptImport() {
  let parsed = parseAiPromptOutput("");
  let mode = "replace";

  openModal({
    title: "AI出力をインポート",
    subtitle: "GrokやChatGPTの回答を全文そのまま貼り付けてください",
    size: "large",
    dismissValue: false,
    build: (body, close) => {
      const input = document.createElement("textarea");
      input.className = "importInput";
      input.rows = 12;
      input.placeholder = "キャラクター\n1girl, character_name\n\n容姿・衣装\nlong hair, blue eyes\n…";
      input.setAttribute("data-autofocus", "true");
      input.setAttribute("aria-label", "AIの回答");

      const modeRow = document.createElement("div");
      modeRow.className = "importModeRow";
      for (const [value, label] of [["replace", "現在の内容を置き換える"], ["append", "現在の内容の末尾へ追加する"]]) {
        const choice = document.createElement("label");
        choice.className = "importModeChoice";
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "aiImportMode";
        radio.value = value;
        radio.checked = value === mode;
        radio.addEventListener("change", () => { if (radio.checked) mode = value; });
        choice.append(radio, label);
        modeRow.append(choice);
      }

      const preview = document.createElement("div");
      preview.className = "importPreview";

      const renderPreview = () => {
        parsed = parseAiPromptOutput(input.value);
        preview.replaceChildren(...buildImportPreview(parsed, close));
      };
      input.addEventListener("input", renderPreview);
      renderPreview();
      body.append(input, modeRow, preview);
    },
    actions: [
      { label: "キャンセル", value: false, variant: "secondary" },
      {
        label: "各欄へ反映",
        primary: true,
        onSelect: (close) => {
          if (!parsed.recognized) {
            toast.warning("取り込める見出しがありません");
            return false;
          }
          applyImportedPrompt(parsed, mode);
          close(true);
          return true;
        }
      }
    ]
  });
}

// 反映前のプレビュー。取り込む内容と、取り込まなかった部分の両方を出す。
function buildImportPreview(parsed, close) {
  const nodes = [];
  if (!parsed.recognized) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = parsed.ignoredLines.length || parsed.unknownHeadings.length
      ? "分割形式を認識できませんでした"
      : "AIの回答を貼り付けると、ここに解析結果が出ます";
    nodes.push(empty);
    if (parsed.ignoredLines.length || parsed.unknownHeadings.length) {
      const fallback = document.createElement("button");
      fallback.type = "button";
      fallback.className = "secondary smallButton";
      fallback.textContent = "全文をRaw Promptへ入れる";
      fallback.addEventListener("click", () => {
        applyRawPromptImport([...parsed.unknownHeadings, ...parsed.ignoredLines].join("\n"));
        close(true);
      });
      nodes.push(fallback);
    }
    return nodes;
  }

  const list = document.createElement("dl");
  list.className = "importPreviewFields";
  const addRow = (label, value, className = "") => {
    const term = document.createElement("dt");
    term.textContent = label;
    const detail = document.createElement("dd");
    detail.className = className;
    detail.textContent = value;
    list.append(term, detail);
  };

  for (const field of PROMPT_FIELDS) {
    if (parsed.sections[field]) addRow(PROMPT_FIELD_LABELS[field], parsed.sections[field]);
  }
  for (const trigger of parsed.triggerWords) {
    addRow(`LoRAトリガーワード（${PROMPT_FIELD_LABELS[trigger.field]}）`,
      `${trigger.text}・Weight ${trigger.weight}`);
  }
  if (parsed.negativePrompt) addRow("Negative Prompt", parsed.negativePrompt);
  if (parsed.combined) {
    addRow("結合結果", parsed.hasSections
      ? `${parsed.combined}（照合用・二重には追加しません）`
      : `${parsed.combined}（分割項目が無いためRaw Promptへ入れます）`, "importPreviewNote");
  }
  nodes.push(list);

  const notes = [];
  if (parsed.hasSections) notes.push("記載の無い項目は今の内容のままにします");
  if (parsed.unknownHeadings.length) notes.push(`取り込まない見出し: ${parsed.unknownHeadings.join(" / ")}`);
  if (parsed.ignoredLines.length) notes.push(`取り込まない行が${parsed.ignoredLines.length}行あります`);
  if (notes.length) {
    const note = document.createElement("p");
    note.className = "hint importPreviewWarning";
    note.textContent = notes.join("・");
    nodes.push(note);
  }
  return nodes;
}

function applyImportedPrompt(parsed, mode) {
  if (parsed.hasSections) {
    // 見出しがあった項目だけを書き換える。結合結果は照合用なので入れない。
    for (const field of PROMPT_FIELDS) {
      const value = parsed.sections[field];
      if (!value) continue;
      const element = promptFieldElement(field);
      element.value = mergePromptValue(element.value, value, mode);
    }
  } else if (parsed.combined) {
    applyRawPromptImport(parsed.combined, mode);
  }

  if (parsed.negativePrompt) {
    elements.negativePrompt.value = mergePromptValue(elements.negativePrompt.value, parsed.negativePrompt, mode);
  }
  applyImportedTriggerWords(parsed.triggerWords, mode);
  handleStructuredPromptInput();
  syncPromptClearButtons();
  if (parsed.hasSections) setPromptMode("structured");
  toast.success("AI出力を各欄へ反映しました");
}

// 分割できなかった場合の逃げ道。Raw Promptとしてそのまま入れる。
function applyRawPromptImport(text, mode = "replace") {
  const next = mergePromptValue(rawPromptOverride ? elements.prompt.value : buildCombinedPrompt(), text, mode);
  setPromptFields(next, elements.negativePrompt.value, promptDescription, { source: "manual" });
  setPromptMode("raw");
}

function applyImportedTriggerWords(entries, mode) {
  if (mode === "replace") {
    // 前回インポートした枠だけを外す（LoRA由来・ユーザー操作の枠は残す）。
    appliedTriggerWords = appliedTriggerWords
      .map((trigger) => ({
        ...trigger,
        sourceLoraIds: trigger.sourceLoraIds.filter((id) => !id.startsWith(IMPORT_SOURCE_PREFIX))
      }))
      .filter((trigger) => trigger.sourceLoraIds.length)
      .map((trigger) => ({ ...trigger, sourceLoraId: trigger.sourceLoraIds[0] }));
  }

  for (const entry of entries) {
    const sourceId = `${IMPORT_SOURCE_PREFIX}${entry.field}`;
    const key = triggerKey(entry.text);
    const existing = appliedTriggerWords.find((trigger) => triggerKey(trigger.text) === key);
    if (existing) {
      // 既にある枠は消さず、由来と指定Weightだけ足す。
      if (!existing.sourceLoraIds.includes(sourceId)) existing.sourceLoraIds.push(sourceId);
      existing.weight = normalizeTriggerWeight(entry.weight);
      existing.enabled = true;
      continue;
    }
    appliedTriggerWords.push({
      id: `trigger:${key}`,
      sourceLoraId: sourceId,
      sourceLoraIds: [sourceId],
      text: entry.text,
      weight: normalizeTriggerWeight(entry.weight),
      targetField: entry.field,
      enabled: true
    });
  }
  syncAppliedTriggerWords();
}

// ---- AI共有（上部ツールバー: Grok用に全コピー / AI共有CSVを更新） ----

// 画面で手入力したTrigger Words。サーバーはこれを最優先でCSVへ入れる。
function manualTriggerWordsPayload() {
  return Object.fromEntries(loraTriggers);
}

function renderShareStatus(state) {
  if (!state?.generatedAt) {
    elements.shareBarStatus.textContent = "AI共有CSVは未作成です。「AI共有CSVを更新」で作成できます。";
    return;
  }
  const text =
    `AI共有CSV: ${state.rowCount}件（Trigger Words ${state.triggerWordCount}件）・${formatDate(state.generatedAt)}・${state.path}`;
  elements.shareBarStatus.textContent = text;
  // スマホでは2行に切り詰めて表示するため、全文はtitleでも見られるようにする。
  elements.shareBarStatus.title = text;
}

async function loadShareState() {
  try {
    const { state } = await getJson("/api/ai-share");
    renderShareStatus(state);
  } catch (error) {
    elements.shareBarStatus.textContent = `AI共有CSVの状態を取得できません: ${error.message}`;
  }
}

async function updateShareCsv() {
  await withBusy(elements.updateShareCsvButton, "更新中…", async () => {
    try {
      const result = await postJson("/api/ai-share/csv", { triggerWords: manualTriggerWordsPayload() });
      renderShareStatus(result);
      // 指示テンプレート側のlora_list.csvも同じ内容へ合わせる。
      if (elements.grokLoraCsv.value !== result.csv) {
        elements.grokLoraCsv.value = result.csv;
        await patchJson("/api/prompt-template", { loraCsv: result.csv }).catch(() => {});
      }
      toast.success(
        `AI共有CSVを更新しました: ${result.rowCount}件（Trigger Words ${result.triggerWordCount}件）\n${result.path}`
      );
    } catch (error) {
      toast.error(`AI共有CSVを更新できませんでした: ${error.message}`);
    }
  });
}

async function copyGrokShare() {
  await withBusy(elements.copyGrokShareButton, "作成中…", async () => {
    try {
      const result = await postJson("/api/ai-share/grok", { triggerWords: manualTriggerWordsPayload() });
      await copyToClipboard(result.markdown);
      flashLabel(elements.copyGrokShareButton, "Copied!");
      renderShareStatus({ ...result, generatedAt: new Date().toISOString() });
      toast.success(`Grok用データをコピーしました（LoRA ${result.rowCount}件）`, {
        action: { label: "内容を確認", onSelect: () => openSharePreview(result.markdown) }
      });
    } catch (error) {
      toast.error(`Grok用データをコピーできませんでした: ${error.message}`);
    }
  });
}

function openSharePreview(markdown) {
  openModal({
    title: "Grok用データ",
    subtitle: "クリップボードへコピーした内容です",
    size: "large",
    build: (body) => {
      const preview = document.createElement("pre");
      preview.className = "sharePreview";
      preview.textContent = markdown;
      body.append(preview);
    },
    actions: [{ label: "閉じる", value: true, primary: true }]
  });
}

// LoRA一覧やTrigger Wordsが変わったときの自動同期。
// 失敗しても通常の操作を止めない（best-effort）。
function scheduleShareCsvSync() {
  clearTimeout(shareSyncTimer);
  shareSyncTimer = setTimeout(() => void syncShareCsvQuietly(), SHARE_SYNC_DEBOUNCE);
}

async function syncShareCsvQuietly() {
  clearTimeout(shareSyncTimer);
  try {
    const result = await postJson("/api/ai-share/csv", { triggerWords: manualTriggerWordsPayload() });
    renderShareStatus(result);
  } catch (error) {
    console.warn(`[AI共有] CSVの自動更新に失敗しました: ${error.message}`);
  }
}

// ---- Grok向け指示テンプレート ----

async function loadPromptTemplate() {
  try {
    const { template } = await getJson("/api/prompt-template");
    elements.grokInstructions.value = template.instructions || DEFAULT_GROK_INSTRUCTIONS;
    elements.grokSetupDoc.value = template.setupDoc;
    elements.grokLoraCsv.value = template.loraCsv;
    renderPromptTemplateStatus(template);
  } catch (error) {
    elements.grokTemplateStatus.textContent = `指示テンプレートを取得できません: ${error.message}`;
  }
}

function renderPromptTemplateStatus(template) {
  const parts = [template.updatedAt ? `保存: ${formatDate(template.updatedAt)}` : "未保存"];
  if (template.loraCsvUpdatedAt) parts.push(`lora_list.csv更新: ${formatDate(template.loraCsvUpdatedAt)}`);
  elements.grokTemplateStatus.textContent = parts.join("・");
}

async function savePromptTemplate({ silent = false } = {}) {
  const { template } = await patchJson("/api/prompt-template", {
    instructions: elements.grokInstructions.value,
    setupDoc: elements.grokSetupDoc.value,
    loraCsv: elements.grokLoraCsv.value
  });
  renderPromptTemplateStatus(template);
  if (!silent) toast.success("指示テンプレートを保存しました");
  return template;
}

async function copyGrokTemplate() {
  const text = buildGrokRequestText({
    instructions: elements.grokInstructions.value,
    setupDoc: elements.grokSetupDoc.value,
    loraCsv: elements.grokLoraCsv.value
  });
  if (!text.trim()) return toast.warning("コピーできる内容がありません");
  try {
    await copyToClipboard(text);
    flashLabel(elements.copyGrokTemplateButton, "Copied!");
    // コピーした内容をそのまま次回も使えるよう、保存も済ませておく。
    await savePromptTemplate({ silent: true });
  } catch (error) {
    toast.error(`コピーできませんでした: ${error.message}`);
  }
}

// 導入済みLoRAからlora_list.csvを作り直す（生成はサーバー側のAI共有CSVと共通）。
async function updateLoraCsvFromInstalled() {
  await withBusy(elements.generateLoraCsvButton, "更新中…", async () => {
    try {
      const result = await postJson("/api/ai-share/csv", { triggerWords: manualTriggerWordsPayload() });
      elements.grokLoraCsv.value = result.csv;
      renderShareStatus(result);
      await savePromptTemplate({ silent: true });
      toast.success(`lora_list.csvを${result.rowCount}件で更新しました（Trigger Words ${result.triggerWordCount}件）`);
    } catch (error) {
      toast.error(`lora_list.csvを更新できませんでした: ${error.message}`);
    }
  });
}

async function resetGrokInstructions() {
  const confirmed = await confirmModal("指示テンプレートを既定の内容へ戻します。よろしいですか？", {
    title: "指示テンプレートの初期化",
    confirmText: "戻す"
  });
  if (!confirmed) return;
  elements.grokInstructions.value = DEFAULT_GROK_INSTRUCTIONS;
  await savePromptTemplate({ silent: true });
  toast.info("既定の指示文へ戻しました");
}

// 日本語からの自動生成が必要かどうか。
// 分割入力に中身があれば生成せず、説明文が無い場合は自動生成そのものができない。
function shouldRequestPrompt(description) {
  if (!description) return false;
  if (rawPromptOverride) return !elements.prompt.value.trim() || promptDescription !== description;
  return !buildCombinedPrompt().trim();
}

function renderCandidates(images) {
  elements.candidateGrid.replaceChildren();
  elements.candidateSummary.textContent = `${images.length}枚生成`;

  images.forEach((candidate, index) => {
    const card = document.createElement("article");
    card.className = "candidateCard";
    card.setAttribute("aria-label", `候補${index + 1}、Seed ${candidate.seed}`);

    const image = document.createElement("img");
    image.className = "candidateImage";
    image.src = `${candidate.imageUrl}?t=${Date.now()}`;
    image.alt = `生成候補 ${index + 1}`;
    image.title = "クリックで拡大";
    // 画像クリックで拡大、選択は下の「選択」ボタンで行う。
    image.addEventListener("click", () =>
      openImageModal(candidate.imageUrl, `候補 ${index + 1} · Seed ${candidate.seed}`)
    );

    const footer = document.createElement("footer");
    const label = document.createElement("span");
    label.textContent = `#${index + 1} · Seed ${candidate.seed}`;
    const download = document.createElement("a");
    download.href = candidate.imageUrl;
    download.download = candidate.filename;
    download.textContent = "保存";
    download.addEventListener("click", (event) => event.stopPropagation());
    const actions = document.createElement("div");
    actions.className = "candidateCardActions";
    const favorite = createFavoriteButton(candidate, { className: "favoriteButton smallButton" });
    favorite.title = "Favoriteに登録";
    const toImg2Img = document.createElement("button");
    toImg2Img.type = "button";
    toImg2Img.className = "candidateImg2ImgButton";
    toImg2Img.textContent = "img2img";
    toImg2Img.title = "この画像をimg2imgの参照にする";
    toImg2Img.addEventListener("click", (event) => {
      event.stopPropagation();
      useImageForImg2Img(candidate);
    });
    const toInpaint = document.createElement("button");
    toInpaint.type = "button";
    toInpaint.className = "candidateImg2ImgButton";
    toInpaint.textContent = "修正";
    toInpaint.title = "この画像を部分修正する";
    toInpaint.addEventListener("click", (event) => {
      event.stopPropagation();
      useImageForInpaint(candidate);
    });
    const select = document.createElement("button");
    select.type = "button";
    select.className = "candidateSelectButton";
    select.textContent = "選択";
    select.title = "この画像を仕上げ対象に選ぶ";
    select.addEventListener("click", (event) => {
      event.stopPropagation();
      selectCandidate(candidate, card);
    });
    actions.append(favorite, createDiscordStatusNode(candidate), toImg2Img, toInpaint, select, download);
    footer.append(label, actions);
    card.append(image, footer);
    elements.candidateGrid.append(card);
  });

  const first = elements.candidateGrid.firstElementChild;
  if (images[0] && first) selectCandidate(images[0], first);
}

function selectCandidate(candidate, card) {
  selectedCandidate = candidate;
  for (const item of elements.candidateGrid.children) item.classList.remove("selected");
  card.classList.add("selected");
  elements.selectedSeedText.textContent = `選択中: Seed ${candidate.seed}`;
  elements.finishButton.disabled = false;
  elements.lockCompositionButton.disabled = false;
  elements.finishButton.textContent = lastGeneration?.mode === "inpaint"
    ? "選択画像を部分修正仕上げ"
    : lastGeneration?.mode === "img2img"
      ? "選択画像をimg2img仕上げ"
      : "選択画像をHires.fix";
}

async function submitGeneration(payload, { allowRecovery = true } = {}) {
  // 二重投入を防ぐ（タブ移動やギャラリー操作から重ねて呼ばれても1本だけ走らせる）。
  if (activeJobId) throw new Error("生成中です。完了または中止してから実行してください");
  const request = { ...payload, autoRetry: elements.autoRetryOnFailure.checked };
  const { job } = await postJson("/api/jobs", request);
  activeJobId = job.id;
  setJobProgress(job);
  renderGenerateActions();
  elements.jobBar.classList.remove("hidden");
  elements.cancelJobButton.disabled = false;
  // 生成はサーバー側のジョブとして進むので、タブを移動しても継続する。
  // 右上のキュー表示へ即座に反映させる。
  startQueuePolling();

  try {
    while (true) {
      await sleep(850);
      const current = (await getJson(`/api/jobs/${job.id}`)).job;
      setJobProgress(current);
      if (current.status === "done") return current.result;
      if (current.status === "failed") {
        // 設定を下げれば通る見込みがある場合だけ、確認して1回だけ再試行する。
        if (allowRecovery && current.recovery) {
          const retryPayload = await confirmRecovery(current.recovery, request);
          if (retryPayload) {
            // 再試行は同じ生成の続きなので、二重投入チェックを通す。
            activeJobId = null;
            renderGenerateActions();
            return submitGeneration(retryPayload, { allowRecovery: false });
          }
        }
        throw new Error(current.error ?? current.message);
      }
      if (current.status === "cancelled") throw new Error("生成を中止しました");
    }
  } finally {
    activeJobId = null;
    renderGenerateActions();
    elements.cancelJobButton.disabled = true;
    setTimeout(() => {
      if (!activeJobId) elements.jobBar.classList.add("hidden");
    }, 1800);
  }
}

// 自動リカバリの確認ダイアログ。承諾したら再試行用のpayloadを返す。
async function confirmRecovery(recovery, request) {
  const accepted = await openModal({
    title: `${recovery.label}のため、設定を下げて再試行できます`,
    subtitle: recovery.reason,
    size: "small",
    dismissValue: false,
    build: (body) => {
      if (!recovery.changes.length) {
        const message = document.createElement("p");
        message.className = "uiModalMessage";
        message.textContent = "同じ設定のまま、もう一度だけ試します。";
        body.append(message);
        return;
      }
      const list = document.createElement("ul");
      list.className = "recoveryChanges";
      for (const change of recovery.changes) {
        const item = document.createElement("li");
        item.textContent = `${change.label}: ${change.from} → ${change.to}`;
        list.append(item);
      }
      body.append(list);
      const note = document.createElement("p");
      note.className = "uiFieldNote";
      note.textContent = "再試行は1回だけです。失敗した場合はそのまま停止します。";
      body.append(note);
    },
    actions: [
      { label: "中止", value: false, variant: "secondary" },
      { label: "再試行する", value: true, primary: true }
    ]
  }).promise;
  if (!accepted) return null;

  toast.info(`${recovery.label}のため設定を下げて再試行します`);
  return {
    ...request,
    settings: { ...request.settings, ...recovery.settings },
    retryInfo: {
      retryReason: recovery.kind,
      retryReasonLabel: recovery.label,
      retryCount: 1,
      retriedAt: new Date().toISOString(),
      originalSettings: request.settings,
      retrySettings: recovery.settings
    }
  };
}

function renderJobProgressText(job) {
  const percent = Math.round(Number(job?.progress ?? 0));
  elements.generateProgressText.textContent = job?.message
    ? `${job.message}（${percent}%）`
    : `生成中… ${percent}%`;
}

function setJobProgress(job) {
  renderJobProgressText(job);
  elements.jobMessage.textContent = job.message ?? "処理中";
  elements.jobProgress.value = Number(job.progress) || 0;
  elements.jobProgressText.textContent = `${Math.round(Number(job.progress) || 0)}%`;
}

async function cancelActiveJob() {
  if (!activeJobId) return;
  elements.cancelJobButton.disabled = true;
  try {
    const response = await fetch(`/api/jobs/${activeJobId}`, { method: "DELETE" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
    setJobProgress(data.job);
  } catch (error) {
    showError(error.message);
  }
}

// ---- ヘッダー右上のキュー表示 ----

const queueHandlers = {
  onCancelGeneration: async (entry) => {
    try {
      await deleteJson(`/api/jobs/${entry.id}`);
      toast.info("生成を中止しました");
    } catch (error) {
      toast.error(error.message);
    }
    await refreshQueue();
  },
  onCancelComparison: async (entry) => {
    try {
      await postJson(`/api/experiments/${entry.id}/cancel`, {});
      toast.warning("比較実験を中断しました");
    } catch (error) {
      toast.error(error.message);
    }
    await refreshQueue();
    await loadExperiments();
  },
  onOpenComparisonResult: (entry) => void openComparisonResult(entry.id)
};

async function refreshQueue() {
  try {
    queueSnapshot = await getJson("/api/queue");
  } catch {
    // 取得できないときは前回の表示を保つ（偽の状態を出さない）
    return null;
  }
  renderQueueIndicator();
  notifyQueueChanges(queueSnapshot);
  queuePanel?.render(queueSnapshot);
  return queueSnapshot;
}

function startQueuePolling() {
  if (queuePolling) return;
  queuePolling = true;
  void (async () => {
    let idle = 0;
    try {
      while (idle < QUEUE_IDLE_TICKS) {
        const snapshot = await refreshQueue();
        const active = Number(snapshot?.summary?.activeCount) || 0;
        idle = active || queuePanel ? 0 : idle + 1;
        await sleep(QUEUE_POLL_INTERVAL);
      }
    } finally {
      queuePolling = false;
      // 「生成完了」は一時表示なので、落ち着いたら消す（失敗表示は残す）。
      hideIdleQueueIndicator();
    }
  })();
}

function hideIdleQueueIndicator() {
  if (queuePanel) return;
  if (Number(queueSnapshot?.summary?.activeCount) || 0) return;
  if (summarizeQueue(queueSnapshot).tone === "error") return;
  elements.queueIndicator.classList.add("hidden");
}

function renderQueueIndicator() {
  const summary = summarizeQueue(queueSnapshot);
  elements.queueIndicator.classList.toggle("hidden", !summary.visible);
  elements.queueIndicator.dataset.tone = summary.tone;
  elements.queueIndicatorText.textContent = summary.text;
  elements.queueIndicator.title = summary.visible
    ? `${summary.text} / クリックで詳細`
    : "生成キューの詳細を表示";
}

// 完了・失敗を検知して通知し、ギャラリーを自動更新する。
function notifyQueueChanges(snapshot) {
  const terminal = new Set();
  const fresh = [];
  for (const entry of [...(snapshot.generation ?? []), ...(snapshot.comparison ?? [])]) {
    if (!QUEUE_TERMINAL_STATUSES.includes(entry.status)) continue;
    const key = `${entry.type}:${entry.id}:${entry.status}`;
    terminal.add(key);
    if (queueSeenTerminal && !queueSeenTerminal.has(key)) fresh.push(entry);
  }
  const firstLoad = queueSeenTerminal === null;
  queueSeenTerminal = terminal;
  if (firstLoad || !fresh.length) return;

  let refreshGallery = false;
  for (const entry of fresh) {
    if (entry.status === "cancelled") continue;
    if (entry.status === "failed") {
      toast.error(entry.type === "comparison"
        ? `比較実験が失敗しました: ${friendlyQueueError(entry.errorMessage)}`
        : `生成に失敗しました: ${friendlyQueueError(entry.errorMessage)}`);
      continue;
    }
    refreshGallery = true;
    if (entry.type === "comparison") {
      const failed = Number(entry.failedCases) || 0;
      toast.success(failed
        ? `比較実験が終了しました（${entry.completedCases}/${entry.totalCases}完了・${failed}件失敗）`
        : "比較実験が完了しました", {
        action: { label: "結果を見る", onSelect: () => void openComparisonResult(entry.id) }
      });
      continue;
    }
    // 生成結果タブを見ているときは画面に出るので、通知はギャラリー閲覧中だけにする。
    if (isGalleryTabVisible()) toast.success("生成が完了しました");
  }
  if (refreshGallery) void loadHistory();
}

function isGalleryTabVisible() {
  return currentView === "gallery";
}

// 内部エラーをそのまま出さないよう、短いメッセージへ丸める。
function friendlyQueueError(message) {
  const text = String(message ?? "").split("\n")[0].trim();
  if (!text) return "詳細不明のエラーです";
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

function openQueuePanel() {
  if (queuePanel) return;
  let panelBody = null;
  const modal = openModal({
    title: "生成キュー",
    subtitle: "画像生成と比較実験の実行状況",
    size: "medium",
    build: (body) => {
      panelBody = body;
      body.append(buildQueuePanel(queueSnapshot, queueHandlers));
    },
    actions: [{ label: "閉じる", primary: true }]
  });
  queuePanel = {
    close: () => modal.close(),
    render: (snapshot) => {
      if (!panelBody?.isConnected) return;
      panelBody.replaceChildren(buildQueuePanel(snapshot, queueHandlers));
    }
  };
  void modal.promise.then(() => { queuePanel = null; });
  startQueuePolling();
}

// 比較実験の結果へ移動する導線。ギャラリーの実験詳細を開く。
async function openComparisonResult(experimentId) {
  queuePanel?.close();
  await loadHistory();
  await loadExperiments();
  const experiment = knownExperiments.find((item) => item.id === experimentId);
  if (!experiment) return toast.warning("実験が見つかりません");
  setResultTab("gallery");
  setGalleryView("experiments");
  renderExperimentCards();
  openExperimentDetail(experiment);
}

// ---- 入力欄のクリア ----

// 共通のクリアボタン。空のときは隠し、その欄だけを消す。
function setupClearableField(input, button, { onClear, isEmpty } = {}) {
  if (!input || !button) return () => {};
  const empty = () => (typeof isEmpty === "function" ? isEmpty(input) : !String(input.value ?? "").trim());
  const sync = () => button.classList.toggle("hidden", empty());
  button.addEventListener("click", () => {
    if (empty()) return;
    if (typeof onClear === "function") {
      onClear();
    } else {
      input.value = "";
      // 既存の入力ハンドラ（プロンプト状態・検証など）へ通常の入力として伝える。
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    sync();
    input.focus();
  });
  for (const eventName of ["input", "change"]) input.addEventListener(eventName, sync);
  sync();
  return sync;
}

function setupClearableFields() {
  setupClearableField(elements.prompt, elements.clearPromptButton);
  setupClearableField(elements.negativePrompt, elements.clearNegativePromptButton);
  setupClearableField(elements.civitaiUrl, elements.clearCivitaiUrlButton, {
    onClear: () => {
      elements.civitaiUrl.value = "";
      // 取得済みの確認結果と検証エラーだけを解除する（追加済みLoRAには触らない）。
      elements.civitaiUrl.dispatchEvent(new Event("input", { bubbles: true }));
      elements.civitaiPreview.classList.add("hidden");
      elements.civitaiPreview.replaceChildren();
      elements.civitaiStatus.textContent = "";
    }
  });
  // Seedは「空」ではなくランダム値(-1)へ戻す。見た目だけ空にはしない。
  syncSeedClearButton = setupClearableField(elements.seed, elements.clearSeedButton, {
    isEmpty: (input) => {
      const value = String(input.value ?? "").trim();
      return !value || Number(value) < 0;
    },
    onClear: () => {
      if (compositionLock) unlockComposition();
      else elements.seed.value = RANDOM_SEED;
      toast.info("Seedをランダム（-1）へ戻しました");
    }
  });
}

// PromptとNegative promptだけをまとめて消す（他の生成設定は変えない）。
function clearBothPrompts() {
  const previous = {
    prompt: elements.prompt.value,
    negativePrompt: elements.negativePrompt.value,
    description: promptDescription,
    sections: readStructuredSections(),
    rawPromptOverride,
    rawPromptOverrideSource
  };
  const hasSections = hasSectionContent(previous.sections);
  if (!previous.prompt.trim() && !previous.negativePrompt.trim() && !hasSections) {
    return toast.info("PromptとNegative promptはすでに空です");
  }
  clearedPromptSnapshot = previous;
  // 手入力した分割入力もまとめて消す（トリガーワード枠はLoRA選択に従うので触らない）。
  writeStructuredSections({});
  // setPromptFieldsがクリアボタンの表示も同期する。
  setPromptFields("", "", "");
  toast.info("プロンプトを削除しました", {
    action: {
      label: "元に戻す",
      onSelect: () => {
        if (!clearedPromptSnapshot) return;
        writeStructuredSections(clearedPromptSnapshot.sections);
        setPromptFields(
          clearedPromptSnapshot.rawPromptOverride ? clearedPromptSnapshot.prompt : "",
          clearedPromptSnapshot.negativePrompt,
          clearedPromptSnapshot.description,
          { source: clearedPromptSnapshot.rawPromptOverrideSource }
        );
        clearedPromptSnapshot = null;
        toast.success("プロンプトを元に戻しました");
      }
    }
  });
}

// プログラム的に値を変えたときは、input イベントが飛ばないので明示的に同期する。
function syncPromptClearButtons() {
  for (const [input, button] of [
    [elements.prompt, elements.clearPromptButton],
    [elements.negativePrompt, elements.clearNegativePromptButton]
  ]) {
    button.classList.toggle("hidden", !String(input.value ?? "").trim());
  }
  syncSeedClearButton();
}

function lockSelectedComposition() {
  if (lastGeneration && selectedCandidate) activateCompositionLock(lastGeneration, selectedCandidate);
}

function activateCompositionLock(recipe, image) {
  loadRecipeFields(recipe, image);
  compositionLock = { recipe, image };
  elements.compositionLockStatus.querySelector("span").textContent = `構図・Seed固定中: ${image.seed}`;
  elements.compositionLockStatus.classList.remove("hidden");
  elements.description.scrollIntoView({ behavior: "smooth", block: "center" });
}

function unlockComposition() {
  compositionLock = null;
  elements.compositionLockStatus.classList.add("hidden");
  elements.seed.value = RANDOM_SEED;
  syncSeedClearButton();
}

function loadRecipeFields(recipe, image) {
  elements.description.value = recipe.description ?? "";
  restorePromptFieldsFromRecipe(recipe);
  const settings = recipe.settings ?? {};
  for (const key of [
    "width", "height", "steps", "cfgScale", "samplerName", "scheduler", "noiseSchedule",
    "img2imgDenoising", "img2imgResizeMode",
    "inpaintDenoising", "maskBlur", "inpaintFill", "inpaintFullResPadding",
    "hiresScale", "hiresSteps", "hiresDenoising", "hiresUpscaler"
  ]) {
    if (settings[key] !== undefined && elements[key]) elements[key].value = settings[key];
  }
  if (settings.inpaintFullRes !== undefined) {
    elements.inpaintFullRes.checked = settings.inpaintFullRes === true;
  }
  syncSamplerLabels();
  elements.seed.value = image.seed;
  elements.candidateCount.value = "1";
  handleCandidateCountChange();
  handleImg2ImgDenoisingInput();
  handleInpaintSettingsChange();

  selectedLoras.clear();
  loraSelectionSources.clear();
  for (const lora of recipe.loras ?? []) {
    if (!installedLoras.some((item) => item.name === lora.name)) continue;
    // 履歴のWeightは実際に生成へ使った実効値。選択元もそのまま復元する。
    selectedLoras.set(lora.name, Number(lora.weight));
    loraSelectionSources.set(lora.name, ["ui", "prompt", "both"].includes(lora.source) ? lora.source : "ui");
    loraWeights.set(lora.name, Number(lora.weight));
    if (lora.triggerWords) loraTriggers.set(lora.name, lora.triggerWords);
    if (lora.negativeWords) loraNegativeWords.set(lora.name, lora.negativeWords);
  }
  saveLoraWeights();
  saveLoraTriggers();
  saveLoraNegativeWords();
  renderLoras();
  renderSelectedLoraSummary();
  // 復元直後からプロンプト表示とUI表示を一致させる。
  syncLorasFromPrompt();
}

// 履歴からのプロンプト復元。
// 構造化プロンプトが無い古い履歴は、分類し直さずRaw Promptとしてそのまま戻す。
function restorePromptFieldsFromRecipe(recipe) {
  const description = recipe.description ?? "";
  const negativePrompt = recipe.negativePrompt ?? "";
  const sections = recipe.structuredPrompt;
  if (!sections) {
    appliedTriggerWords = [];
    writeStructuredSections({});
    renderTriggerLists();
    setPromptFields(recipe.prompt ?? "", negativePrompt, description, { source: "manual" });
    return;
  }

  writeStructuredSections(sections);
  appliedTriggerWords = normalizeAppliedTriggerWords(recipe.appliedTriggerWords);
  renderTriggerLists();
  if (recipe.rawPromptOverride) {
    setPromptFields(recipe.rawPrompt || recipe.prompt || "", negativePrompt, description, { source: "manual" });
    return;
  }
  setPromptFields("", negativePrompt, description, { source: "manual" });
}

async function toggleFavorite(image, button) {
  const next = !image.favorite;
  button.disabled = true;
  try {
    // 確認ダイアログは出さない。Discord送信はサーバー側で非同期に始まる。
    const data = await patchJson(`/api/history/${image.id}/favorite`, { favorite: next });
    image.favorite = data.image.favorite;
    button.classList.toggle("active", image.favorite);
    // どこから操作しても、開いている全ての表示へ即時反映する。
    applyImageFavorite(image.id, image.favorite);
    preferenceData = data.preferences;
    renderPreferenceSummary();
    applyDiscordState(image.id, data.image.discord);
    await loadHistory();
  } catch (error) {
    showError(error.message);
  } finally {
    button.disabled = false;
  }
}

// ---- 画像Favoriteの表示同期 ----

// 画像IDごとのFavorite状態。LoRAのFavorite（LoRAマスタ側）とは別データ。
const imageFavorites = new Map();

function rememberImageFavorites(generations) {
  for (const generation of generations ?? []) {
    for (const image of generation.images ?? []) {
      if (image?.id) imageFavorites.set(image.id, Boolean(image.favorite));
    }
  }
}

function applyImageFavorite(imageId, favorite) {
  imageFavorites.set(imageId, Boolean(favorite));
  refreshFavoriteButtons(imageId);
}

// data-favorite-image を持つボタン（一覧・詳細・最新結果）をまとめて更新する。
function refreshFavoriteButtons(imageId) {
  const favorite = imageFavorites.get(imageId) === true;
  const selector = `[data-favorite-image="${CSS.escape(String(imageId))}"]`;
  for (const button of document.querySelectorAll(selector)) renderFavoriteButton(button, favorite);
}

function renderFavoriteButton(button, favorite) {
  button.classList.toggle("active", favorite);
  button.setAttribute("aria-pressed", String(favorite));
  button.textContent = button.dataset.favoriteStyle === "label"
    ? (favorite ? "★ Favorite" : "☆ Favorite")
    : (favorite ? "★" : "☆");
  button.title = favorite ? "Favoriteを外す" : "Favoriteに登録";
}

// 画像用のFavoriteボタン（星）。表示場所ごとにスタイルだけ変える。
function createFavoriteButton(image, { style = "star", className = "favoriteButton" } = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.dataset.favoriteImage = image.id;
  button.dataset.favoriteStyle = style;
  imageFavorites.set(image.id, Boolean(image.favorite));
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    void toggleFavorite(image, button);
  });
  // まだDOMへ入っていないので、この場で初期表示を作る。
  renderFavoriteButton(button, Boolean(image.favorite));
  return button;
}

// ---- Discord送信状態の表示 ----

function applyDiscordState(imageId, state) {
  if (!imageId || !state) return;
  discordStates.set(imageId, state);
  refreshDiscordBadges(imageId);
  if (state.status === "sending") void watchDiscordSend(imageId);
}

function rememberDiscordStates(generations) {
  for (const generation of generations ?? []) {
    for (const image of generation.images ?? []) {
      if (image?.id && image.discord) discordStates.set(image.id, image.discord);
    }
  }
}

function createDiscordStatusNode(image) {
  const node = document.createElement("span");
  node.className = "discordStatus";
  node.dataset.discordImage = image.id;
  if (image.discord) discordStates.set(image.id, image.discord);
  renderDiscordStatusNode(node, image.id);
  return node;
}

function renderDiscordStatusNode(node, imageId) {
  const state = discordStates.get(imageId) ?? { status: "not_sent", error: "" };
  node.replaceChildren();
  node.className = `discordStatus status-${state.status}`;
  node.title = state.error || "";
  if (state.status === "not_sent") {
    node.classList.add("hidden");
    return;
  }
  const label = document.createElement("span");
  label.textContent = DISCORD_STATUS_LABELS[state.status] ?? "";
  node.append(label);
  // 失敗した画像だけ再送できる（sent / sendingは再送しない）。
  if (state.status === "failed") {
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "discordRetryButton";
    retry.textContent = "再送";
    retry.title = state.error || "Discordへ再送する";
    retry.addEventListener("click", () => void resendToDiscord(imageId, retry));
    node.append(retry);
  }
}

function refreshDiscordBadges(imageId) {
  const selector = `[data-discord-image="${CSS.escape(String(imageId))}"]`;
  for (const node of document.querySelectorAll(selector)) renderDiscordStatusNode(node, imageId);
  // 生成結果パネルのバッジはIDが固定なので、対象画像のときだけ更新する。
  if (finalImage?.id === imageId) {
    elements.finalDiscordStatus.dataset.discordImage = imageId;
    renderDiscordStatusNode(elements.finalDiscordStatus, imageId);
  }
}

// 送信は非同期なので、終わるまで状態だけ見に行く。
async function watchDiscordSend(imageId) {
  if (discordWatchers.has(imageId)) return;
  discordWatchers.add(imageId);
  try {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      await sleep(1200);
      const { discord } = await getJson(`/api/history/${imageId}/discord`);
      discordStates.set(imageId, discord);
      refreshDiscordBadges(imageId);
      if (discord.status === "sending") continue;
      // 成功時は静かに。失敗時だけ知らせて再送できるようにする。
      if (discord.status === "failed") notifyDiscordFailure(imageId, discord);
      return;
    }
  } catch {
    // 状態取得に失敗しても、Favoriteと画面表示は維持する。
  } finally {
    discordWatchers.delete(imageId);
  }
}

function notifyDiscordFailure(imageId, state) {
  toast.error(`Discordへ送信できませんでした: ${state.error || "原因不明"}`, {
    action: { label: "再送", onSelect: () => void resendToDiscord(imageId) }
  });
}

async function resendToDiscord(imageId, button = null) {
  if (button) button.disabled = true;
  try {
    const { discord } = await postJson(`/api/history/${imageId}/discord/send`, {});
    applyDiscordState(imageId, discord);
  } catch (error) {
    toast.error(error.message);
  } finally {
    if (button) button.disabled = false;
  }
}

// ---- Discord設定 ----

async function loadDiscordSettings() {
  try {
    const { settings } = await getJson("/api/discord/settings");
    elements.discordAutoSend.checked = settings.autoSend;
    elements.discordIncludePrompt.checked = settings.includePrompt;
    elements.discordIncludeMetadata.checked = settings.includeMetadata;
    renderDiscordSettingsStatus(settings);
  } catch (error) {
    elements.discordSettingsStatus.textContent = `Discord設定を取得できません: ${error.message}`;
  }
}

function renderDiscordSettingsStatus(settings) {
  // Webhook URL自体は返ってこない。設定済みかどうかと、伏せ字の目印だけ出す。
  const source = { env: "環境変数", config: "config.local.json", stored: "この画面で保存" }[settings.webhookSource];
  elements.discordSettingsStatus.textContent = settings.webhookConfigured
    ? `送信先: ${settings.webhookHint}（${source}）${settings.autoSend ? "・自動送信ON" : "・自動送信OFF"}`
    : "送信先が未設定のため、Favoriteしても送信しません";
  elements.discordWebhook.disabled = !settings.webhookEditable;
  elements.discordWebhook.placeholder = settings.webhookEditable
    ? "https://discord.com/api/webhooks/…"
    : `${source}の設定を使用中`;
  elements.clearDiscordWebhookButton.disabled = !settings.storedWebhookConfigured;
}

async function saveDiscordSettings() {
  await withBusy(elements.saveDiscordSettingsButton, "保存中…", async () => {
    try {
      const { settings } = await patchJson("/api/discord/settings", {
        autoSend: elements.discordAutoSend.checked,
        includePrompt: elements.discordIncludePrompt.checked,
        includeMetadata: elements.discordIncludeMetadata.checked,
        webhookUrl: elements.discordWebhook.value
      });
      // 入力欄には残さない（画面・sessionStorageへ秘密情報を置かない）。
      elements.discordWebhook.value = "";
      renderDiscordSettingsStatus(settings);
      toast.success("Discord設定を保存しました");
    } catch (error) {
      toast.error(error.message);
    }
  });
}

async function clearDiscordWebhook() {
  const confirmed = await confirmModal("保存済みのDiscord送信先を削除します。よろしいですか？", {
    title: "送信先の削除",
    confirmText: "削除する"
  });
  if (!confirmed) return;
  try {
    const { settings } = await patchJson("/api/discord/settings", { clearWebhook: true });
    elements.discordWebhook.value = "";
    renderDiscordSettingsStatus(settings);
    toast.info("Discordの送信先を削除しました");
  } catch (error) {
    toast.error(error.message);
  }
}

async function loadHistory() {
  try {
    const [historyData, preferences] = await Promise.all([
      getJson("/api/history?limit=200"),
      getJson("/api/history/preferences")
    ]);
    preferenceData = preferences;
    renderPreferenceSummary();
    renderHistory(historyData.generations ?? []);
  } catch (error) {
    elements.historyGrid.textContent = `履歴を取得できません: ${error.message}`;
  }
}

function renderHistory(generations) {
  lastHistoryGenerations = generations ?? [];
  rememberImageFavorites(generations);
  // 送信中のバッジが再描画で消えないよう、最新状態を先に取り込む。
  rememberDiscordStates(generations);
  elements.historyGrid.replaceChildren();
  const allEntries = toGalleryEntries(generations);
  renderGalleryFilterOptions(allEntries);
  const entries = filterGalleryEntries(allEntries, galleryFilter);
  elements.galleryFilterSummary.textContent =
    describeGalleryFilter(galleryFilter, allEntries.length, entries.length);
  historyEntries = entries;
  for (const { generation, image } of entries) {
    elements.historyGrid.append(createHistoryCard(generation, image));
  }
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = hasGalleryFilter()
      ? "条件に一致する画像がありません"
      : "生成すると画像とレシピがここへ保存されます";
    elements.historyGrid.append(empty);
  }
  renderExperimentCards();
  updateCompareButton();
}

// ---- ギャラリーの絞り込み ----

function hasGalleryFilter() {
  return galleryFilter.kind !== "all"
    || Boolean(galleryFilter.checkpoint || galleryFilter.lora || galleryFilter.period || galleryFilter.query);
}

function setGalleryFilter(patch) {
  galleryFilter = { ...galleryFilter, ...patch };
  for (const button of elements.galleryKindFilter.querySelectorAll("[data-gallery-kind]")) {
    const active = button.dataset.galleryKind === galleryFilter.kind;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  // 取得済みの履歴をそのまま絞り込む（再取得しない）。
  renderHistory(lastHistoryGenerations);
}

function resetGalleryFilter() {
  elements.galleryCheckpoint.value = "";
  elements.galleryLora.value = "";
  elements.galleryPeriod.value = "";
  elements.gallerySearch.value = "";
  setGalleryFilter({ kind: "all", checkpoint: "", lora: "", period: "", query: "" });
}

// Checkpoint・LoRAの候補は、いま履歴にあるものだけを出す。
function renderGalleryFilterOptions(entries) {
  fillFilterSelect(elements.galleryCheckpoint, collectCheckpoints(entries), galleryFilter.checkpoint);
  fillFilterSelect(elements.galleryLora, collectLoras(entries), galleryFilter.lora);
}

function fillFilterSelect(select, values, selected) {
  const current = selected ?? select.value;
  select.replaceChildren(new Option("すべて", ""));
  for (const value of values) select.append(new Option(shorten(value, 40), value));
  select.value = values.includes(current) ? current : "";
}

// ---- Sampler / Scheduler の選択UI ----

const SAMPLER_STORAGE = {
  sampler: { favorites: "localImageChat.samplerFavorites", recent: "localImageChat.samplerRecent" },
  scheduler: { favorites: "localImageChat.schedulerFavorites", recent: "localImageChat.schedulerRecent" }
};

function readOptionList(storageKey) {
  const stored = readJsonStorage(storageKey, []);
  return Array.isArray(stored) ? stored.filter((item) => typeof item === "string" && item) : [];
}

function writeOptionList(storageKey, values) {
  localStorage.setItem(storageKey, JSON.stringify(values));
}

async function loadSamplerOptions() {
  try {
    const data = await getJson("/api/samplers");
    samplerOptions = {
      samplers: Array.isArray(data.samplers) ? data.samplers : [],
      schedulers: Array.isArray(data.schedulers) ? data.schedulers : []
    };
  } catch {
    // ReForgeが落ちていても選択UIは使えるようにする（保存済みの値と既定値だけ）。
    samplerOptions = { samplers: [], schedulers: [] };
  }
  renderSamplerPresets();
  syncSamplerLabels();
}

// 現在値をボタンへ反映する。Checkpointプロフィール適用や履歴復元の後にも呼ぶ。
function syncSamplerLabels() {
  elements.samplerPickerValue.textContent = elements.samplerName.value || "未設定";
  elements.schedulerPickerValue.textContent = elements.scheduler.value || "未設定";
  renderSamplerPresets();
}

function renderSamplerPresets() {
  elements.samplerPresets.replaceChildren();
  for (const preset of SAMPLER_PRESETS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "samplerPreset";
    button.textContent = describeSamplerPreset(preset);
    button.classList.toggle("active", isActivePreset(preset, elements.samplerName.value, elements.scheduler.value));
    button.addEventListener("click", () => {
      // プリセットは両方まとめて変える。個別選択では相手を触らない。
      applySamplerValue("sampler", preset.sampler);
      applySamplerValue("scheduler", preset.scheduler);
    });
    elements.samplerPresets.append(button);
  }
}

function applySamplerValue(kind, value) {
  const input = kind === "sampler" ? elements.samplerName : elements.scheduler;
  input.value = value;
  writeOptionList(SAMPLER_STORAGE[kind].recent, rememberRecentOption(readOptionList(SAMPLER_STORAGE[kind].recent), value));
  syncSamplerLabels();
}

async function openSamplerPicker(kind) {
  const label = kind === "sampler" ? "Sampler" : "Scheduler";
  const all = kind === "sampler" ? samplerOptions.samplers : samplerOptions.schedulers;
  const input = kind === "sampler" ? elements.samplerName : elements.scheduler;
  let favorites = readOptionList(SAMPLER_STORAGE[kind].favorites);
  let query = "";

  await openModal({
    title: `${label}を選ぶ`,
    subtitle: "★でお気に入り。検索でも絞り込めます",
    size: "small",
    dismissValue: null,
    build: (body, close) => {
      const search = document.createElement("input");
      search.type = "search";
      search.className = "optionPickerSearch";
      search.placeholder = `${label}を検索`;
      search.setAttribute("data-autofocus", "true");

      const list = document.createElement("div");
      list.className = "optionPickerList";

      const render = () => {
        list.replaceChildren();
        const sections = buildOptionSections({
          all,
          favorites,
          recent: readOptionList(SAMPLER_STORAGE[kind].recent),
          query,
          current: input.value
        });
        if (!sections.length) {
          const empty = document.createElement("p");
          empty.className = "hint";
          empty.textContent = "候補が見つかりません";
          list.append(empty);
          return;
        }
        for (const section of sections) {
          const heading = document.createElement("p");
          heading.className = "optionPickerHeading";
          heading.textContent = section.label;
          list.append(heading);
          for (const option of section.items) list.append(createOptionRow(option));
        }
      };

      const createOptionRow = (option) => {
        const row = document.createElement("div");
        row.className = "optionPickerRow";
        row.classList.toggle("current", option === input.value);
        const choose = document.createElement("button");
        choose.type = "button";
        choose.className = "optionPickerChoice";
        choose.textContent = option;
        choose.addEventListener("click", () => {
          applySamplerValue(kind, option);
          close(option);
        });
        const star = document.createElement("button");
        star.type = "button";
        star.className = "optionPickerStar";
        star.textContent = isFavoriteOption(favorites, option) ? "★" : "☆";
        star.title = "お気に入り";
        star.addEventListener("click", () => {
          favorites = toggleFavoriteOption(favorites, option);
          writeOptionList(SAMPLER_STORAGE[kind].favorites, favorites);
          render();
        });
        row.append(choose, star);
        return row;
      };

      search.addEventListener("input", () => {
        query = search.value;
        render();
      });
      render();
      body.append(search, list);
    },
    actions: [{ label: "閉じる", value: null, variant: "secondary" }]
  }).promise;
}

// ---- 使用中LoRA（生成画面） ----

function renderUsedLoras() {
  elements.usedLoraList.replaceChildren();
  elements.loraUseCount.textContent = `${selectedLoras.size}件`;
  if (!selectedLoras.size) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "LoRAは未選択です。「LoRA追加」から選ぶか、プロンプトへ <lora:名前:0.8> と書くと追加されます。";
    elements.usedLoraList.append(empty);
    return;
  }

  for (const [name, weight] of selectedLoras) {
    const lora = findLoraByName(name);
    const row = document.createElement("div");
    row.className = "usedLoraRow";

    const title = document.createElement("div");
    title.className = "usedLoraName";
    title.textContent = lora?.displayName ?? name;
    title.title = name;
    const source = document.createElement("small");
    source.className = "usedLoraSource";
    source.textContent = { ui: "UI選択", prompt: "プロンプト由来", both: "UI+プロンプト" }[
      loraSelectionSources.get(name) ?? "ui"
    ];
    title.append(source);

    const weightField = document.createElement("label");
    weightField.className = "usedLoraWeight";
    weightField.append("Weight");
    const weightInput = document.createElement("input");
    weightInput.type = "number";
    weightInput.min = "0.05";
    weightInput.max = "2";
    weightInput.step = "0.05";
    weightInput.value = Number(weight).toFixed(2);
    weightInput.setAttribute("aria-label", `${name}のLoRA Weight`);
    weightInput.addEventListener("change", () => {
      const next = clampLoraWeightValue(weightInput.value);
      weightInput.value = next.toFixed(2);
      loraWeights.set(name, next);
      selectedLoras.set(name, next);
      saveLoraWeights();
      // プロンプト内に同じタグがあれば、そのWeightだけを書き換える。
      applyLoraWeightToPrompt(name, next);
      renderSelectedLoraSummary();
      renderLoras();
    });
    weightField.append(weightInput);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "usedLoraToggle";
    const enabled = !disabledLoras.has(name);
    toggle.textContent = enabled ? "ON" : "OFF";
    toggle.classList.toggle("off", !enabled);
    toggle.title = enabled ? "この生成では使わない" : "この生成で使う";
    toggle.addEventListener("click", () => {
      if (disabledLoras.has(name)) disabledLoras.delete(name);
      else disabledLoras.add(name);
      renderUsedLoras();
      renderSelectedLoraSummary();
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "usedLoraRemove";
    remove.textContent = "×";
    remove.title = "この生成から外す";
    remove.setAttribute("aria-label", `${name}を外す`);
    remove.addEventListener("click", () => {
      setLoraSelected(name, false);
      renderSelectedLoraSummary();
      renderLoras();
    });

    row.append(title, weightField, toggle, remove);
    elements.usedLoraList.append(row);
  }
}

function clampLoraWeightValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return loraConfig.defaultWeight;
  return Number(Math.min(2, Math.max(0.05, number)).toFixed(2));
}

// LoRA・キャラクター・衣装で共通のサムネイル付き選択画面。
// items は preset-catalog.js が既存のLoRAデータから組み立てたもの。
async function openPresetPicker({
  title,
  subtitle = "",
  items,
  groupKey = "folder",
  applyLabel = "追加",
  isApplied = () => false,
  onApply,
  modes = null,
  emptyMessage = "選択できる項目がありません"
}) {
  if (!items.length) return toast.warning(emptyMessage);
  let query = "";
  let group = "";
  let favoriteOnly = false;
  let mode = modes?.[0]?.value ?? null;

  await openModal({
    title,
    subtitle,
    size: "large",
    build: (body, close) => {
      const toolbar = document.createElement("div");
      toolbar.className = "pickerToolbar";
      const search = document.createElement("input");
      search.type = "search";
      search.className = "optionPickerSearch";
      search.placeholder = "名前・トリガーワード・フォルダで検索";
      search.setAttribute("data-autofocus", "true");
      const favoriteToggle = document.createElement("div");
      favoriteToggle.className = "pickerFavoriteFilter";
      for (const [value, label] of [[false, "すべて"], [true, "★ Favorite"]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "pickerFilterButton";
        button.textContent = label;
        button.classList.toggle("active", favoriteOnly === value);
        button.addEventListener("click", () => {
          favoriteOnly = value;
          for (const other of favoriteToggle.children) other.classList.remove("active");
          button.classList.add("active");
          render();
        });
        favoriteToggle.append(button);
      }
      toolbar.append(search, favoriteToggle);

      const groupBar = document.createElement("div");
      groupBar.className = "pickerGroups";
      const grid = document.createElement("div");
      grid.className = "pickerGrid";

      const renderGroups = () => {
        groupBar.replaceChildren();
        for (const entry of buildGroups(items, groupKey)) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "pickerGroupButton";
          button.textContent = `${entry.label}（${entry.count}）`;
          button.classList.toggle("active", entry.value === group);
          button.addEventListener("click", () => {
            group = entry.value;
            renderGroups();
            render();
          });
          groupBar.append(button);
        }
      };

      const render = () => {
        grid.replaceChildren();
        const matches = filterPresets(items, {
          query,
          favoriteOnly,
          [groupKey]: group
        });
        if (!matches.length) {
          const empty = document.createElement("p");
          empty.className = "hint";
          empty.textContent = "一致する項目がありません";
          grid.append(empty);
          return;
        }
        for (const item of matches.slice(0, 300)) grid.append(createPickerCard(item, render, close));
      };

      const createPickerCard = (item, refresh, closeModal) => {
        const card = document.createElement("article");
        card.className = "pickerCard";

        const thumb = document.createElement("div");
        thumb.className = "pickerThumb";
        if (item.thumbnailUrl) {
          const image = document.createElement("img");
          image.src = item.thumbnailUrl;
          image.alt = "";
          // 件数が多いので遅延読み込みにする。
          image.loading = "lazy";
          image.decoding = "async";
          image.addEventListener("error", () => {
            image.remove();
            thumb.classList.add("placeholder");
            thumb.textContent = "NO IMAGE";
          });
          thumb.append(image);
        } else {
          thumb.classList.add("placeholder");
          thumb.textContent = "NO IMAGE";
        }

        // Favorite（LoRAマスタ側。画像のFavoriteとは別データ）
        const star = document.createElement("button");
        star.type = "button";
        star.className = "pickerStar";
        star.textContent = item.favorite ? "★" : "☆";
        star.title = item.favorite ? "Favoriteを外す" : "Favoriteに登録";
        star.setAttribute("aria-pressed", String(Boolean(item.favorite)));
        star.addEventListener("click", async (event) => {
          event.stopPropagation();
          star.disabled = true;
          const next = await toggleLoraFavorite(item.loraName, !item.favorite);
          star.disabled = false;
          if (next === null) return;
          for (const other of items) {
            if (other.loraName === item.loraName) other.favorite = next;
          }
          refresh();
        });
        thumb.append(star);

        const name = document.createElement("p");
        name.className = "pickerName";
        name.textContent = item.name;
        name.title = item.loraName;

        const meta = document.createElement("p");
        meta.className = "pickerMeta";
        meta.textContent = [item.subtitle || item.folder, PRESET_CATEGORY_LABELS[item.category] ?? item.category]
          .filter(Boolean).join(" / ");

        const trigger = document.createElement("p");
        trigger.className = "pickerTrigger";
        const preview = splitTriggerPreview(item.triggerWords);
        trigger.textContent = preview.tags.length
          ? `Trigger: ${preview.tags.join(", ")}${preview.rest ? ` ほか${preview.rest}` : ""}`
          : "Trigger: 未設定";

        const applied = isApplied(item);
        const action = document.createElement("button");
        action.type = "button";
        action.className = applied ? "secondary smallButton" : "primary smallButton";
        action.textContent = applied ? "追加済み" : applyLabel;
        action.addEventListener("click", async () => {
          await onApply(item, { mode, close: closeModal });
          refresh();
        });

        card.append(thumb, name, meta, trigger, action);
        return card;
      };

      search.addEventListener("input", () => {
        query = search.value;
        render();
      });

      body.append(toolbar, groupBar);
      if (modes) {
        const modeRow = document.createElement("div");
        modeRow.className = "importModeRow";
        for (const option of modes) {
          const label = document.createElement("label");
          label.className = "importModeChoice";
          const radio = document.createElement("input");
          radio.type = "radio";
          radio.name = "presetApplyMode";
          radio.value = option.value;
          radio.checked = option.value === mode;
          radio.addEventListener("change", () => { if (radio.checked) mode = option.value; });
          label.append(radio, option.label);
          modeRow.append(label);
        }
        body.append(modeRow);
      }
      body.append(grid);
      renderGroups();
      render();
    },
    actions: [{ label: "閉じる", value: true, primary: true }]
  }).promise;
}

// LoRAマスタのFavorite。未登録LoRAは登録してから更新する（画像のFavoriteとは別管理）。
async function toggleLoraFavorite(loraName, favorite) {
  const lora = findLoraByName(loraName);
  if (!lora) return null;
  try {
    let uid = lora.registry?.uid;
    if (!uid) {
      const { entry } = await postJson("/api/loras/registry/ensure", {
        relativeName: String(loraName).replaceAll("\\", "/"),
        displayName: lora.displayName ?? ""
      });
      uid = entry.uid;
    }
    const result = await patchJson(`/api/loras/${uid}`, { favorite });
    if (Array.isArray(result.loras) && result.loras.length) installedLoras = result.loras;
    else if (lora.registry) lora.registry.favorite = favorite;
    renderLoras();
    return favorite;
  } catch (error) {
    toast.error(`Favoriteを保存できませんでした: ${error.message}`);
    return null;
  }
}

function loraThumbnail(lora) {
  return resolveLoraPreviewUrl(lora);
}

// LoRA選択（フォルダ・分類・検索・Favorite絞り込み・サムネイル付き）
async function openLoraPicker() {
  const items = buildLoraCatalog(installedLoras, { resolveThumbnail: loraThumbnail });
  await openPresetPicker({
    title: "LoRAを追加",
    subtitle: `最大${loraConfig.maxSelected}個まで。★はLoRAのお気に入り（画像のFavoriteとは別です）`,
    items,
    groupKey: "folder",
    isApplied: (item) => selectedLoras.has(item.loraName),
    onApply: (item) => {
      if (selectedLoras.has(item.loraName)) {
        setLoraSelected(item.loraName, false);
      } else if (!addLoraToForm(item.loraName)) {
        return;
      }
      renderSelectedLoraSummary();
      renderLoras();
    }
  });
}

// 生成フォームへLoRAを1件足す（LoRAマスタは書き換えない）。
function addLoraToForm(loraName) {
  if (selectedLoras.has(loraName)) return true;
  if (selectedLoras.size >= loraConfig.maxSelected) {
    toast.warning(`LoRAは最大${loraConfig.maxSelected}個までです`);
    return false;
  }
  const lora = findLoraByName(loraName);
  const weight = loraWeights.get(loraName)
    ?? lora?.registry?.recommendedWeight
    ?? loraConfig.defaultWeight;
  setLoraSelected(loraName, true, Number(weight));
  return true;
}

// キャラクター選択。キャラ欄へタグを反映し、関連LoRAがあれば生成フォームへ追加する。
async function openCharacterPicker() {
  const items = buildCharacterPresets(installedLoras, {
    resolveProfile,
    resolveThumbnail: loraThumbnail
  });
  await openPresetPicker({
    title: "キャラクターを選択",
    subtitle: "キャラクター欄へ反映します。衣装や他の項目は変更しません",
    emptyMessage: "キャラクターの候補がありません。設定画面のLoRA管理で分類を「キャラクター」にすると候補になります",
    items,
    groupKey: "folder",
    applyLabel: "選択",
    isApplied: () => false,
    modes: [
      { value: "replace", label: "現在の内容を置き換える" },
      { value: "append", label: "現在の内容へ追加する" }
    ],
    onApply: (item, { mode }) => applyPresetToField("character", item, mode)
  });
}

// 衣装選択。容姿・衣装欄へ反映する（キャラクター欄は触らない）。
async function openOutfitPicker() {
  const items = buildOutfitPresets(installedLoras, {
    resolveProfile,
    resolveThumbnail: loraThumbnail
  });
  await openPresetPicker({
    title: "衣装を選択",
    subtitle: "容姿・衣装欄へ反映します。キャラクターや他の項目は変更しません",
    emptyMessage: "衣装の候補がありません。Civitaiから登録した衣装プリセット、キャラLoRAの追加衣装、分類が衣装のLoRAが候補になります",
    items,
    groupKey: "folder",
    applyLabel: "選択",
    isApplied: () => false,
    modes: [
      { value: "replace", label: "現在の内容を置き換える" },
      { value: "append", label: "現在の内容へ追加する" }
    ],
    onApply: (item, { mode }) => applyPresetToField("appearance", item, mode)
  });
}

// プリセットを1つのプロンプト項目へ反映する。他の項目は消さない。
function applyPresetToField(field, item, mode) {
  const element = promptFieldElement(field);
  element.value = mergePromptValue(element.value, item.promptTags, mode === "append" ? "append" : "replace");
  for (const loraName of item.relatedLoraIds ?? []) {
    if (findLoraByName(loraName)) addLoraToForm(loraName);
  }
  revealFilledPromptFields();
  handleStructuredPromptInput();
  renderSelectedLoraSummary();
  renderLoras();
  toast.success(`${item.name} を${PROMPT_FIELD_LABELS[field]}へ反映しました`);
}

// ---- 生成操作バー ----

// 結合結果（実際に送るPositive Prompt）を確認する。
function showCombinedPrompt() {
  const positive = currentPositivePrompt().trim();
  openModal({
    title: "結合結果",
    subtitle: rawPromptOverride ? "Raw Promptを優先しています" : "分割入力を上から順に結合した内容です",
    size: "medium",
    build: (body) => {
      const positiveBlock = document.createElement("pre");
      positiveBlock.className = "sharePreview";
      positiveBlock.textContent = positive || "（未入力）";
      const negativeHeading = document.createElement("p");
      negativeHeading.className = "hint";
      negativeHeading.textContent = "Negative Prompt";
      const negativeBlock = document.createElement("pre");
      negativeBlock.className = "sharePreview";
      negativeBlock.textContent = elements.negativePrompt.value.trim() || "（未入力）";
      body.append(positiveBlock, negativeHeading, negativeBlock);
    },
    actions: [
      {
        label: "Positiveをコピー",
        variant: "secondary",
        keepOpen: true,
        onSelect: async () => {
          if (!positive) return toast.warning("コピーできる内容がありません");
          try {
            await copyToClipboard(positive);
            toast.success("結合結果をコピーしました");
          } catch (error) {
            toast.error(`コピーできませんでした: ${error.message}`);
          }
        }
      },
      { label: "閉じる", value: true, primary: true }
    ]
  });
}

// 現在の設定のまま比較画面へ移動する（生成は行わない）。
// 比較の状態はすべて既存の比較フォームが持ち、ここは値を渡す入り口だけ。
function sendToCompare() {
  if (elements.compareShortcutParameter.value) {
    elements.experimentParameter.value = elements.compareShortcutParameter.value;
    syncExperimentTargetVisibility();
  }
  if (elements.compareShortcutValues.value.trim()) {
    elements.experimentValues.value = elements.compareShortcutValues.value;
  }
  showView("compare");
  elements.experimentDetails.open = true;
  elements.experimentDetails.scrollIntoView({ behavior: "smooth", block: "start" });
  toast.info("現在のPrompt・LoRA・生成設定のまま比較できます");
}

// 生成設定内のショートカットを、比較フォームの現在値へ合わせる。
function syncCompareShortcut() {
  elements.compareShortcutParameter.replaceChildren(
    ...[...elements.experimentParameter.options].map((option) => new Option(option.text, option.value))
  );
  elements.compareShortcutParameter.value = elements.experimentParameter.value;
  elements.compareShortcutValues.value = elements.experimentValues.value;
}

// 生成中は同じ位置へ進捗を出し、ボタンを押せなくする。
function renderGenerateActions() {
  const busy = Boolean(activeJobId);
  elements.generateProgress.classList.toggle("hidden", !busy);
  // 生成枚数が不正なままでは開始しない。
  elements.generateButton.disabled = busy || !isValidCandidateCount(elements.candidateCount.value);
  elements.compareShortcutButton.disabled = busy;
}

// 実験一覧は「比較」画面、画像一覧は「ギャラリー」画面が持つ。
function setGalleryView(view) {
  showView(view === "experiments" ? "compare" : "gallery");
}

async function openGalleryExperiments() {
  showView("compare");
  await loadExperiments();
  renderExperimentCards();
}

function renderExperimentCards() {
  elements.experimentGrid.replaceChildren();
  if (!knownExperiments.length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "「パラメータ比較」で比較生成すると、ここへ実験としてまとまります。";
    elements.experimentGrid.append(empty);
    return;
  }
  for (const experiment of knownExperiments) {
    elements.experimentGrid.append(createExperimentCard(experiment));
  }
}

function experimentEntries(experiment) {
  const imageIds = new Set(experiment.runs.flatMap((run) => run.imageIds ?? []));
  return historyEntries.filter((entry) => entry.generation.experimentId === experiment.id
    || imageIds.has(entry.image.id));
}

function createExperimentCard(experiment) {
  const card = document.createElement("article");
  card.className = "experimentCard";

  const header = document.createElement("div");
  header.className = "experimentCardHeader";
  const title = document.createElement("strong");
  title.textContent = experiment.name;
  const status = document.createElement("span");
  status.className = `experimentCardStatus ${experiment.status}`;
  status.textContent = { running: "生成中", done: "完了", cancelled: "中断" }[experiment.status] ?? experiment.status;
  header.append(title, status);

  const meta = document.createElement("div");
  meta.className = "experimentCardMeta";
  meta.append(
    line(`${experiment.total}枚（完了 ${experiment.completed}）`),
    line(experiment.fixedSeed != null ? `Seed ${experiment.fixedSeed}` : "Seed 未固定"),
    line(experiment.values.join(" / "))
  );

  const thumbs = document.createElement("div");
  thumbs.className = "experimentCardThumbs";
  const entries = experimentEntries(experiment);
  for (const entry of entries.slice(0, 4)) {
    const image = document.createElement("img");
    image.src = entry.image.imageUrl;
    image.alt = `${experiment.name} ${entry.generation.comparedValue ?? ""}`;
    image.loading = "lazy";
    image.title = "クリックで拡大";
    image.addEventListener("click", () => openImageModal(entry.image.imageUrl, experiment.name));
    thumbs.append(image);
  }

  const actions = document.createElement("div");
  actions.className = "experimentCardActions";
  actions.append(
    actionButton("開く", "secondary", () => openExperimentDetail(experiment)),
    actionButton("比較", "secondary", () => {
      const selected = experimentEntries(experiment).slice(0, 4);
      if (selected.length < 2) return toast.warning("比較できる画像が2枚以上ありません");
      void openComparison(selected, experiment);
    }),
    actionButton("名前変更", "ghost", () => void renameExperiment(experiment)),
    actionButton("削除", "historyDelete", () => void deleteExperiment(experiment))
  );

  card.append(header, meta, thumbs, actions);
  return card;
}

function line(text) {
  const span = document.createElement("span");
  span.textContent = text;
  return span;
}

function actionButton(label, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

function openExperimentDetail(experiment) {
  const entries = experimentEntries(experiment);
  openModal({
    title: experiment.name,
    subtitle: `${experiment.parameter}${experiment.target ? ` / ${experiment.target}` : ""}・${experiment.total}枚`,
    size: "large",
    build: (body, close) => {
      const grid = document.createElement("div");
      grid.className = "experimentDetailGrid";
      for (const run of experiment.runs) {
        const entry = entries.find((item) => (run.imageIds ?? []).includes(item.image.id));
        const cell = document.createElement("figure");
        cell.className = "experimentDetailCell";
        if (entry) {
          const image = document.createElement("img");
          image.src = entry.image.imageUrl;
          image.alt = `${run.value}`;
          image.loading = "lazy";
          image.addEventListener("click", () => openImageModal(entry.image.imageUrl, `${experiment.name} ${run.value}`));
          cell.append(image);
        } else {
          const placeholder = document.createElement("div");
          placeholder.className = "experimentDetailPlaceholder";
          placeholder.textContent = { queued: "待機中", running: "生成中", failed: "失敗", cancelled: "中止" }[run.status] ?? "—";
          if (run.error) placeholder.title = run.error;
          cell.append(placeholder);
        }
        const caption = document.createElement("figcaption");
        caption.textContent = `${run.value}`;
        // リカバリされた画像は比較条件が変わっているため、必ず判別できるようにする。
        if (run.recovered || entry?.generation?.retryInfo) {
          caption.append(recoveredBadge(run.retryInfo ?? entry?.generation?.retryInfo));
        }
        if (entry?.image.vote) {
          // A/B比較の結果を実験詳細でも確認できるようにする。
          const vote = document.createElement("span");
          vote.className = `experimentVote vote-${entry.image.vote}`;
          vote.textContent = { win: "A/B勝ち", lose: "A/B負け", draw: "引き分け" }[entry.image.vote] ?? entry.image.vote;
          caption.append(vote);
        }
        if (entry) {
          const favorite = document.createElement("button");
          favorite.type = "button";
          favorite.className = `iconButton${entry.image.favorite ? " active" : ""}`;
          favorite.textContent = "👍";
          favorite.title = "お気に入り";
          favorite.addEventListener("click", () => void toggleFavorite(entry.image, favorite));
          caption.append(favorite);
          const best = document.createElement("button");
          best.type = "button";
          best.className = experiment.bestImageId === entry.image.id ? "primary smallButton" : "ghost smallButton";
          best.textContent = experiment.bestImageId === entry.image.id ? "最良" : "最良にする";
          best.addEventListener("click", async () => {
            await patchJson(`/api/experiments/${experiment.id}`, { bestImageId: entry.image.id });
            toast.success("最良画像を記録しました");
            await loadExperiments();
            close();
          });
          caption.append(best);
        }
        cell.append(caption);
        grid.append(cell);
      }
      body.append(grid);

      if (experiment.bestImageId) {
        const note = document.createElement("p");
        note.className = "uiFieldNote";
        note.textContent = `最良画像: ${experiment.bestImageId}`;
        body.append(note);
      }
    },
    actions: [
      {
        label: "比較する",
        variant: "secondary",
        keepOpen: true,
        onSelect: (close) => {
          const selected = entries.slice(0, 4);
          if (selected.length < 2) {
            toast.warning("比較できる画像が2枚以上ありません");
            return false;
          }
          close();
          void openComparison(selected, experiment);
        }
      },
      { label: "閉じる", primary: true }
    ]
  });
}

async function renameExperiment(experiment) {
  const name = await promptModal("実験名を変更", experiment.name);
  if (!name) return;
  try {
    await patchJson(`/api/experiments/${experiment.id}`, { name });
    toast.success("実験名を変更しました");
    await loadExperiments();
    renderExperimentCards();
  } catch (error) {
    toast.error(error.message);
  }
}

async function deleteExperiment(experiment) {
  const choice = await openModal({
    title: "実験の一括削除",
    subtitle: experiment.name,
    size: "small",
    dismissValue: null,
    build: (body) => {
      const message = document.createElement("p");
      message.className = "uiModalMessage";
      message.textContent = `${experiment.total}枚分の実験「${experiment.name}」を削除します。この操作は取り消せません。`;
      body.append(message);
    },
    actions: [
      { label: "キャンセル", value: null, variant: "secondary" },
      { label: "履歴だけ削除", value: "history", variant: "secondary" },
      { label: "履歴と画像を削除", value: "all", variant: "dangerButton", primary: true }
    ]
  }).promise;
  if (!choice) return;

  try {
    const query = choice === "all" ? "?deleteImages=1" : "";
    const result = await deleteJson(`/api/experiments/${experiment.id}${query}`);
    toast.success(`実験を削除しました（履歴${result.removedGenerations}件・画像${result.removedImages}枚）`);
    await loadHistory();
    await loadExperiments();
    renderExperimentCards();
  } catch (error) {
    toast.error(error.message);
  }
}

// ---- 画像比較 ----

function updateCompareButton() {
  const count = compareSelection.size;
  elements.compareSelectionButton.disabled = count < 2;
  elements.compareSelectionButton.textContent = count ? `比較する（${count}）` : "比較する";
}

function toggleCompareSelection(image, generation, button) {
  if (compareSelection.has(image.id)) {
    compareSelection.delete(image.id);
  } else {
    if (compareSelection.size >= 4) return toast.warning("比較は最大4枚までです");
    compareSelection.set(image.id, { image, generation });
  }
  button?.classList.toggle("active", compareSelection.has(image.id));
  updateCompareButton();
}

async function openComparison(entries, experiment = null) {
  await openCompareView({
    entries,
    onVote: async ({ winnerImageId, result }) => {
      try {
        await postJson("/api/comparisons", {
          imageIds: entries.map((entry) => entry.image.id),
          winnerImageId,
          result,
          parameter: experiment?.parameter ?? entries[0]?.generation?.comparedParameter ?? ""
        });
        if (experiment && winnerImageId) {
          await patchJson(`/api/experiments/${experiment.id}`, { bestImageId: winnerImageId });
        }
        toast.success("比較結果を記録しました");
        await loadHistory();
      } catch (error) {
        toast.error(error.message);
      }
    }
  });
}

function compareCurrentSelection() {
  const entries = [...compareSelection.values()];
  if (entries.length < 2) return toast.warning("比較する画像を2枚以上選んでください");
  void openComparison(entries);
}

function createHistoryCard(generation, image) {
  const card = document.createElement("article");
  card.className = "historyCard";
  const previewWrap = document.createElement("div");
  previewWrap.className = "historyCardPreview";

  const preview = document.createElement("img");
  preview.className = "historyCardImage";
  preview.src = image.imageUrl;
  preview.alt = generation.description || `Seed ${image.seed}`;
  preview.loading = "lazy";
  preview.title = "クリックで拡大";
  preview.addEventListener("click", () =>
    openImageModal(image.imageUrl, generation.description || `Seed ${image.seed}`)
  );

  const body = document.createElement("div");
  body.className = "historyCardBody";

  const meta = document.createElement("div");
  meta.className = "historyCardMeta";
  const summary = document.createElement("span");
  summary.className = "historyCardSummary";
  const badge = generation.settings?.checkpoint
    ? formatCheckpointBadge(generation.settings.checkpoint)
    : null;
  summary.textContent = [badge, loraCountLabel(generation.loras), historyModeLabel(generation.mode)]
    .filter(Boolean)
    .join("・");
  const seedLine = document.createElement("span");
  seedLine.className = "historyCardSeed";
  seedLine.textContent = `Seed ${image.seed}`;
  meta.append(summary, seedLine);

  const actions = document.createElement("div");
  actions.className = "historyCardActions";

  // カード右上の星（画像のFavorite）。一覧・詳細・最新結果で状態を共有する。
  previewWrap.append(preview, createFavoriteButton(image, { className: "cardFavorite" }));
  const discordBadge = createDiscordStatusNode(image);

  const del = document.createElement("button");
  del.type = "button";
  del.className = "historyDelete";
  del.textContent = "削除";
  del.title = "この画像を削除する";
  del.addEventListener("click", () => void deleteHistoryImage(image, del));

  const load = document.createElement("button");
  load.type = "button";
  load.className = "secondary";
  load.textContent = "読込";
  load.title = "この画像の設定を読み込む";
  load.addEventListener("click", () => activateCompositionLock(generation, image));

  const detail = document.createElement("button");
  detail.type = "button";
  detail.className = "ghost";
  detail.textContent = "詳細";
  detail.title = "生成情報を表示";
  detail.addEventListener("click", () => openHistoryDetail(generation, image));

  const compare = document.createElement("button");
  compare.type = "button";
  compare.className = `ghost compareToggle${compareSelection.has(image.id) ? " active" : ""}`;
  compare.textContent = "比較";
  compare.title = "比較対象に追加・解除";
  compare.addEventListener("click", () => toggleCompareSelection(image, generation, compare));

  if (generation.experimentName) {
    const badge = document.createElement("span");
    badge.className = "historyExperimentBadge";
    badge.textContent = generation.comparedValue != null
      ? `${generation.experimentName}: ${generation.comparedValue}`
      : generation.experimentName;
    badge.title = "実験グループ";
    meta.append(badge);
  }

  actions.append(discordBadge, del, load, detail, compare);
  body.append(meta, actions);
  card.append(previewWrap, body);
  return card;
}

// 一覧表示専用のCheckpoint短縮名。内部データには正式名を保存する。
function formatCheckpointBadge(name) {
  const value = String(name ?? "").toLowerCase();
  if (!value) return "Other";
  if (value.includes("noobai") || value.includes("noob")) return "NoobAI";
  if (value.includes("obsession")) return "Obsession";
  if (value.includes("chosen")) return "Chosen";
  if (value.includes("realskin")) return "RealSkin";
  if (value.includes("wai")) return "WAI";
  if (value.includes("rin")) return "RIN";
  if (value.includes("illustrious")) return "Illustrious";
  return "Other";
}

function loraCountLabel(loras) {
  const count = Array.isArray(loras) ? loras.length : 0;
  return count ? `LoRA ${count}` : "LoRAなし";
}

function historyModeLabel(mode) {
  if (mode === "img2img") return "img2img";
  if (mode === "inpaint") return "部分修正";
  return null;
}

async function deleteHistoryImage(image, button) {
  const confirmed = await confirmDialog("この画像を削除しますか？", {
    confirmText: "削除する",
    cancelText: "キャンセル",
    danger: true
  });
  if (!confirmed) return;
  button.disabled = true;
  try {
    const data = await deleteJson(`/api/history/${image.id}`);
    if (data.preferences) {
      preferenceData = data.preferences;
      renderPreferenceSummary();
    }
    await loadHistory();
  } catch (error) {
    button.disabled = false;
    showError(`削除できませんでした: ${error.message}`);
  }
}

// キャンセル/実行の2択確認。共通モーダル部品へ委譲する。
function confirmDialog(message, options = {}) {
  return confirmModal(message, options);
}

// 1行入力モーダル。キャンセル時はnullを返す。
function promptModal(title, initialValue = "", { placeholder = "", multiline = false, confirmText = "決定" } = {}) {
  let field = null;
  return openModal({
    title,
    size: "small",
    dismissValue: null,
    build: (body) => {
      field = document.createElement(multiline ? "textarea" : "input");
      if (multiline) field.rows = 3;
      else field.type = "text";
      field.className = "promptModalField";
      field.value = initialValue;
      field.placeholder = placeholder;
      field.setAttribute("data-autofocus", "true");
      body.append(field);
    },
    actions: [
      { label: "キャンセル", value: null, variant: "secondary" },
      {
        label: confirmText,
        primary: true,
        keepOpen: true,
        onSelect: (close) => {
          const value = field.value.trim();
          if (!value) {
            toast.warning("内容を入力してください");
            return false;
          }
          close(value);
        }
      }
    ]
  }).promise;
}

function openHistoryDetail(generation, image) {
  const overlay = document.createElement("div");
  overlay.className = "detailModal";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "生成情報");
  const box = document.createElement("div");
  box.className = "detailBox";

  const closeDetail = () => {
    document.removeEventListener("keydown", onKey);
    overlay.remove();
  };
  const onKey = (event) => { if (event.key === "Escape") closeDetail(); };

  const header = document.createElement("div");
  header.className = "detailHeader";
  const heading = document.createElement("strong");
  heading.textContent = generation.description || "生成情報";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "imageModalClose";
  close.setAttribute("aria-label", "閉じる");
  close.textContent = "×";
  close.addEventListener("click", closeDetail);
  header.append(heading, close);

  const settings = generation.settings ?? {};
  const dl = document.createElement("dl");
  dl.className = "detailFields";
  const addField = (label, value) => {
    if (value === null || value === undefined || value === "") return;
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    if (value instanceof Node) dd.append(value);
    else dd.textContent = String(value);
    dl.append(dt, dd);
  };
  addField("Checkpoint", settings.checkpoint || "Checkpoint記録なし");
  addField("LoRA", buildLoraDetailNode(generation.loras));
  addField("LoRA警告", buildLoraNoticeNode(generation.loraNotices));
  addField("Seed", image.seed);
  addField("Sampler", settings.samplerName);
  addField("Scheduler", settings.scheduler);
  if (settings.noiseSchedule && settings.noiseSchedule !== "Automatic") {
    addField("Noise schedule", settings.noiseSchedule);
  }
  addField("Steps", settings.steps);
  addField("CFG", settings.cfgScale);
  const resolution = image.width && image.height
    ? `${image.width}×${image.height}`
    : (settings.width && settings.height ? `${settings.width}×${settings.height}` : null);
  addField("解像度", resolution);
  addField("生成モード", historyModeLabel(generation.mode) ?? "txt2img");
  addField("生成日時", formatDate(generation.createdAt));

  // コピー操作。整形はmetadata-format.jsへ分離してある。
  const copyRow = document.createElement("div");
  copyRow.className = "detailCopyActions";
  copyRow.append(
    createCopyButton("Copy Prompt", "secondary smallButton", () => buildPromptText(generation),
      "ポジティブプロンプトだけをコピー"),
    createCopyButton("Copy All Metadata", "secondary smallButton", () => buildMetadataText(generation, image),
      "PNG Info形式で生成情報をコピー")
  );

  const prompts = document.createElement("div");
  prompts.className = "detailPrompts";
  prompts.append(buildPromptDetails("Prompt", generation.prompt));
  prompts.append(buildPromptDetails("Negative Prompt", generation.negativePrompt));
  for (const details of buildStructuredPromptDetails(generation)) prompts.append(details);

  const footer = document.createElement("div");
  footer.className = "detailActions";
  const addAction = (label, className, handler, title = "") => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    if (title) button.title = title;
    button.addEventListener("click", handler);
    footer.append(button);
    return button;
  };
  const detailFavorite = createFavoriteButton(image, { style: "label", className: "favoriteButton" });
  footer.append(detailFavorite);
  addAction("img2imgへ", "secondary", () => { closeDetail(); useImageForImg2Img(image); });
  addAction("部分修正", "secondary", () => { closeDetail(); useImageForInpaint(image); });
  addAction("同じSeedで再生成", "secondary", () => {
    closeDetail();
    regenerateWithSameSeed(generation, image);
  }, "Prompt・Seed・Checkpoint・LoRA・設定を復元して生成画面へ読み込みます");
  addAction("LoRAだけ変更", "secondary", () => { closeDetail(); void changeLoraOnly(generation, image); });
  addAction("衣装だけ変更", "secondary", () => { closeDetail(); void deriveWithInstruction(generation, image, "outfit"); });
  addAction("背景だけ変更", "secondary", () => { closeDetail(); void deriveWithInstruction(generation, image, "background"); });
  addAction("表情だけ変更", "secondary", () => { closeDetail(); void deriveWithInstruction(generation, image, "expression"); });
  addAction("設定を複製", "ghost", () => {
    closeDetail();
    duplicateRecipe(generation, image);
  }, "Seedは-1のまま設定だけ読み込みます");
  addAction("比較対象へ追加", "ghost", () => {
    toggleCompareSelection(image, generation);
    toast.info(compareSelection.has(image.id) ? "比較対象へ追加しました" : "比較対象から外しました");
  });
  addAction("Hiresする", "primary", () => { closeDetail(); void hiresFromGallery(generation, image); },
    "この画像を元に高解像度仕上げ");

  overlay.addEventListener("click", (event) => { if (event.target === overlay) closeDetail(); });
  document.addEventListener("keydown", onKey);

  box.append(header, dl, copyRow, prompts, footer);
  overlay.append(box);
  document.body.append(overlay);
}

// コピー用ボタン。成功時だけ「Copied!」へ変え、失敗はエラーとして知らせる。
function createCopyButton(label, className, buildText, title = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  if (title) button.title = title;
  button.addEventListener("click", async () => {
    let text = "";
    try {
      text = buildText();
    } catch {
      text = "";
    }
    if (!text) return toast.warning("コピーできる情報が保存されていません");
    try {
      await copyToClipboard(text);
      flashLabel(button, "Copied!");
    } catch (error) {
      toast.error(`コピーできませんでした: ${error.message}`);
    }
  });
  return button;
}

// ---- ギャラリーからの派生生成 ----

const DERIVATION_LABELS = {
  outfit: { title: "衣装だけ変更", placeholder: "例: 黒いドレスへ変更", prefix: "" },
  background: { title: "背景だけ変更", placeholder: "例: 夜の東京の屋上", prefix: "background: " },
  expression: { title: "表情だけ変更", placeholder: "例: 困ったような笑顔", prefix: "expression: " }
};

// 元レシピをそのまま読み込み、Seedも固定して再生成できる状態にする。
function regenerateWithSameSeed(generation, image) {
  activateCompositionLock(generation, image);
  pendingDerivation = { type: "same-seed", instruction: "", parentGenerationId: generation.id };
  toast.success(`Seed ${image.seed} の設定を読み込みました。「候補を生成」で再生成できます`);
}

// Seedは固定せず設定だけ複製する。
function duplicateRecipe(generation, image) {
  loadRecipeFields(generation, image);
  elements.seed.value = RANDOM_SEED;
  syncSeedClearButton();
  compositionLock = null;
  elements.compositionLockStatus.classList.add("hidden");
  pendingDerivation = { type: "duplicate", instruction: "", parentGenerationId: generation.id };
  toast.success("設定を複製しました（Seedはランダム）");
}

// 元レシピを読み込んだうえで、LoRAの付け外し・weight変更だけを行う。
async function changeLoraOnly(generation, image) {
  loadRecipeFields(generation, image);
  pendingDerivation = { type: "lora", instruction: "", parentGenerationId: generation.id };
  const working = new Map(selectedLoras);

  const applied = await openModal({
    title: "LoRAだけ変更",
    subtitle: `Seed ${image.seed} の設定を保ったままLoRAを差し替えます`,
    dismissValue: false,
    build: (body) => {
      const list = document.createElement("div");
      list.className = "loraSwapList";
      const rows = () => {
        list.replaceChildren();
        for (const lora of installedLoras) {
          const row = document.createElement("label");
          row.className = "loraSwapRow";
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.checked = working.has(lora.name);
          const name = document.createElement("span");
          name.textContent = lora.displayName;
          const weight = document.createElement("input");
          weight.type = "number";
          weight.min = "0.05";
          weight.max = "2";
          weight.step = "0.05";
          weight.value = String(working.get(lora.name) ?? loraWeights.get(lora.name) ?? loraConfig.defaultWeight);
          weight.disabled = !checkbox.checked;
          checkbox.addEventListener("change", () => {
            if (checkbox.checked) {
              if (working.size >= loraConfig.maxSelected) {
                checkbox.checked = false;
                toast.warning(`LoRAは最大${loraConfig.maxSelected}個までです`);
                return;
              }
              working.set(lora.name, Number(weight.value));
            } else {
              working.delete(lora.name);
            }
            weight.disabled = !checkbox.checked;
          });
          weight.addEventListener("input", () => {
            if (working.has(lora.name)) working.set(lora.name, Number(weight.value));
          });
          row.append(checkbox, name, weight);
          list.append(row);
        }
      };
      rows();
      body.append(list);
    },
    actions: [
      { label: "キャンセル", value: false, variant: "secondary" },
      { label: "この構成にする", value: true, primary: true }
    ]
  }).promise;

  if (!applied) return;
  selectedLoras.clear();
  for (const [name, weight] of working) {
    selectedLoras.set(name, Number(weight));
    loraWeights.set(name, Number(weight));
  }
  saveLoraWeights();
  renderLoras();
  renderSelectedLoraSummary();
  toast.success(`LoRAを${working.size}個に変更しました`);
}

// 衣装・背景・表情だけを差し替える。元Promptへ追加指示を足す方式で、
// 何を追加したかは履歴（derivationInstruction）へ残す。
async function deriveWithInstruction(generation, image, type) {
  const definition = DERIVATION_LABELS[type];
  const instruction = await promptModal(definition.title, "", {
    placeholder: definition.placeholder,
    confirmText: "読み込む"
  });
  if (!instruction) return;

  loadRecipeFields(generation, image);
  const addition = `${definition.prefix}${instruction}`;
  elements.outfitOverride.value = type === "outfit" ? instruction : elements.outfitOverride.value;
  if (type !== "outfit") {
    // 背景・表情はPrompt末尾へ追記し、元Promptのキャラ情報を保つ。
    setPromptFields(
      appendPromptInstruction(elements.prompt.value, addition),
      elements.negativePrompt.value,
      elements.description.value.trim()
    );
  }
  savePromptPartSelections();
  updatePromptPartsSummary();
  pendingDerivation = { type, instruction, parentGenerationId: generation.id };
  toast.success(`${definition.title}の指示を読み込みました: ${instruction}`);
  elements.description.scrollIntoView({ behavior: "smooth", block: "center" });
}

function appendPromptInstruction(prompt, addition) {
  const base = String(prompt ?? "").trim();
  if (!addition) return base;
  return base ? `${base}, ${addition}` : addition;
}

function buildLoraDetailNode(loras) {
  if (!Array.isArray(loras) || !loras.length) {
    const span = document.createElement("span");
    span.textContent = "LoRAなし";
    return span;
  }
  const list = document.createElement("div");
  list.className = "detailLoraList";
  for (const lora of loras) {
    const row = document.createElement("div");
    row.className = "detailLoraRow";
    const name = document.createElement("span");
    name.className = "detailLoraName";
    name.textContent = lora.name;
    const weight = document.createElement("span");
    weight.className = "detailLoraWeight";
    // 実際に生成へ送ったWeightをそのまま出す（UIの古い値は使わない）。
    weight.textContent = Number(lora.weight).toFixed(2);
    row.append(name, weight);
    if (lora.source) {
      const source = document.createElement("small");
      source.className = "detailLoraSource";
      source.textContent = LORA_SOURCE_LABELS[lora.source] ?? lora.source;
      source.title = "このLoRAの選択元";
      row.append(source);
    }
    list.append(row);
  }
  return list;
}

const LORA_SOURCE_LABELS = { ui: "Source: ui", prompt: "Source: prompt", both: "Source: both" };

// LoRAタグ同期の警告を履歴詳細でも確認できるようにする。
function buildLoraNoticeNode(notices) {
  if (!Array.isArray(notices) || !notices.length) return null;
  const list = document.createElement("div");
  list.className = "detailLoraNotices";
  for (const notice of notices) {
    const row = document.createElement("div");
    row.textContent = {
      duplicate: () => `同じLoRAが複数記述: ${notice.name}（${(notice.weights ?? []).join(" / ")} → ${notice.weight}）`,
      unresolved: () => `未インストール: ${notice.name}`,
      ambiguous: () => `特定不能: ${notice.name}（候補: ${(notice.candidates ?? []).join(" / ")}）`,
      invalidWeight: () => `Weightを読み取れず1を使用: ${notice.name}`
    }[notice.type]?.() ?? `${notice.type}: ${notice.name}`;
    list.append(row);
  }
  return list;
}

// 構造化プロンプトを保存した履歴だけ、内訳とトリガーワードを追加表示する。
function buildStructuredPromptDetails(generation) {
  const sections = generation?.structuredPrompt;
  if (!sections) return [];
  const lines = PROMPT_FIELDS
    .map((field) => [PROMPT_FIELD_LABELS[field], String(sections[field] ?? "").trim()])
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`);
  const triggers = normalizeAppliedTriggerWords(generation.appliedTriggerWords)
    .map((trigger) => {
      const state = trigger.enabled ? formatTriggerWord(trigger) : `${trigger.text}（無効）`;
      return `${PROMPT_FIELD_LABELS[trigger.targetField]}: ${state}`;
    });
  const result = [];
  if (lines.length) result.push(buildPromptDetails("構造化プロンプト", lines.join("\n")));
  if (triggers.length) result.push(buildPromptDetails("LoRAトリガーワード", triggers.join("\n")));
  if (generation.rawPromptOverride) {
    result.push(buildPromptDetails("Raw Prompt上書き", generation.rawPrompt || generation.prompt));
  }
  return result;
}

function buildPromptDetails(label, text) {
  const details = document.createElement("details");
  details.className = "detailPrompt";
  const summary = document.createElement("summary");
  summary.textContent = label;
  const body = document.createElement("p");
  body.className = "detailPromptBody";
  body.textContent = text || "（なし）";
  details.append(summary, body);
  return details;
}

function renderPreferenceSummary() {
  elements.preferenceSummary.replaceChildren();
  if (!preferenceData.favoriteCount) {
    elements.preferenceSummary.textContent = "画像に👍を付けると、好きなタグ・LoRA・設定をここへ集計します。";
    elements.applyPreferenceButton.disabled = true;
    return;
  }
  elements.applyPreferenceButton.disabled = false;
  const heading = document.createElement("strong");
  heading.textContent = `👍 ${preferenceData.favoriteCount}枚から抽出`;
  const line = document.createElement("div");
  const loras = preferenceData.topLoras.map((item) => item.name).slice(0, 3);
  const settings = preferenceData.topSettings[0]?.name;
  line.textContent = [
    loras.length ? `よく使うLoRA: ${loras.join(" / ")}` : "",
    settings ? `好みの設定: ${settings}` : ""
  ].filter(Boolean).join("　");
  const tags = document.createElement("div");
  tags.className = "preferenceTags";
  for (const item of preferenceData.topTags.slice(0, 12)) {
    const tag = document.createElement("span");
    tag.className = "preferenceTag";
    tag.textContent = `${item.name} ×${item.count}`;
    tags.append(tag);
  }
  elements.preferenceSummary.append(heading, line, tags);
}

function applyPreferenceTags() {
  preferenceBoosts = preferenceData.topTags.slice(0, 8).map((item) => item.name);
  updatePromptPartsSummary();
}

function clearPromptParts() {
  for (const element of [
    elements.stylePreset, elements.compositionPreset, elements.lightingPreset, elements.moodPreset
  ]) element.value = "";
  elements.outfitOverride.value = "";
  preferenceBoosts = [];
  savePromptPartSelections();
  updatePromptPartsSummary();
}

function handlePromptPartChange() {
  savePromptPartSelections();
  updatePromptPartsSummary();
}

function readPromptBoosts() {
  return [
    elements.stylePreset.value,
    elements.compositionPreset.value,
    elements.lightingPreset.value,
    elements.moodPreset.value,
    elements.outfitOverride.value,
    ...preferenceBoosts
  ].filter(Boolean);
}

function updatePromptPartsSummary() {
  const values = readPromptBoosts();
  elements.promptPartsSummary.textContent = values.length
    ? `追加: ${values.join(" / ")}`
    : "追加部品なし";
}

function loadPromptPartSelections() {
  try {
    const saved = JSON.parse(localStorage.getItem("localImageChat.promptParts") ?? "{}");
    for (const [key, element] of Object.entries({
      style: elements.stylePreset,
      composition: elements.compositionPreset,
      lighting: elements.lightingPreset,
      mood: elements.moodPreset
    })) {
      if ([...element.options].some((option) => option.value === saved[key])) element.value = saved[key];
    }
    if (typeof saved.outfit === "string") elements.outfitOverride.value = saved.outfit.slice(0, 500);
  } catch {
    // 壊れたブラウザ設定は無視する。
  }
  updatePromptPartsSummary();
}

function savePromptPartSelections() {
  localStorage.setItem("localImageChat.promptParts", JSON.stringify({
    style: elements.stylePreset.value,
    composition: elements.compositionPreset.value,
    lighting: elements.lightingPreset.value,
    mood: elements.moodPreset.value,
    outfit: elements.outfitOverride.value
  }));
}

async function inspectCivitai() {
  const url = elements.civitaiUrl.value.trim();
  if (!url) return showError("CivitaiのモデルページURLを入力してください");
  clearError();
  rememberSessionSecrets();
  elements.inspectCivitaiButton.disabled = true;
  elements.installCivitaiButton.disabled = true;
  elements.civitaiStatus.textContent = "Civitaiからモデル情報を取得中…";
  try {
    const data = await postJson("/api/civitai/inspect", {
      url,
      token: elements.civitaiToken.value
    });
    inspectedCivitai = data.metadata;
    renderCivitaiPreview(data.metadata);
    elements.installCivitaiButton.disabled = false;
    elements.civitaiStatus.textContent = "内容を確認しました。分類を選んで登録できます。";
  } catch (error) {
    inspectedCivitai = null;
    elements.civitaiPreview.classList.add("hidden");
    elements.civitaiStatus.textContent = error.message;
  } finally {
    elements.inspectCivitaiButton.disabled = false;
  }
}

function renderCivitaiPreview(metadata) {
  elements.civitaiPreview.replaceChildren();
  if (metadata.previewUrl) {
    const image = document.createElement("img");
    image.src = metadata.previewUrl;
    image.alt = metadata.modelName;
    elements.civitaiPreview.append(image);
  }
  const text = document.createElement("div");
  const heading = document.createElement("strong");
  heading.textContent = `${metadata.modelName} / ${metadata.versionName}`;
  const base = document.createElement("span");
  base.textContent = `${metadata.modelType}・${metadata.baseModel}・${formatFileSize(metadata.file.sizeKB)}`;
  const triggers = document.createElement("span");
  triggers.textContent = metadata.trainedWords.length
    ? `Trigger: ${metadata.trainedWords.join(", ")}`
    : "Trigger Wordsの登録なし";
  const outfits = document.createElement("span");
  outfits.textContent = metadata.outfitPresets?.length > 1
    ? `衣装プリセット候補: ${metadata.outfitPresets.length}種類`
    : "衣装プリセット候補: 1種類";
  const filename = document.createElement("span");
  filename.textContent = metadata.file.name;
  const location = document.createElement("span");
  location.className = "civitaiPreviewLocation";
  const categoryLabel = elements.civitaiCategory.selectedOptions[0]?.textContent ?? elements.civitaiCategory.value;
  const folder = selectedCivitaiFolder();
  location.textContent = `分類: ${categoryLabel} ／ 保存先: ${folder || "保存先を選択してください"}`;
  text.append(heading, base, triggers, outfits, filename, location);
  elements.civitaiPreview.append(text);
  elements.civitaiPreview.classList.remove("hidden");
}

// 現在認識しているLoRAルートを取得して表示する。推定値と明示設定を区別する。
async function loadLoraRoot() {
  try {
    loraRootInfo = await getJson("/api/lora/install-root");
  } catch (error) {
    loraRootInfo = { root: "", source: "", label: "取得失敗", warning: error.message };
  }
  renderLoraRoot();
}

function renderLoraRoot() {
  const { root, source, label, warning } = loraRootInfo;
  elements.loraRootPath.textContent = root || "特定できていません";
  elements.loraRootPath.title = warning || root || "";
  elements.loraRootBadge.textContent = label || "未特定";
  elements.loraRootBadge.className = `loraRootBadge ${
    source === "config" ? "configured" : source ? "detected" : "missing"
  }`;
  elements.openLoraRootButton.disabled = !root;
}

async function openLoraRootFolder() {
  await withBusy(elements.openLoraRootButton, "開いています…", async () => {
    try {
      const data = await postJson("/api/lora/open-root", {});
      toast.success(`LoRAフォルダを開きました: ${data.root}`);
    } catch (error) {
      toast.error(error.message);
    }
  });
}

async function loadCivitaiFolders() {
  try {
    const data = await getJson("/api/civitai/install-folders");
    civitaiFolders = Array.isArray(data.folders) ? data.folders : [];
    if (data.defaults && typeof data.defaults === "object") civitaiFolderDefaults = data.defaults;
    civitaiRecommendedFolders = data.recommended && typeof data.recommended === "object" ? data.recommended : {};
  } catch {
    civitaiFolders = [];
    civitaiRecommendedFolders = {};
  }
  applyCategoryFolder(elements.civitaiCategory.value);
}

// 保存先selectを「前回使用 / お気に入り / 推奨 / 既存フォルダ / 新規作成」の順で構成する。
// 実在しない推奨フォルダは既存フォルダ一覧へ混ぜず、「（新規作成）」と明示する。
function populateCivitaiFolderSelect(category, preferred) {
  const select = elements.civitaiFolder;
  select.replaceChildren();
  const groups = buildFolderGroups({
    folders: civitaiFolders,
    recommended: civitaiRecommendedFolders,
    recent: civitaiRecentFolders[category] ?? [],
    favorites: civitaiFavoriteFolders,
    category
  });
  for (const group of groups) {
    const optgroup = document.createElement("optgroup");
    optgroup.label = group.label;
    for (const option of group.options) optgroup.append(new Option(option.label, option.value));
    select.append(optgroup);
  }
  const values = [...select.options].map((option) => option.value);
  const fallback = pickInitialFolder({
    folders: civitaiFolders,
    recommended: civitaiRecommendedFolders,
    recent: civitaiRecentFolders[category] ?? [],
    favorites: civitaiFavoriteFolders,
    category
  });
  select.value = preferred && values.includes(preferred)
    ? preferred
    : (values.includes(fallback) ? fallback : CIVITAI_NEW_FOLDER);
}

function saveCivitaiFolderMemory() {
  localStorage.setItem("localImageChat.civitaiRecentFolders", JSON.stringify(civitaiRecentFolders));
  localStorage.setItem("localImageChat.civitaiFavoriteFolders", JSON.stringify(civitaiFavoriteFolders));
}

function rememberCivitaiFolder(category, folder) {
  const normalized = normalizeFolder(folder);
  if (!normalized || normalized === CIVITAI_NEW_FOLDER) return;
  civitaiRecentFolders = rememberRecentFolder(civitaiRecentFolders, category, normalized);
  saveCivitaiFolderMemory();
}

function applyCategoryFolder(category) {
  const recent = civitaiRecentFolders[category] ?? [];
  populateCivitaiFolderSelect(category, recent[0]);
  refreshCivitaiFolderHint();
}

function onCivitaiFolderChange() {
  const value = elements.civitaiFolder.value;
  if (value === CIVITAI_NEW_FOLDER) {
    if (!elements.civitaiNewFolder.value.trim()) {
      const recommended = civitaiRecommendedFolders[elements.civitaiCategory.value]?.folder ?? "";
      elements.civitaiNewFolder.value = recommended;
    }
  } else {
    rememberCivitaiFolder(elements.civitaiCategory.value, value);
  }
  refreshCivitaiFolderHint();
}

function toggleCivitaiFolderFavorite() {
  const folder = selectedCivitaiFolder();
  if (!folder) return toast.warning("お気に入りにする保存先を選んでください");
  const wasFavorite = isFavoriteFolder(civitaiFavoriteFolders, folder);
  civitaiFavoriteFolders = toggleFavoriteFolder(civitaiFavoriteFolders, folder);
  saveCivitaiFolderMemory();
  populateCivitaiFolderSelect(elements.civitaiCategory.value, folder);
  refreshCivitaiFolderHint();
  toast.info(wasFavorite ? `${folder} をお気に入りから外しました` : `${folder} をお気に入りに登録しました`);
}

function selectedCivitaiFolder() {
  return elements.civitaiFolder.value === CIVITAI_NEW_FOLDER
    ? normalizeFolder(elements.civitaiNewFolder.value)
    : elements.civitaiFolder.value;
}

function refreshCivitaiFolderHint() {
  const isNew = elements.civitaiFolder.value === CIVITAI_NEW_FOLDER;
  elements.civitaiNewFolderRow.classList.toggle("hidden", !isNew);
  const folder = selectedCivitaiFolder();
  const favorite = isFavoriteFolder(civitaiFavoriteFolders, folder);
  elements.civitaiFolderFavorite.textContent = favorite ? "★" : "☆";
  elements.civitaiFolderFavorite.title = favorite ? "お気に入りから外す" : "この保存先をお気に入りに登録";
  elements.civitaiFolderFavorite.setAttribute("aria-pressed", String(favorite));
  const exists = civitaiFolders.some((item) => item.toLowerCase() === folder.toLowerCase());
  elements.civitaiFolderPath.textContent = folder
    ? `保存先: ${loraRootInfo.root ? `${loraRootInfo.root} / ` : ""}${folder}${exists ? "" : "（新規作成されます）"}`
    : "保存先を選択してください";
  if (inspectedCivitai) renderCivitaiPreview(inspectedCivitai);
}

async function installCivitai() {
  if (!inspectedCivitai) return inspectCivitai();
  const folder = selectedCivitaiFolder();
  if (!folder) {
    elements.civitaiStatus.textContent = "保存先を選択してください";
    toast.warning("保存先を選択してください");
    return;
  }
  const category = elements.civitaiCategory.value;
  clearError();
  rememberSessionSecrets();
  elements.inspectCivitaiButton.disabled = true;
  elements.installCivitaiButton.disabled = true;
  try {
    elements.civitaiStatus.textContent = "既に導入済みかを確認中…";
    const duplicate = await postJson("/api/civitai/check-duplicate", {
      url: elements.civitaiUrl.value.trim(),
      token: elements.civitaiToken.value,
      category,
      folder
    });

    let choice = { mode: "auto", filename: "", confirmMove: false };
    if (duplicate.duplicate) {
      choice = await openDuplicateDialog(duplicate, folder);
      if (!choice) {
        elements.civitaiStatus.textContent = "インストールを中止しました。";
        return;
      }
    }

    elements.civitaiStatus.textContent = choice.mode === "auto" || choice.mode === "rename"
      ? "LoRAをダウンロード中です。大きいファイルは数分かかります…"
      : "既存ファイルの情報を更新中…";
    const result = await postJson("/api/civitai/install", {
      url: elements.civitaiUrl.value.trim(),
      token: elements.civitaiToken.value,
      category,
      folder,
      mode: choice.mode,
      filename: choice.filename,
      confirmMove: choice.confirmMove
    });
    rememberCivitaiFolder(category, result.folder ?? folder);
    const message = describeInstallResult(result, folder);
    elements.civitaiStatus.textContent = message;
    toast.success(message);
    await loadCivitaiFolders();
    await loadLoras();
  } catch (error) {
    elements.civitaiStatus.textContent = error.message;
    toast.error(error.message);
  } finally {
    elements.inspectCivitaiButton.disabled = false;
    elements.installCivitaiButton.disabled = false;
  }
}

function describeInstallResult(result, folder) {
  const name = result.entry?.modelName ?? inspectedCivitai?.modelName ?? "LoRA";
  if (result.mode === "move") {
    return `${name}を「${result.folder}」へ移動しました（${result.movedFiles.length}ファイル）。`;
  }
  if (result.mode === "metadata") return `${name}のメタデータだけを更新しました。`;
  if (result.reusedExisting) {
    const suffix = result.existingInOtherFolder
      ? `（既存ファイルは ${result.existingInOtherFolder} にあります。移動はしていません）`
      : "";
    return `${name}の既存ファイルを再利用し、分類・全衣装プリセットを更新しました。${suffix}`;
  }
  return `${name}を保存先「${result.folder ?? folder}」へ配置し、全衣装プリセットを登録しました。`;
}

// 既に導入済みの場合に、何が起きるかを見せてから操作を選ばせる。
function openDuplicateDialog(duplicate, folder) {
  const options = [];
  let renameField = null;
  const existingLocation = duplicate.registeredVersion?.relativeName
    ?? duplicate.installed[0]?.relativeName
    ?? (duplicate.targetExists ? `${duplicate.targetFolder}/${duplicate.filename}` : "");

  return openModal({
    title: "既に導入済みです",
    subtitle: duplicate.metadata ? `${duplicate.metadata.modelName} / ${duplicate.metadata.versionName}` : "",
    dismissValue: null,
    build: (body) => {
      const list = document.createElement("dl");
      list.className = "detailFields";
      const add = (label, value) => {
        if (!value) return;
        const dt = document.createElement("dt");
        dt.textContent = label;
        const dd = document.createElement("dd");
        dd.textContent = value;
        list.append(dt, dd);
      };
      add("保存場所", existingLocation ? `${existingLocation}.safetensors` : "不明");
      add("登録バージョン", duplicate.registeredVersion?.versionName);
      add("Civitaiバージョン", duplicate.metadata?.versionName);
      if (duplicate.registeredModelVersions?.length) {
        add("同じモデルの別バージョン", duplicate.registeredModelVersions
          .map((item) => item.versionName || item.relativeName).join(" / "));
      }
      if (duplicate.installedElsewhere?.length) {
        add("別フォルダの同名ファイル", duplicate.installedElsewhere.map((item) => item.folder || "（ルート直下）").join(" / "));
      }
      add("今回の保存先", `${folder}/${duplicate.filename}`);
      body.append(list);

      const choices = document.createElement("div");
      choices.className = "duplicateChoices";
      const definitions = [
        { mode: "reuse", label: "既存を使う", hint: "ダウンロードせず、登録情報だけ現在の保存場所へ紐付けます。" },
        { mode: "metadata", label: "メタデータだけ更新", hint: "ファイルは触らず、Trigger Wordsや推奨Weightなどを更新します。" },
        { mode: "rename", label: "別名で保存", hint: `新しいファイル名でダウンロードします。` },
        ...(duplicate.movableSource
          ? [{ mode: "move", label: "指定フォルダへ移動", hint: `既存ファイルを ${folder} へ移動します（確認あり）。` }]
          : [])
      ];
      for (const [index, definition] of definitions.entries()) {
        const row = document.createElement("label");
        row.className = "duplicateChoice";
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "duplicateMode";
        radio.value = definition.mode;
        radio.checked = index === 0;
        if (index === 0) radio.setAttribute("data-autofocus", "true");
        const text = document.createElement("span");
        const strong = document.createElement("strong");
        strong.textContent = definition.label;
        const hint = document.createElement("small");
        hint.textContent = definition.hint;
        text.append(strong, hint);
        row.append(radio, text);
        choices.append(row);
        options.push(radio);
      }
      body.append(choices);

      const renameRow = document.createElement("label");
      renameRow.className = "duplicateRename hidden";
      const renameLabel = document.createElement("span");
      renameLabel.textContent = "別名で保存するファイル名";
      const renameInput = document.createElement("input");
      renameInput.type = "text";
      renameInput.value = duplicate.suggestedFilename ?? "";
      renameRow.append(renameLabel, renameInput);
      body.append(renameRow);

      const sync = () => {
        const selected = options.find((radio) => radio.checked)?.value;
        renameRow.classList.toggle("hidden", selected !== "rename");
      };
      for (const radio of options) radio.addEventListener("change", sync);
      sync();
      renameField = renameInput;
    },
    actions: [
      { label: "キャンセル", value: null, variant: "secondary" },
      {
        label: "実行する",
        primary: true,
        onSelect: async (close) => {
          const mode = options.find((radio) => radio.checked)?.value ?? "reuse";
          const filename = mode === "rename" ? (renameField?.value ?? "").trim() : "";
          if (mode === "rename" && !/\.safetensors$/i.test(filename)) {
            toast.warning("別名は .safetensors で終わるファイル名にしてください");
            return false;
          }
          if (mode === "move") {
            const confirmed = await confirmModal(
              `既存ファイルを ${folder} へ移動します。関連する preview 画像やjsonも一緒に移動します。よろしいですか？`,
              { title: "移動の確認", confirmText: "移動する", danger: true }
            );
            if (!confirmed) return false;
            close({ mode, filename: "", confirmMove: true });
            return;
          }
          close({ mode, filename, confirmMove: false });
        },
        keepOpen: true
      }
    ]
  }).promise;
}

async function refreshCivitaiRegistrations() {
  clearError();
  rememberSessionSecrets();
  elements.inspectCivitaiButton.disabled = true;
  elements.installCivitaiButton.disabled = true;
  elements.refreshCivitaiRegistrationsButton.disabled = true;
  elements.civitaiStatus.textContent = "登録済みCivitai LoRAの衣装・Trigger Wordsを再解析中…";
  try {
    const result = await postJson("/api/civitai/refresh-registrations", {
      token: elements.civitaiToken.value
    });
    if (!result.total) {
      elements.civitaiStatus.textContent = "Civitai URLから登録したLoRAはまだありません。";
      return;
    }

    const failureNames = (result.failures ?? [])
      .slice(0, 3)
      .map((item) => item.modelName)
      .join("、");
    elements.civitaiStatus.textContent = result.failed
      ? `${result.updated}/${result.total}件を更新しました。失敗${result.failed}件: ${failureNames}`
      : `${result.updated}件すべての衣装・Trigger Wordsを更新しました。`;
    await loadLoras();
  } catch (error) {
    elements.civitaiStatus.textContent = `一括再解析に失敗しました: ${error.message}`;
  } finally {
    elements.inspectCivitaiButton.disabled = false;
    elements.installCivitaiButton.disabled = !inspectedCivitai;
    elements.refreshCivitaiRegistrationsButton.disabled = false;
  }
}

async function checkForUpdate() {
  rememberSessionSecrets();
  elements.checkUpdateButton.disabled = true;
  elements.applyUpdateButton.disabled = true;
  elements.updateStatus.textContent = "GitHubの最新版を確認中…";
  try {
    updateInfo = await postJson("/api/update/check", {
      token: elements.githubToken.value
    });
    if (updateInfo.updateAvailable) {
      elements.updateStatus.textContent = `v${updateInfo.currentVersion} → v${updateInfo.latestVersion}へ更新できます。`;
      elements.applyUpdateButton.disabled = false;
    } else {
      elements.updateStatus.textContent = `v${updateInfo.currentVersion}が最新版です。`;
    }
  } catch (error) {
    updateInfo = null;
    elements.updateStatus.textContent = error.message;
  } finally {
    elements.checkUpdateButton.disabled = false;
  }
}

async function applyUpdate() {
  if (!updateInfo?.updateAvailable) return;
  rememberSessionSecrets();
  elements.checkUpdateButton.disabled = true;
  elements.applyUpdateButton.disabled = true;
  elements.updateStatus.textContent = "バックアップを作成して更新中…";
  try {
    const data = await postJson("/api/update/apply", {
      token: elements.githubToken.value
    });
    elements.updateStatus.textContent = data.applied
      ? `v${data.latestVersion}へ更新しました。start.batを閉じて再起動してください。`
      : "すでに最新版です。";
  } catch (error) {
    elements.updateStatus.textContent = error.message;
    elements.applyUpdateButton.disabled = false;
  } finally {
    elements.checkUpdateButton.disabled = false;
  }
}

function restoreSessionSecrets() {
  elements.civitaiToken.value = sessionStorage.getItem("localImageChat.civitaiToken") ?? "";
  elements.githubToken.value = sessionStorage.getItem("localImageChat.githubToken") ?? "";
}

function rememberSessionSecrets() {
  sessionStorage.setItem("localImageChat.civitaiToken", elements.civitaiToken.value);
  sessionStorage.setItem("localImageChat.githubToken", elements.githubToken.value);
}

function formatFileSize(sizeKB) {
  const size = Number(sizeKB);
  if (!Number.isFinite(size)) return "サイズ不明";
  return size >= 1024 * 1024
    ? `${(size / 1024 / 1024).toFixed(1)} GB`
    : `${(size / 1024).toFixed(0)} MB`;
}

function formatDate(value) {
  try {
    return new Intl.DateTimeFormat("ja-JP", {
      month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit"
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function readSettings(overrides = {}) {
  return {
    width: elements.width.value,
    height: elements.height.value,
    steps: elements.steps.value,
    cfgScale: elements.cfgScale.value,
    seed: elements.seed.value,
    samplerName: elements.samplerName.value,
    scheduler: elements.scheduler.value,
    noiseSchedule: elements.noiseSchedule.value,
    checkpoint: activeCheckpoint?.title ?? "",
    checkpointHash: activeCheckpoint?.hash ?? "",
    checkpointModelName: activeCheckpoint?.modelName ?? "",
    checkpointFilename: activeCheckpoint?.filename ?? "",
    candidateCount: elements.candidateCount.value,
    img2imgDenoising: elements.img2imgDenoising.value,
    img2imgResizeMode: elements.img2imgResizeMode.value,
    inpaintDenoising: elements.inpaintDenoising.value,
    maskBlur: elements.maskBlur.value,
    inpaintFill: elements.inpaintFill.value,
    inpaintFullRes: elements.inpaintFullRes.checked,
    inpaintFullResPadding: elements.inpaintFullResPadding.value,
    hiresScale: elements.hiresScale.value,
    hiresSteps: elements.hiresSteps.value,
    hiresDenoising: elements.hiresDenoising.value,
    hiresUpscaler: elements.hiresUpscaler.value,
    hiresEnabled: false,
    ...overrides
  };
}

function readInitImagePayload() {
  if (generationMode === "txt2img" || !initImageReference) return {};
  return initImageReference.imageId
    ? { initImageId: initImageReference.imageId }
    : { initImage: initImageReference.dataUrl };
}

function readInpaintPayload() {
  if (generationMode !== "inpaint" || !elements.inpaintMaskCanvas.width) return {};
  return { maskImage: elements.inpaintMaskCanvas.toDataURL("image/png") };
}

// 派生生成の由来を1回分だけ送る（送信後にクリアする）。
function readDerivationPayload() {
  if (!pendingDerivation) return {};
  const payload = {
    derivation: { type: pendingDerivation.type, instruction: pendingDerivation.instruction },
    parentGenerationId: pendingDerivation.parentGenerationId
  };
  pendingDerivation = null;
  return payload;
}

function readSelectedLoras() {
  // 生成直前にプロンプト内のタグと突き合わせて、実効Weightのまま送る。
  syncLorasFromPrompt();
  return [...selectedLoras]
    .filter(([name]) => !disabledLoras.has(name))
    .map(([name, weight]) => ({
    name,
    weight,
    source: loraSelectionSources.get(name) ?? "ui",
    // トリガーワードは画面側でプロンプトへ組み込むため、サーバーの自動追記へは渡さない。
    // 枠が無いLoRA（トリガーワード未設定）だけ従来どおりの値を送る。
    triggerWords: hasManagedTriggerWords(name) ? "" : loraTriggers.get(name) ?? "",
    negativeWords: loraNegativeWords.get(name) ?? ""
  }));
}

function hasManagedTriggerWords(loraName) {
  return appliedTriggerWords.some((trigger) => trigger.sourceLoraIds.includes(loraName));
}

function loadLoraCategory() {
  const stored = localStorage.getItem("localImageChat.loraCategory");
  return ["character", "direction", "selected", "all"].includes(stored) ? stored : "character";
}

function loadLoraTriggers() {
  try {
    const stored = JSON.parse(localStorage.getItem("localImageChat.loraTriggers") ?? "{}");
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return new Map();
    return new Map(
      Object.entries(stored)
        .filter(([name, value]) => name && typeof value === "string" && value.trim())
        .map(([name, value]) => [name, value.slice(0, 500)])
    );
  } catch {
    return new Map();
  }
}

function loadLoraWeights() {
  try {
    const stored = JSON.parse(localStorage.getItem("localImageChat.loraWeights") ?? "{}");
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return new Map();
    return new Map(
      Object.entries(stored)
        .map(([name, value]) => [name, Number(value)])
        .filter(([name, value]) => name && Number.isFinite(value) && value >= 0.05 && value <= 2)
    );
  } catch {
    return new Map();
  }
}

// localStorageのJSONを安全に読む。壊れていればfallbackを返す。
function readJsonStorage(storageKey, fallback = {}) {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function loadStringMap(storageKey) {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return new Map();
    return new Map(
      Object.entries(stored)
        .filter(([name, value]) => name && typeof value === "string" && value)
    );
  } catch {
    return new Map();
  }
}

function saveLoraWeights() {
  localStorage.setItem("localImageChat.loraWeights", JSON.stringify(Object.fromEntries(loraWeights)));
}

function saveLoraTriggers() {
  localStorage.setItem("localImageChat.loraTriggers", JSON.stringify(Object.fromEntries(loraTriggers)));
}

function saveLoraNegativeWords() {
  localStorage.setItem("localImageChat.loraNegativeWords", JSON.stringify(Object.fromEntries(loraNegativeWords)));
}

function saveProfileSettings() {
  localStorage.setItem("localImageChat.loraProfileAssignments", JSON.stringify(Object.fromEntries(loraProfileAssignments)));
  localStorage.setItem("localImageChat.loraPresetSelections", JSON.stringify(Object.fromEntries(loraPresetSelections)));
  localStorage.setItem("localImageChat.loraAddonSelections", JSON.stringify(Object.fromEntries(loraAddonSelections)));
}

async function getJson(url) {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

async function patchJson(url, body) {
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

async function deleteJson(url) {
  const response = await fetch(url, { method: "DELETE" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

function setBusy(busy, message = "") {
  elements.promptButton.disabled = busy;
  elements.generateButton.disabled = busy;
  elements.healthButton.disabled = busy;
  elements.refreshLorasButton.disabled = busy;
  elements.refreshCivitaiRegistrationsButton.disabled = busy;
  elements.txt2imgModeButton.disabled = busy;
  elements.img2imgModeButton.disabled = busy;
  elements.inpaintModeButton.disabled = busy;
  elements.chooseInitImageButton.disabled = busy;
  elements.initImageInput.disabled = busy;
  elements.clearInitImageButton.disabled = busy || !initImageReference;
  elements.img2imgPreset.disabled = busy;
  elements.img2imgDenoising.disabled = busy;
  elements.img2imgResizeMode.disabled = busy;
  elements.syncInitImageSize.disabled = busy;
  elements.maskPaintButton.disabled = busy;
  elements.maskEraseButton.disabled = busy;
  elements.maskBrushSize.disabled = busy;
  elements.inpaintDenoising.disabled = busy;
  elements.maskBlur.disabled = busy;
  elements.inpaintFill.disabled = busy;
  elements.inpaintFullRes.disabled = busy;
  elements.inpaintFullResPadding.disabled = busy;
  if (busy) {
    elements.maskUndoButton.disabled = true;
    elements.maskRedoButton.disabled = true;
    elements.maskClearButton.disabled = true;
  } else {
    updateMaskHistoryButtons();
  }
  elements.finishButton.disabled = busy || !selectedCandidate;
  elements.lockCompositionButton.disabled = busy || !selectedCandidate;
  elements.loading.classList.toggle("hidden", !busy);
  if (message) elements.loadingText.textContent = message;
}

function updateGenerateButton() {
  const count = elements.candidateCount.value;
  const label = generationMode === "inpaint"
    ? "部分修正"
    : generationMode === "img2img"
      ? "img2img"
      : "画像";
  const valid = isValidCandidateCount(count);
  elements.generateButton.textContent = valid ? `${label}を生成（${count}枚）` : `${label}を生成`;
  elements.candidateCount.classList.toggle("invalid", !valid);
  elements.candidateCountDown.disabled = clampCandidateCount(count) <= MIN_CANDIDATE_COUNT;
  elements.candidateCountUp.disabled = clampCandidateCount(count) >= MAX_CANDIDATE_COUNT;
  renderGenerateActions();
}

// 生成枚数はバックエンドの制限（1〜4）に合わせ、不正値のままでは生成させない。
function handleCandidateCountChange() {
  const value = elements.candidateCount.value;
  if (isValidCandidateCount(value)) {
    localStorage.setItem("localImageChat.candidateCount", String(Number(value)));
  }
  updateGenerateButton();
}

function stepCandidateCount(step) {
  const next = clampCandidateCount(Number(elements.candidateCount.value) + step);
  elements.candidateCount.value = String(next);
  handleCandidateCountChange();
}

// 入力欄から離れた時点で範囲内へ丸める（入力中は打ち直しを邪魔しない）。
function normalizeCandidateCount() {
  elements.candidateCount.value = String(clampCandidateCount(elements.candidateCount.value));
  handleCandidateCountChange();
}

function showError(message) {
  elements.error.textContent = message;
  elements.error.classList.remove("hidden");
}

function clearError() {
  elements.error.classList.add("hidden");
  elements.error.textContent = "";
}

function status(label, ok, detail = "") {
  const title = detail ? ` title="${escapeHtml(detail)}"` : "";
  return `<span class="status ${ok ? "ok" : "bad"}"${title}>${escapeHtml(label)}</span>`;
}

function shorten(value, max) {
  if (!value) return "不明";
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

// ホーム画面へ追加できるようにするためだけのService Worker。
// キャッシュは持たないので、更新後に古い画面が残ることはない。
function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  // file:// や http:// のLAN内アクセスでも動くよう、失敗しても無視する。
  navigator.serviceWorker.register("/sw.js").catch((error) => {
    console.warn(`[PWA] Service Workerを登録できません: ${error.message}`);
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}
