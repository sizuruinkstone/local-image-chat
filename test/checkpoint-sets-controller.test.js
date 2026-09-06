import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import {
  checkpointSetIdentity,
  createCheckpointSetController
} from "../public/features/checkpoint-sets.js";

class FakeControl {
  constructor() {
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.textContent = "";
    this.children = [];
    this.listeners = new Map();
  }

  get options() {
    return this.children.flatMap((child) => child.options ?? [child]);
  }

  replaceChildren(...children) {
    this.children = children;
    this.value = "";
  }

  append(...children) {
    this.children.push(...children);
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }
}

class FakeGroup {
  constructor() {
    this.label = "";
    this.options = [];
  }

  append(...options) {
    this.options.push(...options);
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
}

function fixture(overrides = {}) {
  const elements = Object.fromEntries([
    "checkpointSetSelect", "checkpointSetAutoApply", "saveCheckpointSetButton",
    "applyCheckpointSetButton", "renameCheckpointSetButton", "duplicateCheckpointSetButton",
    "deleteCheckpointSetButton", "checkpointSetStatus"
  ].map((key) => [key, new FakeControl()]));
  let runtimeState = {
    activeRuntimeId: "reforge",
    selectedCheckpoint: { title: "models\\NoobAI.safetensors [abc123]" }
  };
  let runtimeContext = { token: 1, runtimeId: "reforge" };
  let runtimeCurrent = true;
  let settingsState = {
    width: "896", height: "1152", steps: "28", cfgScale: "5.5", seed: "42",
    samplerName: "Euler a", scheduler: "Automatic", noiseSchedule: "Default",
    checkpoint: "models\\NoobAI.safetensors [abc123]", checkpointHash: "abc123",
    checkpointModelName: "NoobAI", checkpointFilename: "models\\NoobAI.safetensors",
    candidateCount: "2", img2imgDenoising: "0.5", img2imgResizeMode: "crop",
    inpaintDenoising: "0.65", maskBlur: "4", inpaintFill: "original",
    inpaintFullRes: true, inpaintFullResPadding: "32", hiresScale: "1.5",
    hiresSteps: "20", hiresDenoising: "0.4", hiresUpscaler: "Anime6B",
    hiresEnabled: false
  };
  let loraEntries = new Map([["Style/B", 0.8], ["Style/A", 0.7]]);
  let promptState = {
    prompt: "1girl", negativePrompt: "low quality", promptBoosts: ["cinematic"]
  };
  let catalog = [];
  const calls = { get: [], post: [], patch: [], delete: [], settings: [], loras: [], prompt: [] };
  const notices = { success: [], warning: [], error: [] };
  let confirm = async () => true;
  let promptValue = "Saved set";

  const controller = createCheckpointSetController({
    elements,
    document: { createElement: () => new FakeGroup() },
    createOption: (text, value) => ({ text, value, disabled: false }),
    getJson: async (url) => {
      calls.get.push(url);
      return { sets: catalog };
    },
    postJson: async (url, body) => {
      calls.post.push({ url, body });
      const set = { id: "created", ...body };
      catalog = [set, ...catalog];
      return { set };
    },
    patchJson: async (url, body) => {
      calls.patch.push({ url, body });
      const id = url.split("/").at(-1);
      if (body.duplicate) {
        const source = catalog.find((set) => set.id === id);
        const set = { ...source, id: "copy", name: `${source.name} のコピー`, autoApply: false };
        catalog = [set, ...catalog];
        return { set };
      }
      catalog = catalog.map((set) => set.id === id ? { ...set, ...body } : set);
      return { set: catalog.find((set) => set.id === id) };
    },
    deleteJson: async (url) => {
      calls.delete.push(url);
      const id = url.split("/").at(-1);
      catalog = catalog.filter((set) => set.id !== id);
      return {};
    },
    confirmModal: (...args) => confirm(...args),
    promptModal: async () => promptValue,
    toast: {
      success: (message) => notices.success.push(message),
      warning: (message) => notices.warning.push(message),
      error: (message) => notices.error.push(message)
    },
    withBusy: async (_element, _label, action) => action(),
    formatCheckpointBadge: (value) => value,
    shorten: (value) => value,
    runtime: {
      getState: () => runtimeState,
      getContext: () => runtimeContext,
      isCurrent: (context) => runtimeCurrent && context === runtimeContext
    },
    settings: {
      read: () => ({ ...settingsState }),
      apply: (value) => {
        calls.settings.push(value);
        settingsState = { ...settingsState, ...value };
      }
    },
    loras: {
      fingerprintEntries: () => loraEntries.entries(),
      readForSet: () => [...loraEntries].map(([name, weight]) => ({ name, weight })),
      restore: (value) => {
        calls.loras.push(value);
        loraEntries = new Map(value.filter((item) => item.name !== "Missing")
          .map((item) => [item.name, Number(item.weight)]));
        return value.filter((item) => item.name === "Missing").map((item) => item.name);
      },
      render: () => calls.loras.push("render")
    },
    prompt: {
      read: () => ({ ...promptState, promptBoosts: [...promptState.promptBoosts] }),
      apply: (prompt, negativePrompt) => {
        calls.prompt.push({ prompt, negativePrompt });
        promptState = { ...promptState, prompt, negativePrompt };
      }
    },
    ...overrides
  });

  return {
    controller, elements, calls, notices,
    setCatalog: (value) => { catalog = value; },
    getCatalog: () => catalog,
    setRuntimeState: (value) => { runtimeState = value; },
    getRuntimeState: () => runtimeState,
    setRuntimeCurrent: (value) => { runtimeCurrent = value; },
    getRuntimeContext: () => runtimeContext,
    setSettings: (value) => { settingsState = { ...settingsState, ...value }; },
    getSettings: () => settingsState,
    setLoraEntries: (value) => { loraEntries = new Map(value); },
    setPrompt: (value) => { promptState = { ...promptState, ...value }; },
    setConfirm: (value) => { confirm = value; },
    setPromptValue: (value) => { promptValue = value; }
  };
}

const BASE_SET = {
  id: "base",
  name: "NoobAI 基本",
  checkpoint: "NoobAI.ckpt",
  autoApply: true,
  loras: [{ name: "Style/A", weight: 0.65 }, { name: "Missing", weight: 0.8 }],
  settings: { width: 1024, height: 1024, steps: 32, cfgScale: 6, samplerName: "Euler" },
  prompt: "set prompt",
  negativePrompt: "set negative",
  promptBoosts: ["stored boost"]
};

test("Checkpoint identityはpath・hash・拡張子・caseを正規化する", () => {
  assert.equal(checkpointSetIdentity("C:\\Models\\NOOBAI.safetensors [A0b1]"), "noobai");
  assert.equal(checkpointSetIdentity("folder/noobai.CKPT"), "noobai");
  assert.equal(checkpointSetIdentity(null), "");
});

test("catalogをCheckpoint別に描画し、不正なsets応答は空配列へ正規化する", async () => {
  const fx = fixture();
  fx.controller.init();
  fx.setCatalog([BASE_SET, { ...BASE_SET, id: "other", name: "Other", checkpoint: "Other.safetensors" }]);
  await fx.controller.load();

  assert.deepEqual(fx.controller.setsForCheckpoint().map((set) => set.id), ["base"]);
  assert.deepEqual(fx.elements.checkpointSetSelect.children.slice(1).map((group) => group.label), [
    "このCheckpoint", "他のCheckpoint"
  ]);
  assert.match(fx.elements.checkpointSetSelect.options[1].text, /自動適用/);

  const malformed = fixture({ getJson: async () => ({ sets: {} }) });
  malformed.controller.init();
  await malformed.controller.load();
  assert.deepEqual(malformed.controller.getState().checkpointSets, []);
});

test("fingerprintはreadSettings全体とsort済みLoRAだけを使いPromptを除外する", () => {
  const fx = fixture();
  fx.controller.init();
  fx.controller.markSettingsApplied();
  assert.equal(fx.controller.hasUnsavedSettingChanges(), false);

  fx.setPrompt({ prompt: "手編集", negativePrompt: "別Prompt", promptBoosts: ["changed"] });
  assert.equal(fx.controller.hasUnsavedSettingChanges(), false, "Promptは既存どおりdirty判定の対象外");

  fx.setLoraEntries([["Style/A", 0.7], ["Style/B", 0.8]]);
  assert.equal(fx.controller.hasUnsavedSettingChanges(), false, "LoRA entry順はfingerprintへ影響しない");

  fx.setSettings({ img2imgDenoising: "0.61" });
  assert.equal(fx.controller.hasUnsavedSettingChanges(), true, "set保存項目外も含むfull readSettingsを比較する");
});

test("payloadとCRUDは既存endpoint/schemaを維持しruntimeIdを保存しない", async () => {
  const fx = fixture();
  fx.controller.init();
  fx.setCatalog([BASE_SET]);
  await fx.controller.load();
  fx.elements.checkpointSetAutoApply.checked = true;

  const payload = fx.controller.currentSetPayload("New");
  assert.equal(payload.checkpoint, "models\\NoobAI.safetensors [abc123]");
  assert.equal(payload.settings.steps, "28");
  assert.equal(payload.prompt, "1girl");
  assert.deepEqual(payload.promptBoosts, ["cinematic"]);
  assert.equal("runtimeId" in payload, false);
  assert.equal("seed" in payload.settings, false);
  assert.equal("candidateCount" in payload.settings, false);

  await fx.controller.saveCurrent();
  assert.equal(fx.calls.post[0].url, "/api/checkpoint-lora-sets");
  assert.equal(fx.elements.checkpointSetSelect.value, "created");

  fx.setPromptValue("Renamed");
  await fx.controller.rename();
  assert.deepEqual(fx.calls.patch.at(-1), {
    url: "/api/checkpoint-lora-sets/created", body: { name: "Renamed" }
  });

  await fx.controller.duplicate();
  assert.deepEqual(fx.calls.patch.at(-1), {
    url: "/api/checkpoint-lora-sets/created", body: { duplicate: true }
  });
  assert.equal(fx.elements.checkpointSetSelect.value, "copy");

  fx.elements.checkpointSetAutoApply.checked = true;
  await fx.controller.toggleAutoApply();
  assert.deepEqual(fx.calls.patch.at(-1), {
    url: "/api/checkpoint-lora-sets/copy", body: { autoApply: true }
  });

  await fx.controller.remove();
  assert.equal(fx.calls.delete.at(-1), "/api/checkpoint-lora-sets/copy");
});

test("applyはdirty確認後にSettings・LoRA・Promptを復元しfingerprintを更新する", async () => {
  const fx = fixture();
  fx.controller.init();
  fx.controller.markSettingsApplied();
  fx.setSettings({ width: "768" });
  fx.setConfirm(async () => false);

  assert.equal(await fx.controller.apply(BASE_SET), false);
  assert.equal(fx.calls.settings.length, 0);
  assert.equal(fx.calls.loras.length, 0);
  assert.equal(fx.calls.prompt.length, 0);

  fx.setConfirm(async () => true);
  assert.equal(await fx.controller.apply(BASE_SET), true);
  assert.equal(fx.getSettings().width, 1024);
  assert.deepEqual(fx.calls.prompt, [{ prompt: "set prompt", negativePrompt: "set negative" }]);
  assert.deepEqual(fx.calls.loras[0], BASE_SET.loras);
  assert.equal(fx.controller.hasUnsavedSettingChanges(), false);
  assert.match(fx.notices.warning.at(-1), /Missing/);
});

test("autoApplyはconfirm待機中にruntime contextがstaleならformを変更しない", async () => {
  const pending = deferred();
  const fx = fixture();
  fx.controller.init();
  fx.setCatalog([BASE_SET]);
  await fx.controller.load();
  fx.controller.markSettingsApplied();
  fx.setSettings({ steps: "31" });
  fx.setConfirm(() => pending.promise);
  const state = fx.getRuntimeState();
  const context = fx.getRuntimeContext();
  let callbackCurrent = true;

  const applying = fx.controller.applyAuto(state, context, () => callbackCurrent);
  await Promise.resolve();
  callbackCurrent = false;
  fx.setRuntimeCurrent(false);
  fx.setRuntimeState({
    activeRuntimeId: "forge-neo-anima",
    selectedCheckpoint: { title: "Other.safetensors" }
  });
  pending.resolve(true);

  assert.equal(await applying, false);
  assert.equal(fx.calls.settings.length, 0);
  assert.equal(fx.calls.loras.length, 0);
  assert.equal(fx.calls.prompt.length, 0);
  assert.equal(fx.getSettings().steps, "31");
});

test("init/disposeがCheckpoint Set listenerを重複なく所有する", () => {
  const fx = fixture();
  fx.controller.init();
  fx.controller.init();
  for (const [key, event] of [
    ["checkpointSetSelect", "change"], ["checkpointSetAutoApply", "change"],
    ["saveCheckpointSetButton", "click"], ["applyCheckpointSetButton", "click"],
    ["renameCheckpointSetButton", "click"], ["duplicateCheckpointSetButton", "click"],
    ["deleteCheckpointSetButton", "click"]
  ]) assert.equal(fx.elements[key].listeners.has(event), true);

  fx.controller.dispose();
  for (const control of Object.values(fx.elements)) assert.equal(control.listeners.size, 0);
});

test("appはCheckpoint Set controllerを狭いportで構成しsyntax check対象に含める", async () => {
  const [app, controllerSource, packageSource] = await Promise.all([
    fs.readFile("public/app.js", "utf8"),
    fs.readFile("public/features/checkpoint-sets.js", "utf8"),
    fs.readFile("package.json", "utf8")
  ]);
  assert.match(app, /createCheckpointSetController\(\{/);
  assert.match(app, /runtime:\s*\{[\s\S]*?getState:[\s\S]*?getContext:[\s\S]*?isCurrent:/);
  assert.match(app, /settings:\s*\{[\s\S]*?read:[\s\S]*?apply:/);
  assert.match(app, /loras:\s*\{[\s\S]*?fingerprintEntries:[\s\S]*?restore:[\s\S]*?render:/);
  assert.match(app, /prompt:\s*\{[\s\S]*?read:[\s\S]*?apply:/);
  assert.doesNotMatch(app, /\/api\/checkpoint-lora-sets/);
  assert.doesNotMatch(app, /function (?:settingsFingerprint|applyAutoCheckpointSet|loadCheckpointSets)\b/);
  assert.match(controllerSource, /elements\.checkpointSetSelect\.addEventListener\("change", onSelectChange\)/);
  assert.match(controllerSource, /elements\.checkpointSetSelect\.removeEventListener\("change", onSelectChange\)/);
  assert.match(JSON.parse(packageSource).scripts.check, /node --check public\/features\/checkpoint-sets\.js/);
});
