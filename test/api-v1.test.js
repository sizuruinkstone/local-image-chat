import assert from "node:assert/strict";
import fs from "node:fs/promises";
import express from "express";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJobManager } from "../src/job-manager.js";
import { createGenerationRuntime, createGenerationService } from "../src/services/generation-service.js";
import { resolvePrompt } from "../src/services/prompt-service.js";
import { createV1ErrorMiddleware, createV1Router } from "../src/api/v1/router.js";

const config = {
  reforge: { url: "http://mock-reforge" },
  lora: { defaultWeight: 0.7, maxSelected: 4 },
  defaults: {
    width: 768,
    height: 768,
    steps: 20,
    cfgScale: 5,
    samplerName: "Euler a",
    scheduler: "Automatic",
    noiseSchedule: "Automatic",
    candidateCount: 1,
    hiresScale: 1.5,
    hiresSteps: 20,
    hiresDenoising: 0.4,
    hiresUpscaler: "Mock"
  }
};

const ONE_PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("Prompt Serviceはstructuredの順序・raw override・negativeを共通解決する", () => {
  assert.deepEqual(resolvePrompt({
    structured: {
      character: " character ",
      appearance: "appearance",
      composition: "composition",
      situation: "situation",
      style: "style",
      extra: "extra"
    },
    negative: " lowres, bad hands "
  }), {
    structured: {
      character: " character ",
      appearance: "appearance",
      composition: "composition",
      situation: "situation",
      style: "style",
      extra: "extra"
    },
    rawOverride: null,
    positive: "character, appearance, composition, situation, style, extra",
    negative: "lowres, bad hands",
    mode: "structured"
  });

  const raw = resolvePrompt({
    structured: { character: "ignored" },
    rawOverride: "  <lora:style:0.7>, (tag:1.2), duplicated, duplicated  ",
    negative: "  keep, order  "
  });
  assert.equal(raw.mode, "raw");
  assert.equal(raw.positive, "<lora:style:0.7>, (tag:1.2), duplicated, duplicated");
  assert.equal(raw.negative, "keep, order");
  assert.match(raw.positive, /duplicated, duplicated/);
});

test("Generation Serviceはv1 requestを既存JobManager用payloadへ変換しmetadata.clientを保持する", async () => {
  const executed = [];
  const jobs = createJobManager(async (payload) => {
    executed.push(payload);
    return {
      generationId: "generation-12345678",
      images: [{ id: "image-12345678", seed: 12, width: 768, height: 768 }]
    };
  });
  const runtime = {
    resolveV1Checkpoint: async (id) => ({
      id,
      title: id,
      modelName: "mock-model",
      hash: "abc123",
      active: false
    }),
    execute: async () => ({})
  };
  const service = createGenerationService({
    jobs,
    runtime,
    config,
    history: { listPage: async () => ({ generations: [], limit: 20, total: 0, nextCursor: null, hasMore: false }) },
    capabilityDependencies: {
      listLoras: async () => [{ name: "characters/example.safetensors", displayName: "example" }]
    }
  });

  const created = await service.createV1Job({
    mode: "txt2img",
    prompt: {
      structured: { character: "1girl", style: "masterpiece" },
      rawOverride: null,
      negative: "lowres"
    },
    settings: {
      checkpoint: "mock.safetensors",
      width: 768,
      height: 1280,
      steps: 30,
      cfgScale: 4,
      sampler: "Euler a",
      scheduler: "SGM Uniform",
      seed: -1,
      candidateCount: 1,
      hires: { enabled: false, scale: 1.5, steps: 20, denoising: 0.4, upscaler: "Mock" }
    },
    loras: [{ name: "characters/example.safetensors", weight: 0.7, enabled: true }],
    metadata: { client: "cli" }
  });
  await waitUntil(() => jobs.get(created.id).status === "done");

  assert.equal(executed.length, 1);
  assert.equal(executed[0].mode, "txt2img");
  assert.equal(executed[0].prompt, "1girl, masterpiece");
  assert.equal(executed[0].negativePrompt, "lowres");
  assert.deepEqual(executed[0].structuredPrompt, {
    character: "1girl",
    appearance: "",
    composition: "",
    situation: "",
    style: "masterpiece",
    extra: ""
  });
  assert.equal(executed[0].settings.samplerName, "Euler a");
  assert.equal(executed[0].settings.hiresEnabled, false);
  assert.equal(jobs.get(created.id).meta.client, "cli");
  assert.equal(executed[0].settings.checkpoint, "mock.safetensors");
});

test("旧Job経路のGeneration RuntimeはconfigのLoRA上限と既定Weightを使う", async (t) => {
  const harness = await createRuntimeHarness(t, {
    lora: { maxSelected: 2, defaultWeight: 0.85 }
  });
  const queued = harness.service.createLegacyJob({
    prompt: "1girl",
    negativePrompt: "",
    loras: [{ name: "alpha" }, { name: "beta" }, { name: "gamma" }],
    settings: { width: 512, height: 512, steps: 5, candidateCount: 1 }
  }, { kind: "generation", label: "legacy-test" });

  await waitUntil(() => harness.jobs.get(queued.id).status === "done");
  assert.equal(harness.requests.length, 1);
  assert.match(harness.requests[0].prompt, /<lora:alpha:0\.85>/);
  assert.match(harness.requests[0].prompt, /<lora:beta:0\.85>/);
  assert.doesNotMatch(harness.requests[0].prompt, /<lora:gamma:/);
  assert.equal(harness.history.records[0].loras.length, 2);
  assert.deepEqual(harness.history.records[0].loras.map((item) => item.weight), [0.85, 0.85]);
});

test("v1の非アクティブCheckpointはqueue実行時だけ切り替える", async (t) => {
  let releaseFirst;
  let firstStarted;
  const firstStartedPromise = new Promise((resolve) => {
    firstStarted = resolve;
  });
  const harness = await createRuntimeHarness(t, {
    generateImages: async (_reforgeConfig, request) => {
      if (request.prompt === "job-a") {
        firstStarted();
        await new Promise((resolve) => {
          releaseFirst = resolve;
        });
      }
      return { images: [{ base64: ONE_PIXEL_PNG, seed: 123 }] };
    }
  });
  t.after(() => releaseFirst?.());

  const jobA = await harness.service.createV1Job({
    prompt: { rawOverride: "job-a" }
  });
  await firstStartedPromise;
  const jobB = await harness.service.createV1Job({
    prompt: { rawOverride: "job-b" },
    settings: { checkpoint: "checkpoint-y" }
  });

  assert.equal(harness.jobs.get(jobB.id).status, "queued");
  assert.deepEqual(harness.switchCalls, [], "Bがqueuedの間はCheckpointを切り替えない");

  releaseFirst();
  await waitUntil(() => harness.jobs.get(jobB.id).status === "done");

  assert.deepEqual(harness.switchCalls, ["checkpoint-y"]);
  const requestB = harness.requests.find((request) => request.prompt === "job-b");
  assert.equal(requestB.checkpoint, "checkpoint-y");
  const historyB = harness.history.records.find((generation) => generation.prompt === "job-b");
  assert.equal(historyB.settings.checkpoint, "checkpoint-y");
  assert.equal(harness.jobs.get(jobA.id).status, "done");
});

test("Generation Serviceは空Prompt、非txt2img、危険な設定をAPI境界で拒否する", async () => {
  const jobs = createJobManager(async () => ({}));
  const service = createGenerationService({
    jobs,
    runtime: { resolveV1Checkpoint: async () => ({ id: "mock.safetensors", title: "mock.safetensors" }) },
    config,
    history: { listPage: async () => ({ generations: [], limit: 20, total: 0, nextCursor: null, hasMore: false }) }
  });

  await assert.rejects(
    service.createV1Job({ prompt: { structured: {} } }),
    (error) => error.apiCode === "INVALID_REQUEST"
  );
  await assert.rejects(
    service.createV1Job({ mode: "img2img", prompt: { rawOverride: "1girl" } }),
    (error) => error.apiCode === "UNSUPPORTED_MODE"
  );
  await assert.rejects(
    service.createV1Job({ prompt: { rawOverride: "1girl" }, settings: { width: 257 } }),
    (error) => error.apiCode === "INVALID_REQUEST"
  );
});

test("Generation Serviceのcancelは既存JobManagerのqueued状態を使う", async () => {
  let releaseFirst;
  let executionCount = 0;
  const jobs = createJobManager(async (_payload, { signal }) => {
    executionCount += 1;
    if (executionCount === 1) {
      await new Promise((resolve, reject) => {
        releaseFirst = resolve;
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }
    return {};
  });
  const service = createGenerationService({
    jobs,
    runtime: { resolveV1Checkpoint: async () => ({ id: "mock.safetensors", title: "mock.safetensors" }) },
    config,
    history: { listPage: async () => ({ generations: [], limit: 20, total: 0, nextCursor: null, hasMore: false }) }
  });
  const first = await service.createV1Job({ prompt: { rawOverride: "first" } });
  await waitUntil(() => jobs.get(first.id).status === "running");
  const second = await service.createV1Job({ prompt: { rawOverride: "second" } });
  const cancelled = service.cancelV1Job(second.id);
  assert.equal(cancelled.status, "cancelled");
  releaseFirst();
  await waitUntil(() => jobs.get(first.id).status === "done");
  assert.equal(jobs.get(second.id).status, "cancelled");
});

test("API v1の5 endpointは統一DTO、status、公開allowlistを使う", async (t) => {
  const jobs = createJobManager(async () => ({
    generationId: "generation-12345678",
    images: [{ id: "image-12345678", seed: 42, width: 768, height: 768, filename: "C:\\secret\\image.png" }]
  }));
  const service = createGenerationService({
    jobs,
    runtime: {
      resolveV1Checkpoint: async (id) => ({ id, title: id, modelName: "mock", hash: "hash", active: true })
    },
    config,
    history: {
      listPage: async () => ({
        generations: [{
          id: "generation-12345678",
          createdAt: "2026-08-09T00:00:00.000Z",
          title: "fixture",
          prompt: "1girl",
          effectivePrompt: "1girl",
          negativePrompt: "lowres",
          structuredPrompt: { character: "1girl" },
          rawPrompt: "",
          settings: {
            checkpoint: "C:\\secret\\model.safetensors",
            width: 768,
            height: 768,
            steps: 20,
            cfgScale: 5,
            samplerName: "Euler a",
            scheduler: "Automatic",
            seed: 42,
            checkpointFilename: "C:\\secret\\model.safetensors"
          },
          loras: [{ name: "example", weight: 0.7 }],
          images: [{ id: "image-12345678", filename: "C:\\secret\\image.png", seed: 42 }]
        }],
        limit: 20,
        total: 1,
        nextCursor: null,
        hasMore: false
      })
    },
    capabilityDependencies: {
      listCheckpoints: async () => ({
        activeCheckpoint: "mock.safetensors",
        checkpoints: [{ title: "mock.safetensors", modelName: "mock", filename: "C:\\secret\\model.safetensors", hash: "abc" }]
      }),
      listSamplers: async () => ({ samplers: ["Euler a"], schedulers: ["Automatic"] }),
      listLoras: async () => [{ name: "example", displayName: "example", path: "C:\\secret\\example.safetensors" }]
    }
  });
  const app = express();
  app.use(express.json());
  app.use("/api/v1", createV1Router({ generationService: service }));
  app.use(createV1ErrorMiddleware());
  const listener = await new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
  t.after(() => new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve())));
  const baseUrl = `http://127.0.0.1:${listener.address().port}`;

  const capabilities = await requestJson(`${baseUrl}/api/v1/capabilities`);
  assert.equal(capabilities.status, 200);
  assert.equal(capabilities.body.checkpoints[0].id, "mock.safetensors");
  assert.equal("filename" in capabilities.body.checkpoints[0], false);
  assert.equal("path" in capabilities.body.loras[0], false);
  assert.doesNotMatch(JSON.stringify(capabilities.body), /C:\\secret/);

  const accepted = await requestJson(`${baseUrl}/api/v1/generations`, {
    method: "POST",
    body: { prompt: { rawOverride: "  1girl  " }, metadata: { client: "mcp" } }
  });
  assert.equal(accepted.status, 202);
  assert.equal(accepted.body.status, "queued");
  await waitUntil(async () => (await requestJson(`${baseUrl}/api/v1/generations/${accepted.body.id}`)).body.status === "done");
  const done = await requestJson(`${baseUrl}/api/v1/generations/${accepted.body.id}`);
  assert.equal(done.status, 200);
  assert.equal(done.body.progress, 1);
  assert.equal(done.body.result.historyId, "generation-12345678");
  assert.equal(done.body.result.images[0].originalUrl, "/api/images/image-12345678/original");
  assert.equal("filename" in done.body.result.images[0], false);
  const terminalCancel = await requestJson(`${baseUrl}/api/v1/generations/${accepted.body.id}/cancel`, { method: "POST" });
  assert.equal(terminalCancel.status, 409);
  assert.equal(terminalCancel.body.error.code, "JOB_NOT_CANCELLABLE");

  const history = await requestJson(`${baseUrl}/api/v1/history`);
  assert.equal(history.status, 200);
  assert.equal(history.body.generations[0].settings.checkpoint, null);
  assert.equal("checkpointFilename" in history.body.generations[0].settings, false);
  assert.doesNotMatch(JSON.stringify(history.body), /C:\\secret/);

  const missing = await requestJson(`${baseUrl}/api/v1/generations/not_id`);
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error.code, "INVALID_REQUEST");
  const notFound = await requestJson(`${baseUrl}/api/v1/generations/not-an-id`);
  assert.equal(notFound.status, 404);
  assert.equal(notFound.body.error.code, "JOB_NOT_FOUND");
  const unknownRoute = await requestJson(`${baseUrl}/api/v1/no-such-route`);
  assert.equal(unknownRoute.status, 404);
  assert.equal(unknownRoute.body.error.code, "NOT_FOUND");
  const malformed = await fetch(`${baseUrl}/api/v1/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{"
  });
  const malformedBody = await malformed.json();
  assert.equal(malformed.status, 400);
  assert.equal(malformedBody.error.code, "INVALID_REQUEST");
});

async function createRuntimeHarness(t, options = {}) {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "local-image-chat-api-v1-"));
  t.after(() => fs.rm(outputDir, { recursive: true, force: true }));

  const harnessConfig = {
    ...config,
    lora: { ...config.lora, ...options.lora },
    defaults: { ...config.defaults }
  };
  const requests = [];
  const switchCalls = [];
  const records = [];
  let activeCheckpoint = "checkpoint-x";
  let generationIndex = 0;
  const checkpoints = [
    { title: "checkpoint-x", modelName: "mock-x", hash: "hash-x" },
    { title: "checkpoint-y", modelName: "mock-y", hash: "hash-y" }
  ];
  const listCheckpoints = options.listCheckpoints ?? (async () => ({
    activeCheckpoint,
    checkpoints
  }));
  const switchCheckpoint = async (reforgeConfig, checkpoint) => {
    switchCalls.push(checkpoint);
    activeCheckpoint = checkpoint;
    return options.switchCheckpoint?.(reforgeConfig, checkpoint) ?? { checkpoint };
  };
  const generateImages = async (reforgeConfig, request, context) => {
    requests.push(request);
    if (options.generateImages) return options.generateImages(reforgeConfig, request, context);
    return { images: [{ base64: ONE_PIXEL_PNG, seed: requests.length }] };
  };
  const history = {
    records,
    async addGeneration(input) {
      const generation = {
        ...input,
        id: `generation-${String(++generationIndex).padStart(8, "0")}`
      };
      records.push(generation);
      return generation;
    },
    async listPage() {
      return { generations: records, limit: 20, total: records.length, nextCursor: null, hasMore: false };
    }
  };
  const runtime = createGenerationRuntime({
    config: harnessConfig,
    history,
    thumbnails: { ensure: async () => {} },
    discord: null,
    outputDir,
    createPrompt: async () => ({
      prompt: "mock prompt",
      negative_prompt: "",
      explanation_ja: "mock"
    }),
    unloadOllama: async () => {},
    generateImages,
    listCheckpoints,
    switchCheckpoint
  });
  const jobs = createJobManager(runtime.executeWithRecovery);
  const service = createGenerationService({
    jobs,
    runtime,
    config: harnessConfig,
    history,
    capabilityDependencies: {
      listCheckpoints,
      listLoras: async () => []
    }
  });
  return { jobs, service, history, requests, switchCalls };
}

async function requestJson(url, { method = "GET", body } = {}) {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function waitUntil(predicate) {
  const startedAt = Date.now();
  while (!(await predicate())) {
    if (Date.now() - startedAt > 2000) throw new Error("test timeout");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
