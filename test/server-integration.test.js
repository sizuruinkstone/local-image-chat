import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const ONE_PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("生成キューからReForge、履歴、👍集計までAPIが往復する", async (t) => {
  const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), "local-image-chat-api-"));
  const ollama = await startMockServer(handleOllama);
  const reforgeRequests = [];
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

  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      LOCAL_IMAGE_CHAT_CONFIG: configPath,
      LOCAL_IMAGE_CHAT_DATA_DIR: path.join(temporaryDir, "data"),
      LOCAL_IMAGE_CHAT_OUTPUT_DIR: path.join(temporaryDir, "outputs")
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  t.after(async () => {
    child.kill();
    await Promise.all([ollama.close(), reforge.close()]);
    await fs.rm(temporaryDir, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${appPort}`;
  await waitForServer(`${baseUrl}/api/config`, child);
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
  const queued = await postJson(`${baseUrl}/api/jobs`, {
    description: "テスト画像",
    prompt: "masterpiece, 1girl, blue hair",
    negativePrompt: "low quality",
    loras: [],
    settings: { width: 512, height: 512, steps: 5, candidateCount: 1, noiseSchedule: "Zero Terminal SNR" }
  });
  const completed = await waitForJob(baseUrl, queued.job.id);

  assert.equal(completed.status, "done");
  assert.equal(completed.result.images.length, 1);
  assert.match(completed.result.images[0].id, /^[a-z0-9-]+$/i);
  assert.equal(reforgeRequests.noiseSchedule, "Zero Terminal SNR", "生成前にNoise scheduleをoptionsへ送る");

  const image = completed.result.images[0];
  await patchJson(`${baseUrl}/api/history/${image.id}/favorite`, { favorite: true });
  const preferences = await (await fetch(`${baseUrl}/api/history/preferences`)).json();
  assert.equal(preferences.favoriteCount, 1);
  assert.equal(preferences.topTags[0].name, "blue hair");

  const favoritesDir = path.join(temporaryDir, "outputs", "favorite");
  const favoritedFile = path.join(favoritesDir, path.basename(image.imageUrl));
  assert.ok(await fileExists(favoritedFile), "お気に入りにするとoutputs/favoriteへ複製する");
  const favoriteResponse = await fetch(`${baseUrl}/favorites/${path.basename(image.imageUrl)}`);
  assert.equal(favoriteResponse.status, 200);

  await patchJson(`${baseUrl}/api/history/${image.id}/favorite`, { favorite: false });
  assert.equal(await fileExists(favoritedFile), false, "お気に入り解除でoutputs/favoriteから削除する");

  await patchJson(`${baseUrl}/api/history/${image.id}/favorite`, { favorite: true });

  const img2imgQueued = await postJson(`${baseUrl}/api/jobs`, {
    mode: "img2img",
    description: "衣装だけ変更",
    prompt: "masterpiece, 1girl, red dress",
    negativePrompt: "low quality",
    initImage: `data:image/png;base64,${ONE_PIXEL_PNG}`,
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
});

function handleOllama(request, response) {
  if (request.url === "/api/tags") return json(response, { models: [{ name: "mock" }] });
  if (request.url === "/api/generate") return json(response, { response: "masterpiece, 1girl, blue hair" });
  response.writeHead(404).end();
}

async function handleReforge(request, response, requests) {
  if (request.url === "/sdapi/v1/options" && request.method === "POST") {
    const body = JSON.parse(await readBody(request));
    if (body.sd_model_checkpoint !== undefined) requests.activeCheckpoint = body.sd_model_checkpoint;
    if (body.sd_noise_schedule_sampling !== undefined) requests.noiseSchedule = body.sd_noise_schedule_sampling;
    return json(response, {});
  }
  if (request.url === "/sdapi/v1/options") {
    return json(response, { sd_model_checkpoint: requests.activeCheckpoint ?? "mock.safetensors" });
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
    requests.push({ url: request.url, body: JSON.parse(text) });
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

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
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
