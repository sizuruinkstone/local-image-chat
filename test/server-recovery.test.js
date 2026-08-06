import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getInstanceLockPath } from "../src/instance-lock.js";

const ONE_PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("OOM時に安全設定で1回だけ再試行し、retry情報を履歴へ残す", async (t) => {
  const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), "local-image-chat-recovery-"));
  const ollama = await startMockServer((request, response) => {
    if (request.url === "/api/tags") return json(response, { models: [{ name: "mock" }] });
    if (request.url === "/api/generate") return json(response, { response: "masterpiece, 1girl" });
    response.writeHead(404).end();
  });

  const generateCalls = [];
  const reforge = await startMockServer(async (request, response) => {
    if (request.url === "/sdapi/v1/options" && request.method === "POST") return json(response, {});
    if (request.url === "/sdapi/v1/options") return json(response, { sd_model_checkpoint: "mock.safetensors" });
    if (request.url === "/sdapi/v1/sd-models") return json(response, [{ title: "mock.safetensors", model_name: "mock" }]);
    if (request.url === "/sdapi/v1/loras") return json(response, []);
    if (request.url?.startsWith("/sdapi/v1/progress")) return json(response, { progress: 0.5 });
    if (request.url === "/sdapi/v1/upscalers") return json(response, [{ name: "Mock" }]);
    if (request.url === "/sdapi/v1/txt2img") {
      const body = JSON.parse(await readBody(request));
      generateCalls.push(body);
      // 1回目だけVRAM不足で失敗させる
      if (generateCalls.length === 1) {
        response.writeHead(500, { "Content-Type": "text/plain" });
        return response.end("torch.cuda.OutOfMemoryError: CUDA out of memory");
      }
      return json(response, { images: [ONE_PIXEL_PNG], info: JSON.stringify({ seed: 7, all_seeds: [7] }) });
    }
    response.writeHead(404).end();
  });

  const appPort = await reservePort();
  const configPath = path.join(temporaryDir, "config.json");
  await fs.writeFile(configPath, JSON.stringify({
    port: appPort,
    ollama: { url: `http://127.0.0.1:${ollama.port}`, model: "mock", timeoutMs: 5000 },
    reforge: { url: `http://127.0.0.1:${reforge.port}`, timeoutMs: 5000 },
    defaults: {
      width: 1024, height: 1536, steps: 5, cfgScale: 5, samplerName: "Euler a",
      scheduler: "Automatic", candidateCount: 1, hiresScale: 1.8, hiresSteps: 20,
      hiresDenoising: 0.4, hiresUpscaler: "Mock"
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
    let cleanupError;
    try {
      await stopTestServer(child, appPort);
    } catch (error) {
      cleanupError ??= error;
    }
    try {
      await Promise.all([ollama.close(), reforge.close()]);
    } catch (error) {
      cleanupError ??= error;
    }
    if (!cleanupError) await fs.rm(temporaryDir, { recursive: true, force: true });
    if (cleanupError) throw cleanupError;
  });

  const baseUrl = `http://127.0.0.1:${appPort}`;
  await waitForServer(`${baseUrl}/api/config`, child);

  const settings = {
    width: 1024, height: 1536, steps: 5, candidateCount: 1,
    hiresEnabled: true, hiresScale: 1.8, hiresSteps: 20, hiresDenoising: 0.4
  };
  const queued = await postJson(`${baseUrl}/api/jobs`, {
    description: "OOMテスト",
    prompt: "masterpiece, 1girl",
    negativePrompt: "low quality",
    loras: [],
    autoRetry: true,
    settings
  });
  const completed = await waitForJob(baseUrl, queued.job.id);

  assert.equal(completed.status, "done", "安全設定で再試行して成功する");
  assert.equal(generateCalls.length, 2, "再試行は1回だけ");
  assert.equal(generateCalls[0].hr_scale, 1.8);
  assert.equal(generateCalls[1].hr_scale, 1.6, "Hires倍率を0.2下げる");
  assert.equal(generateCalls[1].hr_second_pass_steps, 12, "Hires Stepsを減らす");

  const image = completed.result.images[0];
  const recipe = await (await fetch(`${baseUrl}/api/history/${image.id}/recipe`)).json();
  assert.equal(recipe.retryInfo.retryReason, "oom");
  assert.equal(recipe.retryInfo.retryCount, 1);
  assert.equal(recipe.retryInfo.originalSettings.hiresScale, 1.8);
  assert.equal(recipe.retryInfo.retrySettings.hiresScale, 1.6);
});

test("自動再試行OFFなら提案付きで失敗し、ユーザー判断に委ねる", async (t) => {
  const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), "local-image-chat-recovery-off-"));
  const ollama = await startMockServer((request, response) => {
    if (request.url === "/api/tags") return json(response, { models: [{ name: "mock" }] });
    if (request.url === "/api/generate") return json(response, { response: "masterpiece, 1girl" });
    response.writeHead(404).end();
  });
  let calls = 0;
  const reforge = await startMockServer(async (request, response) => {
    if (request.url === "/sdapi/v1/options" && request.method === "POST") return json(response, {});
    if (request.url === "/sdapi/v1/options") return json(response, { sd_model_checkpoint: "mock" });
    if (request.url === "/sdapi/v1/loras") return json(response, []);
    if (request.url?.startsWith("/sdapi/v1/progress")) return json(response, { progress: 0 });
    if (request.url === "/sdapi/v1/txt2img") {
      calls += 1;
      response.writeHead(500, { "Content-Type": "text/plain" });
      return response.end("CUDA out of memory");
    }
    response.writeHead(404).end();
  });

  const appPort = await reservePort();
  const configPath = path.join(temporaryDir, "config.json");
  await fs.writeFile(configPath, JSON.stringify({
    port: appPort,
    ollama: { url: `http://127.0.0.1:${ollama.port}`, model: "mock", timeoutMs: 5000 },
    reforge: { url: `http://127.0.0.1:${reforge.port}`, timeoutMs: 5000 },
    defaults: { width: 896, height: 1152, steps: 5, cfgScale: 5, samplerName: "Euler a", scheduler: "Automatic", candidateCount: 4 }
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
    let cleanupError;
    try {
      await stopTestServer(child, appPort);
    } catch (error) {
      cleanupError ??= error;
    }
    try {
      await Promise.all([ollama.close(), reforge.close()]);
    } catch (error) {
      cleanupError ??= error;
    }
    if (!cleanupError) await fs.rm(temporaryDir, { recursive: true, force: true });
    if (cleanupError) throw cleanupError;
  });

  const baseUrl = `http://127.0.0.1:${appPort}`;
  await waitForServer(`${baseUrl}/api/config`, child);
  const queued = await postJson(`${baseUrl}/api/jobs`, {
    description: "OOMテスト",
    prompt: "masterpiece, 1girl",
    loras: [],
    settings: { width: 896, height: 1152, steps: 5, candidateCount: 4 }
  });
  const failed = await waitForJob(baseUrl, queued.job.id);

  assert.equal(failed.status, "failed");
  assert.equal(calls, 1, "確認なしに再試行しない");
  assert.equal(failed.recovery.kind, "oom");
  assert.equal(failed.recovery.changes[0].label, "候補枚数");
  assert.equal(failed.recovery.changes[0].to, "1");
});

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
  while (Date.now() - startedAt < 8000) {
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
  while (Date.now() - startedAt < 8000) {
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

async function stopTestServer(child, port) {
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
