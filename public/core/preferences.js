export const PROFILE_STORAGE_VERSION = 3;

export const PREFERENCE_KEYS = Object.freeze({
  autoRetry: "localImageChat.autoRetry",
  candidateCount: "localImageChat.candidateCount",
  checkpointAutoApply: "localImageChat.checkpointAutoApply",
  checkpointProfileAssignments: "localImageChat.checkpointProfileAssignments",
  contentRating: "localImageChat.contentRating",
  generationLoraOutfits: "localImageChat.generationLoraOutfits",
  githubToken: "localImageChat.githubToken",
  img2imgDenoising: "localImageChat.img2imgDenoising",
  img2imgResizeMode: "localImageChat.img2imgResizeMode",
  loraAddonSelections: "localImageChat.loraAddonSelections",
  loraNegativeWords: "localImageChat.loraNegativeWords",
  loraPresetSelections: "localImageChat.loraPresetSelections",
  loraProfileAssignments: "localImageChat.loraProfileAssignments",
  loraProfileVersion: "localImageChat.loraProfileVersion",
  loraTriggers: "localImageChat.loraTriggers",
  loraWeights: "localImageChat.loraWeights",
  promptParts: "localImageChat.promptParts",
  syncInitImageSize: "localImageChat.syncInitImageSize",
  titleGenerationMode: "localImageChat.titleGenerationMode",
  titleTemplate: "localImageChat.titleTemplate"
});

export function createPreferences({ storage = globalThis.localStorage, session = globalThis.sessionStorage } = {}) {
  function get(key, fallback = null) {
    return storage.getItem(key) ?? fallback;
  }

  function set(key, value) {
    storage.setItem(key, value);
  }

  function readTitleSettings() {
    let mode = "";
    let template = "";
    try {
      mode = get(PREFERENCE_KEYS.titleGenerationMode, "");
      template = get(PREFERENCE_KEYS.titleTemplate, "");
    } catch {
      // Match the original sequential try block: earlier successful reads survive.
    }
    return { mode, template };
  }

  function writeTitleSettings(mode, template) {
    try {
      set(PREFERENCE_KEYS.titleGenerationMode, mode);
      set(PREFERENCE_KEYS.titleTemplate, template);
      return true;
    } catch {
      return false;
    }
  }

  function readJson(key, fallback = {}) {
    try {
      const parsed = JSON.parse(get(key, "null"));
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch {
      return fallback;
    }
  }

  function readStringMap(key) {
    const stored = readJson(key, {});
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return new Map();
    return new Map(
      Object.entries(stored)
        .filter(([name, value]) => name && typeof value === "string" && value)
    );
  }

  function readLoraTriggers() {
    const stored = readJson(PREFERENCE_KEYS.loraTriggers, {});
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return new Map();
    return new Map(
      Object.entries(stored)
        .filter(([name, value]) => name && typeof value === "string" && value.trim())
        .map(([name, value]) => [name, value.slice(0, 500)])
    );
  }

  function readLoraWeights() {
    const stored = readJson(PREFERENCE_KEYS.loraWeights, {});
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return new Map();
    return new Map(
      Object.entries(stored)
        .map(([name, value]) => [name, Number(value)])
        .filter(([name, value]) => name && Number.isFinite(value) && value >= 0.05 && value <= 2)
    );
  }

  function readLoraOutfits() {
    const stored = readJson(PREFERENCE_KEYS.generationLoraOutfits, {});
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return new Map();
    return new Map(
      Object.entries(stored)
        .filter(([name, choiceId]) => name && typeof choiceId === "string")
    );
  }

  function writeMap(key, map) {
    set(key, JSON.stringify(Object.fromEntries(map)));
  }

  function getSession(key, fallback = null) {
    return session.getItem(key) ?? fallback;
  }

  function setSession(key, value) {
    session.setItem(key, value);
  }

  return {
    get,
    set,
    readTitleSettings,
    writeTitleSettings,
    readJson,
    readStringMap,
    readLoraTriggers,
    readLoraWeights,
    readLoraOutfits,
    writeMap,
    getSession,
    setSession
  };
}
