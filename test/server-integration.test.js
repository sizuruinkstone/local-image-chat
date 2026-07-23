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
  const reforge = await startMockServer(handleReforge);
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
  const queued = await postJson(`${baseUrl}/api/jobs`, {
    description: "テスト画像",
    prompt: "masterpiece, 1girl, blue hair",
    negativePrompt: "low quality",
    loras: [],
    settings: { width: 512, height: 512, steps: 5, candidateCount: 1 }
  });
  const completed = await waitForJob(baseUrl, queued.job.id);

  assert.equal(completed.status, "done");
  assert.equal(completed.result.images.length, 1);
  assert.match(completed.result.images[0].id, /^[a-z0-9-]+$/i);

  const image = completed.result.images[0];
  await patchJson(`${baseUrl}/api/history/${image.id}/favorite`, { favorite: true });
  const preferences = await (await fetch(`${baseUrl}/api/history/preferences`)).json();
  assert.equal(preferences.favoriteCount, 1);
  assert.equal(preferences.topTags[0].name, "blue hair");
});

function handleOllama(request, response) {
  if (request.url === "/api/tags") return json(response, { models: [{ name: "mock" }] });
  if (request.url === "/api/generate") return json(response, { response: "masterpiece, 1girl, blue hair" });
  response.writeHead(404).end();
}

async function handleReforge(request, response) {
  if (request.url === "/sdapi/v1/options") return json(response, { sd_model_checkpoint: "mock.safetensors" });
  if (request.url === "/sdapi/v1/loras") return json(response, []);
  if (request.url?.startsWith("/sdapi/v1/progress")) return json(response, { progress: 0.5, eta_relative: 1 });
  if (request.url === "/sdapi/v1/upscalers") return json(response, [{ name: "Mock" }]);
  if (request.url === "/sdapi/v1/refresh-loras") return json(response, {});
  if (request.url === "/sdapi/v1/txt2img") {
    await readBody(request);
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
  for await (const _chunk of request) {
    // drain
  }
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
