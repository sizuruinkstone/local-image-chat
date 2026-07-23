import { LORA_PROFILES, findProfileForLora, getPreset, getProfile } from "./lora-profiles.js";

const PROFILE_STORAGE_VERSION = 2;

const elements = Object.fromEntries(
  [
    "health", "healthButton", "description", "promptButton", "generateButton",
    "prompt", "negativePrompt", "width", "height", "steps", "cfgScale", "seed",
    "samplerName", "scheduler", "candidateCount", "hiresScale", "hiresSteps",
    "hiresDenoising", "hiresUpscaler", "emptyState", "loading", "loadingText",
    "resultContent", "candidateSection", "candidateGrid", "candidateSummary",
    "selectedSeedText", "finishButton", "finalResult", "resultImage", "seedText",
    "resolutionText", "downloadLink", "explanation", "error", "loraSearch",
    "loraList", "loraStatus", "loraSelectedCount", "selectedLoraSummary",
    "refreshLorasButton", "loraCategories", "versionText", "jobBar", "jobMessage",
    "jobProgressText", "jobProgress", "cancelJobButton", "stylePreset",
    "compositionPreset", "lightingPreset", "moodPreset", "outfitOverride", "applyPreferenceButton",
    "clearPromptPartsButton", "promptPartsSummary", "compositionLockStatus",
    "unlockCompositionButton", "lockCompositionButton", "favoriteFinalButton",
    "reuseFinalButton", "civitaiDetails", "civitaiUrl", "civitaiCategory",
    "civitaiToken", "inspectCivitaiButton", "installCivitaiButton",
    "civitaiPreview", "civitaiStatus", "updateStatusButton", "updateDetails",
    "githubToken", "checkUpdateButton", "applyUpdateButton", "updateStatus",
    "favoritesOnly", "refreshHistoryButton", "preferenceSummary", "historyGrid"
  ].map((id) => [id, document.getElementById(id)])
);

let promptDescription = "";
let selectedCandidate = null;
let lastGeneration = null;
let settingPromptProgrammatically = false;
let installedLoras = [];
let loraConfig = { defaultWeight: 0.7, maxSelected: 4 };
let activeJobId = null;
let compositionLock = null;
let finalImage = null;
let finalGeneration = null;
let preferenceData = { favoriteCount: 0, topTags: [], topLoras: [], topSettings: [] };
let preferenceBoosts = [];
let inspectedCivitai = null;
let updateInfo = null;
let activeLoraCategory = loadLoraCategory();
const selectedLoras = new Map();
const loraWeights = loadLoraWeights();
const loraTriggers = loadLoraTriggers();
const loraNegativeWords = loadStringMap("localImageChat.loraNegativeWords");
const loraProfileAssignments = loadStringMap("localImageChat.loraProfileAssignments");
const loraPresetSelections = loadStringMap("localImageChat.loraPresetSelections");

await loadConfig();
loadPromptPartSelections();
restoreSessionSecrets();
await Promise.all([checkHealth(), loadLoras(), loadHistory()]);
updateGenerateButton();

elements.healthButton.addEventListener("click", checkHealth);
elements.promptButton.addEventListener("click", buildPrompt);
elements.generateButton.addEventListener("click", generateCandidates);
elements.finishButton.addEventListener("click", finishSelected);
elements.lockCompositionButton.addEventListener("click", lockSelectedComposition);
elements.reuseFinalButton.addEventListener("click", () => {
  if (finalGeneration && finalImage) activateCompositionLock(finalGeneration, finalImage);
});
elements.favoriteFinalButton.addEventListener("click", () => {
  if (finalImage) void toggleFavorite(finalImage, elements.favoriteFinalButton);
});
elements.unlockCompositionButton.addEventListener("click", unlockComposition);
elements.cancelJobButton.addEventListener("click", cancelActiveJob);
elements.candidateCount.addEventListener("change", handleCandidateCountChange);
elements.description.addEventListener("input", handleDescriptionChange);
elements.prompt.addEventListener("input", markPromptAsCurrent);
elements.negativePrompt.addEventListener("input", markPromptAsCurrent);
elements.loraSearch.addEventListener("input", renderLoras);
elements.refreshLorasButton.addEventListener("click", () => loadLoras(true));
elements.inspectCivitaiButton.addEventListener("click", inspectCivitai);
elements.installCivitaiButton.addEventListener("click", installCivitai);
elements.civitaiUrl.addEventListener("input", () => {
  inspectedCivitai = null;
  elements.installCivitaiButton.disabled = true;
});
elements.checkUpdateButton.addEventListener("click", checkForUpdate);
elements.applyUpdateButton.addEventListener("click", applyUpdate);
elements.updateStatusButton.addEventListener("click", () => {
  elements.updateDetails.open = true;
  elements.updateDetails.scrollIntoView({ behavior: "smooth", block: "center" });
  void checkForUpdate();
});
elements.refreshHistoryButton.addEventListener("click", loadHistory);
elements.favoritesOnly.addEventListener("change", loadHistory);
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
    if (elements[key]) elements[key].value = value;
  }
  const savedCount = localStorage.getItem("localImageChat.candidateCount");
  if (["1", "2", "3", "4"].includes(savedCount)) elements.candidateCount.value = savedCount;
}

async function loadLoras(refresh = false) {
  elements.loraStatus.textContent = refresh ? "ReForgeでLoRAを再読込中…" : "LoRAを取得中…";
  elements.refreshLorasButton.disabled = true;
  try {
    const data = refresh
      ? await postJson("/api/loras/refresh", {})
      : await getJson("/api/loras");
    installedLoras = data.loras ?? [];
    registerCivitaiDefaults();
    registerDetectedProfiles();
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
  } catch (error) {
    elements.loraStatus.textContent = `LoRA一覧を取得できません: ${error.message}`;
  } finally {
    elements.refreshLorasButton.disabled = false;
  }
}

function renderLoras() {
  const query = elements.loraSearch.value.trim().toLowerCase();
  const matches = installedLoras
    .filter((item) => {
      const category = getLoraCategory(item);
      const matchesCategory = activeLoraCategory === "all"
        || activeLoraCategory === category
        || (activeLoraCategory === "selected" && selectedLoras.has(item.name));
      const matchesSearch = `${item.displayName} ${item.name} ${item.alias} ${item.folder ?? ""}`
        .toLowerCase()
        .includes(query);
      return matchesCategory && matchesSearch;
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
}

function createLoraRow(lora) {
  const profile = resolveProfile(lora);
  const registry = lora.registry;
  const isCharacter = getLoraCategory(lora) === "character";
  const weight = loraWeights.get(lora.name) ?? registry?.recommendedWeight ?? loraConfig.defaultWeight;
  const row = document.createElement("div");
  row.className = "loraRow";

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
  if (profile) {
    const registered = document.createElement("small");
    registered.className = "loraRegistered";
    registered.textContent = `登録済み・${profile.name}`;
    names.append(registered);
  } else if (registry) {
    const registered = document.createElement("small");
    registered.className = "loraRegistered";
    registered.textContent = `Civitai登録済み・${registry.modelName}`;
    names.append(registered);
  }
  if (lora.displayName !== lora.name) {
    const canonical = document.createElement("small");
    canonical.textContent = lora.name;
    names.append(canonical);
  }
  choice.append(checkbox, names);

  const weightWrap = document.createElement("label");
  weightWrap.className = "loraWeight";
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0.05";
  slider.max = "1.5";
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
  advancedSummary.textContent = isCharacter ? "衣装・Trigger設定" : "Trigger・Negative設定";
  const advancedBody = document.createElement("div");
  advancedBody.className = "loraAdvancedBody";

  const profileControls = document.createElement("div");
  profileControls.className = "loraProfileControls";
  const profileSelect = document.createElement("select");
  profileSelect.className = "loraProfileSelect";
  profileSelect.setAttribute("aria-label", `${lora.displayName}のプロフィール`);
  profileSelect.append(new Option("プロフィール未設定", ""));
  for (const item of LORA_PROFILES) profileSelect.append(new Option(item.name, item.id));
  profileSelect.value = profile?.id ?? "";

  const presetSelect = document.createElement("select");
  presetSelect.className = "loraPresetSelect";
  presetSelect.setAttribute("aria-label", `${lora.displayName}の衣装プリセット`);
  fillPresetSelect(presetSelect, profile, loraPresetSelections.get(lora.name));

  const sourceLink = document.createElement("a");
  sourceLink.className = "loraSourceLink";
  sourceLink.textContent = "配布元";
  sourceLink.target = "_blank";
  sourceLink.rel = "noreferrer";
  sourceLink.href = profile?.sourceUrl ?? registry?.sourceUrl ?? "#";
  sourceLink.classList.toggle("hidden", !profile && !registry);
  if (profile) sourceLink.title = `${profile.baseModel}・${profile.note}`;
  else if (registry) sourceLink.title = `${registry.baseModel}・Civitaiから登録`;
  profileControls.append(profileSelect, presetSelect, sourceLink);

  if (isCharacter) {
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
    if (checkbox.checked) selectedLoras.set(lora.name, Number(slider.value));
    else selectedLoras.delete(lora.name);
    clearError();
    renderSelectedLoraSummary();
    if (activeLoraCategory === "selected" && !checkbox.checked) renderLoras();
    else updateLoraCategoryButtons();
  });

  slider.addEventListener("input", () => {
    const nextWeight = Number(slider.value);
    output.textContent = nextWeight.toFixed(2);
    loraWeights.set(lora.name, nextWeight);
    saveLoraWeights();
    if (selectedLoras.has(lora.name)) {
      selectedLoras.set(lora.name, nextWeight);
      renderSelectedLoraSummary();
    }
  });

  triggerInput.addEventListener("input", () => {
    const triggerWords = triggerInput.value.trim();
    if (triggerWords) loraTriggers.set(lora.name, triggerWords);
    else loraTriggers.delete(lora.name);
    saveLoraTriggers();
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
    const nextProfile = getProfile(profileSelect.value);
    if (!nextProfile) {
      loraProfileAssignments.delete(lora.name);
      loraPresetSelections.delete(lora.name);
      saveProfileSettings();
      renderLoras();
      return;
    }
    const preset = getPreset(nextProfile, nextProfile.defaultPreset);
    loraProfileAssignments.set(lora.name, nextProfile.id);
    loraPresetSelections.set(lora.name, preset.id);
    applyProfilePreset(lora.name, nextProfile, preset);
    renderLoras();
    renderSelectedLoraSummary();
  });

  presetSelect.addEventListener("change", () => {
    const currentProfile = getProfile(profileSelect.value);
    const preset = getPreset(currentProfile, presetSelect.value);
    if (!currentProfile || !preset) return;
    loraPresetSelections.set(lora.name, preset.id);
    applyProfilePreset(lora.name, currentProfile, preset);
    triggerInput.value = preset.triggerWords;
    negativeInput.value = preset.negativeWords ?? "";
    const presetWeight = getPresetWeight(currentProfile, preset);
    slider.value = String(presetWeight);
    output.textContent = Number(presetWeight).toFixed(2);
    renderSelectedLoraSummary();
  });

  row.append(choice, weightWrap, advanced);
  return row;
}

function getLoraCategory(lora) {
  if (resolveProfile(lora)) return "character";
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
      profile = findProfileForLora(lora);
      if (profile) {
        loraProfileAssignments.set(lora.name, profile.id);
        changed = true;
      }
    }
    if (!profile) continue;

    const preset = getPreset(profile, loraPresetSelections.get(lora.name));
    if (!loraPresetSelections.has(lora.name)) {
      loraPresetSelections.set(lora.name, preset.id);
      changed = true;
    }
    if (!loraWeights.has(lora.name)) {
      loraWeights.set(lora.name, getPresetWeight(profile, preset));
      changed = true;
    }
    if (!loraTriggers.has(lora.name)) {
      loraTriggers.set(lora.name, preset.triggerWords);
      changed = true;
    }
    if (!loraNegativeWords.has(lora.name) && preset.negativeWords) {
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
    if (!loraWeights.has(lora.name) && Number.isFinite(Number(registry.recommendedWeight))) {
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
  return getProfile(loraProfileAssignments.get(lora.name)) ?? findProfileForLora(lora);
}

function fillPresetSelect(select, profile, selectedPresetId) {
  select.replaceChildren();
  if (!profile) {
    select.append(new Option("衣装プリセットなし", ""));
    select.disabled = true;
    return;
  }
  select.disabled = false;
  for (const preset of profile.presets) select.append(new Option(preset.name, preset.id));
  select.value = getPreset(profile, selectedPresetId)?.id ?? profile.defaultPreset;
}

function applyProfilePreset(loraName, profile, preset) {
  const weight = getPresetWeight(profile, preset);
  loraWeights.set(loraName, weight);
  loraTriggers.set(loraName, preset.triggerWords);
  if (preset.negativeWords) loraNegativeWords.set(loraName, preset.negativeWords);
  else loraNegativeWords.delete(loraName);
  if (selectedLoras.has(loraName)) selectedLoras.set(loraName, weight);
  saveLoraWeights();
  saveLoraTriggers();
  saveLoraNegativeWords();
  saveProfileSettings();
}

function getPresetWeight(profile, preset) {
  return Number(preset?.recommendedWeight ?? profile?.recommendedWeight ?? loraConfig.defaultWeight);
}

function renderSelectedLoraSummary() {
  const items = [...selectedLoras].map(([name, weight]) => {
    const triggerWords = loraTriggers.get(name);
    const suppressesOutfit = Boolean(loraNegativeWords.get(name));
    return `${name} ${Number(weight).toFixed(2)}${triggerWords ? `・${triggerWords}` : ""}${suppressesOutfit ? "・標準衣装を抑制" : ""}`;
  });
  elements.loraSelectedCount.textContent = `${items.length}個選択`;
  elements.selectedLoraSummary.textContent = items.length ? `使用: ${items.join(" / ")}` : "LoRAなし";
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
    document.querySelector("details").open = true;
  } catch (error) {
    showError(error.message);
  } finally {
    setBusy(false);
  }
}

async function generateCandidates() {
  clearError();
  const description = elements.description.value.trim();
  if (!description) return showError("生成したい画像を日本語で入力してくれ");

  elements.emptyState.classList.add("hidden");
  elements.finalResult.classList.add("hidden");
  selectedCandidate = null;
  const count = Number(elements.candidateCount.value);
  setBusy(true, `${count}枚の候補を1枚ずつ生成します…`);

  try {
    if (!elements.prompt.value.trim() || promptDescription !== description) {
      elements.loadingText.textContent = "日本語からプロンプトを作成中…";
      await requestPrompt(description);
    }

    elements.loadingText.textContent = `${count}枚の候補を1枚ずつ生成中…`;
    const data = await submitGeneration({
      description,
      prompt: elements.prompt.value,
      negativePrompt: elements.negativePrompt.value,
      loras: readSelectedLoras(),
      promptBoosts: readPromptBoosts(),
      settings: readSettings({ candidateCount: count, hiresEnabled: false })
    });

    lastGeneration = {
      description,
      prompt: data.prompt,
      negativePrompt: data.negativePrompt,
      settings: data.settings,
      loras: data.loras,
      images: data.images
    };
    setPromptFields(data.prompt, data.negativePrompt, description);
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
  setBusy(true, `Seed ${selectedCandidate.seed} をHires.fix中…`);

  try {
    const data = await submitGeneration({
      description: lastGeneration.description,
      prompt: lastGeneration.prompt,
      negativePrompt: lastGeneration.negativePrompt,
      loras: lastGeneration.loras,
      promptBoosts: [],
      parentImageId: selectedCandidate.id,
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

    const finished = data.images[0];
    finalImage = finished;
    finalGeneration = {
      description: lastGeneration.description,
      prompt: data.prompt,
      negativePrompt: data.negativePrompt,
      settings: data.settings,
      loras: data.loras,
      images: data.images
    };
    elements.resultImage.src = `${finished.imageUrl}?t=${Date.now()}`;
    elements.seedText.textContent = `Seed ${finished.seed}`;
    elements.resolutionText.textContent = `${Math.round(Number(data.settings.width) * Number(data.settings.hiresScale))} × ${Math.round(Number(data.settings.height) * Number(data.settings.hiresScale))}`;
    elements.downloadLink.href = finished.imageUrl;
    elements.downloadLink.download = finished.filename;
    elements.favoriteFinalButton.classList.toggle("active", finished.favorite);
    elements.finalResult.classList.remove("hidden");
    elements.finalResult.scrollIntoView({ behavior: "smooth", block: "start" });
    await loadHistory();
  } catch (error) {
    showError(error.message);
  } finally {
    setBusy(false);
  }
}

async function requestPrompt(description) {
  const data = await postJson("/api/prompt", {
    description,
    promptBoosts: readPromptBoosts()
  });
  setPromptFields(data.prompt, data.negative_prompt, description);
  return data;
}

function setPromptFields(prompt, negativePrompt, description) {
  settingPromptProgrammatically = true;
  elements.prompt.value = prompt;
  elements.negativePrompt.value = negativePrompt;
  settingPromptProgrammatically = false;
  promptDescription = description;
}

function handleDescriptionChange() {
  const current = elements.description.value.trim();
  if (promptDescription && current !== promptDescription) {
    if (compositionLock) unlockComposition();
    settingPromptProgrammatically = true;
    elements.prompt.value = "";
    elements.negativePrompt.value = "";
    settingPromptProgrammatically = false;
    promptDescription = "";
  }
}

function markPromptAsCurrent() {
  if (!settingPromptProgrammatically) {
    promptDescription = elements.description.value.trim();
  }
}

function renderCandidates(images) {
  elements.candidateGrid.replaceChildren();
  elements.candidateSummary.textContent = `${images.length}枚生成`;

  images.forEach((candidate, index) => {
    const card = document.createElement("article");
    card.className = "candidateCard";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `候補${index + 1}、Seed ${candidate.seed}`);

    const image = document.createElement("img");
    image.src = `${candidate.imageUrl}?t=${Date.now()}`;
    image.alt = `生成候補 ${index + 1}`;

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
    const favorite = document.createElement("button");
    favorite.type = "button";
    favorite.textContent = "👍";
    favorite.title = "好みとして記録";
    favorite.classList.toggle("active", candidate.favorite);
    favorite.addEventListener("click", (event) => {
      event.stopPropagation();
      void toggleFavorite(candidate, favorite);
    });
    actions.append(favorite, download);
    footer.append(label, actions);
    card.append(image, footer);

    const choose = () => selectCandidate(candidate, card);
    card.addEventListener("click", choose);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        choose();
      }
    });
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
}

async function submitGeneration(payload) {
  const { job } = await postJson("/api/jobs", payload);
  activeJobId = job.id;
  setJobProgress(job);
  elements.jobBar.classList.remove("hidden");
  elements.cancelJobButton.disabled = false;

  try {
    while (true) {
      await sleep(850);
      const current = (await getJson(`/api/jobs/${job.id}`)).job;
      setJobProgress(current);
      if (current.status === "done") return current.result;
      if (current.status === "failed") throw new Error(current.error ?? current.message);
      if (current.status === "cancelled") throw new Error("生成を中止しました");
    }
  } finally {
    activeJobId = null;
    elements.cancelJobButton.disabled = true;
    setTimeout(() => {
      if (!activeJobId) elements.jobBar.classList.add("hidden");
    }, 1800);
  }
}

function setJobProgress(job) {
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
  elements.seed.value = "-1";
}

function loadRecipeFields(recipe, image) {
  elements.description.value = recipe.description ?? "";
  setPromptFields(recipe.prompt ?? "", recipe.negativePrompt ?? "", recipe.description ?? "");
  const settings = recipe.settings ?? {};
  for (const key of [
    "width", "height", "steps", "cfgScale", "samplerName", "scheduler",
    "hiresScale", "hiresSteps", "hiresDenoising", "hiresUpscaler"
  ]) {
    if (settings[key] !== undefined && elements[key]) elements[key].value = settings[key];
  }
  elements.seed.value = image.seed;
  elements.candidateCount.value = "1";
  handleCandidateCountChange();

  selectedLoras.clear();
  for (const lora of recipe.loras ?? []) {
    if (!installedLoras.some((item) => item.name === lora.name)) continue;
    selectedLoras.set(lora.name, Number(lora.weight));
    loraWeights.set(lora.name, Number(lora.weight));
    if (lora.triggerWords) loraTriggers.set(lora.name, lora.triggerWords);
    if (lora.negativeWords) loraNegativeWords.set(lora.name, lora.negativeWords);
  }
  saveLoraWeights();
  saveLoraTriggers();
  saveLoraNegativeWords();
  renderLoras();
  renderSelectedLoraSummary();
}

async function toggleFavorite(image, button) {
  const next = !image.favorite;
  button.disabled = true;
  try {
    const data = await patchJson(`/api/history/${image.id}/favorite`, { favorite: next });
    image.favorite = data.image.favorite;
    button.classList.toggle("active", image.favorite);
    preferenceData = data.preferences;
    renderPreferenceSummary();
    await loadHistory();
  } catch (error) {
    showError(error.message);
  } finally {
    button.disabled = false;
  }
}

async function loadHistory() {
  try {
    const favoritesQuery = elements.favoritesOnly.checked ? "&favorites=1" : "";
    const [historyData, preferences] = await Promise.all([
      getJson(`/api/history?limit=80${favoritesQuery}`),
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
  elements.historyGrid.replaceChildren();
  const entries = generations.flatMap((generation) =>
    generation.images.map((image) => ({ generation, image }))
  );
  for (const { generation, image } of entries) {
    const card = document.createElement("article");
    card.className = "historyCard";
    const preview = document.createElement("img");
    preview.src = image.imageUrl;
    preview.alt = generation.description || `Seed ${image.seed}`;
    preview.loading = "lazy";
    const body = document.createElement("div");
    body.className = "historyCardBody";
    const title = document.createElement("strong");
    title.textContent = generation.description || "生成画像";
    title.title = generation.description;
    const metadata = document.createElement("span");
    metadata.textContent = `${generation.kind === "hires" ? "Hires" : "候補"}・Seed ${image.seed}・${formatDate(generation.createdAt)}`;
    const actions = document.createElement("div");
    actions.className = "historyCardActions";
    const favorite = document.createElement("button");
    favorite.type = "button";
    favorite.className = `iconButton${image.favorite ? " active" : ""}`;
    favorite.textContent = "👍";
    favorite.addEventListener("click", () => void toggleFavorite(image, favorite));
    const reuse = document.createElement("button");
    reuse.type = "button";
    reuse.className = "secondary";
    reuse.textContent = "レシピ読込・構図固定";
    reuse.addEventListener("click", () => activateCompositionLock(generation, image));
    actions.append(favorite, reuse);
    body.append(title, metadata, actions);
    card.append(preview, body);
    elements.historyGrid.append(card);
  }
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = elements.favoritesOnly.checked
      ? "👍を付けた画像はまだありません"
      : "生成すると画像とレシピがここへ保存されます";
    elements.historyGrid.append(empty);
  }
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
  const filename = document.createElement("span");
  filename.textContent = metadata.file.name;
  text.append(heading, base, triggers, filename);
  elements.civitaiPreview.append(text);
  elements.civitaiPreview.classList.remove("hidden");
}

async function installCivitai() {
  if (!inspectedCivitai) return inspectCivitai();
  clearError();
  rememberSessionSecrets();
  elements.inspectCivitaiButton.disabled = true;
  elements.installCivitaiButton.disabled = true;
  elements.civitaiStatus.textContent = "LoRAをダウンロード中です。大きいファイルは数分かかります…";
  try {
    await postJson("/api/civitai/install", {
      url: elements.civitaiUrl.value.trim(),
      token: elements.civitaiToken.value,
      category: elements.civitaiCategory.value
    });
    elements.civitaiStatus.textContent = `${inspectedCivitai.modelName}を配置・登録しました。`;
    await loadLoras();
  } catch (error) {
    elements.civitaiStatus.textContent = error.message;
  } finally {
    elements.inspectCivitaiButton.disabled = false;
    elements.installCivitaiButton.disabled = false;
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
    candidateCount: elements.candidateCount.value,
    hiresScale: elements.hiresScale.value,
    hiresSteps: elements.hiresSteps.value,
    hiresDenoising: elements.hiresDenoising.value,
    hiresUpscaler: elements.hiresUpscaler.value,
    hiresEnabled: false,
    ...overrides
  };
}

function readSelectedLoras() {
  return [...selectedLoras].map(([name, weight]) => ({
    name,
    weight,
    triggerWords: loraTriggers.get(name) ?? "",
    negativeWords: loraNegativeWords.get(name) ?? ""
  }));
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
        .filter(([name, value]) => name && Number.isFinite(value) && value >= 0.05 && value <= 1.5)
    );
  } catch {
    return new Map();
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

function setBusy(busy, message = "") {
  elements.promptButton.disabled = busy;
  elements.generateButton.disabled = busy;
  elements.healthButton.disabled = busy;
  elements.refreshLorasButton.disabled = busy;
  elements.finishButton.disabled = busy || !selectedCandidate;
  elements.lockCompositionButton.disabled = busy || !selectedCandidate;
  elements.loading.classList.toggle("hidden", !busy);
  if (message) elements.loadingText.textContent = message;
}

function updateGenerateButton() {
  const count = elements.candidateCount.value;
  elements.generateButton.textContent = `${count}枚の候補を生成`;
}

function handleCandidateCountChange() {
  localStorage.setItem("localImageChat.candidateCount", elements.candidateCount.value);
  updateGenerateButton();
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

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}
