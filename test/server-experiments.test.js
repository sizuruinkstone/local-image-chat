import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getInstanceLockPath } from "../src/instance-lock.js";

const ONE_PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

// 比較実験のライフサイクル（同時実行の拒否・実行中の削除）をHTTP越しに検証する。
test("比較実験は同時に1本だけ開始でき、実行中に削除するとジョブが止まる", async (t) => {
  const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), "local-image-chat-experiments-"));
  let txt2imgCount = 0;

  const ollama = await startMockServer((request, response) => {
    if (request.url === "/api/tags") return json(response, { models: [{ name: "mock" }] });
    if (request.url === "/api/generate") return json(response, { response: "masterpiece, 1girl" });
    response.writeHead(404).end();
  });
  const reforge = await startMockServer(async (request, response) => {
    if (request.url === "/sdapi/v1/options" && request.method === "POST") return json(response, {});
    if (request.url === "/sdapi/v1/options") return json(response, { sd_model_checkpoint: "mock.safetensors" });
    if (request.url === "/sdapi/v1/sd-models") return json(response, [{ title: "mock.safetensors", model_name: "mock" }]);
    if (request.url === "/sdapi/v1/loras") return json(response, []);
    if (request.url === "/sdapi/v1/refresh-loras") return json(response, {});
    if (request.url?.startsWith("/sdapi/v1/progress")) return json(response, { progress: 0.5 });
    if (request.url === "/sdapi/v1/upscalers") return json(response, [{ name: "Mock" }]);
    if (request.url === "/sdapi/v1/txt2img") {
      await readBody(request);
      txt2imgCount += 1;
      // 1枚あたり時間がかかる状況を作り、実験が実行中のままになるようにする。
      await new Promise((resolve) => setTimeout(resolve, 400));
      return json(response, { images: [ONE_PIXEL_PNG], info: JSON.stringify({ seed: 5, all_seeds: [5] }) });
    }
    response.writeHead(404).end();
  });

  const appPort = await reservePort();
  const configPath = path.join(temporaryDir, "config.json");
  await fs.writeFile(configPath, JSON.stringify({
    port: appPort,
    ollama: { url: `http://127.0.0.1:${ollama.port}`, model: "mock", timeoutMs: 5000 },
    reforge: { url: `http://127.0.0.1:${reforge.port}`, timeoutMs: 20000 },
    experiments: { maxImages: 8 },
    defaults: {
      width: 512, height: 512, steps: 5, cfgScale: 5, samplerName: "Euler a",
      scheduler: "Automatic", candidateCount: 1, hiresScale: 1.5, hiresSteps: 5,
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

  const body = (values) => ({
    parameter: "cfgScale",
    values,
    fixedSeed: 1753486420,
    baseRequest: {
      description: "CFG比較",
      prompt: "masterpiece, 1girl",
      negativePrompt: "low quality",
      settings: { width: 512, height: 512, steps: 5, candidateCount: 1 }
    }
  });

  // 1本目を開始する
  const first = await postJson(`${baseUrl}/api/experiments`, body([5, 6, 7, 8]));
  assert.equal(first.status, 202);
  const experimentId = first.data.experiment.id;

  // 2本目は409で拒否される
  const second = await postJson(`${baseUrl}/api/experiments`, body([9, 10]));
  assert.equal(second.status, 409);
  assert.match(second.data.error, /別の比較実験が実行中です/);
  assert.equal((await getJson(`${baseUrl}/api/experiments`)).experiments.length, 1, "拒否した実験は作られない");

  // 1枚目の生成が始まってから削除する
  await waitUntil(() => txt2imgCount >= 1, "1枚目の生成が始まらない");

  // キュー表示: 通常生成と比較実験を区別し、実行順と進捗を返す
  const queue = await waitUntil(async () => {
    const snapshot = await getJson(`${baseUrl}/api/queue`);
    return snapshot.comparison?.[0]?.status === "running" ? snapshot : null;
  }, "キューに実行中の比較実験が出ない");
  const [entry] = queue.comparison;
  assert.equal(entry.id, experimentId);
  assert.equal(entry.type, "comparison");
  assert.match(entry.subject, /CFG 5 \/ 6 \/ 7 \/ 8/, "比較内容が人間に分かる形で入る");
  assert.equal(entry.totalCases, 4);
  assert.ok(entry.currentCaseLabel, "処理中の条件が分かる");
  assert.equal(queue.generation.length, 0, "実験のジョブは通常生成へ混ざらない");
  assert.equal(queue.summary.comparisonActive, 1);
  assert.equal(queue.summary.generationActive, 0);

  // 通常生成のジョブはラベル付きで通常生成側へ並ぶ
  await postJson(`${baseUrl}/api/jobs`, {
    description: "通常生成",
    prompt: "masterpiece, 1girl",
    settings: { width: 512, height: 512, steps: 5, candidateCount: 2 }
  });
  const mixed = await waitUntil(async () => {
    const snapshot = await getJson(`${baseUrl}/api/queue`);
    return snapshot.generation?.length ? snapshot : null;
  }, "通常生成がキューへ出ない");
  assert.equal(mixed.generation[0].type, "generation");
  assert.equal(mixed.generation[0].label, "新規生成・候補2枚");
  assert.ok(["queued", "running"].includes(mixed.generation[0].status));
  await deleteJson(`${baseUrl}/api/jobs/${mixed.generation[0].id}`);
  const generatedBeforeDelete = txt2imgCount;
  const deleted = await deleteJson(`${baseUrl}/api/experiments/${experimentId}`);
  assert.equal(deleted.ok, true);

  // 削除後は生成も履歴も増えない
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.equal(txt2imgCount, generatedBeforeDelete, "削除後に新しい生成が始まらない");
  const history = await getJson(`${baseUrl}/api/history?limit=50`);
  assert.deepEqual(
    history.generations.filter((generation) => generation.experimentId === experimentId),
    [],
    "孤児の履歴が残らない"
  );
  const { jobs } = await getJson(`${baseUrl}/api/jobs`);
  assert.ok(
    jobs.every((job) => ["done", "failed", "cancelled"].includes(job.status)),
    "関連ジョブがキューに残らない"
  );
  assert.equal((await getJson(`${baseUrl}/api/experiments`)).experiments.length, 0, "実験データが削除される");

  // 1本目が終わっていれば2本目を開始できる
  const third = await postJson(`${baseUrl}/api/experiments`, body([9, 10]));
  assert.equal(third.status, 202);
  await postJson(`${baseUrl}/api/experiments/${third.data.experiment.id}/cancel`, {});
});

function startMockServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((request, response) => {
      Promise.resolve(handler(request, response)).catch(() => {
        // 生成中止でソケットが切れた場合は何もしない
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
  if (response.writableEnded || response.destroyed) return;
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

async function waitUntil(check, message) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(message);
}

async function getJson(url) {
  return (await fetch(url)).json();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return { status: response.status, data: await response.json() };
}

async function deleteJson(url) {
  return (await fetch(url, { method: "DELETE" })).json();
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
