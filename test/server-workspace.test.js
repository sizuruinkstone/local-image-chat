import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const ONE_PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

// LoRAルート・実験・Checkpointセット・比較APIをまとめて往復させる。
test("ワークスペースAPI（LoRAルート・実験・セット・比較）が往復する", async (t) => {
  const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), "local-image-chat-workspace-"));
  const loraRoot = path.join(temporaryDir, "models", "Lora");
  await fs.mkdir(path.join(loraRoot, "Anime", "Style"), { recursive: true });

  const ollama = await startMockServer((request, response) => {
    if (request.url === "/api/tags") return json(response, { models: [{ name: "mock" }] });
    if (request.url === "/api/generate") return json(response, { response: "masterpiece, 1girl" });
    response.writeHead(404).end();
  });
  const reforge = await startMockServer(async (request, response) => {
    if (request.url === "/sdapi/v1/options" && request.method === "POST") return json(response, {});
    if (request.url === "/sdapi/v1/options") return json(response, { sd_model_checkpoint: "mock.safetensors" });
    if (request.url === "/sdapi/v1/sd-models") return json(response, [{ title: "mock.safetensors", model_name: "mock" }]);
    if (request.url === "/sdapi/v1/loras") {
      return json(response, [{
        name: "Anime/Style/FlatPainting",
        alias: "FlatPainting",
        path: path.join(loraRoot, "Anime", "Style", "FlatPainting.safetensors")
      }]);
    }
    if (request.url === "/sdapi/v1/refresh-loras") return json(response, {});
    if (request.url?.startsWith("/sdapi/v1/progress")) return json(response, { progress: 0.5 });
    if (request.url === "/sdapi/v1/upscalers") return json(response, [{ name: "Mock" }]);
    if (request.url === "/sdapi/v1/txt2img") {
      await readBody(request);
      return json(response, { images: [ONE_PIXEL_PNG], info: JSON.stringify({ seed: 5, all_seeds: [5] }) });
    }
    response.writeHead(404).end();
  });

  const appPort = await reservePort();
  const configPath = path.join(temporaryDir, "config.json");
  await fs.writeFile(configPath, JSON.stringify({
    port: appPort,
    ollama: { url: `http://127.0.0.1:${ollama.port}`, model: "mock", timeoutMs: 5000 },
    reforge: { url: `http://127.0.0.1:${reforge.port}`, timeoutMs: 5000 },
    lora: { installDir: loraRoot },
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
    child.kill();
    await Promise.all([ollama.close(), reforge.close()]);
    await fs.rm(temporaryDir, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${appPort}`;
  await waitForServer(`${baseUrl}/api/config`, child);

  // LoRAルート: configの明示設定が使われる
  const root = await getJson(`${baseUrl}/api/lora/install-root`);
  assert.equal(root.root, loraRoot);
  assert.equal(root.source, "config");
  assert.equal(root.label, "設定済み");

  // 保存先候補: 実在フォルダのみ + 推奨は別枠
  const folders = await getJson(`${baseUrl}/api/civitai/install-folders`);
  assert.ok(folders.folders.includes("Anime/Style"));
  assert.equal(folders.folders.includes("Characters"), false);
  assert.deepEqual(folders.recommended.character, { folder: "Characters", exists: false });

  // LoRAメタデータ編集
  const ensured = await postJson(`${baseUrl}/api/loras/registry/ensure`, {
    relativeName: "Anime/Style/FlatPainting"
  });
  const patched = await patchJson(`${baseUrl}/api/loras/${ensured.entry.uid}`, {
    displayName: "フラット画風",
    subcategory: "style",
    triggerWords: "flat painting"
  });
  assert.equal(patched.entry.displayName, "フラット画風");
  assert.ok(patched.entry.manualFields.includes("triggerWords"));
  const listed = await getJson(`${baseUrl}/api/loras/registry`);
  assert.equal(listed.entries[0].displayName, "フラット画風");

  // Checkpoint別LoRAセット
  const created = await postJson(`${baseUrl}/api/checkpoint-lora-sets`, {
    name: "mock 基本セット",
    checkpoint: "mock.safetensors",
    autoApply: true,
    loras: [{ name: "Anime/Style/FlatPainting", weight: 0.65 }],
    settings: { steps: 24, cfgScale: 6, width: 512, height: 512 }
  });
  assert.equal(created.set.autoApply, true);
  const sets = await getJson(`${baseUrl}/api/checkpoint-lora-sets`);
  assert.equal(sets.sets.length, 1);
  assert.equal(sets.sets[0].loras[0].weight, 0.65);

  // パラメータ比較: 4枚が同じ実験へまとまる
  const experimentResponse = await postJson(`${baseUrl}/api/experiments`, {
    parameter: "loraWeight",
    target: "Anime/Style/FlatPainting",
    values: [0.5, 0.6, 0.7, 0.8],
    fixedSeed: 1753486420,
    baseRequest: {
      description: "weight比較",
      prompt: "masterpiece, 1girl",
      negativePrompt: "low quality",
      loras: [{ name: "Anime/Style/FlatPainting", weight: 0.7 }],
      settings: { width: 512, height: 512, steps: 5, candidateCount: 1 }
    }
  });
  const experimentId = experimentResponse.experiment.id;
  assert.equal(experimentResponse.experiment.total, 4);

  const finished = await waitForExperiment(baseUrl, experimentId);
  assert.equal(finished.status, "done");
  assert.equal(finished.completed, 4);
  assert.deepEqual(finished.runs.map((run) => run.value), [0.5, 0.6, 0.7, 0.8]);

  const history = await getJson(`${baseUrl}/api/history?limit=20`);
  const grouped = history.generations.filter((generation) => generation.experimentId === experimentId);
  assert.equal(grouped.length, 4, "4枚が同じ実験へまとまる");
  assert.equal(grouped[0].comparedParameter, "loraWeight");
  assert.equal(grouped[0].settings.seed, 1753486420, "Seedが固定される");
  assert.deepEqual(
    [...new Set(grouped.map((generation) => generation.comparedValue))].sort(),
    [0.5, 0.6, 0.7, 0.8]
  );

  // A/B比較の投票
  const imageIds = grouped.slice(0, 2).map((generation) => generation.images[0].id);
  const comparison = await postJson(`${baseUrl}/api/comparisons`, {
    imageIds,
    winnerImageId: imageIds[1],
    result: "b",
    parameter: "loraWeight"
  });
  assert.equal(comparison.comparison.winnerImageId, imageIds[1]);
  const recipe = await getJson(`${baseUrl}/api/history/${imageIds[1]}/recipe`);
  assert.equal(recipe.selectedImage.vote, "win");

  // 実験名の変更と一括削除（履歴のみ）
  const renamed = await patchJson(`${baseUrl}/api/experiments/${experimentId}`, { name: "weight test" });
  assert.equal(renamed.experiment.name, "weight test");
  const deleted = await deleteJson(`${baseUrl}/api/experiments/${experimentId}`);
  assert.equal(deleted.removedGenerations, 4);
  assert.equal(deleted.removedImages, 0, "履歴だけ削除では画像を消さない");
  const after = await getJson(`${baseUrl}/api/experiments`);
  assert.equal(after.experiments.length, 0);
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

async function waitForExperiment(baseUrl, id) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10000) {
    const { experiment } = await getJson(`${baseUrl}/api/experiments/${id}`);
    if (experiment.status !== "running") return experiment;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error("experiment timeout");
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

async function deleteJson(url) {
  return (await fetch(url, { method: "DELETE" })).json();
}
