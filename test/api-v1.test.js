import assert from "node:assert/strict";
import fs from "node:fs/promises";
import express from "express";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJobManager } from "../src/job-manager.js";
import { createGenerationRuntime, createGenerationService } from "../src/services/generation-service.js";
import { resolvePrompt } from "../src/services/prompt-service.js";
import { createReferenceAssetBodyParser } from "../src/api/v1/assets.js";
import { createV1ErrorMiddleware, createV1Router } from "../src/api/v1/router.js";
import {
  createReferenceAssetService,
  createReferenceImageResolver
} from "../src/reference-assets.js";

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

test("API v1のReference Asset importはraw bytesだけを受け、公開DTOへpathを出さない", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "local-image-chat-api-assets-"));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const referenceAssets = createReferenceAssetService({
    outputDir: path.join(workspace, "outputs"),
    dataDir: path.join(workspace, "data")
  });
  const app = express();
  app.use("/api/v1/assets/images", createReferenceAssetBodyParser());
  app.use(express.json());
  app.use("/api/v1", createV1Router({ generationService: {}, referenceAssets }));
  app.use(createV1ErrorMiddleware());
  const listener = await new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
  t.after(() => new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve())));
  const baseUrl = `http://127.0.0.1:${listener.address().port}`;
  const imageBytes = Buffer.from(ONE_PIXEL_PNG, "base64");

  const accepted = await fetch(`${baseUrl}/api/v1/assets/images`, {
    method: "POST",
    headers: { "Content-Type": "image/png" },
    body: imageBytes
  });
  const acceptedBody = await accepted.json();
  assert.equal(accepted.status, 201);
  assert.equal(acceptedBody.kind, "reference-asset");
  assert.equal(acceptedBody.mimeType, "image/png");
  assert.match(acceptedBody.id, /^asset-[a-z0-9-]+$/);
  assert.deepEqual(Object.keys(acceptedBody).sort(), [
    "byteLength", "createdAt", "height", "id", "kind", "mimeType",
    "originalUrl", "thumbnailUrl", "width"
  ]);
  assert.doesNotMatch(JSON.stringify(acceptedBody), /C:\\|source|filename|base64|outputs/);

  for (const request of [
    {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base64: imageBytes.toString("base64") })
    },
    {
      headers: { "Content-Type": "multipart/form-data; boundary=fixture" },
      body: "--fixture\r\nContent-Disposition: form-data; name=\"file\"\r\n\r\nnot-a-file\r\n--fixture--"
    },
    {
      headers: { "Content-Type": "image/gif" },
      body: imageBytes
    }
  ]) {
    const response = await fetch(`${baseUrl}/api/v1/assets/images`, { method: "POST", ...request });
    const body = await response.json();
    assert.ok([400, 415].includes(response.status));
    assert.match(body.error.code, /INVALID_REQUEST|UNSUPPORTED_IMAGE_TYPE/);
    assert.doesNotMatch(JSON.stringify(body), /C:\\|source|filename|base64|sharp|stack/i);
  }
});

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
  assert.equal(executed[0].contentRating, "general");

  const nsfw = await service.createV1Job({
    contentRating: "nsfw",
    prompt: { rawOverride: "explicit rating" },
    settings: { candidateCount: 1 }
  });
  await waitUntil(() => jobs.get(nsfw.id).status === "done");
  assert.equal(executed[1].contentRating, "nsfw");
  await assert.rejects(
    () => service.createV1Job({ contentRating: "unknown", prompt: { rawOverride: "invalid rating" } }),
    (error) => error?.apiCode === "INVALID_REQUEST"
  );
});

test("API v1の公開ipAdapterはstrictに正規化し、参照画像の存在をJob作成前に確認する", async (t) => {
  const executed = [];
  const jobs = createJobManager(async (payload) => {
    executed.push(payload);
    return {};
  });
  const referenceImageId = "image-reference1";
  const history = {
    async getImage(id) {
      if (id !== referenceImageId) throw new Error("指定された画像が履歴にありません");
      return { id, filename: "reference.png" };
    },
    async listPage() {
      return { generations: [], limit: 20, total: 0, nextCursor: null, hasMore: false };
    }
  };
  const service = createGenerationService({
    jobs,
    runtime: { resolveV1Checkpoint: async () => null },
    config,
    history
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

  const accepted = await requestJson(`${baseUrl}/api/v1/generations`, {
    method: "POST",
    body: {
      prompt: { rawOverride: "reference generation" },
      ipAdapter: { referenceImageId, weight: 0, guidanceStart: 0, guidanceEnd: 1 }
    }
  });
  assert.equal(accepted.status, 202);
  await waitUntil(() => jobs.get(accepted.body.id).status === "done");
  assert.deepEqual(executed[0].ipAdapter, {
    enabled: true,
    referenceImageId,
    weight: 0,
    guidanceStart: 0,
    guidanceEnd: 1
  });

  const upperBoundary = await service.createV1Job({
    prompt: { rawOverride: "reference upper boundary" },
    ipAdapter: { referenceImageId, weight: 2, guidanceStart: 0, guidanceEnd: 1 }
  });
  await waitUntil(() => jobs.get(upperBoundary.id).status === "done");
  assert.equal(executed[1].ipAdapter.weight, 2);

  const missing = await requestJson(`${baseUrl}/api/v1/generations`, {
    method: "POST",
    body: {
      prompt: { rawOverride: "missing reference" },
      ipAdapter: { referenceImageId: "image-missing1" }
    }
  });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, "REFERENCE_IMAGE_NOT_FOUND");
  assert.equal(executed.length, 2, "不存在参照画像ではJobを作成しない");

  for (const ipAdapter of [
    { referenceImageId, enabled: true },
    { referenceImageId, url: "https://outside.example/reference.png" },
    { referenceImageId, path: "C:\\secret\\reference.png" },
    { referenceImageId, base64: "AAAA" },
    { referenceImageId, weight: 2.1 },
    { referenceImageId, guidanceStart: 1, guidanceEnd: 1 },
    { referenceImageId, weight: "0.65" }
  ]) {
    await assert.rejects(
      service.createV1Job({ prompt: { rawOverride: "invalid reference" }, ipAdapter }),
      (error) => error.apiCode === "INVALID_REQUEST"
    );
  }
});

test("Task 18のasset imageはTask 17共通resolverからRuntime、ReForge、Historyへ接続する", async (t) => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "local-image-chat-api-reference-runtime-"));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const referenceAssets = createReferenceAssetService({
    outputDir: path.join(workspace, "outputs"),
    dataDir: path.join(workspace, "data")
  });
  const asset = await referenceAssets.importBuffer(Buffer.from(ONE_PIXEL_PNG, "base64"), {
    mimeType: "image/png"
  });
  const resolver = createReferenceImageResolver({
    history: { getImage: async () => { throw new Error("履歴resolverはasset testでは使わない"); } },
    referenceAssets,
    resolveOutputImagePath: (filename) => path.join(workspace, "outputs", filename)
  });
  const capability = {
    available: true,
    family: "sdxl",
    module: "CLIP-ViT-H (IPAdapter)",
    model: "ip-adapter-plus_sdxl_vit-h"
  };
  const harness = await createRuntimeHarness(t, {
    resolveReferenceImage: resolver,
    getIpAdapterOptions: async () => capability
  });
  const job = await harness.service.createV1Job({
    prompt: { rawOverride: "asset reference" },
    ipAdapter: { referenceImageId: asset.id, weight: 0.65, guidanceStart: 0, guidanceEnd: 1 }
  });
  await waitUntil(() => harness.jobs.get(job.id).status === "done");
  const request = harness.requests.at(-1);
  const normalizedBytes = await referenceAssets.readOriginalBuffer(asset.id);
  assert.equal(request.ipAdapter.referenceBase64, normalizedBytes.toString("base64"));
  assert.equal(harness.history.records.at(-1).ipAdapter.referenceImageId, asset.id);
  assert.equal(JSON.stringify(harness.history.records.at(-1).ipAdapter).includes(workspace), false);
  assert.equal(JSON.stringify(harness.history.records.at(-1).ipAdapter).includes("filename"), false);

  const unavailable = await createRuntimeHarness(t, {
    resolveReferenceImage: resolver,
    getIpAdapterOptions: async () => ({ available: false, message: "IP-Adapter unavailable" })
  });
  const unavailableJob = await unavailable.service.createV1Job({
    prompt: { rawOverride: "must fail" },
    ipAdapter: { referenceImageId: asset.id }
  });
  await waitUntil(() => ["failed", "done"].includes(unavailable.jobs.get(unavailableJob.id).status));
  assert.equal(unavailable.jobs.get(unavailableJob.id).status, "failed");
  assert.equal(unavailable.requests.length, 0);
  assert.equal(unavailable.history.records.length, 0);
});

test("API v1派生再生成のipAdapterは明示時だけpayloadへ入り、元History設定を継承しない", async () => {
  const executed = [];
  const jobs = createJobManager(async (payload) => {
    executed.push(payload);
    return {};
  });
  const source = {
    id: "history-reference1",
    mode: "txt2img",
    prompt: "source prompt",
    effectivePrompt: "source prompt",
    negativePrompt: "lowres",
    settings: { width: 512, height: 512, steps: 10, cfgScale: 4, seed: 7 },
    ipAdapter: {
      enabled: true,
      family: "sdxl",
      module: "CLIP-ViT-H (IPAdapter)",
      model: "ip-adapter-plus_sdxl_vit-h",
      referenceImageId: "image-original1",
      weight: 0.65,
      guidanceStart: 0,
      guidanceEnd: 1
    },
    loras: [],
    images: [{ id: "image-source1", seed: 7, width: 512, height: 512 }]
  };
  const referenceImageId = "image-reference1";
  const history = {
    async getGeneration(id) {
      return id === source.id ? structuredClone(source) : null;
    },
    async getImage(id) {
      if (id !== referenceImageId) throw new Error("指定された画像が履歴にありません");
      return { id, filename: "reference.png" };
    }
  };
  const service = createGenerationService({
    jobs,
    runtime: { resolveV1Checkpoint: async () => null },
    config,
    history
  });

  const explicit = await service.createV1Regeneration(source.id, {
    sourceImageId: "image-source1",
    ipAdapter: { referenceImageId, weight: 0.75, guidanceStart: 0, guidanceEnd: 0.9 }
  });
  await waitUntil(() => jobs.get(explicit.id).status === "done");
  assert.deepEqual(executed[0].ipAdapter, {
    enabled: true,
    referenceImageId,
    weight: 0.75,
    guidanceStart: 0,
    guidanceEnd: 0.9
  });

  const omitted = await service.createV1Regeneration(source.id, {
    sourceImageId: "image-source1"
  });
  await waitUntil(() => jobs.get(omitted.id).status === "done");
  assert.equal("ipAdapter" in executed[1], false, "省略時は元HistoryのIP-Adapterを継承しない");
});

test("API v1のipAdapterは実Generation Runtime、参照解決、History保存へ接続する", async (t) => {
  let capabilityAvailable = true;
  const capability = {
    available: true,
    family: "sdxl",
    module: "CLIP-ViT-H (IPAdapter)",
    model: "ip-adapter-plus_sdxl_vit-h",
    message: "利用できます"
  };
  const harness = await createRuntimeHarness(t, {
    getIpAdapterOptions: async () => capabilityAvailable
      ? capability
      : { ...capability, available: false, family: null, module: null, model: null, message: "mock unavailable" }
  });
  const fixture = Buffer.from(ONE_PIXEL_PNG, "base64");
  const sourceImageId = "image-runtime-source";
  const referenceImageId = "image-runtime-reference";
  const source = {
    id: "history-runtime-source",
    mode: "txt2img",
    prompt: "source prompt",
    effectivePrompt: "source prompt",
    negativePrompt: "",
    settings: {
      width: 512,
      height: 512,
      steps: 5,
      cfgScale: 5,
      samplerName: "Euler a",
      scheduler: "Automatic",
      seed: 11,
      candidateCount: 1,
      hiresEnabled: false,
      hiresScale: 1.5,
      hiresSteps: 5,
      hiresDenoising: 0.4,
      hiresUpscaler: "Mock"
    },
    loras: [],
    images: [{
      id: sourceImageId,
      seed: 11,
      width: 512,
      height: 512,
      filename: "runtime-source.png",
      imageUrl: "/outputs/runtime-source.png"
    }]
  };
  const reference = {
    id: "history-runtime-reference",
    mode: "txt2img",
    prompt: "reference prompt",
    effectivePrompt: "reference prompt",
    negativePrompt: "",
    settings: source.settings,
    loras: [],
    images: [{
      id: referenceImageId,
      seed: 12,
      width: 512,
      height: 512,
      filename: "runtime-reference.png",
      imageUrl: "/outputs/runtime-reference.png"
    }]
  };
  await Promise.all([
    fs.writeFile(path.join(harness.outputDir, source.images[0].filename), fixture),
    fs.writeFile(path.join(harness.outputDir, reference.images[0].filename), fixture)
  ]);
  harness.history.records.push(source, reference);

  const app = express();
  app.use(express.json());
  app.use("/api/v1", createV1Router({ generationService: harness.service }));
  app.use(createV1ErrorMiddleware());
  const listener = await new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
  t.after(() => new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve())));
  const baseUrl = `http://127.0.0.1:${listener.address().port}`;

  const accepted = await requestJson(`${baseUrl}/api/v1/generations`, {
    method: "POST",
    body: {
      prompt: { rawOverride: "runtime reference generation" },
      ipAdapter: { referenceImageId: sourceImageId }
    }
  });
  assert.equal(accepted.status, 202);
  await waitUntil(() => ["done", "failed"].includes(harness.jobs.get(accepted.body.id).status));
  const generatedJob = harness.jobs.get(accepted.body.id);
  assert.equal(generatedJob.status, "done", generatedJob.error);
  assert.deepEqual(harness.requests.at(-1).ipAdapter, {
    enabled: true,
    referenceBase64: ONE_PIXEL_PNG,
    module: capability.module,
    model: capability.model,
    weight: 0.65,
    guidanceStart: 0,
    guidanceEnd: 1
  });
  const generatedHistory = harness.history.records.find((generation) => generation.id === generatedJob.result.generationId);
  assert.deepEqual(generatedHistory.ipAdapter, {
    enabled: true,
    family: capability.family,
    module: capability.module,
    model: capability.model,
    weight: 0.65,
    guidanceStart: 0,
    guidanceEnd: 1,
    referenceImageId: sourceImageId,
    referenceImageUrl: "/outputs/runtime-source.png"
  });

  const jobsBeforeInvalid = harness.jobs.list().length;
  const requestsBeforeInvalid = harness.requests.length;
  const recordsBeforeInvalid = harness.history.records.length;
  const invalidReference = await requestJson(`${baseUrl}/api/v1/generations`, {
    method: "POST",
    body: {
      prompt: { rawOverride: "invalid reference id" },
      ipAdapter: { referenceImageId: "bad/id" }
    }
  });
  assert.equal(invalidReference.status, 400);
  assert.equal(invalidReference.body.error.code, "INVALID_REQUEST");
  assert.equal(harness.jobs.list().length, jobsBeforeInvalid);
  assert.equal(harness.requests.length, requestsBeforeInvalid);
  assert.equal(harness.history.records.length, recordsBeforeInvalid);

  capabilityAvailable = false;
  const jobsBeforeUnavailable = harness.jobs.list().length;
  const requestsBeforeUnavailable = harness.requests.length;
  const recordsBeforeUnavailable = harness.history.records.length;
  const unavailable = await requestJson(`${baseUrl}/api/v1/generations`, {
    method: "POST",
    body: {
      prompt: { rawOverride: "unavailable reference" },
      ipAdapter: { referenceImageId: sourceImageId }
    }
  });
  assert.equal(unavailable.status, 202);
  await waitUntil(() => harness.jobs.get(unavailable.body.id).status === "failed");
  assert.equal(harness.jobs.get(unavailable.body.id).status, "failed");
  assert.equal(harness.requests.length, requestsBeforeUnavailable, "利用不可時はgenerateImagesを呼ばない");
  assert.equal(harness.history.records.length, recordsBeforeUnavailable, "利用不可時はHistoryを追加しない");
  assert.equal(harness.jobs.list().length, jobsBeforeUnavailable + 1);

  capabilityAvailable = true;
  async function regenerateWithReference(referenceId) {
    const queued = await requestJson(`${baseUrl}/api/v1/history/${source.id}/regenerations`, {
      method: "POST",
      body: {
        sourceImageId,
        ipAdapter: { referenceImageId: referenceId }
      }
    });
    assert.equal(queued.status, 202);
    await waitUntil(() => harness.jobs.get(queued.body.id).status === "done");
    const job = harness.jobs.get(queued.body.id);
    const history = harness.history.records.find((generation) => generation.id === job.result.generationId);
    assert.equal(history.ipAdapter.referenceImageId, referenceId);
    return { job, history };
  }

  const sameReference = await regenerateWithReference(sourceImageId);
  assert.equal(sameReference.history.parentImageId, sourceImageId);
  assert.equal(harness.requests.at(-1).ipAdapter.referenceBase64, ONE_PIXEL_PNG);
  const differentReference = await regenerateWithReference(referenceImageId);
  assert.equal(differentReference.history.parentImageId, sourceImageId);
  assert.equal(differentReference.history.ipAdapter.referenceImageId, referenceImageId);
  assert.equal(harness.requests.at(-1).ipAdapter.referenceBase64, ONE_PIXEL_PNG);
});

test('Scenesの明示weight 0は旧Job/API v1のProvider requestと履歴まで保持する',async t=>{
  const harness=await createRuntimeHarness(t,{listLoras:async()=>[{name:'alpha'}]});
  const legacy=harness.service.createLegacyJob({prompt:'scene',loras:[{name:'alpha',weight:0,enabled:true}],settings:{width:512,height:512,steps:5,candidateCount:1}},{kind:'generation'});
  await waitUntil(()=>harness.jobs.get(legacy.id).status==='done');
  assert.match(harness.requests[0].prompt,/<lora:alpha:0>/);assert.equal(harness.history.records[0].loras[0].weight,0);
  const modern=await harness.service.createV1Job({mode:'txt2img',prompt:{structured:{situation:'scene'},rawOverride:null,negative:''},settings:{checkpoint:'checkpoint-x',width:512,height:512,steps:5,candidateCount:1},loras:[{name:'alpha',weight:0,enabled:true}]});
  await waitUntil(()=>harness.jobs.get(modern.id).status==='done');
  assert.match(harness.requests[1].prompt,/<lora:alpha:0>/);assert.equal(harness.history.records[1].loras[0].weight,0);
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

test("API v1のHistory itemとAI Workflow再生成は元履歴を変更せず新規Jobへ合流する", async (t) => {
  const harness = await createRuntimeHarness(t, {
    listLoras: async () => [{ name: "style" }, { name: "replacement" }]
  });
  const source = {
    id: "history-source1234",
    createdAt: "2026-08-10T00:00:00.000Z",
    title: "source",
    mode: "txt2img",
    prompt: "original, <lora:style:0.8>",
    effectivePrompt: "original, <lora:style:0.8>",
    negativePrompt: "lowres",
    effectiveNegativePrompt: "lowres",
    rawPromptOverride: true,
    rawPrompt: "original, <lora:style:0.8>",
    structuredPrompt: null,
    settings: {
      checkpoint: "checkpoint-x",
      width: 512,
      height: 640,
      steps: 12,
      cfgScale: 5,
      samplerName: "Euler a",
      scheduler: "Automatic",
      noiseSchedule: "Automatic",
      candidateCount: 4,
      seed: 999,
      hiresEnabled: false,
      hiresScale: 1.5,
      hiresSteps: 20,
      hiresDenoising: 0.4,
      hiresUpscaler: "Mock"
    },
    ipAdapter: {
      enabled: true,
      family: "sdxl",
      module: "CLIP-ViT-H (IPAdapter)",
      model: "ip-adapter-plus_sdxl_vit-h",
      referenceImageId: "image-reference1",
      referenceImageUrl: "/outputs/ip-adapter-reference-deadbeefdeadbeefdead.png",
      weight: 0.7,
      guidanceStart: 0,
      guidanceEnd: 1
    },
    loras: [{
      name: "style",
      weight: 0.8,
      enabled: true,
      source: "ui",
      triggerWords: "style trigger",
      negativeWords: "old negative"
    }],
    parentGenerationId: null,
    parentImageId: null,
    derivationType: null,
    derivationInstruction: null,
    images: [{
      id: "image-source1234",
      seed: 42,
      width: 512,
      height: 640,
      filename: "C:\\secret\\source.png",
      imageUrl: "/outputs/source.png"
    }]
  };
  const original = structuredClone(source);
  harness.history.records.push(source);
  const app = express();
  app.use(express.json());
  app.use("/api/v1", createV1Router({ generationService: harness.service }));
  app.use(createV1ErrorMiddleware());
  const listener = await new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
  t.after(() => new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve())));
  const baseUrl = `http://127.0.0.1:${listener.address().port}`;

  const item = await requestJson(`${baseUrl}/api/v1/history/${source.id}`);
  assert.equal(item.status, 200);
  assert.equal(item.body.id, source.id);
  assert.equal(item.body.prompt.rawPromptOverride, true);
  assert.equal("rawOverride" in item.body.prompt, false);
  assert.equal(item.body.settings.candidateCount, 4);
  assert.equal(item.body.derivation, null);
  assert.deepEqual(item.body.ipAdapter, {
    referenceImageId: "image-reference1",
    weight: 0.7,
    guidanceStart: 0,
    guidanceEnd: 1
  });
  assert.equal("filename" in item.body.images[0], false);
  assert.doesNotMatch(JSON.stringify(item.body), /C:\\secret|source\.png/);

  const legacy = structuredClone(source);
  legacy.id = "history-legacy1";
  legacy.images = [{ id: "image-legacy1", seed: 43, width: 512, height: 640 }];
  delete legacy.ipAdapter;
  harness.history.records.push(legacy);
  const legacyItem = await requestJson(`${baseUrl}/api/v1/history/${legacy.id}`);
  assert.equal(legacyItem.status, 200);
  assert.equal(legacyItem.body.ipAdapter, null);

  const list = await requestJson(`${baseUrl}/api/v1/history`);
  assert.equal(list.status, 200);
  assert.equal("ipAdapter" in list.body.generations[0], false);

  const inherited = await harness.service.createV1Regeneration(source.id, {
    sourceImageId: source.images[0].id
  });
  await waitUntil(() => harness.jobs.get(inherited.id).status === "done");
  const inheritedRequest = harness.requests.at(-1);
  assert.match(inheritedRequest.prompt, /<lora:style:0\.8>/);
  assert.match(inheritedRequest.prompt, /style trigger/);
  assert.match(inheritedRequest.negativePrompt, /old negative/);
  assert.deepEqual(harness.history.records.at(-1).loras[0], {
    name: "style",
    weight: 0.8,
    enabled: true,
    triggerWords: "style trigger",
    negativeWords: "old negative",
    source: "ui"
  });

  const accepted = await requestJson(`${baseUrl}/api/v1/history/${source.id}/regenerations`, {
    method: "POST",
    body: {
      sourceImageId: source.images[0].id,
      prompt: { rawOverride: "revised, (tag:1.2)", negative: "changed negative" },
      settings: { steps: 20 },
      instruction: "背景を夜の街へ変更",
      metadata: { client: "api-test" }
    }
  });
  assert.equal(accepted.status, 202);
  assert.equal(accepted.body.status, "queued");
  assert.equal(harness.jobs.get(accepted.body.id).meta.client, "api-test");
  await waitUntil(() => harness.jobs.get(accepted.body.id).status === "done");
  const request = harness.requests.at(-1);
  assert.match(request.prompt, /^revised, \(tag:1\.2\)/);
  assert.doesNotMatch(request.prompt, /背景を夜の街へ変更/);
  assert.equal(request.negativePrompt, "changed negative, old negative");
  assert.equal(request.width, 512);
  assert.equal(request.height, 640);
  assert.equal(request.steps, 20);
  assert.equal(request.candidateCount, 1);
  assert.equal(request.seed, -1);
  assert.equal(request.checkpoint, "checkpoint-x");
  assert.deepEqual(harness.history.records.at(-1).parentGenerationId, source.id);
  assert.equal(harness.history.records.at(-1).parentImageId, source.images[0].id);
  assert.equal(harness.history.records.at(-1).derivationType, "ai-workflow");
  assert.equal(harness.history.records.at(-1).derivationInstruction, "背景を夜の街へ変更");
  assert.deepEqual(source, original);

  const derived = await requestJson(`${baseUrl}/api/v1/history/${harness.history.records.at(-1).id}`);
  assert.equal(derived.status, 200);
  assert.equal(derived.body.parentGenerationId, source.id);
  assert.equal(derived.body.parentImageId, source.images[0].id);
  assert.deepEqual(derived.body.derivation, { type: "ai-workflow", instruction: "背景を夜の街へ変更" });

  const invalidId = await requestJson(`${baseUrl}/api/v1/history/not_id`);
  assert.equal(invalidId.status, 400);
  assert.equal(invalidId.body.error.code, "INVALID_REQUEST");
  const missing = await requestJson(`${baseUrl}/api/v1/history/history-missing1`);
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, "HISTORY_NOT_FOUND");
});

test("AI Workflow再生成はstructured継承、seed規則、source画像所有権、modeを検証する", async (t) => {
  const harness = await createRuntimeHarness(t, {
    listLoras: async () => [{ name: "style" }, { name: "replacement" }]
  });
  const source = {
    id: "history-structured1",
    mode: "txt2img",
    structuredPrompt: {
      character: "1girl",
      appearance: "silver hair",
      composition: "portrait",
      situation: "in a room",
      style: "anime",
      extra: "sharp focus, <lora:style:0.7>"
    },
    rawPromptOverride: false,
    rawPrompt: "",
    prompt: "1girl, silver hair, portrait, in a room, anime, sharp focus, <lora:style:0.7>",
    negativePrompt: "lowres",
    settings: {
      width: 512,
      height: 512,
      steps: 10,
      cfgScale: 4,
      samplerName: "Euler a",
      scheduler: "Automatic",
      seed: 7,
      hiresEnabled: true,
      hiresScale: 1.5,
      hiresSteps: 20,
      hiresDenoising: 0.4,
      hiresUpscaler: "Mock"
    },
    loras: [{
      name: "style",
      weight: 0.7,
      enabled: true,
      triggerWords: "style trigger",
      negativeWords: "old negative"
    }],
    images: [{ id: "image-structured1", seed: 73, width: 512, height: 512 }]
  };
  const img2img = {
    ...source,
    id: "history-img2img1",
    mode: "img2img",
    images: [{ id: "image-img2img1", seed: 73, width: 512, height: 512 }]
  };
  harness.history.records.push(source, img2img);

  const reused = await harness.service.createV1Regeneration(source.id, {
    sourceImageId: source.images[0].id,
    prompt: { negative: "new negative" },
    reuseSeed: true,
    instruction: "keep prompt"
  });
  await waitUntil(() => harness.jobs.get(reused.id).status === "done");
  const reusedRequest = harness.requests.at(-1);
  assert.match(reusedRequest.prompt, /^1girl, silver hair, portrait, in a room, anime, sharp focus/);
  assert.match(reusedRequest.prompt, /<lora:style:0\.7>/);
  assert.match(reusedRequest.prompt, /style trigger/);
  assert.match(reusedRequest.negativePrompt, /^new negative/);
  assert.match(reusedRequest.negativePrompt, /old negative/);
  assert.equal(reusedRequest.seed, 73);
  assert.equal(reusedRequest.candidateCount, 1);
  assert.equal(reusedRequest.hiresEnabled, true);

  const cleared = await harness.service.createV1Regeneration(source.id, {
    sourceImageId: source.images[0].id,
    settings: { hires: { enabled: false } },
    loras: []
  });
  await waitUntil(() => harness.jobs.get(cleared.id).status === "done");
  const clearedRequest = harness.requests.at(-1);
  assert.doesNotMatch(clearedRequest.prompt, /<lora:style:/);
  assert.doesNotMatch(clearedRequest.prompt, /style trigger/);
  assert.equal(clearedRequest.hiresEnabled, false);
  assert.deepEqual(harness.history.records.at(-1).loras, []);

  const replaced = await harness.service.createV1Regeneration(source.id, {
    sourceImageId: source.images[0].id,
    loras: [{ name: "replacement", weight: 1.2 }]
  });
  await waitUntil(() => harness.jobs.get(replaced.id).status === "done");
  const replacedRequest = harness.requests.at(-1);
  assert.doesNotMatch(replacedRequest.prompt, /<lora:style:/);
  assert.match(replacedRequest.prompt, /<lora:replacement:1\.2>/);
  assert.deepEqual(harness.history.records.at(-1).loras.map((lora) => lora.weight), [1.2]);

  const explicitLoraPrompt = await harness.service.createV1Regeneration(source.id, {
    sourceImageId: source.images[0].id,
    prompt: { rawOverride: "explicit, <lora:style:0.7>" },
    loras: []
  });
  await waitUntil(() => harness.jobs.get(explicitLoraPrompt.id).status === "done");
  assert.match(harness.requests.at(-1).prompt, /<lora:style:0\.7>/);

  const missingInstalled = await createRuntimeHarness(t, {
    listLoras: async () => []
  });
  missingInstalled.history.records.push(structuredClone(source));
  await assert.rejects(
    missingInstalled.service.createV1Regeneration(source.id, {
      sourceImageId: source.images[0].id
    }),
    (error) => error.apiCode === "INVALID_REQUEST"
  );

  const legacy = {
    id: "history-legacy001",
    mode: "txt2img",
    prompt: "legacy prompt",
    settings: { width: 512, height: 512 },
    loras: [],
    images: [{ id: "image-legacy001", seed: 11 }]
  };
  const effectiveFallback = {
    id: "history-effective1",
    mode: "txt2img",
    prompt: "",
    effectivePrompt: "effective fallback",
    settings: { width: 512, height: 512 },
    loras: [],
    images: [{ id: "image-effective1", seed: 12 }]
  };
  harness.history.records.push(legacy, effectiveFallback);
  const legacyJob = await harness.service.createV1Regeneration(legacy.id, {
    sourceImageId: legacy.images[0].id
  });
  await waitUntil(() => harness.jobs.get(legacyJob.id).status === "done");
  assert.equal(harness.requests.at(-1).prompt, "legacy prompt");
  const fallbackJob = await harness.service.createV1Regeneration(effectiveFallback.id, {
    sourceImageId: effectiveFallback.images[0].id
  });
  await waitUntil(() => harness.jobs.get(fallbackJob.id).status === "done");
  assert.equal(harness.requests.at(-1).prompt, "effective fallback");

  await assert.rejects(
    harness.service.createV1Regeneration(source.id, {
      sourceImageId: source.images[0].id,
      reuseSeed: true,
      settings: { seed: 12 }
    }),
    (error) => error.apiCode === "INVALID_REQUEST"
  );
  await assert.rejects(
    harness.service.createV1Regeneration(source.id, {
      sourceImageId: "image-not-owned1"
    }),
    (error) => error.apiCode === "SOURCE_IMAGE_NOT_FOUND"
  );
  await assert.rejects(
    harness.service.createV1Regeneration(img2img.id, {
      sourceImageId: img2img.images[0].id
    }),
    (error) => error.apiCode === "UNSUPPORTED_HISTORY_MODE"
  );
  await assert.rejects(
    harness.service.createV1Regeneration(source.id, {
      sourceImageId: source.images[0].id,
      instruction: "bad\ntext"
    }),
    (error) => error.apiCode === "INVALID_REQUEST"
  );
  await assert.rejects(
    harness.service.createV1Regeneration(source.id, {
      sourceImageId: source.images[0].id,
      prompt: { structured: { character: "partial" } }
    }),
    (error) => error.apiCode === "INVALID_REQUEST"
  );
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
  const resolveOutputImagePath = (filename) => {
    const resolved = path.resolve(outputDir, filename);
    if (path.dirname(resolved) !== path.resolve(outputDir)) {
      throw new Error("原画像の保存先が不正です");
    }
    return resolved;
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
    },
    async getImage(imageId) {
      for (const generation of records) {
        const image = Array.isArray(generation.images)
          ? generation.images.find((item) => item?.id === imageId)
          : null;
        if (image) return { generationId: generation.id, ...structuredClone(image) };
      }
      throw new Error("指定された画像が履歴にありません");
    },
    async getGeneration(id) {
      const found = records.find((generation) => generation.id === id);
      if (!found) {
        const error = new Error("not found");
        error.code = "HISTORY_NOT_FOUND";
        throw error;
      }
      return structuredClone(found);
    }
  };
  const runtime = createGenerationRuntime({
    config: harnessConfig,
    history,
    thumbnails: { ensure: async () => {} },
    discord: null,
    outputDir,
    resolveOutputImagePath,
    createPrompt: async () => ({
      prompt: "mock prompt",
      negative_prompt: "",
      explanation_ja: "mock"
    }),
    unloadOllama: async () => {},
    generateImages,
    getIpAdapterOptions: options.getIpAdapterOptions,
    resolveReferenceImage: options.resolveReferenceImage,
    listCheckpoints,
    switchCheckpoint
  });
  const jobs = createJobManager(runtime.executeWithRecovery);
  const service = createGenerationService({
    jobs,
    runtime,
    config: harnessConfig,
    history,
    resolveReferenceImage: options.resolveReferenceImage,
    capabilityDependencies: {
      listCheckpoints,
      listLoras: options.listLoras ?? (async () => [])
    }
  });
  return { jobs, service, history, requests, switchCalls, outputDir };
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
