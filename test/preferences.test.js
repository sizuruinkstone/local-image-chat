import assert from "node:assert/strict";
import test from "node:test";

import {
  PREFERENCE_KEYS,
  PROFILE_STORAGE_VERSION,
  createPreferences
} from "../public/core/preferences.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    values
  };
}

test("Phase 23 keeps every app-owned storage key and profile version unchanged", () => {
  assert.equal(PROFILE_STORAGE_VERSION, 3);
  assert.deepEqual(PREFERENCE_KEYS, {
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
});

test("missing and corrupt JSON preserve fallback values without rewriting storage", () => {
  const storage = memoryStorage({ corrupt: "{bad", literalNull: "null" });
  const preferences = createPreferences({ storage, session: memoryStorage() });
  const fallback = { keep: true };
  assert.strictEqual(preferences.readJson("missing", fallback), fallback);
  assert.strictEqual(preferences.readJson("corrupt", fallback), fallback);
  assert.strictEqual(preferences.readJson("literalNull", fallback), fallback);
  assert.equal(storage.values.get("corrupt"), "{bad");
});

test("JSON arrays remain arrays while map readers reject arrays and invalid objects", () => {
  const storage = memoryStorage({
    array: '["one","two"]',
    strings: '{"keep":"value","empty":"","number":3}',
    invalidMap: '[{"name":"not-a-map"}]'
  });
  const preferences = createPreferences({ storage, session: memoryStorage() });
  assert.deepEqual(preferences.readJson("array", []), ["one", "two"]);
  assert.deepEqual([...preferences.readStringMap("strings")], [["keep", "value"]]);
  assert.deepEqual([...preferences.readStringMap("invalidMap")], []);
});

test("LoRA Map parsing and object JSON serialization retain existing filtering rules", () => {
  const storage = memoryStorage({
    [PREFERENCE_KEYS.loraTriggers]: JSON.stringify({ keep: " trigger ", blank: " ", long: "x".repeat(501), bad: 2 }),
    [PREFERENCE_KEYS.loraWeights]: JSON.stringify({ low: 0.049, min: "0.05", normal: 0.7, max: 2, high: 2.01, nan: "x" }),
    [PREFERENCE_KEYS.generationLoraOutfits]: JSON.stringify({ keep: "uniform", empty: "", bad: 4 })
  });
  const preferences = createPreferences({ storage, session: memoryStorage() });
  assert.deepEqual([...preferences.readLoraTriggers()], [
    ["keep", " trigger "],
    ["long", "x".repeat(500)]
  ]);
  assert.deepEqual([...preferences.readLoraWeights()], [
    ["min", 0.05],
    ["normal", 0.7],
    ["max", 2]
  ]);
  assert.deepEqual([...preferences.readLoraOutfits()], [["keep", "uniform"], ["empty", ""]]);

  preferences.writeMap(PREFERENCE_KEYS.loraProfileAssignments, new Map([["A", "profile-a"], ["B", "profile-b"]]));
  assert.equal(storage.values.get(PREFERENCE_KEYS.loraProfileAssignments), '{"A":"profile-a","B":"profile-b"}');
});

test("title access keeps grouped storage failures best-effort while normal writes still throw", () => {
  const failure = new Error("storage blocked");
  const storage = {
    getItem() { throw failure; },
    setItem() { throw failure; }
  };
  const preferences = createPreferences({ storage, session: memoryStorage() });
  assert.deepEqual(preferences.readTitleSettings(), { mode: "", template: "" });
  assert.equal(preferences.writeTitleSettings("auto", "{prompt}"), false);
  assert.throws(() => preferences.get(PREFERENCE_KEYS.contentRating), failure);
  assert.throws(() => preferences.set(PREFERENCE_KEYS.contentRating, "general"), failure);
});

test("title settings preserve the original grouped storage failure boundary", () => {
  const reads = [];
  const writes = [];
  const storage = {
    getItem(key) {
      reads.push(key);
      if (key === PREFERENCE_KEYS.titleGenerationMode) throw new Error("blocked");
      return "must-not-be-read";
    },
    setItem(key, value) {
      writes.push([key, value]);
      if (key === PREFERENCE_KEYS.titleGenerationMode) throw new Error("blocked");
    }
  };
  const preferences = createPreferences({ storage, session: memoryStorage() });

  assert.deepEqual(preferences.readTitleSettings(), { mode: "", template: "" });
  assert.deepEqual(reads, [PREFERENCE_KEYS.titleGenerationMode]);
  assert.equal(preferences.writeTitleSettings("auto", "{prompt}"), false);
  assert.deepEqual(writes, [[PREFERENCE_KEYS.titleGenerationMode, "auto"]]);
});

test("title settings retain an earlier read when the second grouped read fails", () => {
  const reads = [];
  const storage = {
    getItem(key) {
      reads.push(key);
      if (key === PREFERENCE_KEYS.titleTemplate) throw new Error("blocked");
      return "template";
    },
    setItem() {}
  };
  const preferences = createPreferences({ storage, session: memoryStorage() });

  assert.deepEqual(preferences.readTitleSettings(), { mode: "template", template: "" });
  assert.deepEqual(reads, [PREFERENCE_KEYS.titleGenerationMode, PREFERENCE_KEYS.titleTemplate]);
});

test("GitHub token remains session-only and does not touch local storage", () => {
  const storage = memoryStorage();
  const session = memoryStorage({ [PREFERENCE_KEYS.githubToken]: "session-token" });
  const preferences = createPreferences({ storage, session });
  assert.equal(preferences.getSession(PREFERENCE_KEYS.githubToken, ""), "session-token");
  preferences.setSession(PREFERENCE_KEYS.githubToken, "next-token");
  assert.equal(session.values.get(PREFERENCE_KEYS.githubToken), "next-token");
  assert.equal(storage.values.has(PREFERENCE_KEYS.githubToken), false);
});
