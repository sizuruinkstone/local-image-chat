import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getInstanceLockPath } from "../src/instance-lock.js";
import {
  buildIpAdapterControlNetUnit,
  mergeIpAdapterPayload,
  modelBasename,
  normalizeIpAdapter,
  selectIpAdapterCapability,
  validateIpAdapter
} from "../src/ip-adapter.js";
import { createHistoryService } from "../src/history.js";
import { createAttachmentReader } from "../src/mcp/attachment-reader.js";
import { generationTitle } from "../public/history-title.js";

const ONE_PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("Task 10のIP-Adapter純粋関数はモデル名・境界値・unitを安全に正規化する", () => {
  assert.equal(modelBasename("ControlNet/ip-adapter-plus_sdxl_vit-h.safetensors [abc123]"), "ip-adapter-plus_sdxl_vit-h");
  assert.equal(selectIpAdapterCapability({
    checkpoint: "obsessionIllustrious_vPredV20.safetensors",
    moduleNames: ["None", "CLIP-ViT-H (IPAdapter)"],
    modelNames: ["None", "ip-adapter-plus_sdxl_vit-h [3f5062b8]"]
  }).available, true);
  assert.equal(selectIpAdapterCapability({
    checkpoint: "model.safetensors",
    moduleNames: ["CLIP-ViT-H (IPAdapter)"],
    modelNames: ["ip-adapter-plus_sdxl_vit-h"]
  }).available, false);
  assert.equal(selectIpAdapterCapability({
    checkpoint: "obsessionIllustrious_vPredV20.safetensors",
    moduleNames: ["None"],
    modelNames: ["ip-adapter-plus_sdxl_vit-h"]
  }).available, false);

  const valid = validateIpAdapter({
    enabled: true,
    referenceImageId: "12345678-abcd",
    weight: "2",
    guidanceStart: "0",
    guidanceEnd: 1
  });
  assert.equal(valid.weight, 2);
  assert.equal(valid.guidanceStart, 0);
  assert.equal(valid.guidanceEnd, 1);
  assert.equal(validateIpAdapter({ enabled: false }), null);
  assert.throws(() => validateIpAdapter({ enabled: true, referenceImageId: "12345678", weight: "2.01" }), /Weight/);
  assert.throws(() => validateIpAdapter({ enabled: true, referenceImageId: "12345678", guidanceStart: 1, guidanceEnd: 1 }), /Start/);
  assert.throws(() => validateIpAdapter({ enabled: true, referenceImageUrl: "file:///C:/secret.png" }), /URL/);
  assert.throws(() => validateIpAdapter({ enabled: true, referenceImageUrl: "/outputs/../secret.png" }), /URL/);
  assert.throws(() => validateIpAdapter({ enabled: true, referenceImageUrl: "C:\\outputs\\ip-adapter-reference_12345678901234567890.png" }), /URL/);
  assert.throws(() => validateIpAdapter({ enabled: true, referenceImageUrl: "/outputs/other_12345678901234567890.png" }), /URL/);
  assert.throws(() => validateIpAdapter({ enabled: true, referenceImage: "data:image/gif;base64,AAAA" }), /PNG/);
  assert.equal(normalizeIpAdapter(null), null);
  assert.equal(normalizeIpAdapter({ enabled: false }), null);
  assert.equal(normalizeIpAdapter({ enabled: true, referenceImageId: "12345678", weight: 3 }), null);

  const unit = buildIpAdapterControlNetUnit({
    referenceBase64: `data:image/png;base64,${ONE_PIXEL_PNG}`,
    model: "ip-adapter-plus_sdxl_vit-h [3f5062b8]",
    weight: 0,
    guidanceStart: 0,
    guidanceEnd: 1
  });
  assert.deepEqual(Object.keys(unit), [
    "enabled", "image", "module", "model", "weight", "resize_mode", "guidance_start",
    "guidance_end", "pixel_perfect", "processor_res", "threshold_a", "threshold_b",
    "control_mode", "save_detected_map"
  ]);
  assert.equal(unit.image, ONE_PIXEL_PNG);
  const originalPayload = {
    prompt: "1girl",
    alwayson_scripts: {
      OtherScript: { args: [{ keep: true }] },
      ControlNet: { args: [{ existing: true }] }
    }
  };
  const merged = mergeIpAdapterPayload(originalPayload, {
    enabled: true,
    referenceBase64: ONE_PIXEL_PNG,
    model: "ip-adapter-plus_sdxl_vit-h [3f5062b8]"
  });
  assert.deepEqual(merged.alwayson_scripts.OtherScript, originalPayload.alwayson_scripts.OtherScript);
  assert.equal(merged.alwayson_scripts.ControlNet.args.length, 2);
  assert.strictEqual(mergeIpAdapterPayload(originalPayload, { enabled: false }), originalPayload);
});

test("Task 10の履歴正規化はIP-Adapterの安全な参照メタデータだけを保存する", async () => {
  const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), "local-image-chat-ip-history-"));
  try {
    const history = createHistoryService(temporaryDir);
    const stored = await history.addGeneration({
      prompt: "1girl",
      description: "履歴正規化",
      ipAdapter: {
        enabled: true,
        family: "sdxl",
        module: "CLIP-ViT-H (IPAdapter)",
        model: "ip-adapter-plus_sdxl_vit-h [hash]",
        weight: "0.65",
        guidanceStart: "0",
        guidanceEnd: 1,
        referenceImageId: "12345678-abcd",
        referenceImage: `data:image/png;base64,${ONE_PIXEL_PNG}`,
        base64: ONE_PIXEL_PNG,
        buffer: Buffer.from(ONE_PIXEL_PNG),
        localPath: "C:\\secret\\reference.png",
        unexpected: "drop me"
      }
    });
    assert.deepEqual(stored.ipAdapter, {
      enabled: true,
      family: "sdxl",
      module: "CLIP-ViT-H (IPAdapter)",
      model: "ip-adapter-plus_sdxl_vit-h [hash]",
      weight: 0.65,
      guidanceStart: 0,
      guidanceEnd: 1,
      referenceImageId: "12345678-abcd"
    });
    assert.equal(JSON.stringify(stored).includes("base64"), false);
    assert.equal(JSON.stringify(stored).includes("secret"), false);
    assert.equal(generationTitle({ title: "", description: "旧説明" }), "旧説明");
    assert.equal(generationTitle({ description: "" }), "無題");

    const historyPath = path.join(temporaryDir, "history.json");
    await fs.writeFile(historyPath, JSON.stringify({
      schemaVersion: 2,
      generations: [{
        id: "old-generation",
        images: [{ id: "old-image", filename: "old.png" }],
        ipAdapter: {
          enabled: true,
          referenceImageId: "bad id",
          referenceImage: `data:image/png;base64,${ONE_PIXEL_PNG}`,
          weight: 9
        }
      }]
    }));
    const oldRecipe = await history.getRecipe("old-image");
    assert.equal(oldRecipe.ipAdapter, null, "壊れた旧履歴のIP-Adapterは無効化する");
  } finally {
    await fs.rm(temporaryDir, { recursive: true, force: true });
  }
});

test("Task 10のUI契約は中央画像操作をIP-Adapter stateへ分離する", async () => {
  const [html, app, style] = await Promise.all([
    fs.readFile("public/index.html", "utf8"),
    fs.readFile("public/app.js", "utf8"),
    fs.readFile("public/style.css", "utf8")
  ]);
  assert.match(html, /id="studioMainIpAdapterButton"[\s\S]*title="この画像をIP-Adapter参照に使用"/);
  assert.match(html, /id="studioMainIpAdapterButton"[\s\S]*aria-label="この画像をIP-Adapter参照に使用"/);
  assert.match(html, /id="finalIpAdapterButton"[\s\S]*title="この画像をIP-Adapter参照に使用"/);
  assert.match(html, /id="finalIpAdapterButton"[\s\S]*aria-label="この画像をIP-Adapter参照に使用"/);
  assert.match(html, /accept="image\/png,image\/jpeg,image\/webp"/);
  assert.match(html, /id="ipAdapterStatus"[\s\S]*aria-live="polite"/);
  assert.match(app, /function setIpAdapterReference\(/);
  assert.match(app, /function setCurrentImageAsIpAdapterReference\(/);
  assert.match(app, /referenceImageId: image\.id/);
  assert.match(app, /event\.stopPropagation\(\)/);
  assert.match(app, /function readIpAdapterPayload\(/);
  assert.match(app, /initImageReference/);
  assert.match(app, /URL\.revokeObjectURL/);
  const centralHandler = app.slice(app.indexOf("elements.studioMainIpAdapterButton.addEventListener"), app.indexOf("elements.studioMainCompareButton.addEventListener"));
  assert.doesNotMatch(centralHandler, /fetch\(|FileReader|fileToDataUrl|toDataURL/);
  const hiresHandler = app.slice(app.indexOf("elements.finalIpAdapterButton.addEventListener"), app.indexOf("elements.sendFinalToImg2ImgButton.addEventListener"));
  assert.match(centralHandler, /setCurrentImageAsIpAdapterReference\(studioInspection\?\.image/);
  assert.match(hiresHandler, /setCurrentImageAsIpAdapterReference\(finalImage/);
  assert.match(hiresHandler, /event\.stopPropagation\(\)/);
  assert.doesNotMatch(hiresHandler, /fetch\(|FileReader|fileToDataUrl|toDataURL/);
  assert.match(style, /\.ipAdapterSection/);
  assert.match(style, /#studioMainIpAdapterButton/);
});

test("Task 09の保存先APIは隔離サーバーの再起動移行後も画像URLを維持する", async (t) => {
  const server = await createIsolatedStorageServer(t, "storage-success");
  if (!server) return;
  await seedStorageFixture(server, {
    filename: "fixture.png",
    imageId: "fixture-image-id",
    extraFiles: [["keep.txt", "keep after deletion"]]
  });
  await server.start();

  const settingsBefore = await requestJsonWithStatus(`${server.baseUrl}/api/storage/settings`);
  assert.equal(settingsBefore.status, 200);
  assert.equal(settingsBefore.body.currentOutputDir, server.outputDir);
  assert.equal(settingsBefore.body.source, "default");

  const plan = await requestJsonWithStatus(`${server.baseUrl}/api/storage/plan`, {
    method: "POST",
    body: { targetOutputDir: server.targetDir }
  });
  assert.equal(plan.status, 200);
  assert.equal(plan.body.valid, true, plan.body.error);
  assert.equal(plan.body.targetOutputDir, server.targetDir);
  assert.ok(plan.body.sourceFiles >= 2);
  assert.equal(plan.body.restartRequired, true);

  const reserved = await requestJsonWithStatus(`${server.baseUrl}/api/storage/settings`, {
    method: "PATCH",
    body: { targetOutputDir: server.targetDir, confirmMigration: true }
  });
  assert.equal(reserved.status, 200);
  assert.equal(reserved.body.pendingOutputDir, server.targetDir);
  assert.equal(reserved.body.restartRequired, true);
  const pendingSettings = await requestJsonWithStatus(`${server.baseUrl}/api/storage/settings`);
  assert.equal(pendingSettings.body.pendingStatus, "pending");

  const cancelled = await requestJsonWithStatus(`${server.baseUrl}/api/storage/settings`, {
    method: "PATCH",
    body: { cancelPending: true }
  });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.pendingStatus, null);

  const reReserved = await requestJsonWithStatus(`${server.baseUrl}/api/storage/settings`, {
    method: "PATCH",
    body: { targetOutputDir: server.targetDir, confirmMigration: true }
  });
  assert.equal(reReserved.status, 200);
  assert.equal(reReserved.body.pendingOutputDir, server.targetDir);

  for (const url of [
    "/outputs/fixture.png",
    "/favorites/fixture.png",
    "/api/images/fixture-image-id/original"
  ]) {
    const response = await fetch(`${server.baseUrl}${url}`);
    assert.equal(response.status, 200, url);
    assert.match(response.headers.get("content-type") ?? "", /^image\/png/, url);
  }
  const thumbnailBefore = await fetch(`${server.baseUrl}/api/images/fixture-image-id/thumbnail`);
  assert.equal(thumbnailBefore.status, 200);
  assert.match(thumbnailBefore.headers.get("content-type") ?? "", /^image\/webp/);

  await server.stop();
  await server.start();

  const settingsAfter = await requestJsonWithStatus(`${server.baseUrl}/api/storage/settings`);
  assert.equal(settingsAfter.status, 200);
  assert.equal(settingsAfter.body.currentOutputDir, server.targetDir);
  assert.equal(settingsAfter.body.source, "stored");
  assert.equal(settingsAfter.body.pendingStatus, null);
  assert.equal(settingsAfter.body.lastMigration.status, "completed");
  assert.equal(await fileExists(path.join(server.targetDir, ".local-image-chat-output.json")), true);

  for (const [url, contentType] of [
    ["/outputs/fixture.png", /^image\/png/],
    ["/favorites/fixture.png", /^image\/png/],
    ["/api/images/fixture-image-id/original", /^image\/png/],
    ["/api/images/fixture-image-id/thumbnail", /^image\/webp/]
  ]) {
    const response = await fetch(`${server.baseUrl}${url}`);
    assert.equal(response.status, 200, url);
    assert.match(response.headers.get("content-type") ?? "", contentType, url);
  }
  assert.equal(await fileExists(path.join(server.outputDir, "fixture.png")), true);
  assert.equal(await fileExists(path.join(server.outputDir, "favorite", "fixture.png")), true);

  const deleted = await fetch(`${server.baseUrl}/api/history/fixture-image-id`, { method: "DELETE" });
  assert.equal(deleted.status, 200);
  assert.equal(await fileExists(path.join(server.targetDir, "fixture.png")), false);
  assert.equal(await fileExists(path.join(server.targetDir, "favorite", "fixture.png")), false);
  assert.equal(await fileExists(path.join(server.targetDir, "thumbnails", "fixture-image-id.webp")), false);
  assert.equal(await fileExists(path.join(server.targetDir, ".local-image-chat-output.json")), true);
  assert.equal(await fileExists(path.join(server.targetDir, "keep.txt")), true);
  assert.equal(await fileExists(path.join(server.outputDir, "fixture.png")), true);
  assert.equal(await fileExists(path.join(server.outputDir, "favorite", "fixture.png")), true);
});

test("Task 09の移行競合は旧保存先で起動し、旧URLとsourceを維持する", async (t) => {
  const server = await createIsolatedStorageServer(t, "storage-failure");
  if (!server) return;
  await seedStorageFixture(server, {
    filename: "a.png",
    imageId: "failure-image-id",
    extraFiles: [["z.png", Buffer.from(ONE_PIXEL_PNG, "base64")]]
  });
  await fs.mkdir(server.targetDir, { recursive: true });
  await writeOutputMarkerForTest(server.targetDir);
  await fs.writeFile(path.join(server.targetDir, "a.png"), "different-content");
  await server.start();

  const reserved = await requestJsonWithStatus(`${server.baseUrl}/api/storage/settings`, {
    method: "PATCH",
    body: { targetOutputDir: server.targetDir, confirmMigration: true }
  });
  assert.equal(reserved.status, 200);
  assert.equal(reserved.body.pendingOutputDir, server.targetDir);
  await server.stop();
  await server.start();

  const failedSettings = await requestJsonWithStatus(`${server.baseUrl}/api/storage/settings`);
  assert.equal(failedSettings.status, 200);
  assert.equal(failedSettings.body.currentOutputDir, server.outputDir);
  assert.equal(failedSettings.body.source, "stored");
  assert.equal(failedSettings.body.pendingStatus, "failed");
  assert.equal(failedSettings.body.lastMigration.status, "failed");

  for (const url of [
    "/outputs/a.png",
    "/favorites/a.png",
    "/api/images/failure-image-id/original",
    "/api/images/failure-image-id/thumbnail"
  ]) {
    const response = await fetch(`${server.baseUrl}${url}`);
    assert.equal(response.status, 200, url);
  }
  assert.equal(await fs.readFile(path.join(server.targetDir, "a.png"), "utf8"), "different-content");
  assert.equal(await fileExists(path.join(server.targetDir, "z.png")), false);
  assert.equal(await fileExists(path.join(server.outputDir, "a.png")), true);
  assert.equal(await fileExists(path.join(server.outputDir, "z.png")), true);
  assert.equal(await fileExists(path.join(server.outputDir, "favorite", "a.png")), true);
});

test("Task 18以前のHistory dotfile配信拒否を固定する", async (t) => {
  const server = await createIsolatedStorageServer(t, "history-dotfile");
  if (!server) return;
  await seedStorageFixture(server, { filename: ".broken.png", imageId: "hidden-image-id" });
  await fs.writeFile(path.join(server.outputDir, ".broken.png"), "not-an-image");
  await server.start();

  const original = await fetch(`${server.baseUrl}/api/images/hidden-image-id/original`);
  assert.equal(original.status, 404);
  const thumbnail = await fetch(`${server.baseUrl}/api/images/hidden-image-id/thumbnail`);
  assert.notEqual(thumbnail.status, 200);
});

test("Task 18のReference Asset APIは実配信と既存保存先移行へ合流する", async (t) => {
  const server = await createIsolatedStorageServer(t, "reference-assets");
  if (!server) return;
  await server.start();
  const imageBytes = Buffer.from(ONE_PIXEL_PNG, "base64");
  const imported = await fetch(`${server.baseUrl}/api/v1/assets/images`, {
    method: "POST",
    headers: { "Content-Type": "image/png" },
    body: imageBytes
  });
  const asset = await imported.json();
  assert.equal(imported.status, 201);
  assert.equal(asset.kind, "reference-asset");
  assert.match(asset.id, /^asset-[a-z0-9-]+$/);
  assert.doesNotMatch(JSON.stringify(asset), /C:\\|filename|source|base64/);

  for (const [url, contentType] of [
    [`/api/images/${asset.id}/original`, /^image\/png/],
    [`/api/images/${asset.id}/thumbnail`, /^image\/webp/]
  ]) {
    const response = await fetch(`${server.baseUrl}${url}`);
    assert.equal(response.status, 200, url);
    assert.match(response.headers.get("content-type") ?? "", contentType, url);
  }
  const directOutput = await fetch(`${server.baseUrl}/outputs/.reference-assets/originals/${asset.id}.png`);
  assert.equal(directOutput.status, 404);

  const reserved = await requestJsonWithStatus(`${server.baseUrl}/api/storage/settings`, {
    method: "PATCH",
    body: { targetOutputDir: server.targetDir, confirmMigration: true }
  });
  assert.equal(reserved.status, 200);
  await server.stop();
  await server.start();

  assert.equal(await fileExists(path.join(server.targetDir, ".reference-assets", "originals", `${asset.id}.png`)), true);
  assert.equal(await fileExists(path.join(server.targetDir, ".reference-assets", "thumbnails", `${asset.id}.webp`)), true);
  for (const url of [
    `/api/images/${asset.id}/original`,
    `/api/images/${asset.id}/thumbnail`
  ]) {
    const response = await fetch(`${server.baseUrl}${url}`);
    assert.equal(response.status, 200, url);
  }
  const unknown = await fetch(`${server.baseUrl}/api/images/asset-ffffffff-ffff-4fff-8fff-ffffffffffff/original`);
  assert.equal(unknown.status, 404);
});

test("生成キューからReForge、履歴、👍集計までAPIが往復する", async (t) => {
  const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), "local-image-chat-api-"));
  const ollama = await startMockServer(handleOllama);
  const reforgeRequests = [];
  reforgeRequests.events = [];
  reforgeRequests.optionsKeySupported = true;
  reforgeRequests.ipAdapterModuleSupported = true;
  reforgeRequests.ipAdapterModelSupported = true;
  const reforge = await startMockServer((request, response) =>
    handleReforge(request, response, reforgeRequests)
  );
  const appPort = await reservePort();
  const configPath = path.join(temporaryDir, "config.json");
  await fs.writeFile(configPath, JSON.stringify({
    port: appPort,
    ollama: { url: `http://127.0.0.1:${ollama.port}`, model: "mock", timeoutMs: 5000 },
    reforge: { url: `http://127.0.0.1:${reforge.port}`, timeoutMs: 5000 },
    defaults: {
      width: 512,
      height: 512,
      steps: 5,
      cfgScale: 5,
      samplerName: "Euler a",
      scheduler: "Automatic",
      candidateCount: 1,
      hiresScale: 1.5,
      hiresSteps: 5,
      hiresDenoising: 0.4,
      hiresUpscaler: "Mock"
    }
  }));

  const serverEnv = {
    ...process.env,
    LOCAL_IMAGE_CHAT_CONFIG: configPath,
    LOCAL_IMAGE_CHAT_DATA_DIR: path.join(temporaryDir, "data"),
    LOCAL_IMAGE_CHAT_OUTPUT_DIR: path.join(temporaryDir, "outputs")
  };
  const serverChildren = [];
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: path.resolve("."),
    env: serverEnv,
    stdio: ["ignore", "pipe", "pipe"]
  });
  serverChildren.push(child);

  t.after(async () => {
    let cleanupError;
    for (const serverChild of [...serverChildren].reverse()) {
      try {
        await stopTestServer(serverChild, appPort, { cleanupLock: false });
      } catch (error) {
        cleanupError ??= error;
      }
    }
    try {
      await Promise.all([ollama.close(), reforge.close()]);
    } catch (error) {
      cleanupError ??= error;
    }
    if (!cleanupError) {
      try {
        await cleanupTestLock(appPort);
        await fs.rm(temporaryDir, { recursive: true, force: true });
      } catch (error) {
        cleanupError ??= error;
      }
    }
    if (cleanupError) throw cleanupError;
  });

  const baseUrl = `http://127.0.0.1:${appPort}`;
  await waitForServer(`${baseUrl}/api/config`, child);
  const configResponse = await fetch(`${baseUrl}/api/config`);
  const runtimeConfig = await configResponse.json();
  assert.equal(configResponse.status, 200);
  assert.equal(runtimeConfig.version, "3.0.0", "既存のversionフィールドを維持する");
  assert.ok(Number.isInteger(runtimeConfig.runtime.pid) && runtimeConfig.runtime.pid > 0);
  assert.ok(Number.isFinite(Date.parse(runtimeConfig.runtime.startedAt)));
  assert.ok(Number.isInteger(runtimeConfig.runtime.uptimeSeconds));
  assert.ok(runtimeConfig.runtime.uptimeSeconds >= 0);
  assert.equal(typeof runtimeConfig.runtime.binding.host, "string");
  assert.equal(runtimeConfig.runtime.binding.port, appPort);
  assert.equal(typeof runtimeConfig.runtime.binding.exposed, "boolean");
  assert.equal("instanceId" in runtimeConfig.runtime, false);
  assert.doesNotMatch(JSON.stringify(runtimeConfig.runtime), /webhook|integration|secret|token/i);
  assert.doesNotMatch(JSON.stringify(runtimeConfig.runtime), new RegExp(temporaryDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  const checkpoints = await (await fetch(`${baseUrl}/api/checkpoints`)).json();
  assert.equal(checkpoints.activeCheckpoint, "mock.safetensors");
  assert.deepEqual(checkpoints.checkpoints.map((item) => item.title), [
    "mock.safetensors",
    "waiNSFWIllustrious_v170.safetensors"
  ]);
  const switchedCheckpoint = await postJson(`${baseUrl}/api/checkpoints/select`, {
    checkpoint: "waiNSFWIllustrious_v170.safetensors"
  });
  assert.equal(switchedCheckpoint.checkpoint, "waiNSFWIllustrious_v170.safetensors");

  const refreshRegistrations = await postJson(`${baseUrl}/api/civitai/refresh-registrations`, {});
  assert.deepEqual(refreshRegistrations, {
    total: 0,
    updated: 0,
    failed: 0,
    failures: []
  });
  const generationEventsStart = reforgeRequests.events.length;
  const queued = await postJson(`${baseUrl}/api/jobs`, {
    description: "テスト画像",
    title: " 手動タイトル ",
    prompt: "masterpiece, 1girl, blue hair",
    negativePrompt: "low quality",
    loras: [],
    settings: {
      width: 512, height: 512, steps: 5, candidateCount: 1, noiseSchedule: "Zero Terminal SNR",
      checkpoint: "waiNSFWIllustrious_v170.safetensors", checkpointHash: "abc123def"
    }
  });
  const completed = await waitForJob(baseUrl, queued.job.id);

  assert.equal(completed.status, "done");
  assert.equal(completed.result.title, "手動タイトル");
  assert.equal(completed.result.images.length, 1);
  assert.match(completed.result.images[0].id, /^[a-z0-9-]+$/i);
  assert.equal(reforgeRequests.noiseSchedule, "Zero Terminal SNR", "生成前にNoise scheduleをoptionsへ送る");
  const supportedGenerationEvents = reforgeRequests.events
    .slice(generationEventsStart)
    .filter((event) => ["/sdapi/v1/options", "/sdapi/v1/txt2img"].includes(event.url));
  assert.deepEqual(
    supportedGenerationEvents.map((event) => `${event.method} ${event.url}`),
    ["GET /sdapi/v1/options", "POST /sdapi/v1/options", "POST /sdapi/v1/txt2img"],
    "options GET、対応キーPOST、生成endpointの順で呼ぶ"
  );
  assert.equal(supportedGenerationEvents[1].body.sd_noise_schedule_sampling, "Zero Terminal SNR");

  const image = completed.result.images[0];
  assert.equal(image.thumbnailUrl, `/api/images/${image.id}/thumbnail`);
  assert.equal(image.originalUrl, `/api/images/${image.id}/original`);
  assert.equal(JSON.stringify(completed.result).includes("data:image"), false, "生成結果へdata URLを返さない");
  assert.equal(JSON.stringify(completed.result).includes(ONE_PIXEL_PNG), false, "生成結果へbase64を返さない");

  const historyPageResponse = await fetch(`${baseUrl}/api/history?limit=1`);
  const historyPage = await historyPageResponse.json();
  assert.equal(historyPage.generations.flatMap((item) => item.images).length, 1);
  assert.equal(historyPage.limit, 1);
  assert.equal(historyPage.total, 1);
  assert.equal(historyPage.generations[0].title, "手動タイトル");
  assert.equal(historyPage.hasMore, false);
  assert.equal(JSON.stringify(historyPage).includes("base64"), false, "履歴APIへbase64を含めない");
  assert.equal(historyPage.generations[0].images[0].thumbnailUrl, image.thumbnailUrl);

  const thumbnailResponse = await fetch(`${baseUrl}${image.thumbnailUrl}`);
  assert.equal(thumbnailResponse.status, 200);
  assert.equal(thumbnailResponse.headers.get("content-type"), "image/webp");
  assert.equal(thumbnailResponse.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.ok(Number(thumbnailResponse.headers.get("content-length")) > 0);

  const generatedOutputFile = path.join(temporaryDir, "outputs", path.basename(image.imageUrl));
  const generatedThumbnailFile = path.join(
    temporaryDir, "outputs", "thumbnails", `${image.id}.webp`
  );
  const hiddenOutputFile = `${generatedOutputFile}.missing-test`;
  await fs.rename(generatedOutputFile, hiddenOutputFile);
  await fs.rm(generatedThumbnailFile, { force: true });
  try {
    const missingThumbnail = await fetch(`${baseUrl}${image.thumbnailUrl}`);
    assert.equal(missingThumbnail.status, 404, "原画像がないオンデマンド生成は404を返す");
    const missingBody = await missingThumbnail.json();
    assert.equal(
      missingBody.error,
      "原画像が見つからないためサムネイルを生成できません",
      "ローカルパスや内部例外をUIへ返さない"
    );
    assert.equal(JSON.stringify(missingBody).includes(temporaryDir), false);
  } finally {
    await fs.rename(hiddenOutputFile, generatedOutputFile);
  }
  const regeneratedThumbnail = await fetch(`${baseUrl}${image.thumbnailUrl}`);
  assert.equal(regeneratedThumbnail.status, 200, "原画像を戻すとオンデマンドで再生成できる");
  assert.equal(regeneratedThumbnail.headers.get("content-type"), "image/webp");

  const originalResponse = await fetch(`${baseUrl}${image.originalUrl}`);
  assert.equal(originalResponse.status, 200);
  assert.equal(originalResponse.headers.get("content-type"), "image/png");
  assert.equal(originalResponse.headers.get("cache-control"), "public, max-age=31536000, immutable");
  const originalEtag = originalResponse.headers.get("etag");
  assert.ok(originalEtag, "原寸画像にETagが付く");
  const cachedOriginal = await fetch(`${baseUrl}${image.originalUrl}`, {
    headers: { "If-None-Match": originalEtag }
  });
  assert.equal(cachedOriginal.status, 304, "同じ原寸画像は条件付きリクエストで再転送しない");

  const traversal = await fetch(`${baseUrl}/api/images/${encodeURIComponent("../secret")}/original`);
  assert.equal([404, 422].includes(traversal.status), true, "不正な画像IDを拒否する");

  const savedRecipe = await (await fetch(`${baseUrl}/api/history/${image.id}/recipe`)).json();
  assert.equal(savedRecipe.settings.checkpoint, "waiNSFWIllustrious_v170.safetensors", "Checkpoint名が履歴へ保存される");
  assert.equal(savedRecipe.settings.checkpointHash, "abc123def", "Checkpoint hashが履歴へ保存される");

  const ipAdapterOptions = await (await fetch(`${baseUrl}/api/reforge/ip-adapter/options`)).json();
  assert.deepEqual(ipAdapterOptions, {
    available: true,
    family: "sdxl",
    module: "CLIP-ViT-H (IPAdapter)",
    model: "ip-adapter-plus_sdxl_vit-h [3f5062b8]",
    message: "利用できます"
  });
  const ipQueued = await postJson(`${baseUrl}/api/jobs`, {
    description: "履歴画像をIP-Adapter参照にする",
    prompt: "masterpiece, 1girl, ip reference",
    negativePrompt: "low quality",
    ipAdapter: {
      enabled: true,
      referenceImageId: image.id,
      weight: "0.8",
      guidanceStart: "0.1",
      guidanceEnd: 0.9
    },
    loras: [],
    settings: { width: 512, height: 512, steps: 5, candidateCount: 1 }
  });
  const ipCompleted = await waitForJob(baseUrl, ipQueued.job.id);
  assert.equal(ipCompleted.status, "done");
  assert.deepEqual(ipCompleted.result.ipAdapter, {
    enabled: true,
    family: "sdxl",
    module: "CLIP-ViT-H (IPAdapter)",
    model: "ip-adapter-plus_sdxl_vit-h [3f5062b8]",
    weight: 0.8,
    guidanceStart: 0.1,
    guidanceEnd: 0.9,
    referenceImageId: image.id
  });
  const ipRequest = reforgeRequests.filter((item) => item.url === "/sdapi/v1/txt2img").at(-1);
  assert.equal(ipRequest.body.alwayson_scripts.ControlNet.args.length, 1);
  assert.deepEqual(ipRequest.body.alwayson_scripts.ControlNet.args[0], {
    enabled: true,
    image: ONE_PIXEL_PNG,
    module: "CLIP-ViT-H (IPAdapter)",
    model: "ip-adapter-plus_sdxl_vit-h [3f5062b8]",
    weight: 0.8,
    resize_mode: "Crop and Resize",
    guidance_start: 0.1,
    guidance_end: 0.9,
    pixel_perfect: false,
    processor_res: -1,
    threshold_a: -1,
    threshold_b: -1,
    control_mode: "Balanced",
    save_detected_map: false
  });
  assert.equal(ipRequest.body.init_images, undefined, "TXT生成へimg2img元画像を混ぜない");
  assert.equal(JSON.stringify(ipCompleted.result).includes(ONE_PIXEL_PNG), false, "履歴レスポンスへbase64を返さない");
  const ipRecipe = await (await fetch(`${baseUrl}/api/history/${ipCompleted.result.images[0].id}/recipe`)).json();
  assert.equal(ipRecipe.ipAdapter.referenceImageId, image.id);
  assert.equal(JSON.stringify(ipRecipe).includes(ONE_PIXEL_PNG), false, "IP-Adapter履歴へbase64を保存しない");

  reforgeRequests.ipAdapterModelSupported = false;
  const unavailableIpQueued = await postJson(`${baseUrl}/api/jobs`, {
    description: "IP-Adapterなし",
    prompt: "1girl, unavailable ip adapter",
    ipAdapter: { enabled: true, referenceImageId: image.id },
    loras: [],
    settings: { width: 512, height: 512, steps: 5, candidateCount: 1 }
  });
  const unavailableIpCompleted = await waitForJob(baseUrl, unavailableIpQueued.job.id);
  assert.equal(unavailableIpCompleted.status, "failed");
  assert.match(unavailableIpCompleted.error, /モデル|IP-Adapter/);
  assert.equal(
    reforgeRequests.filter((item) => item.url === "/sdapi/v1/txt2img").length,
    2,
    "IP-Adapter利用不可時はReForge生成endpointへフォールバックしない"
  );
  const disabledEventsStart = reforgeRequests.events.length;
  const disabledIpQueued = await postJson(`${baseUrl}/api/jobs`, {
    description: "IP-Adapterを明示的にOFF",
    prompt: "1girl, disabled ip adapter",
    ipAdapter: { enabled: false },
    loras: [],
    settings: { width: 512, height: 512, steps: 5, candidateCount: 1 }
  });
  const disabledIpCompleted = await waitForJob(baseUrl, disabledIpQueued.job.id);
  assert.equal(disabledIpCompleted.status, "done", "IP-Adapter OFFなら通常生成を続行する");
  const disabledEvents = reforgeRequests.events.slice(disabledEventsStart);
  assert.equal(
    disabledEvents.some((event) => event.url === "/controlnet/module_list" || event.url === "/controlnet/model_list"),
    false,
    "IP-Adapter OFFでは能力確認を行わない"
  );
  const disabledIpRequest = disabledEvents.find((event) => event.url === "/sdapi/v1/txt2img");
  assert.ok(disabledIpRequest, "IP-Adapter OFFでも通常のtxt2imgを呼ぶ");
  assert.equal(disabledIpRequest.body.alwayson_scripts?.ControlNet, undefined, "OFFではControlNet unitを追加しない");
  await fetch(`${baseUrl}/api/history/${disabledIpCompleted.result.images[0].id}`, { method: "DELETE" });
  reforgeRequests.ipAdapterModelSupported = true;

  const uploadIpQueued = await postJson(`${baseUrl}/api/jobs`, {
    description: "IP-Adapterアップロード",
    prompt: "1girl, uploaded ip adapter",
    ipAdapter: {
      enabled: true,
      referenceImage: `data:image/png;base64,${ONE_PIXEL_PNG}`,
      weight: 0.65,
      guidanceStart: 0,
      guidanceEnd: 1
    },
    loras: [],
    settings: { width: 512, height: 512, steps: 5, candidateCount: 1 }
  });
  const uploadIpCompleted = await waitForJob(baseUrl, uploadIpQueued.job.id);
  assert.equal(uploadIpCompleted.status, "done");
  assert.match(uploadIpCompleted.result.ipAdapter.referenceImageUrl, /^\/outputs\/ip-adapter-reference_[a-f0-9]{20}\.png$/);
  assert.ok(await fileExists(path.join(
    temporaryDir, "outputs", path.basename(uploadIpCompleted.result.ipAdapter.referenceImageUrl)
  )));
  const uploadIpRecipe = await (await fetch(
    `${baseUrl}/api/history/${uploadIpCompleted.result.images[0].id}/recipe`
  )).json();
  assert.equal(uploadIpRecipe.ipAdapter.referenceImageUrl, uploadIpCompleted.result.ipAdapter.referenceImageUrl);
  assert.equal(JSON.stringify(uploadIpRecipe).includes(ONE_PIXEL_PNG), false);
  assert.equal(JSON.stringify(uploadIpRecipe).includes("data:image"), false);
  await fetch(`${baseUrl}/api/history/${uploadIpCompleted.result.images[0].id}`, { method: "DELETE" });
  await fetch(`${baseUrl}/api/history/${ipCompleted.result.images[0].id}`, { method: "DELETE" });

  // 現在のReForge相当: options GETにNoise scheduleキーがない場合も生成を続ける。
  reforgeRequests.optionsKeySupported = false;
  const unsupportedGenerationEventsStart = reforgeRequests.events.length;
  const unsupportedQueued = await postJson(`${baseUrl}/api/jobs`, {
    description: "未対応Noise scheduleの生成",
    prompt: "1girl, unsupported noise schedule",
    negativePrompt: "low quality",
    loras: [],
    settings: {
      width: 512,
      height: 512,
      steps: 5,
      candidateCount: 1,
      noiseSchedule: "Zero Terminal SNR"
    }
  });
  const unsupportedCompleted = await waitForJob(baseUrl, unsupportedQueued.job.id);
  assert.equal(unsupportedCompleted.status, "done", "未対応キーでも生成ジョブを成功させる");
  const unsupportedGenerationEvents = reforgeRequests.events
    .slice(unsupportedGenerationEventsStart)
    .filter((event) => ["/sdapi/v1/options", "/sdapi/v1/txt2img"].includes(event.url));
  assert.deepEqual(
    unsupportedGenerationEvents.map((event) => `${event.method} ${event.url}`),
    ["GET /sdapi/v1/options", "POST /sdapi/v1/txt2img"],
    "未対応キーを含むoptions POSTを行わず生成する"
  );
  assert.equal(
    unsupportedGenerationEvents.filter(
      (event) => event.method === "POST" && event.body?.sd_noise_schedule_sampling !== undefined
    ).length,
    0,
    "未対応キーのoptions POSTは0回"
  );
  await fetch(`${baseUrl}/api/history/${unsupportedCompleted.result.images[0].id}`, { method: "DELETE" });
  reforgeRequests.optionsKeySupported = true;

  // 用途別プロンプトとLoRAトリガーワードが履歴へそのまま残る（復元用）。
  const structuredQueued = await postJson(`${baseUrl}/api/jobs`, {
    description: "構造化プロンプトのテスト",
    titleMode: "character-outfit",
    prompt: "1girl, (character_name:1.2), classroom",
    negativePrompt: "low quality",
    structuredPrompt: {
      character: "1girl, solo, character_name",
      appearance: "sailor uniform",
      situation: "classroom",
      unknown: "無視される"
    },
    rawPromptOverride: false,
    rawPrompt: "",
    appliedTriggerWords: [{
      id: "trigger:character_name",
      sourceLoraId: "Characters/test",
      sourceLoraIds: ["Characters/test"],
      text: "character_name",
      weight: 1.2,
      targetField: "character",
      enabled: true
    }],
    // 画面側でプロンプトへ組み込み済みなので、triggerWordsは空で送る。
    loras: [
      {
        name: "Characters/test",
        weight: 0.8,
        enabled: true,
        triggerWords: "",
        characterTriggerWords: "character_name",
        outfitChoiceId: "preset:dreaming",
        outfitPresetName: "dreaming_high",
        outfitTriggerWords: "dreaming_high, white_jacket"
      },
      {
        name: "Characters/off",
        weight: 0.7,
        enabled: false,
        triggerWords: "must_not_be_sent"
      }
    ],
    settings: { width: 512, height: 512, steps: 5, candidateCount: 1 }
  });
  const structuredCompleted = await waitForJob(baseUrl, structuredQueued.job.id);
  assert.equal(structuredCompleted.status, "done");
  assert.equal(structuredCompleted.result.title, "character_name · sailor uniform");
  assert.deepEqual(structuredCompleted.result.structuredPrompt, {
    character: "1girl, solo, character_name",
    appearance: "sailor uniform",
    composition: "",
    situation: "classroom",
    style: "",
    extra: ""
  });
  assert.equal(structuredCompleted.result.appliedTriggerWords[0].weight, 1.2);
  // LoRA本体のWeightとトリガーワードのWeightは別管理。
  assert.equal(structuredCompleted.result.loras[0].weight, 0.8);
  assert.equal(structuredCompleted.result.loras[0].enabled, true);
  assert.equal(structuredCompleted.result.loras[0].characterTriggerWords, "character_name");
  assert.equal(structuredCompleted.result.loras[0].outfitChoiceId, "preset:dreaming");
  assert.equal(structuredCompleted.result.loras[0].outfitPresetName, "dreaming_high");
  assert.equal(structuredCompleted.result.loras[0].outfitTriggerWords, "dreaming_high, white_jacket");
  assert.equal(structuredCompleted.result.loras[1].enabled, false);
  assert.equal(
    structuredCompleted.result.effectivePrompt,
    "1girl, (character_name:1.2), classroom, <lora:Characters/test:0.8>",
    "組み込み済みのトリガーワードをサーバーが二重に追記しない"
  );
  assert.equal(structuredCompleted.result.effectivePrompt.includes("Characters/off"), false);
  assert.equal(structuredCompleted.result.effectivePrompt.includes("must_not_be_sent"), false);
  const structuredRecipe = await (await fetch(
    `${baseUrl}/api/history/${structuredCompleted.result.images[0].id}/recipe`
  )).json();
  assert.equal(structuredRecipe.structuredPrompt.situation, "classroom");
  assert.equal(structuredRecipe.rawPromptOverride, false);
  assert.equal(structuredRecipe.appliedTriggerWords[0].targetField, "character");
  assert.equal(structuredRecipe.loras[0].outfitChoiceId, "preset:dreaming");
  assert.equal(structuredRecipe.loras[1].enabled, false);
  await fetch(`${baseUrl}/api/history/${structuredCompleted.result.images[0].id}`, { method: "DELETE" });

  // プロンプト内のLoRAタグが実効Weightとして履歴へ残り、重複タグは1つにまとめられる。
  const loraTagQueued = await postJson(`${baseUrl}/api/jobs`, {
    description: "LoRAタグ同期",
    prompt: "1girl, <lora:Characters/saileach_IL:0.6>, blue eyes, <lora:Characters/saileach_IL:0.65>",
    negativePrompt: "low quality",
    // UI側は古い1.0のまま送っても、実際に使ったWeightへ揃える。
    loras: [{ name: "Characters/saileach_IL", weight: 1, source: "both" }],
    loraNotices: [{ type: "duplicate", name: "Characters/saileach_IL", weights: [0.6, 0.65], weight: 0.65 }],
    settings: { width: 512, height: 512, steps: 5, candidateCount: 1 }
  });
  const loraTagCompleted = await waitForJob(baseUrl, loraTagQueued.job.id);
  assert.equal(loraTagCompleted.status, "done");
  assert.equal(
    loraTagCompleted.result.effectivePrompt,
    "1girl, blue eyes, <lora:Characters/saileach_IL:0.65>",
    "同一LoRAは最後の1つだけを生成へ送る"
  );
  assert.deepEqual(loraTagCompleted.result.loras, [{
    name: "Characters/saileach_IL",
    weight: 0.65,
    triggerWords: "",
    negativeWords: "",
    source: "both"
  }]);
  const loraTagRecipe = await (await fetch(
    `${baseUrl}/api/history/${loraTagCompleted.result.images[0].id}/recipe`
  )).json();
  assert.equal(loraTagRecipe.loras[0].weight, 0.65, "履歴のWeightがeffectivePromptと一致する");
  assert.equal(loraTagRecipe.loras[0].source, "both");
  assert.equal(loraTagRecipe.prompt.includes("<lora:Characters/saileach_IL:0.6>"), true, "元の入力は残す");
  // 画面側で報告済みの重複は二重に記録しない。
  assert.deepEqual(loraTagRecipe.loraNotices, [
    { type: "duplicate", name: "Characters/saileach_IL", weights: [0.6, 0.65], weight: 0.65 }
  ]);
  await fetch(`${baseUrl}/api/history/${loraTagCompleted.result.images[0].id}`, { method: "DELETE" });

  // 説明文なしでもPromptがあれば生成でき、履歴には「無題」で残る。
  const untitledQueued = await postJson(`${baseUrl}/api/jobs`, {
    prompt: "1girl, untitled run",
    negativePrompt: "low quality",
    loras: [],
    settings: { width: 512, height: 512, steps: 5, candidateCount: 1 }
  });
  const untitledCompleted = await waitForJob(baseUrl, untitledQueued.job.id);
  assert.equal(untitledCompleted.status, "done");
  const untitledRecipe = await (await fetch(
    `${baseUrl}/api/history/${untitledCompleted.result.images[0].id}/recipe`
  )).json();
  assert.equal(untitledRecipe.description, "無題");
  assert.equal(untitledRecipe.prompt, "1girl, untitled run");
  await fetch(`${baseUrl}/api/history/${untitledCompleted.result.images[0].id}`, { method: "DELETE" });

  // 説明文もPromptも無い場合は拒否する。
  const emptyQueued = await postJson(`${baseUrl}/api/jobs`, {
    loras: [],
    settings: { width: 512, height: 512, steps: 5, candidateCount: 1 }
  });
  const emptyFinished = await waitForJob(baseUrl, emptyQueued.job.id);
  assert.equal(emptyFinished.status, "failed");
  assert.match(emptyFinished.error, /生成したい内容かPrompt/);
  const favorited = await patchJson(`${baseUrl}/api/history/${image.id}/favorite`, { favorite: true });
  const preferences = await (await fetch(`${baseUrl}/api/history/preferences`)).json();
  assert.equal(preferences.favoriteCount, 1);
  assert.equal(preferences.topTags[0].name, "blue hair");

  // Discord: 送信先が未設定でもFavoriteは成功し、状態はnot_sentのまま。
  assert.equal(favorited.image.favorite, true);
  assert.deepEqual(favorited.image.discord, {
    status: "not_sent", messageId: null, sentAt: null, error: ""
  });
  const discordState = await (await fetch(`${baseUrl}/api/history/${image.id}/discord`)).json();
  assert.equal(discordState.discord.status, "not_sent");
  const noTarget = await fetch(`${baseUrl}/api/history/${image.id}/discord/send`, { method: "POST" });
  assert.equal(noTarget.status, 409);
  assert.match((await noTarget.json()).error, /送信先が設定されていません/);

  // 設定APIはWebhook URLを返さない。Discord以外のURLは拒否する。
  const discordSettings = await (await fetch(`${baseUrl}/api/discord/settings`)).json();
  assert.deepEqual(Object.keys(discordSettings.settings).sort(), [
    "autoSend", "generationAttachmentMode", "generationAutoSend", "generationIncludeDuration",
    "generationIncludeImage", "generationIncludeModel", "generationIncludeSeed", "generationIncludeTitle",
    "includeMetadata", "includePrompt", "storedWebhookConfigured",
    "webhookConfigured", "webhookEditable", "webhookHint", "webhookSource"
  ]);
  assert.equal(discordSettings.settings.webhookConfigured, false);
  const rejected = await fetch(`${baseUrl}/api/discord/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ webhookUrl: "https://example.com/api/webhooks/1/abc" })
  });
  assert.equal(rejected.status, 400);
  const savedSettings = await patchJson(`${baseUrl}/api/discord/settings`, {
    webhookUrl: "https://discord.com/api/webhooks/123456789012345678/token-value-here",
    autoSend: false,
    includePrompt: false
  });
  assert.equal(savedSettings.settings.webhookConfigured, true);
  assert.equal(savedSettings.settings.autoSend, false);
  assert.equal(savedSettings.settings.includePrompt, false);
  assert.equal(JSON.stringify(savedSettings).includes("token-value-here"), false, "Webhook URLを返さない");
  assert.equal(savedSettings.settings.webhookHint, "discord.com/api/webhooks/123456789012345678/••••");
  await patchJson(`${baseUrl}/api/discord/settings`, { clearWebhook: true, autoSend: true, includePrompt: true });

  const favoritesDir = path.join(temporaryDir, "outputs", "favorite");
  const favoritedFile = path.join(favoritesDir, path.basename(image.imageUrl));
  assert.ok(await fileExists(favoritedFile), "お気に入りにするとoutputs/favoriteへ複製する");
  const favoriteResponse = await fetch(`${baseUrl}/favorites/${path.basename(image.imageUrl)}`);
  assert.equal(favoriteResponse.status, 200);

  await patchJson(`${baseUrl}/api/history/${image.id}/favorite`, { favorite: false });
  assert.equal(await fileExists(favoritedFile), false, "お気に入り解除でoutputs/favoriteから削除する");

  await patchJson(`${baseUrl}/api/history/${image.id}/favorite`, { favorite: true });

  // 履歴削除: 出力ファイル・お気に入り複製・履歴エントリがすべて消える
  const outputFile = path.join(temporaryDir, "outputs", path.basename(image.imageUrl));
  assert.ok(await fileExists(outputFile), "削除前は出力ファイルが存在する");
  const deleteResult = await (await fetch(`${baseUrl}/api/history/${image.id}`, { method: "DELETE" })).json();
  assert.equal(deleteResult.ok, true);
  assert.equal(await fileExists(outputFile), false, "削除でoutputファイルも消える");
  assert.equal(
    await fileExists(path.join(temporaryDir, "outputs", "thumbnails", `${image.id}.webp`)),
    false,
    "削除でサムネイルも消える"
  );
  assert.equal(await fileExists(favoritedFile), false, "削除でお気に入り複製も消える");
  const goneRecipe = await fetch(`${baseUrl}/api/history/${image.id}/recipe`);
  assert.equal(goneRecipe.status, 404, "削除後は履歴から引けない");
  const gonePreferences = await (await fetch(`${baseUrl}/api/history/preferences`)).json();
  assert.equal(gonePreferences.favoriteCount, 0, "削除で👍集計からも外れる");

  const img2imgQueued = await postJson(`${baseUrl}/api/jobs`, {
    mode: "img2img",
    description: "衣装だけ変更",
    prompt: "masterpiece, 1girl, red dress",
    negativePrompt: "low quality",
    initImage: `data:image/png;base64,${ONE_PIXEL_PNG}`,
    ipAdapter: {
      enabled: true,
      referenceImage: `data:image/png;base64,${ONE_PIXEL_PNG}`,
      weight: 0.7,
      guidanceStart: 0,
      guidanceEnd: 1
    },
    loras: [],
    settings: {
      width: 512,
      height: 512,
      steps: 5,
      candidateCount: 1,
      img2imgDenoising: 0.45,
      img2imgResizeMode: 2
    }
  });
  const img2imgCompleted = await waitForJob(baseUrl, img2imgQueued.job.id);
  assert.equal(img2imgCompleted.status, "done");
  assert.equal(img2imgCompleted.result.mode, "img2img");
  assert.match(img2imgCompleted.result.sourceImageUrl, /^\/outputs\/img2img-source_[a-f0-9]{20}\.png$/);

  const img2imgRequest = reforgeRequests.find((item) => item.url === "/sdapi/v1/img2img");
  assert.ok(img2imgRequest);
  assert.equal(img2imgRequest.body.init_images[0], ONE_PIXEL_PNG);
  assert.equal(img2imgRequest.body.alwayson_scripts.ControlNet.args[0].image, ONE_PIXEL_PNG);
  assert.equal(img2imgRequest.body.denoising_strength, 0.45);
  assert.equal(img2imgRequest.body.resize_mode, 2);

  const img2imgImage = img2imgCompleted.result.images[0];
  const recipeResponse = await fetch(`${baseUrl}/api/history/${img2imgImage.id}/recipe`);
  const recipe = await recipeResponse.json();
  assert.equal(recipe.mode, "img2img");
  assert.equal(recipe.sourceImageUrl, img2imgCompleted.result.sourceImageUrl);

  const inpaintQueued = await postJson(`${baseUrl}/api/jobs`, {
    mode: "inpaint",
    description: "上着だけ変更",
    prompt: "masterpiece, 1girl, white jacket",
    negativePrompt: "low quality",
    initImageId: img2imgImage.id,
    ipAdapter: {
      enabled: true,
      referenceImageId: img2imgImage.id,
      weight: 0.6,
      guidanceStart: 0.15,
      guidanceEnd: 0.95
    },
    maskImage: `data:image/png;base64,${ONE_PIXEL_PNG}`,
    loras: [],
    settings: {
      width: 512,
      height: 512,
      steps: 5,
      candidateCount: 1,
      img2imgResizeMode: 1,
      inpaintDenoising: 0.55,
      maskBlur: 6,
      inpaintFill: 1,
      inpaintFullRes: true,
      inpaintFullResPadding: 32
    }
  });
  const inpaintCompleted = await waitForJob(baseUrl, inpaintQueued.job.id);
  assert.equal(inpaintCompleted.status, "done");
  assert.equal(inpaintCompleted.result.mode, "inpaint");
  assert.match(inpaintCompleted.result.maskImageUrl, /^\/outputs\/inpaint-mask_[a-f0-9]{20}\.png$/);

  const inpaintRequest = reforgeRequests.filter((item) => item.url === "/sdapi/v1/img2img").at(-1);
  assert.equal(inpaintRequest.body.mask, ONE_PIXEL_PNG);
  assert.equal(inpaintRequest.body.denoising_strength, 0.55);
  assert.equal(inpaintRequest.body.mask_blur, 6);
  assert.equal(inpaintRequest.body.inpainting_fill, 1);
  assert.equal(inpaintRequest.body.inpaint_full_res, true);
  assert.equal(inpaintRequest.body.inpaint_full_res_padding, 32);
  assert.equal(inpaintRequest.body.inpainting_mask_invert, 0);
  assert.equal(inpaintRequest.body.alwayson_scripts.ControlNet.args[0].image, ONE_PIXEL_PNG);
  assert.equal(inpaintRequest.body.init_images[0], ONE_PIXEL_PNG, "inpaint元画像とIP参照は別のunitで送る");

  const inpaintImage = inpaintCompleted.result.images[0];
  const inpaintRecipe = await (await fetch(`${baseUrl}/api/history/${inpaintImage.id}/recipe`)).json();
  assert.equal(inpaintRecipe.mode, "inpaint");
  assert.equal(inpaintRecipe.maskImageUrl, inpaintCompleted.result.maskImageUrl);

  const refineQueued = await postJson(`${baseUrl}/api/jobs`, {
    mode: "img2img",
    description: "高解像度仕上げ",
    prompt: "masterpiece, 1girl, red dress",
    negativePrompt: "low quality",
    initImageId: img2imgImage.id,
    parentImageId: img2imgImage.id,
    ipAdapter: img2imgCompleted.result.ipAdapter,
    loras: [],
    settings: {
      width: 512,
      height: 512,
      steps: 5,
      candidateCount: 1,
      img2imgDenoising: 0.45,
      img2imgResizeMode: 1,
      hiresEnabled: true,
      hiresScale: 1.5,
      hiresSteps: 7,
      hiresDenoising: 0.32
    }
  });
  const refined = await waitForJob(baseUrl, refineQueued.job.id);
  assert.equal(refined.status, "done");
  assert.equal(refined.result.images[0].width, 768);
  assert.equal(refined.result.images[0].height, 768);
  const refineRequest = reforgeRequests.filter((item) => item.url === "/sdapi/v1/img2img").at(-1);
  assert.equal(refineRequest.body.width, 768);
  assert.equal(refineRequest.body.height, 768);
  assert.equal(refineRequest.body.steps, 7);
  assert.equal(refineRequest.body.denoising_strength, 0.32);
  assert.equal(refineRequest.body.enable_hr, undefined);

  const inpaintRefineQueued = await postJson(`${baseUrl}/api/jobs`, {
    mode: "inpaint",
    description: "部分修正の高解像度仕上げ",
    prompt: "masterpiece, 1girl, white jacket",
    negativePrompt: "low quality",
    initImageId: inpaintImage.id,
    parentImageId: inpaintImage.id,
    ipAdapter: inpaintCompleted.result.ipAdapter,
    loras: [],
    settings: {
      width: 512,
      height: 512,
      steps: 5,
      candidateCount: 1,
      img2imgResizeMode: 1,
      inpaintDenoising: 0.55,
      hiresEnabled: true,
      hiresScale: 1.5,
      hiresSteps: 7,
      hiresDenoising: 0.3
    }
  });
  const inpaintRefined = await waitForJob(baseUrl, inpaintRefineQueued.job.id);
  assert.equal(inpaintRefined.status, "done");
  assert.equal(inpaintRefined.result.mode, "inpaint");
  const inpaintRefineRequest = reforgeRequests.filter((item) => item.url === "/sdapi/v1/img2img").at(-1);
  assert.equal(inpaintRefineRequest.body.mask, undefined);
  assert.equal(inpaintRefineRequest.body.denoising_strength, 0.3);
  assert.equal(inpaintRefineRequest.body.width, 768);
  assert.equal(inpaintRefineRequest.body.height, 768);

  const v1Capabilities = await requestJsonWithStatus(`${baseUrl}/api/v1/capabilities`);
  assert.equal(v1Capabilities.status, 200);
  assert.equal(v1Capabilities.body.checkpoints[0].id, "mock.safetensors");
  assert.equal("filename" in v1Capabilities.body.checkpoints[0], false);
  const v1Accepted = await requestJsonWithStatus(`${baseUrl}/api/v1/generations`, {
    method: "POST",
    body: {
      mode: "txt2img",
      prompt: { rawOverride: "1girl, blue hair", negative: "low quality" },
      settings: { width: 512, height: 512, steps: 5, cfgScale: 5, candidateCount: 1 },
      metadata: { client: "integration-test" }
    }
  });
  assert.equal(v1Accepted.status, 202);
  assert.equal(v1Accepted.body.status, "queued");
  const v1Completed = await waitForV1Job(baseUrl, v1Accepted.body.id);
  assert.equal(v1Completed.status, "done");
  assert.equal(v1Completed.progress, 1);
  assert.equal(v1Completed.result.images.length, 1);
  assert.equal("filename" in v1Completed.result.images[0], false);

  // 添付readerからraw Asset API、v1生成、Runtime、ReForge、Historyまでを一連で確認する。
  const attachmentRoot = path.join(temporaryDir, "attachments");
  const attachmentPath = path.join(attachmentRoot, "host-attached.png");
  await fs.mkdir(attachmentRoot, { recursive: true });
  await fs.writeFile(attachmentPath, Buffer.from(ONE_PIXEL_PNG, "base64"));
  const attachmentReader = createAttachmentReader({
    env: { LOCAL_IMAGE_CHAT_IMPORT_ROOTS: attachmentRoot }
  });
  const attachment = await attachmentReader.read(attachmentPath);
  const importedResponse = await fetch(`${baseUrl}/api/v1/assets/images`, {
    method: "POST",
    headers: { "Content-Type": attachment.mimeType },
    body: attachment.bytes
  });
  const importedAsset = await importedResponse.json();
  assert.equal(importedResponse.status, 201);
  assert.match(importedAsset.id, /^asset-[a-z0-9-]+$/);
  assert.doesNotMatch(JSON.stringify(importedAsset), /host-attached|attachments|base64/);
  const normalizedResponse = await fetch(`${baseUrl}${importedAsset.originalUrl}`);
  const normalizedBase64 = Buffer.from(await normalizedResponse.arrayBuffer()).toString("base64");

  const assetGeneration = await requestJsonWithStatus(`${baseUrl}/api/v1/generations`, {
    method: "POST",
    body: {
      mode: "txt2img",
      prompt: { rawOverride: "asset runtime generation" },
      settings: { width: 512, height: 512, steps: 5, candidateCount: 1 },
      ipAdapter: { referenceImageId: importedAsset.id, weight: 0.65, guidanceStart: 0, guidanceEnd: 1 }
    }
  });
  assert.equal(assetGeneration.status, 202);
  const assetGenerationDone = await waitForV1Job(baseUrl, assetGeneration.body.id);
  assert.equal(assetGenerationDone.status, "done");
  const assetGenerationHistoryId = assetGenerationDone.result.historyId;
  const assetGenerationHistory = await requestJsonWithStatus(
    `${baseUrl}/api/v1/history/${assetGenerationHistoryId}`
  );
  assert.equal(assetGenerationHistory.status, 200);
  assert.deepEqual(assetGenerationHistory.body.ipAdapter, {
    referenceImageId: importedAsset.id,
    weight: 0.65,
    guidanceStart: 0,
    guidanceEnd: 1
  });
  assert.doesNotMatch(JSON.stringify(assetGenerationHistory.body), /host-attached|attachments|base64|C:\\\\/);
  const assetGenerationRequest = reforgeRequests.filter((item) => item.url === "/sdapi/v1/txt2img").at(-1);
  assert.equal(assetGenerationRequest.body.alwayson_scripts.ControlNet.args[0].image, normalizedBase64);

  const assetRegeneration = await requestJsonWithStatus(
    `${baseUrl}/api/v1/history/${assetGenerationHistoryId}/regenerations`,
    {
      method: "POST",
      body: {
        sourceImageId: assetGenerationHistory.body.images[0].id,
        ipAdapter: { referenceImageId: importedAsset.id, weight: 0.45, guidanceStart: 0.1, guidanceEnd: 0.9 }
      }
    }
  );
  assert.equal(assetRegeneration.status, 202);
  const assetRegenerationDone = await waitForV1Job(baseUrl, assetRegeneration.body.id);
  assert.equal(assetRegenerationDone.status, "done");
  const assetRegenerationHistory = await requestJsonWithStatus(
    `${baseUrl}/api/v1/history/${assetRegenerationDone.result.historyId}`
  );
  assert.deepEqual(assetRegenerationHistory.body.ipAdapter, {
    referenceImageId: importedAsset.id,
    weight: 0.45,
    guidanceStart: 0.1,
    guidanceEnd: 0.9
  });
  const assetRegenerationRequest = reforgeRequests.filter((item) => item.url === "/sdapi/v1/txt2img").at(-1);
  assert.equal(assetRegenerationRequest.body.alwayson_scripts.ControlNet.args[0].image, normalizedBase64);

  const historyBeforeUnavailableAsset = await requestJsonWithStatus(`${baseUrl}/api/v1/history?limit=50`);
  const generatedBeforeUnavailableAsset = reforgeRequests.filter((item) => item.url === "/sdapi/v1/txt2img").length;
  reforgeRequests.ipAdapterModelSupported = false;
  const unavailableAssetGeneration = await requestJsonWithStatus(`${baseUrl}/api/v1/generations`, {
    method: "POST",
    body: {
      mode: "txt2img",
      prompt: { rawOverride: "asset capability unavailable" },
      settings: { width: 512, height: 512, steps: 5, candidateCount: 1 },
      ipAdapter: { referenceImageId: importedAsset.id }
    }
  });
  const unavailableAssetDone = await waitForV1Job(baseUrl, unavailableAssetGeneration.body.id);
  assert.equal(unavailableAssetDone.status, "failed");
  assert.equal(
    reforgeRequests.filter((item) => item.url === "/sdapi/v1/txt2img").length,
    generatedBeforeUnavailableAsset,
    "利用不可時はAsset参照でもReForge生成へfallbackしない"
  );
  const historyAfterUnavailableAsset = await requestJsonWithStatus(`${baseUrl}/api/v1/history?limit=50`);
  assert.equal(historyAfterUnavailableAsset.body.total, historyBeforeUnavailableAsset.body.total);
  reforgeRequests.ipAdapterModelSupported = true;

  // 実サーバーを同じroot+portで2個起動し、2個目だけが拒否されることを確認する。
  const duplicate = spawn(process.execPath, ["src/server.js"], {
    cwd: path.resolve("."),
    env: serverEnv,
    stdio: ["ignore", "ignore", "pipe"]
  });
  serverChildren.push(duplicate);
  let duplicateStderr = "";
  duplicate.stderr.setEncoding("utf8");
  duplicate.stderr.on("data", (chunk) => {
    duplicateStderr += chunk;
  });
  assert.equal(await waitForChildExit(duplicate, 5000), true, "二重起動側が一定時間内に終了する");
  assert.equal(duplicate.exitCode, 1, "二重起動側だけが非0終了する");
  assert.match(duplicateStderr, /Local Image Chatは既に起動しています。/);
  assert.match(duplicateStderr, /PID:/);
  assert.match(duplicateStderr, /Port:/);
  assert.equal((await fetch(`${baseUrl}/api/config`)).status, 200, "1個目は応答を継続する");

  // 1個目の終了完了後、同じroot+portを再取得できることを確認する。
  await stopTestServer(child, appPort);
  const third = spawn(process.execPath, ["src/server.js"], {
    cwd: path.resolve("."),
    env: serverEnv,
    stdio: ["ignore", "pipe", "pipe"]
  });
  serverChildren.push(third);
  await waitForServer(`${baseUrl}/api/config`, third);
  const thirdConfig = await (await fetch(`${baseUrl}/api/config`)).json();
  assert.equal(thirdConfig.runtime.binding.port, appPort);
  assert.notEqual(thirdConfig.runtime.pid, runtimeConfig.runtime.pid, "終了後は別PIDで再取得できる");
});

function handleOllama(request, response) {
  if (request.url === "/api/tags") return json(response, { models: [{ name: "mock" }] });
  if (request.url === "/api/generate") return json(response, { response: "masterpiece, 1girl, blue hair" });
  response.writeHead(404).end();
}

async function handleReforge(request, response, requests) {
  if (request.url?.startsWith("/controlnet/module_list")) {
    requests.events.push({ method: request.method, url: request.url });
    return json(response, {
      module_list: requests.ipAdapterModuleSupported ? ["None", "CLIP-ViT-H (IPAdapter)"] : ["None"]
    });
  }
  if (request.url?.startsWith("/controlnet/model_list")) {
    requests.events.push({ method: request.method, url: request.url });
    return json(response, {
      model_list: requests.ipAdapterModelSupported
        ? ["None", "ip-adapter-plus_sdxl_vit-h [3f5062b8]"]
        : ["None"]
    });
  }
  if (request.url === "/sdapi/v1/options" && request.method === "POST") {
    const body = JSON.parse(await readBody(request));
    requests.events.push({ method: request.method, url: request.url, body });
    if (body.sd_model_checkpoint !== undefined) requests.activeCheckpoint = body.sd_model_checkpoint;
    if (body.sd_noise_schedule_sampling !== undefined) requests.noiseSchedule = body.sd_noise_schedule_sampling;
    return json(response, {});
  }
  if (request.url === "/sdapi/v1/options") {
    requests.events.push({ method: request.method, url: request.url });
    const options = { sd_model_checkpoint: requests.activeCheckpoint ?? "mock.safetensors" };
    if (requests.optionsKeySupported) options.sd_noise_schedule_sampling = "Automatic";
    return json(response, options);
  }
  if (request.url === "/sdapi/v1/sd-models") {
    return json(response, [
      { title: "mock.safetensors", model_name: "mock", filename: "C:\\Models\\mock.safetensors" },
      {
        title: "waiNSFWIllustrious_v170.safetensors",
        model_name: "waiNSFWIllustrious_v170",
        filename: "C:\\Models\\waiNSFWIllustrious_v170.safetensors"
      }
    ]);
  }
  if (request.url === "/sdapi/v1/loras") return json(response, []);
  if (request.url?.startsWith("/sdapi/v1/progress")) return json(response, { progress: 0.5, eta_relative: 1 });
  if (request.url === "/sdapi/v1/upscalers") return json(response, [{ name: "Mock" }]);
  if (request.url === "/sdapi/v1/refresh-loras") return json(response, {});
  if (request.url === "/sdapi/v1/txt2img" || request.url === "/sdapi/v1/img2img") {
    const text = await readBody(request);
    const body = JSON.parse(text);
    requests.events.push({ method: request.method, url: request.url, body });
    requests.push({ url: request.url, body });
    return json(response, {
      images: [ONE_PIXEL_PNG],
      info: JSON.stringify({ seed: 123, all_seeds: [123] })
    });
  }
  response.writeHead(404).end();
}

function startMockServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((request, response) => {
      Promise.resolve(handler(request, response)).catch((error) => {
        response.writeHead(500).end(error.message);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({
      port: server.address().port,
      close: () => new Promise((done) => server.close(done))
    }));
  });
}

async function reservePort() {
  const server = await startMockServer((_request, response) => response.end());
  const { port } = server;
  await server.close();
  return port;
}

function json(response, body) {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  let text = "";
  for await (const chunk of request) text += chunk;
  return text;
}

async function waitForServer(url, child) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5000) {
    if (child.exitCode !== null) throw new Error(`server exited with ${child.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // 起動待ち
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("server start timeout");
}

async function waitForJob(baseUrl, id) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5000) {
    const data = await (await fetch(`${baseUrl}/api/jobs/${id}`)).json();
    if (["done", "failed", "cancelled"].includes(data.job.status)) return data.job;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error("job timeout");
}

async function waitForV1Job(baseUrl, id) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5000) {
    const response = await fetch(`${baseUrl}/api/v1/generations/${id}`);
    const body = await response.json();
    if (["done", "failed", "cancelled"].includes(body.status)) return body;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error("v1 job timeout");
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function createIsolatedStorageServer(t, suffix) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), `local-image-chat-${suffix}-`));
  const state = {
    workspace,
    dataDir: path.join(workspace, "data"),
    outputDir: path.join(workspace, "outputs"),
    targetDir: path.join(workspace, "migrated-outputs"),
    baseUrl: null,
    appPort: null,
    child: null,
    ollama: null,
    reforge: null,
    start: null,
    stop: null
  };

  t.after(async () => {
    let cleanupError;
    try {
      await state.stop?.();
    } catch (error) {
      cleanupError ??= error;
    }
    for (const mock of [state.ollama, state.reforge]) {
      if (!mock) continue;
      try {
        await mock.close();
      } catch (error) {
        cleanupError ??= error;
      }
    }
    try {
      await removeIsolatedWorkspace(workspace);
    } catch (error) {
      cleanupError ??= error;
    }
    if (cleanupError) throw cleanupError;
  });

  await Promise.all([
    fs.cp(path.resolve("src"), path.join(workspace, "src"), { recursive: true }),
    fs.cp(path.resolve("public"), path.join(workspace, "public"), { recursive: true }),
    fs.copyFile(path.resolve("config.json"), path.join(workspace, "config.json")),
    fs.copyFile(path.resolve("package.json"), path.join(workspace, "package.json"))
  ]);

  try {
    await fs.symlink(path.resolve("node_modules"), path.join(workspace, "node_modules"), "junction");
  } catch {
    t.skip("隔離workspace用node_modules junctionを作成できません");
    return null;
  }

  const mockHandler = (_request, response) => response.writeHead(404).end();
  state.ollama = await startMockServer(mockHandler);
  state.reforge = await startMockServer(mockHandler);
  state.appPort = await reservePort();
  state.baseUrl = `http://127.0.0.1:${state.appPort}`;
  const configPath = path.join(workspace, "config.test.json");
  await fs.writeFile(configPath, JSON.stringify({
    host: "127.0.0.1",
    port: state.appPort,
    ollama: { url: `http://127.0.0.1:${state.ollama.port}`, model: "mock", timeoutMs: 500 },
    reforge: { url: `http://127.0.0.1:${state.reforge.port}`, timeoutMs: 500 },
    defaults: {
      width: 1,
      height: 1,
      steps: 1,
      cfgScale: 1,
      samplerName: "Euler a",
      scheduler: "Automatic",
      candidateCount: 1,
      hiresScale: 1.5,
      hiresSteps: 1,
      hiresDenoising: 0.4,
      hiresUpscaler: "Mock"
    }
  }, null, 2));

  state.start = async () => {
    if (state.child) throw new Error("隔離テストサーバーはすでに起動しています");
    const env = {
      ...process.env,
      LOCAL_IMAGE_CHAT_CONFIG: configPath,
      LOCAL_IMAGE_CHAT_DATA_DIR: state.dataDir
    };
    delete env.LOCAL_IMAGE_CHAT_OUTPUT_DIR;
    delete env.LOCAL_IMAGE_CHAT_FAVORITES_DIR;
    delete env.LOCAL_IMAGE_CHAT_ROOT_DIR;
    delete env.LOCAL_IMAGE_CHAT_PORT;
    delete env.LOCAL_IMAGE_CHAT_HOST;
    state.child = spawn(process.execPath, [path.join(workspace, "src", "server.js")], {
      cwd: workspace,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    state.child.stdout.resume();
    state.child.stderr.resume();
    await waitForServer(`${state.baseUrl}/api/config`, state.child);
    return state.child;
  };
  state.stop = async () => {
    if (!state.child) return;
    const child = state.child;
    await stopTestServer(child, state.appPort, { cleanupLock: false });
    state.child = null;
    await fs.rm(getInstanceLockPath(workspace, state.appPort), { force: true });
  };
  return state;
}

async function seedStorageFixture(server, {
  filename,
  imageId,
  extraFiles = []
}) {
  const image = Buffer.from(ONE_PIXEL_PNG, "base64");
  await fs.mkdir(path.join(server.outputDir, "favorite"), { recursive: true });
  await fs.mkdir(server.dataDir, { recursive: true });
  await fs.writeFile(path.join(server.outputDir, filename), image);
  await fs.writeFile(path.join(server.outputDir, "favorite", filename), image);
  for (const [relativePath, content] of extraFiles) {
    const value = Buffer.isBuffer(content) ? content : String(content);
    await fs.mkdir(path.dirname(path.join(server.outputDir, relativePath)), { recursive: true });
    await fs.writeFile(path.join(server.outputDir, relativePath), value);
  }
  await fs.writeFile(path.join(server.dataDir, "history.json"), JSON.stringify({
    schemaVersion: 2,
    generations: [{
      id: `${imageId}-generation`,
      createdAt: "2026-08-07T00:00:00.000Z",
      kind: "candidates",
      mode: "txt2img",
      title: "保存先統合fixture",
      description: "保存先統合fixture",
      prompt: "fixture",
      negativePrompt: "",
      settings: { width: 1, height: 1 },
      loras: [],
      images: [{
        id: imageId,
        imageUrl: `/outputs/${filename}`,
        filename,
        seed: 1,
        width: 1,
        height: 1,
        favorite: true
      }]
    }]
  }, null, 2));
}

async function writeOutputMarkerForTest(directory) {
  await fs.writeFile(path.join(directory, ".local-image-chat-output.json"), `${JSON.stringify({
    type: "local-image-chat-output",
    schemaVersion: 1,
    createdAt: "2026-08-07T00:00:00.000Z"
  })}\n`);
}

async function removeIsolatedWorkspace(workspace) {
  const modulesPath = path.join(workspace, "node_modules");
  try {
    const stats = await fs.lstat(modulesPath);
    if (stats.isSymbolicLink()) await fs.unlink(modulesPath);
    else await fs.rm(modulesPath, { recursive: true, force: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await fs.rm(workspace, { recursive: true, force: true });
}

async function requestJsonWithStatus(url, { method = "GET", body } = {}) {
  const headers = body === undefined ? {} : { "Content-Type": "application/json" };
  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let parsed = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // 非JSON応答もstatusとともに呼び出し側へ返す。
  }
  return { status: response.status, headers: response.headers, body: parsed };
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return response.json();
}

async function patchJson(url, body) {
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return response.json();
}

async function stopTestServer(child, port, { cleanupLock = true } = {}) {
  let exited = child.exitCode !== null || child.signalCode !== null;
  if (!exited) {
    const gracefulExit = waitForChildExit(child, 5000);
    try { child.kill("SIGTERM"); } catch {}
    exited = await gracefulExit;
  }
  if (!exited) {
    const forcedExit = waitForChildExit(child, 5000);
    try { child.kill(); } catch {}
    exited = await forcedExit;
  }
  if (!exited) throw new Error(`test server did not exit on port ${port}`);

  if (!cleanupLock) return;
  await cleanupTestLock(port);
}

async function cleanupTestLock(port) {
  // Windowsの強制終了ではSIGTERM/exitハンドラーを通らないため、
  // このテストが所有するroot+portのロックだけを明示的に清掃する。
  const lockPath = getInstanceLockPath(path.resolve("."), port);
  await fs.rm(lockPath, { force: true });
  await assert.rejects(fs.access(lockPath), { code: "ENOENT" });
}

function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onClose = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      child.removeListener("close", onClose);
      resolve(false);
    }, timeoutMs);
    child.once("close", onClose);
  });
}
