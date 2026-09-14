import assert from "node:assert/strict";
import fs from "node:fs/promises";
import express from "express";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCivitaiService } from "../src/civitai.js";
import { createForgeNeoProvider } from "../src/forge-neo.js";
import { createGenerationRuntimeRegistry } from "../src/generation-runtimes.js";
import { createHistoryService } from "../src/history.js";
import { serializeHistoryGeneration } from "../src/api/v1/history.js";
import { createJobManager } from "../src/job-manager.js";
import { normalizeLora } from "../src/reforge.js";
import { createGenerationRuntime, createGenerationService } from "../src/services/generation-service.js";
import { capabilitiesInputSchema } from "../src/mcp/schemas.js";
import { createLocalImageChatClient } from "../src/mcp/local-image-chat-client.js";
import { createMcpServer } from "../src/mcp/tools.js";
import { createV1ErrorMiddleware, createV1Router } from "../src/api/v1/router.js";

const ONE_PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function neoConfig(overrides = {}) {
  return {
    enabled: true,
    id: "forge-neo-anima",
    label: "Forge Neo / Anima",
    url: "http://mock-neo",
    activationMode: "managed-options",
    preset: "anima",
    checkpoint: "sd\\oneObsessionAnima_v30.safetensors",
    additionalModules: ["qwen_image_vae.safetensors", "oneObsessionAnima_v30_txt.safetensors"],
    timeoutMs: 5_000,
    ...overrides
  };
}

function createNeoFetch({ options, modules, models, loras = [] } = {}) {
  const calls = [];
  let currentOptions = structuredClone(options);
  const fetchImpl = async (url, request = {}) => {
    const parsed = new URL(url);
    const endpoint = parsed.pathname.split("/").at(-1);
    const body = request.body ? JSON.parse(request.body) : null;
    calls.push({ endpoint, method: request.method ?? "GET", body });
    if (endpoint === "options" && request.method === "POST") {
      currentOptions = { ...currentOptions, ...body };
      return jsonResponse({ ok: true });
    }
    if (endpoint === "refresh-checkpoints" && request.method === "POST") return jsonResponse(null);
    if (endpoint === "refresh-loras" && request.method === "POST") return jsonResponse(null);
    if (endpoint === "options") return jsonResponse(currentOptions);
    if (endpoint === "sd-models") return jsonResponse(models);
    if (endpoint === "sd-modules") return jsonResponse(modules);
    if (endpoint === "samplers") return jsonResponse([{ name: "Euler a" }]);
    if (endpoint === "schedulers") return jsonResponse([{ name: "Automatic" }]);
    if (endpoint === "loras") return jsonResponse(loras);
    if (endpoint === "progress") return jsonResponse({ progress: 0.4, eta_relative: 0 });
    if (endpoint === "txt2img") return jsonResponse({
      images: [`data:image/png;base64,${ONE_PIXEL_PNG}`],
      info: JSON.stringify({ seed: body.seed })
    });
    if (endpoint === "interrupt") return jsonResponse({ ok: true });
    if (endpoint === "cmd-flags") return jsonResponse({}, 500);
    throw new Error(`unexpected endpoint: ${endpoint}`);
  };
  return { calls, fetchImpl, getOptions: () => currentOptions };
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

async function startNeoHttpServer(t, configure) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  configure(app);
  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    instance.once("error", reject);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

function baseNeoFixture(options = {}) {
  return createNeoFetch({
    options: {
      sd_model_checkpoint: "oneObsessionAnima_v30.safetensors",
      forge_preset: "anima",
      forge_additional_modules: [
        "qwen_image_vae.safetensors",
        "oneObsessionAnima_v30_txt.safetensors"
      ],
      ...options
    },
    models: [{
      title: "oneObsessionAnima_v30.safetensors",
      model_name: "oneObsessionAnima_v30",
      filename: "sd/oneObsessionAnima_v30.safetensors",
      hash: "anima-hash"
    }],
    modules: [
      { name: "qwen_image_vae.safetensors", filename: "C:\\neo\\models\\qwen_image_vae.safetensors" },
      { name: "oneObsessionAnima_v30_txt.safetensors", filename: "C:\\neo\\models\\oneObsessionAnima_v30_txt.safetensors" }
    ]
  });
}

async function waitForTerminalJob(jobs, id, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = jobs.get(id);
    if (["done", "failed", "cancelled"].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Job ${id} did not reach a terminal state`);
}

async function createNeoJobHarness(t, fetchImpl, forgeConfig = neoConfig()) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "local-image-chat-task20-job-"));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const config = {
    reforge: { url: "http://mock-reforge" },
    lora: { defaultWeight: 0.7, maxSelected: 4 },
    defaults: {
      width: 512, height: 512, steps: 8, cfgScale: 5,
      samplerName: "Euler a", scheduler: "Automatic", noiseSchedule: "Automatic", candidateCount: 1,
      hiresScale: 1.5, hiresSteps: 12, hiresDenoising: 0.3, hiresUpscaler: "Mock"
    },
    runtimes: { default: "forge-neo-anima", forgeNeoAnima: forgeConfig }
  };
  const records = [];
  const history = {
    async addGeneration(input) {
      const generation = { ...input, id: `task20-generation-${records.length + 1}` };
      records.push(generation);
      return generation;
    },
    async listPage() {
      return { generations: [], limit: 20, total: 0, nextCursor: null, hasMore: false };
    }
  };
  const registry = createGenerationRuntimeRegistry({ config, fetchImpl });
  const runtime = createGenerationRuntime({
    config,
    runtimeRegistry: registry,
    history,
    thumbnails: { ensure: async () => {} },
    outputDir: workspace,
    createPrompt: async () => ({ prompt: "mock", negative_prompt: "", explanation_ja: "mock" }),
    unloadOllama: async () => {}
  });
  const jobs = createJobManager(runtime.executeWithRecovery);
  const service = createGenerationService({ jobs, runtime, runtimeRegistry: registry, config, history });
  return { config, history, registry, runtime, jobs, service, records };
}

async function createRecoveryFailureHarness(runtimeId, label, failureMessage) {
  const config = {
    reforge: { url: "http://mock-reforge" },
    lora: { defaultWeight: 0.7, maxSelected: 4 },
    ollama: { url: "http://mock-ollama", model: "mock" },
    defaults: {
      width: 512, height: 512, steps: 8, cfgScale: 5,
      samplerName: "Euler a", scheduler: "Automatic", noiseSchedule: "Automatic", candidateCount: 1,
      hiresScale: 1.5, hiresSteps: 12, hiresDenoising: 0.3, hiresUpscaler: "Mock"
    }
  };
  const descriptor = {
    id: runtimeId,
    label,
    provider: runtimeId === "reforge" ? "reforge" : "forge-neo",
    available: true,
    supportedModes: ["txt2img"],
    features: { txt2img: true, img2img: false, inpaint: false, hires: false, ipAdapter: false }
  };
  const provider = {
    descriptor,
    validateRequest() {},
    prepareGeneration: async () => ({}),
    generateImages: async () => {
      throw new Error(failureMessage);
    }
  };
  const registry = {
    defaultRuntimeId: runtimeId,
    resolve: () => provider,
    listDescriptors: () => [descriptor],
    providers: new Map([[runtimeId, provider]])
  };
  const history = { async addGeneration() { throw new Error("History保存は実行されない想定です"); } };
  const runtime = createGenerationRuntime({
    config,
    runtimeRegistry: registry,
    history,
    thumbnails: { ensure: async () => {} },
    outputDir: os.tmpdir(),
    createPrompt: async () => ({ prompt: "mock", negative_prompt: "", explanation_ja: "mock" }),
    unloadOllama: async () => {}
  });
  const jobs = createJobManager(runtime.executeWithRecovery);
  const service = createGenerationService({ jobs, runtime, runtimeRegistry: registry, config, history });
  return { jobs, service };
}

test("Forge Neo readinessはcmd-flagsに依存せず、完全一致時はoptions POSTを行わない", async () => {
  const fixture = baseNeoFixture();
  const provider = createForgeNeoProvider({ config: neoConfig(), fetchImpl: fixture.fetchImpl });
  const health = await provider.checkHealth();
  assert.equal(health.ok, true);
  await provider.prepareGeneration();
  assert.equal(fixture.calls.some((call) => call.endpoint === "cmd-flags"), false);
  assert.equal(fixture.calls.filter((call) => call.endpoint === "options" && call.method === "POST").length, 0);
  assert.equal(fixture.calls.find((call) => call.endpoint === "sd-modules").body, null);
});

test("Forge Neo health確認は生成timeoutと独立し、応答停止時も/api/runtimes用に有限時間で失敗する", async () => {
  const calls = [];
  const fetchImpl = async (url, request = {}) => {
    calls.push({ url, endpoint: new URL(url).pathname.split("/").at(-1) });
    return new Promise((_resolve, reject) => {
      request.signal?.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    });
  };
  const logger = { warn() {} };
  const provider = createForgeNeoProvider({
    config: neoConfig({ timeoutMs: 900_000, healthTimeoutMs: 25 }),
    fetchImpl,
    logger
  });
  const startedAt = Date.now();
  const health = await provider.checkHealth();
  assert.ok(Date.now() - startedAt < 1_000);
  assert.equal(health.available, false);
  assert.equal(health.ok, false);
  assert.equal(health.error, "Forge Neoへの接続がタイムアウトしました");
  assert.equal(calls.length, 1);
  assert.doesNotMatch(JSON.stringify(health), /mock-neo|stack|AbortError/);

  const registry = createGenerationRuntimeRegistry({
    config: {
      reforge: { url: "" },
      runtimes: { default: "forge-neo-anima", forgeNeoAnima: neoConfig({ healthTimeoutMs: 25 }) }
    },
    fetchImpl,
    logger
  });
  const registryStartedAt = Date.now();
  const runtimeHealth = await registry.healthAll();
  assert.ok(Date.now() - registryStartedAt < 1_000);
  assert.equal(runtimeHealth["forge-neo-anima"].ok, false);
  assert.equal(runtimeHealth["forge-neo-anima"].error, "Forge Neoへの接続がタイムアウトしました");
});

test("LoRA共通normalizerは既知marker後の階層だけを公開し、未知absolute pathを隠す", () => {
  const character = normalizeLora({
    name: "hero",
    alias: "Hero",
    path: "C:\\AI\\StableDiffusion\\models\\Lora\\Anima\\Character\\hero.safetensors"
  });
  assert.equal(character.folder, "Anima/Character");
  assert.equal(character.category, "character");
  assert.equal(character.displayName, "Hero");

  const preservedIdentifier = normalizeLora({
    name: "Anima\\Character\\hero",
    path: "C:\\AI\\StableDiffusion\\models\\Lora\\Anima\\Character\\hero.safetensors"
  });
  assert.equal(preservedIdentifier.name, "Anima\\Character\\hero");

  const style = normalizeLora({
    name: "style",
    path: "C:\\AI\\StableDiffusion\\models\\Loras\\Anima\\Style\\style.safetensors"
  });
  assert.equal(style.folder, "Anima/Style");
  assert.equal(style.category, "direction");

  const root = normalizeLora({
    name: "root",
    path: "C:\\AI\\StableDiffusion\\models\\LyCORIS\\root.safetensors"
  });
  assert.equal(root.folder, "");

  const unknown = normalizeLora({
    name: "unknown",
    path: "C:\\Users\\secret\\Packages\\ForgeNeo\\custom\\unknown.safetensors"
  });
  assert.equal(unknown.folder, "");
  assert.doesNotMatch(JSON.stringify(unknown), /C:\\\\Users|ForgeNeo/);
});

test("Forge Neo LoRAは階層・既存Registry情報・API用nameを維持してmergeする", async (t) => {
  const fixture = createNeoFetch({
    options: {
      sd_model_checkpoint: "oneObsessionAnima_v30.safetensors",
      forge_preset: "anima",
      forge_additional_modules: [
        "qwen_image_vae.safetensors",
        "oneObsessionAnima_v30_txt.safetensors"
      ]
    },
    models: [{
      title: "oneObsessionAnima_v30.safetensors",
      model_name: "oneObsessionAnima_v30",
      filename: "sd/oneObsessionAnima_v30.safetensors"
    }],
    modules: [
      { name: "qwen_image_vae.safetensors" },
      { name: "oneObsessionAnima_v30_txt.safetensors" }
    ],
    loras: [
      {
        name: "hero",
        alias: "hero",
        path: "C:\\neo\\models\\Lora\\Anima\\Character\\hero.safetensors"
      },
      {
        name: "style",
        alias: "style",
        path: "C:\\neo\\models\\Lora\\Anima\\Style\\style.safetensors"
      },
      {
        name: "shared",
        alias: "shared",
        path: "C:\\neo\\models\\Lora\\Anima\\Style\\shared.safetensors"
      }
    ]
  });
  const provider = createForgeNeoProvider({ config: neoConfig(), fetchImpl: fixture.fetchImpl });
  const installed = await provider.listLoras();
  assert.equal(installed.length, 3);
  assert.equal(installed.find((item) => item.name === "hero").folder, "Anima/Character");
  assert.equal(installed.find((item) => item.name === "hero").category, "character");
  assert.equal(installed.find((item) => item.name === "style").folder, "Anima/Style");
  assert.doesNotMatch(JSON.stringify(installed), /C:\\\\neo|models\\\\Lora/);

  const refreshed = await provider.refreshLoras();
  assert.deepEqual(refreshed, installed);
  assert.equal(fixture.calls.filter((call) => call.endpoint === "refresh-loras").length, 1);
  assert.deepEqual(
    fixture.calls.slice(-2).map((call) => `${call.method} ${call.endpoint}`),
    ["POST refresh-loras", "GET loras"]
  );

  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "local-image-chat-task20-lora-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dataDir, "lora-registry.json"), JSON.stringify({
    schemaVersion: 6,
    entries: [
      {
        uid: "hero-entry",
        relativeName: "Anima/Character/hero",
        filename: "hero.safetensors",
        displayName: "管理済みHero",
        category: "character",
        subcategory: "character",
        characterTriggerWords: "hero face",
        triggerWords: "hero face",
        negativeWords: "old costume",
        outfitPresets: [{ id: "uniform", name: "制服", triggerWords: "school uniform" }],
        previewUrl: "https://example.test/hero.png"
      },
      {
        uid: "shared-character-entry",
        relativeName: "Anima/Character/shared",
        filename: "shared.safetensors",
        category: "character"
      },
      {
        uid: "shared-style-entry",
        relativeName: "Anima/Style/shared",
        filename: "shared.safetensors",
        category: "direction"
      }
    ]
  }));
  const civitai = createCivitaiService({ dataDir, loraConfig: {}, reforgeConfig: {} });
  const merged = await civitai.mergeWithInstalled(installed);
  const hero = merged.find((item) => item.name === "hero");
  assert.equal(hero.displayName, "管理済みHero");
  assert.equal(hero.category, "character");
  assert.equal(hero.registry.characterTriggerWords, "hero face");
  assert.equal(hero.registry.negativeWords, "old costume");
  assert.equal(hero.registry.outfitPresets[0].name, "制服");
  assert.equal(hero.registry.previewUrl, "https://example.test/hero.png");
  assert.equal(hero.name, "hero", "Neoへ送るLoRA identifierは変更しない");
  assert.doesNotMatch(JSON.stringify(merged), /C:\\\\neo|models\\\\Lora/);

  const ambiguous = await civitai.mergeWithInstalled([{
    name: "shared",
    displayName: "shared",
    folder: "",
    category: "direction"
  }]);
  assert.equal(ambiguous[0].registry, undefined, "同名basenameが曖昧な場合は未結合にする");

  const resolved = await civitai.mergeWithInstalled([{
    name: "shared",
    displayName: "shared",
    folder: "Anima/Character",
    category: "direction"
  }]);
  assert.equal(resolved[0].registry.uid, "shared-character-entry");
  assert.equal(resolved[0].category, "character");

  const duplicateDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "local-image-chat-task20-lora-duplicate-"));
  t.after(() => fs.rm(duplicateDataDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(duplicateDataDir, "lora-registry.json"), JSON.stringify({
    schemaVersion: 6,
    entries: [{
      uid: "folder-a-shared-entry",
      relativeName: "FolderA/shared",
      filename: "shared.safetensors",
      displayName: "Folder A shared"
    }]
  }));
  const duplicateCivitai = createCivitaiService({
    dataDir: duplicateDataDir,
    loraConfig: {},
    reforgeConfig: {}
  });
  const duplicateInstalled = await duplicateCivitai.mergeWithInstalled([
    { name: "shared", displayName: "shared", folder: "FolderA" },
    { name: "shared", displayName: "shared", folder: "FolderB" }
  ]);
  assert.equal(duplicateInstalled[0].registry.uid, "folder-a-shared-entry");
  assert.equal(duplicateInstalled[1].registry, undefined, "installed側の同名folder違いがある場合はbasename fallbackしない");
});

test("Forge Neoの実形catalogはtitle hash suffixとabsolute filenameをbasenameで安全に解決する", async () => {
  const fixture = createNeoFetch({
    options: {
      sd_model_checkpoint: "sd\\oneObsessionAnima_v30.safetensors",
      forge_preset: "anima",
      forge_additional_modules: [
        "C:\\neo\\models\\qwen_image_vae.safetensors",
        "C:\\neo\\models\\oneObsessionAnima_v30_txt.safetensors"
      ]
    },
    models: [{
      title: "sd\\oneObsessionAnima_v30.safetensors [ed32d6584f]",
      model_name: "sd_oneObsessionAnima_v30",
      filename: "C:\\neo\\models\\oneObsessionAnima_v30.safetensors",
      hash: "ed32d6584f"
    }],
    modules: [
      { model_name: "qwen_image_vae.safetensors", filename: "C:\\neo\\models\\qwen_image_vae.safetensors" },
      { model_name: "oneObsessionAnima_v30_txt.safetensors", filename: "C:\\neo\\models\\oneObsessionAnima_v30_txt.safetensors" }
    ]
  });
  const provider = createForgeNeoProvider({ config: neoConfig(), fetchImpl: fixture.fetchImpl });
  const listed = await provider.listCheckpoints();
  assert.equal(listed.activeCheckpoint, listed.checkpoints[0].title);
  assert.equal((await provider.resolveV1Checkpoint(listed.checkpoints[0].title)).active, true);
  await provider.prepareGeneration();
  assert.equal(fixture.calls.filter((call) => call.endpoint === "options" && call.method === "POST").length, 0);
  assert.doesNotMatch(JSON.stringify(await provider.listCheckpoints()), /C:\\neo|sd\\/);

  const preloadedProvider = createForgeNeoProvider({
    config: neoConfig({ activationMode: "preloaded" }),
    fetchImpl: fixture.fetchImpl
  });
  await preloadedProvider.prepareGeneration();
  assert.equal(fixture.calls.filter((call) => call.endpoint === "options" && call.method === "POST").length, 0);
});

test("Forge Neoの手動Checkpoint再読込はrefresh後に固定allowlistだけを再取得する", async () => {
  const fixture = baseNeoFixture();
  const provider = createForgeNeoProvider({ config: neoConfig(), fetchImpl: fixture.fetchImpl });
  const result = await provider.refreshCheckpoints();
  const refreshCalls = fixture.calls.slice(0, 4);

  assert.deepEqual(refreshCalls.map((call) => `${call.method} ${call.endpoint}`), [
    "POST refresh-checkpoints",
    "GET options",
    "GET sd-models",
    "GET sd-modules"
  ]);
  assert.equal(fixture.calls.filter((call) => call.endpoint === "refresh-checkpoints").length, 1);
  assert.deepEqual(result.checkpoints.map((checkpoint) => checkpoint.title), ["oneObsessionAnima_v30.safetensors"]);
  assert.equal(result.activeCheckpoint, "oneObsessionAnima_v30.safetensors");
});

test("Forge NeoのCheckpoint不一致だけが固定identifierでoptions POSTされる", async () => {
  const fixture = createNeoFetch({
    options: {
      sd_model_checkpoint: "other.safetensors",
      forge_preset: "anima",
      forge_additional_modules: [
        "qwen_image_vae.safetensors",
        "oneObsessionAnima_v30_txt.safetensors"
      ]
    },
    models: [{
      title: "sd\\oneObsessionAnima_v30.safetensors [ed32d6584f]",
      model_name: "sd_oneObsessionAnima_v30",
      filename: "C:\\neo\\models\\oneObsessionAnima_v30.safetensors"
    }],
    modules: [
      { model_name: "qwen_image_vae.safetensors", filename: "C:\\neo\\models\\qwen_image_vae.safetensors" },
      { model_name: "oneObsessionAnima_v30_txt.safetensors", filename: "C:\\neo\\models\\oneObsessionAnima_v30_txt.safetensors" }
    ]
  });
  const provider = createForgeNeoProvider({ config: neoConfig(), fetchImpl: fixture.fetchImpl });
  await provider.prepareGeneration();
  const posts = fixture.calls.filter((call) => call.endpoint === "options" && call.method === "POST");
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.sd_model_checkpoint, "sd_oneObsessionAnima_v30");
  assert.doesNotMatch(posts[0].body.sd_model_checkpoint, /\[[0-9a-f]+\]$/i);
  assert.doesNotMatch(posts[0].body.sd_model_checkpoint, /[\\/]/);
});

test("Forge Neo managed-optionsはCheckpoint・preset・全required modulesを1回で反映し再検証する", async () => {
  const fixture = baseNeoFixture({
    sd_model_checkpoint: "other.safetensors",
    forge_preset: "other",
    forge_additional_modules: []
  });
  const provider = createForgeNeoProvider({ config: neoConfig(), fetchImpl: fixture.fetchImpl });
  await provider.prepareGeneration();
  const optionPosts = fixture.calls.filter((call) => call.endpoint === "options" && call.method === "POST");
  assert.equal(optionPosts.length, 1);
  assert.deepEqual(optionPosts[0].body, {
    sd_model_checkpoint: "oneObsessionAnima_v30",
    forge_preset: "anima",
    forge_additional_modules: [
      "qwen_image_vae.safetensors",
      "oneObsessionAnima_v30_txt.safetensors"
    ]
  });
  assert.deepEqual(Object.keys(optionPosts[0].body), [
    "sd_model_checkpoint",
    "forge_preset",
    "forge_additional_modules"
  ]);
  const postIndex = fixture.calls.indexOf(optionPosts[0]);
  assert.ok(fixture.calls.slice(0, postIndex).some((call) => call.endpoint === "sd-modules"));
  assert.equal(fixture.calls.at(-1).endpoint, "options");
});

test("Forge Neo preloadedと固定Checkpoint allowlistは推測POSTや任意Checkpointを許可しない", async () => {
  const fixture = baseNeoFixture({ forge_preset: "other" });
  const provider = createForgeNeoProvider({
    config: neoConfig({ activationMode: "preloaded" }),
    fetchImpl: fixture.fetchImpl
  });
  await assert.rejects(provider.prepareGeneration(), (error) => error.apiCode === "NEO_ANIMA_ACTIVATION_FAILED");
  assert.equal(fixture.calls.some((call) => call.endpoint === "options" && call.method === "POST"), false);
  await assert.rejects(
    provider.resolveV1Checkpoint("other.safetensors"),
    (error) => error.apiCode === "RUNTIME_CHECKPOINT_NOT_ALLOWED"
  );
});

test("Forge Neoのrequired module不足はtxt2img前に安全に失敗する", async () => {
  const fixture = baseNeoFixture();
  fixture.fetchImpl = createNeoFetch({
    options: fixture.getOptions(),
    models: [{ title: "oneObsessionAnima_v30.safetensors" }],
    modules: [{ name: "qwen_image_vae.safetensors" }]
  }).fetchImpl;
  const provider = createForgeNeoProvider({ config: neoConfig(), fetchImpl: fixture.fetchImpl });
  await assert.rejects(provider.prepareGeneration(), (error) => error.apiCode === "NEO_ANIMA_MODULE_NOT_FOUND");
});

test("Forge Neo txt2imgは候補を逐次送信し、absolute module pathを公開しない", async () => {
  const fixture = baseNeoFixture();
  const provider = createForgeNeoProvider({ config: neoConfig(), fetchImpl: fixture.fetchImpl });
  const result = await provider.generateImages({
    mode: "txt2img",
    prompt: "1girl",
    negativePrompt: "lowres",
    width: 512,
    height: 512,
    steps: 8,
    cfgScale: 5,
    seed: 10,
    samplerName: "Euler a",
    scheduler: "Automatic",
    candidateCount: 2
  });
  assert.equal(result.images.length, 2);
  assert.deepEqual(result.images.map((image) => image.seed), [10, 11]);
  assert.equal(fixture.calls.filter((call) => call.endpoint === "txt2img").length, 2);
  assert.doesNotMatch(JSON.stringify(await provider.listCheckpoints()), /C:\\\\neo/);
});

test("Forge Neo txt2imgの長時間transportは遅延headerを設定timeout内で待ち、payloadを維持する", async (t) => {
  let receivedBody;
  const url = await startNeoHttpServer(t, (app) => {
    app.post("/sdapi/v1/txt2img", (request, response) => {
      receivedBody = request.body;
      setTimeout(() => response.json({
        images: [`data:image/png;base64,${ONE_PIXEL_PNG}`],
        info: JSON.stringify({ seed: request.body.seed })
      }), 150);
    });
  });
  const provider = createForgeNeoProvider({ config: neoConfig({ url, timeoutMs: 1_000 }) });
  const startedAt = Date.now();
  const result = await provider.generateImages({
    mode: "txt2img", prompt: "1girl", negativePrompt: "lowres", width: 512, height: 768,
    steps: 12, cfgScale: 4, seed: 42, samplerName: "Euler a", scheduler: "Automatic",
    candidateCount: 1
  });

  assert.ok(Date.now() - startedAt >= 125, "response headerを待たずに完了してはならない");
  assert.equal(result.images[0].seed, 42);
  assert.deepEqual(receivedBody, {
    prompt: "1girl",
    negative_prompt: "lowres",
    width: 512,
    height: 768,
    steps: 12,
    cfg_scale: 4,
    seed: 42,
    sampler_name: "Euler a",
    scheduler: "Automatic",
    batch_size: 1,
    n_iter: 1,
    do_not_save_grid: true,
    save_images: true
  });
});

test("Forge Neo txt2imgの長時間transportは明示timeoutをRUNTIME_TIMEOUTへ写像する", async (t) => {
  const url = await startNeoHttpServer(t, (app) => {
    app.post("/sdapi/v1/txt2img", () => {});
  });
  const provider = createForgeNeoProvider({ config: neoConfig({ url, timeoutMs: 1_000 }) });
  await assert.rejects(provider.generateImages({
    mode: "txt2img", prompt: "timeout", negativePrompt: "", width: 512, height: 512,
    steps: 8, cfgScale: 4, seed: 1, samplerName: "Euler a", scheduler: "Automatic",
    candidateCount: 1
  }), (error) => error.apiCode === "RUNTIME_TIMEOUT" && error.statusCode === 504);
});

test("Forge Neo txt2imgの長時間transportはcancel時にrequestを破棄しinterruptを1回だけ送る", async (t) => {
  let txt2imgStarted = false;
  let txt2imgClosed = false;
  let interruptCount = 0;
  const url = await startNeoHttpServer(t, (app) => {
    app.post("/sdapi/v1/txt2img", (request) => {
      txt2imgStarted = true;
      request.once("close", () => { txt2imgClosed = true; });
    });
    app.post("/sdapi/v1/interrupt", (_request, response) => {
      interruptCount += 1;
      response.json({ ok: true });
    });
  });
  const provider = createForgeNeoProvider({ config: neoConfig({ url, timeoutMs: 5_000 }) });
  const controller = new AbortController();
  const pending = provider.generateImages({
    mode: "txt2img", prompt: "cancel", negativePrompt: "", width: 512, height: 512,
    steps: 8, cfgScale: 4, seed: 1, samplerName: "Euler a", scheduler: "Automatic",
    candidateCount: 1
  }, { signal: controller.signal });
  while (!txt2imgStarted) await new Promise((resolve) => setTimeout(resolve, 1));
  controller.abort();
  await assert.rejects(pending, (error) => error?.name === "AbortError");
  const deadline = Date.now() + 1_000;
  while ((!txt2imgClosed || interruptCount !== 1) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(txt2imgClosed, true);
  assert.equal(interruptCount, 1);
});

test("Forge Neo txt2imgの長時間transportは非2xxと不正JSONを安全なruntime errorへ写像する", async (t) => {
  const url = await startNeoHttpServer(t, (app) => {
    app.post("/sdapi/v1/txt2img", (request, response) => {
      if (request.body.prompt === "bad-status") response.status(500).send("internal secret");
      else response.type("application/json").send("not-json");
    });
  });
  const provider = createForgeNeoProvider({ config: neoConfig({ url, timeoutMs: 1_000 }) });
  const generate = (prompt) => provider.generateImages({
    mode: "txt2img", prompt, negativePrompt: "", width: 512, height: 512,
    steps: 8, cfgScale: 4, seed: 1, samplerName: "Euler a", scheduler: "Automatic",
    candidateCount: 1
  });
  await assert.rejects(generate("bad-status"), (error) => error.apiCode === "RUNTIME_UNAVAILABLE"
    && error.statusCode === 503 && !error.message.includes("secret"));
  await assert.rejects(generate("bad-json"), (error) => error.apiCode === "RUNTIME_UNAVAILABLE"
    && error.statusCode === 503 && !error.message.includes("not-json"));
});

test("Forge Neoのcancelは生成requestの中断とinterruptへ接続し、独自retryを行わない", async () => {
  const fixture = baseNeoFixture();
  const baseFetch = fixture.fetchImpl;
  fixture.fetchImpl = async (url, request = {}) => {
    if (new URL(url).pathname.endsWith("/txt2img")) {
      fixture.calls.push({ endpoint: "txt2img", method: request.method ?? "GET", body: null });
      return new Promise((_resolve, reject) => {
        request.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    }
    return baseFetch(url, request);
  };
  const provider = createForgeNeoProvider({ config: neoConfig(), fetchImpl: fixture.fetchImpl });
  const controller = new AbortController();
  const pending = provider.generateImages({
    mode: "txt2img", prompt: "1girl", negativePrompt: "", width: 512, height: 512,
    steps: 8, cfgScale: 5, seed: 1, samplerName: "Euler a", scheduler: "Automatic", candidateCount: 1
  }, { signal: controller.signal });
  while (!fixture.calls.some((call) => call.endpoint === "txt2img")) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  controller.abort();
  await assert.rejects(pending, (error) => error?.name === "AbortError");
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(fixture.calls.filter((call) => call.endpoint === "interrupt" && call.method === "POST").length, 1);
  assert.equal(fixture.calls.filter((call) => call.endpoint === "txt2img").length, 1);
});

test("Runtime registryとHistory detailはsafe DTOを返し、旧HistoryはReForge扱いにできる", async (t) => {
  const fixture = baseNeoFixture();
  const config = {
    reforge: { url: "http://mock-reforge" },
    runtimes: { default: "forge-neo-anima", forgeNeoAnima: neoConfig() }
  };
  const registry = createGenerationRuntimeRegistry({ config, fetchImpl: fixture.fetchImpl });
  assert.equal(registry.defaultRuntimeId, "forge-neo-anima");
  assert.throws(() => registry.resolve("unknown-runtime"), (error) => error.apiCode === "RUNTIME_NOT_FOUND");
  const descriptor = registry.listDescriptors().find((item) => item.id === "forge-neo-anima");
  assert.deepEqual(Object.keys(descriptor).sort(), ["available", "features", "id", "label", "provider", "supportedModes"]);
  assert.equal("url" in descriptor, false);

  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "local-image-chat-task20-history-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  const history = createHistoryService(dataDir);
  const stored = await history.addGeneration({
    prompt: "1girl",
    runtime: {
      id: "forge-neo-anima",
      provider: "forge-neo",
      url: "http://127.0.0.1:7861",
      absolutePath: "C:\\neo"
    },
    images: [{ id: "task20-image", seed: 1 }]
  });
  const detail = serializeHistoryGeneration(stored, { includeDerivation: true });
  assert.deepEqual(detail.runtime, { id: "forge-neo-anima", provider: "forge-neo" });
  assert.doesNotMatch(JSON.stringify(detail), /127\.0\.0\.1|C:\\|absolutePath/);
  assert.equal(serializeHistoryGeneration({ id: "old", images: [] }, { includeDerivation: true }).runtime, null);
});

test("Generation RuntimeはNeoのactivation失敗時にtxt2imgとHistory保存を行わず、成功時はruntime metadataを保存する", async (t) => {
  const fixture = baseNeoFixture();
  const config = {
    reforge: { url: "http://mock-reforge" },
    lora: { defaultWeight: 0.7, maxSelected: 4 },
    defaults: {
      width: 512, height: 512, steps: 8, cfgScale: 5,
      samplerName: "Euler a", scheduler: "Automatic", noiseSchedule: "Automatic", candidateCount: 1
    },
    runtimes: { default: "forge-neo-anima", forgeNeoAnima: neoConfig() }
  };
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "local-image-chat-task20-runtime-"));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const records = [];
  const history = {
    async addGeneration(input) {
      const generation = { ...input, id: "task20-generation" };
      records.push(generation);
      return generation;
    }
  };
  const registry = createGenerationRuntimeRegistry({ config, fetchImpl: fixture.fetchImpl });
  const runtime = createGenerationRuntime({
    config,
    runtimeRegistry: registry,
    history,
    thumbnails: { ensure: async () => {} },
    outputDir: workspace,
    createPrompt: async () => ({ prompt: "mock", negative_prompt: "", explanation_ja: "mock" }),
    unloadOllama: async () => {}
  });
  const jobs = createJobManager(runtime.executeWithRecovery);
  const service = createGenerationService({ jobs, runtime, runtimeRegistry: registry, config, history });
  const job = await service.createV1Job({
    runtimeId: "forge-neo-anima",
    prompt: { rawOverride: "1girl" },
    settings: { width: 512, height: 512, steps: 8, cfgScale: 5, candidateCount: 1 }
  });
  while (jobs.get(job.id).status === "queued" || jobs.get(job.id).status === "running") {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(jobs.get(job.id).status, "done");
  assert.equal(records[0].runtime.id, "forge-neo-anima");
  assert.equal(fixture.calls.filter((call) => call.endpoint === "txt2img").length, 1);
});

test("Forge Neoの同期legacy APIも既存JobManager内でprepare/options/txt2imgを直列化する", async () => {
  const events = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  let executionCount = 0;
  const descriptor = {
    id: "forge-neo-anima",
    label: "Forge Neo / Anima",
    provider: "forge-neo",
    available: true,
    supportedModes: ["txt2img"],
    features: { txt2img: true, img2img: false, inpaint: false, hires: false, ipAdapter: false }
  };
  const provider = {
    descriptor,
    validateRequest({ mode }) {
      if (mode !== "txt2img") throw new Error("unsupported");
    }
  };
  const registry = {
    resolve: () => provider,
    defaultRuntimeId: "forge-neo-anima",
    listDescriptors: () => [descriptor]
  };
  const runtime = {
    registry,
    async execute(payload) {
      const label = payload.prompt;
      events.push(`prepare:${label}`);
      if (executionCount++ === 0) await firstGate;
      events.push(`options:${label}`);
      events.push(`txt2img:${label}`);
      return { generationId: `generation-${label}`, images: [] };
    }
  };
  const jobs = createJobManager(runtime.execute);
  const service = createGenerationService({
    jobs,
    runtime,
    runtimeRegistry: registry,
    config: { reforge: {}, defaults: {}, lora: {} },
    history: { listPage: async () => ({ generations: [], limit: 20, total: 0, nextCursor: null, hasMore: false }) }
  });

  const first = service.generateLegacyNow({
    runtimeId: "forge-neo-anima", mode: "txt2img", prompt: "first", settings: { candidateCount: 1 }
  });
  while (events.length < 1) await new Promise((resolve) => setTimeout(resolve, 1));
  const second = service.generateLegacyNow({
    runtimeId: "forge-neo-anima", mode: "txt2img", prompt: "second", settings: { candidateCount: 1 }
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(events, ["prepare:first"]);

  releaseFirst();
  assert.deepEqual(await first, { generationId: "generation-first", images: [] });
  assert.deepEqual(await second, { generationId: "generation-second", images: [] });
  assert.deepEqual(events, [
    "prepare:first", "options:first", "txt2img:first",
    "prepare:second", "options:second", "txt2img:second"
  ]);
});

test("Forge Neoの同期legacy APIはcancel／failed時にresponse待機を残さない", async () => {
  const started = [];
  const descriptor = {
    id: "forge-neo-anima", label: "Forge Neo / Anima", provider: "forge-neo", available: true,
    supportedModes: ["txt2img"],
    features: { txt2img: true, img2img: false, inpaint: false, hires: false, ipAdapter: false }
  };
  const provider = { descriptor, validateRequest() {} };
  const registry = { resolve: () => provider, defaultRuntimeId: "forge-neo-anima", listDescriptors: () => [descriptor] };
  const runtime = {
    registry,
    execute: async (payload, { signal } = {}) => {
      started.push(payload.prompt);
      if (payload.prompt === "failed") throw new Error("mock failed");
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    }
  };
  const jobs = createJobManager(runtime.execute);
  const service = createGenerationService({
    jobs,
    runtime,
    runtimeRegistry: registry,
    config: { reforge: {}, defaults: {}, lora: {} },
    history: { listPage: async () => ({ generations: [], limit: 20, total: 0, nextCursor: null, hasMore: false }) }
  });
  const controller = new AbortController();
  const cancelled = service.generateLegacyNow(
    { runtimeId: "forge-neo-anima", mode: "txt2img", prompt: "cancel", settings: { candidateCount: 1 } },
    { signal: controller.signal }
  );
  while (!started.includes("cancel")) await new Promise((resolve) => setTimeout(resolve, 1));
  controller.abort();
  await assert.rejects(cancelled, (error) => error.name === "AbortError");
  await assert.rejects(
    service.generateLegacyNow({
      runtimeId: "forge-neo-anima", mode: "txt2img", prompt: "failed", settings: { candidateCount: 1 }
    }),
    /mock failed/
  );
});

test("Forge Neoのtxt2img接続失敗はJob failedとなりHistoryを追加しない", async (t) => {
  const failures = [
    ["connection reset", "ECONNRESET"],
    ["connection refused", "ECONNREFUSED"],
    ["malformed JSON", "MALFORMED"],
    ["timeout", "TIMEOUT"]
  ];
  for (const [label, kind] of failures) {
    const fixture = baseNeoFixture();
    const baseFetch = fixture.fetchImpl;
    fixture.fetchImpl = async (url, request = {}) => {
      const endpoint = new URL(url).pathname.split("/").at(-1);
      if (endpoint === "txt2img") {
        fixture.calls.push({ endpoint, method: request.method ?? "GET", body: null });
        if (kind === "MALFORMED") return new Response("{", {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
        const error = new Error(label);
        if (kind === "TIMEOUT") error.name = "TimeoutError";
        else error.code = kind;
        throw error;
      }
      return baseFetch(url, request);
    };
    const harness = await createNeoJobHarness(t, fixture.fetchImpl);
    const job = harness.service.createLegacyJob({
      runtimeId: "forge-neo-anima",
      mode: "txt2img",
      prompt: "1girl",
      autoRetry: false,
      settings: { width: 512, height: 512, steps: 8, cfgScale: 5, candidateCount: 1 }
    });
    const terminal = await waitForTerminalJob(harness.jobs, job.id);
    assert.equal(terminal.status, "failed", label);
    assert.equal(harness.records.length, 0, label);
    assert.equal(fixture.calls.filter((call) => call.endpoint === "txt2img").length, 1, label);
    assert.match(terminal.error, /Forge Neo/, label);
    assert.doesNotMatch(terminal.error, /ReForge/, label);
    if (terminal.recovery) assert.match(terminal.recovery.reason, /Forge Neo/, label);
  }
});

test("ReForgeの接続失敗文言とrecoveryは既存のまま維持する", async () => {
  const harness = await createRecoveryFailureHarness("reforge", "ReForge", "fetch failed");
  const job = harness.service.createLegacyJob({
    mode: "txt2img",
    prompt: "1girl",
    autoRetry: false,
    settings: { width: 512, height: 512, steps: 8, cfgScale: 5, candidateCount: 1 }
  });
  const terminal = await waitForTerminalJob(harness.jobs, job.id);
  assert.equal(terminal.status, "failed");
  assert.match(terminal.error, /ReForgeとの接続が切れました/);
  assert.doesNotMatch(terminal.error, /Forge Neo/);
  assert.match(terminal.recovery?.reason ?? "", /ReForgeとの接続が切れました/);
});

test("Forge Neoのactivation失敗はtxt2imgとHistory保存を行わず、preloaded一致時はoptions POSTなしで生成する", async (t) => {
  const mismatch = baseNeoFixture({ forge_preset: "wrong" });
  const mismatchBaseFetch = mismatch.fetchImpl;
  mismatch.fetchImpl = async (url, request = {}) => {
    if (new URL(url).pathname.endsWith("/options") && request.method === "POST") {
      const body = request.body ? JSON.parse(request.body) : null;
      mismatch.calls.push({ endpoint: "options", method: "POST", body });
      return jsonResponse({ ok: true });
    }
    return mismatchBaseFetch(url, request);
  };
  const failedHarness = await createNeoJobHarness(t, mismatch.fetchImpl);
  const failedJob = failedHarness.service.createLegacyJob({
    runtimeId: "forge-neo-anima",
    mode: "txt2img",
    prompt: "1girl",
    autoRetry: false,
    settings: { width: 512, height: 512, steps: 8, cfgScale: 5, candidateCount: 1 }
  });
  const failed = await waitForTerminalJob(failedHarness.jobs, failedJob.id);
  assert.equal(failed.status, "failed");
  assert.equal(failedHarness.records.length, 0);
  assert.equal(mismatch.calls.filter((call) => call.endpoint === "txt2img").length, 0);

  const preloaded = baseNeoFixture();
  const preloadedHarness = await createNeoJobHarness(
    t,
    preloaded.fetchImpl,
    neoConfig({ activationMode: "preloaded" })
  );
  const preloadedJob = preloadedHarness.service.createLegacyJob({
    runtimeId: "forge-neo-anima",
    mode: "txt2img",
    prompt: "1girl",
    settings: { width: 512, height: 512, steps: 8, cfgScale: 5, candidateCount: 1 }
  });
  const done = await waitForTerminalJob(preloadedHarness.jobs, preloadedJob.id);
  assert.equal(done.status, "done");
  assert.equal(preloaded.calls.filter((call) => call.endpoint === "options" && call.method === "POST").length, 0);
  assert.equal(preloaded.calls.filter((call) => call.endpoint === "txt2img").length, 1);
});

test("API v1のRuntime unknown／disabled／unsupported／Checkpoint mismatchは安全な4xx系DTOになる", async (t) => {
  async function startApi(config, fetchImpl) {
    const registry = createGenerationRuntimeRegistry({ config, fetchImpl });
    const runtime = { registry, execute: async () => ({}) };
    const jobs = createJobManager(runtime.execute);
    const service = createGenerationService({
      jobs,
      runtime,
      runtimeRegistry: registry,
      config,
      history: {
        async listPage() {
          return { generations: [], limit: 20, total: 0, nextCursor: null, hasMore: false };
        }
      }
    });
    const app = express();
    app.use(express.json());
    app.use("/api/v1", createV1Router({ generationService: service }));
    app.use(createV1ErrorMiddleware());
    const server = await new Promise((resolve) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    t.after(() => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }));
    return `http://127.0.0.1:${server.address().port}`;
  }

  async function post(baseUrl, body) {
    const response = await fetch(`${baseUrl}/api/v1/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
  }

  const common = {
    reforge: { url: "http://mock-reforge" },
    lora: { defaultWeight: 0.7, maxSelected: 4 },
    defaults: { width: 512, height: 512, steps: 8, cfgScale: 5, samplerName: "Euler a", scheduler: "Automatic" }
  };
  const unknownBase = await startApi(common, baseNeoFixture().fetchImpl);
  const unknown = await post(unknownBase, {
    runtimeId: "missing-runtime", prompt: { rawOverride: "1girl" }
  });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error.code, "RUNTIME_NOT_FOUND");

  const disabledFixture = baseNeoFixture();
  const disabledBase = await startApi({
    ...common,
    runtimes: { forgeNeoAnima: neoConfig({ enabled: false }) }
  }, disabledFixture.fetchImpl);
  const disabled = await post(disabledBase, {
    runtimeId: "forge-neo-anima", prompt: { rawOverride: "1girl" }
  });
  assert.equal(disabled.status, 503);
  assert.equal(disabled.body.error.code, "RUNTIME_UNAVAILABLE");

  const enabledFixture = baseNeoFixture();
  const enabledConfig = { ...common, runtimes: { forgeNeoAnima: neoConfig() } };
  const enabledBase = await startApi(enabledConfig, enabledFixture.fetchImpl);
  const unsupported = await post(enabledBase, {
    runtimeId: "forge-neo-anima", mode: "img2img", prompt: { rawOverride: "1girl" }
  });
  assert.equal(unsupported.status, 400);
  assert.equal(unsupported.body.error.code, "RUNTIME_MODE_NOT_SUPPORTED");

  const mismatch = await post(enabledBase, {
    runtimeId: "forge-neo-anima",
    prompt: { rawOverride: "1girl" },
    settings: { checkpoint: "other.safetensors" }
  });
  assert.equal(mismatch.status, 400);
  assert.equal(mismatch.body.error.code, "RUNTIME_CHECKPOINT_NOT_ALLOWED");
});

test("MCPのruntimeIdはcapabilities／generate／regenerateのHTTP契約を壊さずoptionalに渡せる", async () => {
  assert.equal(capabilitiesInputSchema.safeParse({}).success, true);
  assert.equal(capabilitiesInputSchema.safeParse({ runtimeId: "forge-neo-anima" }).success, true);
  assert.equal(capabilitiesInputSchema.safeParse({ runtimeId: "http://127.0.0.1" }).success, false);
  const requests = [];
  const client = createLocalImageChatClient({
    baseUrl: "http://mock-backend",
    fetchImpl: async (url, request = {}) => {
      requests.push({ url: String(url), method: request.method ?? "GET", body: request.body ?? null });
      const pathname = new URL(url).pathname;
      if (pathname.endsWith("/generations") && request.method === "POST") {
        return jsonResponse({ id: "job-12345678", status: "queued" });
      }
      if (pathname.endsWith("/regenerations") && request.method === "POST") {
        return jsonResponse({ id: "job-87654321", status: "queued" });
      }
      return jsonResponse({
        checkpoints: [],
        samplers: [],
        schedulers: [],
        loras: [],
        defaults: {}
      });
    }
  });
  await client.getCapabilities("forge-neo-anima");
  assert.equal(new URL(requests[0].url).searchParams.get("runtimeId"), "forge-neo-anima");
  await client.createGeneration({ runtimeId: "forge-neo-anima", prompt: { rawOverride: "1girl" } });
  await client.createRegeneration("history-12345678", {
    runtimeId: "forge-neo-anima",
    sourceImageId: "image-12345678",
    prompt: { rawOverride: "1girl" }
  });
  const generationRequest = requests.find((request) => request.url.endsWith("/api/v1/generations"));
  const regenerationRequest = requests.find((request) => request.url.endsWith("/api/v1/history/history-12345678/regenerations"));
  assert.equal(JSON.parse(generationRequest.body).runtimeId, "forge-neo-anima");
  assert.equal(JSON.parse(regenerationRequest.body).runtimeId, "forge-neo-anima");
});

test("MCP History detailのruntimeは{id,provider}だけを受け付ける", async () => {
  const baseHistory = {
    id: "history-12345678",
    prompt: {},
    settings: {},
    loras: [],
    images: [],
    runtime: { id: "forge-neo-anima", provider: "forge-neo" }
  };
  const validClient = createLocalImageChatClient({
    baseUrl: "http://mock-backend",
    fetchImpl: async () => jsonResponse(baseHistory)
  });
  const valid = await validClient.getHistoryItem("history-12345678");
  assert.deepEqual(valid.runtime, { id: "forge-neo-anima", provider: "forge-neo" });

  for (const runtime of [
    { id: "forge-neo-anima", provider: "forge-neo", url: "http://127.0.0.1:7861" },
    { id: "forge-neo-anima", provider: "forge-neo", absolutePath: "C:\\neo" },
    { id: "forge-neo-anima", provider: "forge-neo", extra: true },
    "forge-neo-anima"
  ]) {
    const client = createLocalImageChatClient({
      baseUrl: "http://mock-backend",
      fetchImpl: async () => jsonResponse({ ...baseHistory, runtime })
    });
    await assert.rejects(
      client.getHistoryItem("history-12345678"),
      (error) => error.code === "LOCAL_IMAGE_CHAT_INVALID_RESPONSE"
    );
  }
});

test("MCPのgenerate_image／regenerate_imageはruntimeIdをBackendへ渡す", async () => {
  const calls = { generate: [], regenerate: [] };
  const client = {
    getCapabilities: async () => ({}),
    createGeneration: async (request) => {
      calls.generate.push(request);
      return { id: "job-12345678", status: "queued" };
    },
    getGeneration: async () => ({}),
    cancelGeneration: async () => ({}),
    getHistory: async () => ({}),
    getHistoryItem: async () => ({}),
    createRegeneration: async (historyId, request) => {
      calls.regenerate.push({ historyId, request });
      return { id: "job-87654321", status: "queued" };
    },
    getImage: async () => ({})
  };
  const server = createMcpServer({ client });
  await server._registeredTools.generate_image.handler({
    runtimeId: "forge-neo-anima",
    prompt: { rawOverride: "1girl" }
  });
  await server._registeredTools.regenerate_image.handler({
    historyId: "history-12345678",
    sourceImageId: "image-12345678",
    runtimeId: "forge-neo-anima",
    prompt: { rawOverride: "1girl" }
  });
  assert.equal(calls.generate[0].runtimeId, "forge-neo-anima");
  assert.equal(calls.regenerate[0].request.runtimeId, "forge-neo-anima");
});

test("Task20 UIはRuntime切替完了後に履歴を復元し、生成元RuntimeでHiresを判定する", async () => {
  const app = await fs.readFile("public/app.js", "utf8");
  const loraLibrary = await fs.readFile("public/features/lora-library.js", "utf8");
  const runtimeController = await fs.readFile("public/core/runtime-service.js", "utf8")
    + await fs.readFile("public/features/runtime-controller.js", "utf8");
  const studio = await fs.readFile("public/features/studio-controller.js", "utf8");
  const historyController = await fs.readFile("public/features/history-controller.js", "utf8");
  const generationController = await fs.readFile("public/features/generation-controller.js", "utf8");
  const server = await fs.readFile("src/server.js", "utf8");
  assert.match(runtimeController, /let selectionToken = 0/);
  assert.match(runtimeController, /const isRuntimeContextCurrent = \(context\)/);
  assert.match(runtimeController, /if \(!isRuntimeContextCurrent\(context\)\) return false/);
  assert.match(runtimeController, /const runtimeApiUrl = \(pathname\)[\s\S]*?if \(!activeRuntimeId\) return pathname/);
  assert.match(runtimeController, /elements\.refreshCheckpointsButton\.addEventListener\("click", onRefresh\)/);
  assert.match(runtimeController, /async function refreshCheckpoints\(\)[\s\S]*?postJson\(runtimeApiUrl\("\/api\/checkpoints\/refresh"\)/);
  assert.match(runtimeController, /async function loadCheckpoints\(context = runtimeRequestContext\(\)\)[\s\S]*?getJson\(runtimeApiUrl\("\/api\/checkpoints"\)/);
  assert.doesNotMatch(runtimeController.match(/async function loadCheckpoints[\s\S]*?\n  \}/)?.[0] ?? "", /refresh-checkpoints/);
  assert.match(app, /const liveResponse = await fetch\("\/api\/runtimes"\)/);
  assert.match(runtimeController, /async function applyHealth\(health/);
  assert.match(runtimeController, /selectable: isRuntimeSelectable\(runtime\)/);
  assert.match(runtimeController, /option\.disabled = !runtime\.selectable/);
  assert.match(runtimeController, /\$\{label\}（未接続）/);
  assert.match(app, /await runtimeController\.applyHealth\(data\.runtimes, healthRequest\);[\s\S]*?if \(!runtimeController\.isHealthRequestCurrent\(healthRequest\)\) return false/);
  assert.match(app, /const runtimeText = runtimeHealth\?\.ok/);
  assert.match(app, /form: captureRuntimeFormState\(\)/);
  assert.match(app, /function captureRuntimeFormState\(\)[\s\S]*?candidateCount/);
  assert.match(app, /restoreRuntimeFormState\(snapshot\.form\)/);
  assert.match(app, /function restoreRuntimeFormState\(snapshot,[\s\S]*?promptDescription/);
  assert.match(server, /app\.get\("\/api\/runtimes", async/);
  assert.match(server, /const health = await runtimeRegistry\.healthAll\(\)/);
  assert.match(server, /runtimeRegistry\.listDescriptors\(\)\.map\(\(descriptor\) =>/);
  assert.match(server, /app\.get\("\/api\/health", async/);
  assert.match(server, /app\.post\("\/api\/checkpoints\/refresh", async/);
  assert.match(server, /typeof provider\.refreshCheckpoints === "function"/);
  assert.match(server, /reforge,/);
  assert.match(server, /response\.json\(\{ loras: await civitai\.mergeWithInstalled\(loras\) \}\)/);
  assert.match(server, /const loras = provider\.descriptor\.id === "reforge"[\s\S]*?typeof provider\.refreshLoras === "function"[\s\S]*?await provider\.refreshLoras\(\)/);
  assert.doesNotMatch(server, /Forge Neo \/ AnimaのLoRA再読込は対応していません/);
  assert.match(app, /function loadRecipeFields\(recipe, image\)[\s\S]*?recipeWorkflow\.load\(recipe, image\)/);
  const recipeRestore = app.match(/function loadRecipeFields\(recipe, image\)[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(recipeRestore, /\bactiveRuntimeId\b|\bruntimeOptions\b/);
  assert.match(app, /async function ensureRuntimeForRecipeDirect\(recipe\)[\s\S]*?return handleRuntimeChange\(target\.id\)/);
  assert.match(app, /function ensureRuntimeForRecipe\(recipe\)[\s\S]*?recipeWorkflow\.ensureRuntime\(recipe\)/);
  assert.match(app, /isHiresAvailable:[\s\S]*?runtimeForGeneration\(generation\)/);
  const candidate = studio.match(/function selectCandidate\([\s\S]*?\n  \}/)?.[0] ?? "";
  assert.match(candidate, /syncWorkflowAvailability\(\)/);
  assert.match(studio, /!isHiresAvailable\(lastGeneration\)/);
  const finish = generationController.match(/function finishSelected\([\s\S]*?\n  \}/)?.[0] ?? "";
  assert.match(finish, /readRuntimePayloadFor\(runtime\)/);
  const galleryHires = generationController.match(/function hiresFromGallery\([\s\S]*?\n  \}/)?.[0] ?? "";
  assert.match(galleryHires, /runtimeForGeneration\(generation\)/);
  assert.match(galleryHires, /readRuntimePayloadFor\(runtime\)/);
  const detail = historyController.match(/function openDetail\([\s\S]*?(?=\n  function createCopyButton)/)?.[0] ?? "";
  assert.match(detail, /const hiresAction = addAction\("Hiresする"/);
  assert.match(detail, /hiresAction\.disabled = !hiresAvailable/);
  assert.match(loraLibrary, /async function openPicker\(\)[\s\S]*?runtime\.getState\?\.\(\)\.switching/);
});
