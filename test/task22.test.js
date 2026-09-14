import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { createForgeNeoProvider, normalizeForgeNeoConfig } from "../src/forge-neo.js";
import { createJobManager } from "../src/job-manager.js";
import { createRuntimeService } from "../public/core/runtime-service.js";
import { settingsWithCheckpoint } from "../public/core/generation-settings.js";

const ONE_PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function multiProfileConfig(overrides = {}) {
  return {
    enabled: true,
    url: "http://mock-neo",
    activationMode: "managed-options",
    profiles: [
      {
        id: "anima-default",
        label: "Anima / oneObsession v3.0",
        checkpoint: "sd\\oneObsessionAnima_v30.safetensors",
        preset: "anima",
        additionalModules: [
          "qwen_image_vae.safetensors",
          "oneObsessionAnima_v30_txt.safetensors"
        ]
      },
      {
        id: "xl-illustrious",
        label: "SDXL / Illustrious",
        checkpoint: "sd\\waiIllustriousSDXL_v170.safetensors",
        preset: "xl",
        additionalModules: []
      }
    ],
    ...overrides
  };
}

function createNeoFetch({
  options = {
    sd_model_checkpoint: "oneObsessionAnima_v30.safetensors",
    forge_preset: "anima",
    forge_additional_modules: [
      "qwen_image_vae.safetensors",
      "oneObsessionAnima_v30_txt.safetensors"
    ]
  },
  applyOptionsPost = true,
  requireModelNameAlias = false,
  failOnCheckpoint = false,
  models = [
    {
      title: "sd\\oneObsessionAnima_v30.safetensors [anima-hash]",
      model_name: "sd_oneObsessionAnima_v30",
      filename: "C:\\neo\\models\\oneObsessionAnima_v30.safetensors",
      hash: "anima-hash"
    },
    {
      title: "sd\\waiIllustriousSDXL_v170.safetensors [xl-hash]",
      model_name: "sd_waiIllustriousSDXL_v170",
      filename: "C:\\neo\\models\\waiIllustriousSDXL_v170.safetensors",
      hash: "xl-hash"
    },
    {
      title: "sd\\unregistered.safetensors",
      model_name: "sd_unregistered",
      filename: "C:\\neo\\models\\unregistered.safetensors",
      hash: "unregistered-hash"
    }
  ],
  modules = [
    {
      model_name: "qwen_image_vae.safetensors",
      filename: "C:\\neo\\models\\VAE\\qwen_image_vae.safetensors"
    },
    {
      model_name: "oneObsessionAnima_v30_txt.safetensors",
      filename: "C:\\neo\\models\\text_encoder\\oneObsessionAnima_v30_txt.safetensors"
    }
  ]
} = {}) {
  const calls = [];
  let currentOptions = structuredClone(options);
  const fetchImpl = async (url, request = {}) => {
    const endpoint = new URL(url).pathname.split("/").at(-1);
    const body = request.body ? JSON.parse(request.body) : null;
    calls.push({ endpoint, method: request.method ?? "GET", body });
    if (endpoint === "options" && request.method === "POST") {
      if (requireModelNameAlias
        && !models.some((model) => model?.model_name === body?.sd_model_checkpoint)) {
        return jsonResponse({ detail: `Model ${body?.sd_model_checkpoint} not found` }, 422);
      }
      if (failOnCheckpoint) {
        for (const key of Object.keys(body ?? {})) {
          if (key === "sd_model_checkpoint") {
            return jsonResponse({ detail: "checkpoint rejected" }, 422);
          }
          currentOptions[key] = body[key];
        }
        return jsonResponse({ ok: true });
      }
      if (applyOptionsPost) currentOptions = { ...currentOptions, ...body };
      return jsonResponse({ ok: true });
    }
    if (endpoint === "options") return jsonResponse(currentOptions);
    if (endpoint === "sd-models") return jsonResponse(models);
    if (endpoint === "sd-modules") return jsonResponse(modules);
    if (endpoint === "txt2img") return jsonResponse({
      images: [`data:image/png;base64,${ONE_PIXEL_PNG}`],
      info: JSON.stringify({ seed: body.seed })
    });
    if (endpoint === "progress") return jsonResponse({ progress: 0.4 });
    if (endpoint === "interrupt") return jsonResponse({ ok: true });
    if (endpoint === "refresh-checkpoints" && request.method === "POST") return jsonResponse(null);
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

async function waitForJob(jobs, id, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = jobs.get(id);
    if (["done", "failed", "cancelled"].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`Job ${id} did not reach a terminal state`);
}

test("Task 22は旧単一Anima設定を1件のProfileへ変換し、明示profilesを正本にする", () => {
  const legacy = normalizeForgeNeoConfig({
    checkpoint: "sd\\legacy.safetensors",
    preset: "anima",
    additionalModules: ["legacy-vae.safetensors"]
  });
  assert.deepEqual(legacy.profiles.map((profile) => profile.id), ["anima-default"]);
  assert.equal(legacy.profiles[0].checkpoint, "sd/legacy.safetensors");
  assert.deepEqual(legacy.profiles[0].additionalModules, ["legacy-vae.safetensors"]);

  const explicit = normalizeForgeNeoConfig(multiProfileConfig({
    checkpoint: "sd\\must-not-merge.safetensors",
    preset: "anima",
    additionalModules: ["must-not-merge.safetensors"]
  }));
  assert.deepEqual(explicit.profiles.map((profile) => profile.id), ["anima-default", "xl-illustrious"]);
  assert.equal(explicit.profiles[0].checkpoint, "sd/oneObsessionAnima_v30.safetensors");
  assert.equal(explicit.checkpoint, explicit.profiles[0].checkpoint);
  assert.notDeepEqual(explicit.additionalModules, ["must-not-merge.safetensors"]);
});

test("Task 22のProfile validationは重複ID／Checkpoint、未知preset、危険path、重複moduleを拒否する", () => {
  const invalidProfiles = [
    [
      { id: "same", checkpoint: "sd/a.safetensors", preset: "anima", additionalModules: [] },
      { id: "same", checkpoint: "sd/b.safetensors", preset: "xl", additionalModules: [] }
    ],
    [
      { id: "a", checkpoint: "sd/shared.safetensors", preset: "anima", additionalModules: [] },
      { id: "b", checkpoint: "models/shared.safetensors", preset: "xl", additionalModules: [] }
    ],
    [{ id: "bad-preset", checkpoint: "sd/a.safetensors", preset: "flux", additionalModules: [] }],
    [{ id: "absolute", checkpoint: "C:\\neo\\a.safetensors", preset: "anima", additionalModules: [] }],
    [{ id: "module-path", checkpoint: "sd/a.safetensors", preset: "anima", additionalModules: ["models\\vae.safetensors"] }],
    [{ id: "module-duplicate", checkpoint: "sd/a.safetensors", preset: "anima", additionalModules: ["vae.safetensors", "VAE.safetensors"] }],
    [{ id: "module-null", checkpoint: "sd/a.safetensors", preset: "anima", additionalModules: null }]
  ];
  for (const profiles of invalidProfiles) {
    assert.throws(
      () => normalizeForgeNeoConfig({ profiles }),
      (error) => error.apiCode === "FORGE_NEO_CONFIG_INVALID"
    );
  }
});

test("Task 22のCheckpoint catalogは設定順を保ち、未登録・absolute filenameを公開しない", async () => {
  const fixture = createNeoFetch();
  const provider = createForgeNeoProvider({ config: multiProfileConfig(), fetchImpl: fixture.fetchImpl });
  const listed = await provider.listCheckpoints();
  assert.deepEqual(listed.checkpoints.map((item) => item.title), [
    "sd/oneObsessionAnima_v30.safetensors [anima-hash]",
    "sd/waiIllustriousSDXL_v170.safetensors [xl-hash]"
  ]);
  assert.equal(listed.activeCheckpoint, listed.checkpoints[0].title);
  assert.doesNotMatch(JSON.stringify(listed), /unregistered|C:\\neo/);

  const selected = await provider.resolveV1Checkpoint(listed.checkpoints[1].title);
  assert.equal(selected.id, listed.checkpoints[1].title);
  assert.equal(selected.active, false);
  await assert.rejects(
    provider.resolveV1Checkpoint("unregistered.safetensors"),
    (error) => error.apiCode === "RUNTIME_CHECKPOINT_NOT_ALLOWED" && error.statusCode === 400
  );
  assert.equal(fixture.calls.some((call) => call.endpoint === "options" && call.method === "POST"), false);

  const mismatchedFixture = createNeoFetch({
    options: {
      sd_model_checkpoint: "oneObsessionAnima_v30.safetensors",
      forge_preset: "xl",
      forge_additional_modules: []
    }
  });
  const mismatchedProvider = createForgeNeoProvider({
    config: multiProfileConfig(),
    fetchImpl: mismatchedFixture.fetchImpl
  });
  const mismatched = await mismatchedProvider.listCheckpoints();
  assert.equal(mismatched.activeCheckpoint, "");
  assert.equal((await mismatchedProvider.resolveV1Checkpoint(mismatched.checkpoints[0].title)).active, false);
});

test("Task 22のhealthはoptions完全一致Profileをactiveとして返し、managed/preloadedを区別する", async () => {
  const secondModel = {
    title: "sd\\waiIllustriousSDXL_v170.safetensors [xl-hash]",
    model_name: "sd_waiIllustriousSDXL_v170",
    filename: "C:\\neo\\models\\waiIllustriousSDXL_v170.safetensors",
    hash: "xl-hash"
  };
  const activeXlOptions = {
    sd_model_checkpoint: "waiIllustriousSDXL_v170.safetensors",
    forge_preset: "xl",
    forge_additional_modules: []
  };

  const activeFixture = createNeoFetch({ options: activeXlOptions });
  const activeHealth = await createForgeNeoProvider({
    config: multiProfileConfig(),
    fetchImpl: activeFixture.fetchImpl
  }).checkHealth();
  assert.equal(activeHealth.available, true);
  assert.equal(activeHealth.ok, true);
  assert.equal(activeHealth.checkpoint, "sd/waiIllustriousSDXL_v170.safetensors [xl-hash]");

  const missingPrimaryFixture = createNeoFetch({
    options: activeXlOptions,
    models: [secondModel]
  });
  const missingPrimaryHealth = await createForgeNeoProvider({
    config: multiProfileConfig(),
    fetchImpl: missingPrimaryFixture.fetchImpl
  }).checkHealth();
  assert.equal(missingPrimaryHealth.available, true);
  assert.equal(missingPrimaryHealth.ok, true);
  assert.equal(missingPrimaryHealth.checkpoint, "sd/waiIllustriousSDXL_v170.safetensors [xl-hash]");

  const managedNoActiveFixture = createNeoFetch({
    options: {
      sd_model_checkpoint: "unregistered.safetensors",
      forge_preset: "xl",
      forge_additional_modules: []
    },
    models: [secondModel]
  });
  const managedNoActiveHealth = await createForgeNeoProvider({
    config: multiProfileConfig(),
    fetchImpl: managedNoActiveFixture.fetchImpl
  }).checkHealth();
  assert.equal(managedNoActiveHealth.available, true);
  assert.equal(managedNoActiveHealth.ok, true);
  assert.equal("checkpoint" in managedNoActiveHealth, false);

  const preloadedFixture = createNeoFetch({
    options: {
      sd_model_checkpoint: "unregistered.safetensors",
      forge_preset: "anima",
      forge_additional_modules: []
    }
  });
  const preloadedHealth = await createForgeNeoProvider({
    config: multiProfileConfig({ activationMode: "preloaded" }),
    fetchImpl: preloadedFixture.fetchImpl
  }).checkHealth();
  assert.equal(preloadedHealth.available, true);
  assert.equal(preloadedHealth.ok, false);
  assert.equal(preloadedHealth.error, "Forge Neoの設定済みProfileが有効ではありません");
  assert.doesNotMatch(JSON.stringify(preloadedHealth), /C:\\neo|mock-neo|stack/i);
});

test("Task 22はcatalog内のbasename衝突と、設定ProfileのCheckpoint衝突を曖昧として拒否する", async () => {
  assert.throws(
    () => normalizeForgeNeoConfig({
      profiles: [
        { id: "a", checkpoint: "sd/shared.safetensors", preset: "anima", additionalModules: [] },
        { id: "b", checkpoint: "other/shared.safetensors", preset: "xl", additionalModules: [] }
      ]
    }),
    (error) => error.apiCode === "FORGE_NEO_CONFIG_INVALID"
  );

  const fixture = createNeoFetch({
    models: [
      { title: "sd/shared.safetensors", filename: "C:\\neo\\a\\shared.safetensors", model_name: "sd_shared_a" },
      { title: "other/shared.safetensors", filename: "C:\\neo\\b\\shared.safetensors", model_name: "sd_shared_b" }
    ]
  });
  const provider = createForgeNeoProvider({
    config: {
      ...multiProfileConfig(),
      profiles: [{ id: "shared", checkpoint: "sd/shared.safetensors", preset: "anima", additionalModules: [] }]
    },
    fetchImpl: fixture.fetchImpl
  });
  await assert.rejects(provider.listCheckpoints(), (error) => error.apiCode === "RUNTIME_CHECKPOINT_AMBIGUOUS");
});

test("Task 22のmanaged-optionsはProfileごとにCheckpoint・preset・modulesを一括反映し、no-opではPOSTしない", async () => {
  const fixture = createNeoFetch();
  const provider = createForgeNeoProvider({ config: multiProfileConfig(), fetchImpl: fixture.fetchImpl });
  const listed = await provider.listCheckpoints();
  const animaTitle = listed.checkpoints[0].title;
  const xlTitle = listed.checkpoints[1].title;

  await provider.prepareGeneration();
  assert.equal(fixture.calls.filter((call) => call.endpoint === "options" && call.method === "POST").length, 0);

  await provider.prepareGeneration({ requestedCheckpoint: xlTitle });
  let posts = fixture.calls.filter((call) => call.endpoint === "options" && call.method === "POST");
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].body, {
    sd_model_checkpoint: "sd_waiIllustriousSDXL_v170",
    forge_preset: "xl",
    forge_additional_modules: []
  });
  assert.deepEqual(Object.keys(posts[0].body), [
    "sd_model_checkpoint",
    "forge_preset",
    "forge_additional_modules"
  ]);

  await provider.prepareGeneration({ requestedCheckpoint: xlTitle });
  assert.equal(fixture.calls.filter((call) => call.endpoint === "options" && call.method === "POST").length, 1);

  await provider.prepareGeneration({ requestedCheckpoint: animaTitle });
  posts = fixture.calls.filter((call) => call.endpoint === "options" && call.method === "POST");
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[1].body, {
    sd_model_checkpoint: "sd_oneObsessionAnima_v30",
    forge_preset: "anima",
    forge_additional_modules: [
      "qwen_image_vae.safetensors",
      "oneObsessionAnima_v30_txt.safetensors"
    ]
  });
  assert.deepEqual(Object.keys(posts[1].body), [
    "sd_model_checkpoint",
    "forge_preset",
    "forge_additional_modules"
  ]);
});

test("Task 22はConfigの区切りにかかわらずcatalogのmodel_nameをoptionsへ送る", async () => {
  for (const configuredCheckpoint of [
    "sd\\oneObsessionAnima_v30.safetensors",
    "sd/oneObsessionAnima_v30.safetensors"
  ]) {
    const config = multiProfileConfig();
    config.profiles[0] = { ...config.profiles[0], checkpoint: configuredCheckpoint };
    const fixture = createNeoFetch({
      options: {
        sd_model_checkpoint: "other.safetensors",
        forge_preset: "xl",
        forge_additional_modules: []
      },
      requireModelNameAlias: true
    });
    const provider = createForgeNeoProvider({ config, fetchImpl: fixture.fetchImpl });

    await provider.prepareGeneration({ requestedCheckpoint: configuredCheckpoint });

    const posts = fixture.calls.filter((call) => call.endpoint === "options" && call.method === "POST");
    assert.equal(posts.length, 1);
    assert.equal(posts[0].body.sd_model_checkpoint, "sd_oneObsessionAnima_v30");
    assert.deepEqual(Object.keys(posts[0].body), [
      "sd_model_checkpoint",
      "forge_preset",
      "forge_additional_modules"
    ]);
  }
});

test("Task 22はCheckpoint拒否時にpresetとmodulesを先に部分適用しない", async () => {
  const before = {
    sd_model_checkpoint: "oneObsessionAnima_v30.safetensors",
    forge_preset: "anima",
    forge_additional_modules: [
      "qwen_image_vae.safetensors",
      "oneObsessionAnima_v30_txt.safetensors"
    ]
  };
  const fixture = createNeoFetch({ options: before, failOnCheckpoint: true });
  const provider = createForgeNeoProvider({ config: multiProfileConfig(), fetchImpl: fixture.fetchImpl });
  const xlTitle = (await provider.listCheckpoints()).checkpoints[1].title;

  await assert.rejects(
    provider.prepareGeneration({ requestedCheckpoint: xlTitle }),
    (error) => error.apiCode === "NEO_ANIMA_ACTIVATION_FAILED" && error.statusCode === 503
  );
  assert.deepEqual(fixture.getOptions(), before);
  const posts = fixture.calls.filter((call) => call.endpoint === "options" && call.method === "POST");
  assert.equal(posts.length, 1);
  assert.deepEqual(Object.keys(posts[0].body), [
    "sd_model_checkpoint",
    "forge_preset",
    "forge_additional_modules"
  ]);
});

test("Task 22はcatalogの安全なmodel_nameがない場合にoptions POSTを行わず503で停止する", async () => {
  const fixture = createNeoFetch({
    options: {
      sd_model_checkpoint: "other.safetensors",
      forge_preset: "xl",
      forge_additional_modules: []
    },
    models: [{
      title: "sd\\oneObsessionAnima_v30.safetensors [anima-hash]",
      filename: "C:\\neo\\models\\oneObsessionAnima_v30.safetensors",
      hash: "anima-hash"
    }]
  });
  const provider = createForgeNeoProvider({ config: multiProfileConfig(), fetchImpl: fixture.fetchImpl });

  await assert.rejects(
    provider.prepareGeneration(),
    (error) => error.apiCode === "NEO_ANIMA_ACTIVATION_FAILED" && error.statusCode === 503
  );
  assert.equal(fixture.calls.filter((call) => call.endpoint === "options" && call.method === "POST").length, 0);
});

test("Task 22はPOST後の再GET不一致でtxt2imgへ進まず、preloadedではPOSTしない", async () => {
  const mismatchFixture = createNeoFetch({ applyOptionsPost: false });
  const mismatchProvider = createForgeNeoProvider({
    config: multiProfileConfig(),
    fetchImpl: mismatchFixture.fetchImpl
  });
  const xlTitle = (await mismatchProvider.listCheckpoints()).checkpoints[1].title;
  const jobs = createJobManager(async () => {
    await mismatchProvider.prepareGeneration({ requestedCheckpoint: xlTitle });
    return mismatchProvider.generateImages({
      mode: "txt2img",
      prompt: "1girl",
      negativePrompt: "",
      width: 512,
      height: 512,
      steps: 8,
      cfgScale: 5,
      seed: 1,
      samplerName: "Euler a",
      scheduler: "Automatic",
      candidateCount: 1
    });
  });
  const failed = await waitForJob(jobs, jobs.create({ checkpoint: xlTitle }).id);
  assert.equal(failed.status, "failed");
  assert.equal(mismatchFixture.calls.filter((call) => call.endpoint === "txt2img").length, 0);
  assert.equal(mismatchFixture.calls.filter((call) => call.endpoint === "options" && call.method === "POST").length, 1);

  const preloadedFixture = createNeoFetch({
    options: {
      sd_model_checkpoint: "oneObsessionAnima_v30.safetensors",
      forge_preset: "anima",
      forge_additional_modules: ["qwen_image_vae.safetensors", "oneObsessionAnima_v30_txt.safetensors"]
    }
  });
  const preloadedProvider = createForgeNeoProvider({
    config: multiProfileConfig({ activationMode: "preloaded" }),
    fetchImpl: preloadedFixture.fetchImpl
  });
  const preloadedXl = (await preloadedProvider.listCheckpoints()).checkpoints[1].title;
  await assert.rejects(
    preloadedProvider.prepareGeneration({ requestedCheckpoint: preloadedXl }),
    (error) => error.apiCode === "NEO_ANIMA_ACTIVATION_FAILED"
  );
  assert.equal(preloadedFixture.calls.some((call) => call.endpoint === "options" && call.method === "POST"), false);
});

test("Task 22のqueued jobは実行時のProfileを各Jobごとに適用し、待機中requestへ状態を混ぜない", async () => {
  const fixture = createNeoFetch();
  const provider = createForgeNeoProvider({ config: multiProfileConfig(), fetchImpl: fixture.fetchImpl });
  const listed = await provider.listCheckpoints();
  const [animaTitle, xlTitle] = listed.checkpoints.map((item) => item.title);
  const jobs = createJobManager(async (payload) => provider.prepareGeneration({
    requestedCheckpoint: payload.checkpoint
  }));

  const first = jobs.create({ checkpoint: xlTitle });
  const second = jobs.create({ checkpoint: animaTitle });
  const [firstDone, secondDone] = await Promise.all([
    waitForJob(jobs, first.id),
    waitForJob(jobs, second.id)
  ]);
  assert.equal(firstDone.status, "done");
  assert.equal(secondDone.status, "done");
  assert.equal(firstDone.result.checkpoint, "sd/waiIllustriousSDXL_v170.safetensors [xl-hash]");
  assert.equal(secondDone.result.checkpoint, "sd/oneObsessionAnima_v30.safetensors [anima-hash]");

  const posts = fixture.calls.filter((call) => call.endpoint === "options" && call.method === "POST");
  assert.equal(posts.length, 2);
  assert.equal(posts[0].body.forge_preset, "xl");
  assert.equal(posts[0].body.forge_additional_modules.length, 0);
  assert.equal(posts[1].body.forge_preset, "anima");
  assert.deepEqual(posts[1].body.forge_additional_modules, [
    "qwen_image_vae.safetensors",
    "oneObsessionAnima_v30_txt.safetensors"
  ]);
});

// These contracts previously inspected the old controller's source location.
// Exercise the extracted service directly so a future view cannot weaken them.
async function selectorFixture() {
  const calls = [], messages = [];
  const runtime = createRuntimeService({
    storage: { getItem: () => null, setItem() {}, removeItem() {} },
    getJson: async () => ({ checkpoints: [
      { title: "A", hash: "aaa" }, { title: "B", hash: "bbb" }
    ], activeCheckpoint: "A" }),
    postJson: async (url, body) => { calls.push({ url, body }); return { checkpoint: body.checkpoint }; },
    presentation: { checkpointStatus: (message) => messages.push(message) }
  });
  runtime.init();
  runtime.configure([{ id: "forge-neo-anima", label: "Neo", provider: "forge-neo", available: true, features: { txt2img: true } }], "forge-neo-anima");
  await runtime.loadCheckpoints();
  return { runtime, calls, messages };
}

test("Task 22の既存Checkpoint selectorは選択時にLocal APIだけを呼び、Neo options POSTはqueue側に残す", async (t) => {
  const { runtime, calls } = await selectorFixture();
  t.after(() => runtime.dispose());
  assert.equal(await runtime.selectCheckpoint("B"), true);
  assert.deepEqual(calls, [{ url: "/api/checkpoints/select", body: { checkpoint: "B", runtimeId: "forge-neo-anima" } }]);
  const server = await fs.readFile("src/server.js", "utf8");
  assert.match(server, /if \(provider\.descriptor\.id !== "reforge"\)[\s\S]*?provider\.resolveV1Checkpoint\(selected\)/);
});

test("Task 22のNeo selectorはselectedとactiveを分離し、次回生成へ選択値を渡す", async (t) => {
  const { runtime, messages } = await selectorFixture();
  t.after(() => runtime.dispose());
  await runtime.selectCheckpoint("B");
  const state = runtime.getState();
  assert.equal(state.selectedCheckpoint.title, "B");
  assert.equal(state.activeCheckpoint.title, "A");
  const settings = settingsWithCheckpoint({ seed: 4 }, state.selectedCheckpoint);
  assert.equal(settings.checkpoint, "B");
  assert.equal(settings.checkpointHash, "bbb");
  assert.ok(messages.some((message) => message.includes("次回生成で切替: B")));
  assert.ok(messages.some((message) => message.includes("現在の使用中: A")));
  runtime.updateActiveCheckpoint("B");
  assert.equal(runtime.getState().activeCheckpoint.title, "B");
  assert.equal(runtime.getState().selectedCheckpoint.title, "B");
});

test("Task 22のCivitai追加は選択RuntimeのLoRA一覧を再取得する", async () => {
  const app = await fs.readFile("public/app.js", "utf8");
  const controller = await fs.readFile("public/features/civitai-controller.js", "utf8");
  const server = await fs.readFile("src/server.js", "utf8");
  assert.match(app, /createCivitaiController\(\{[\s\S]*?runtimePayload,[\s\S]*?library:/);
  const install = controller.match(/async function install\(\)[\s\S]*?(?=\n  function describeInstallResult)/)?.[0] ?? "";
  assert.match(install, /const capturedRuntimePayload = runtimePayload\(\)[\s\S]*?confirmMove: choice\.confirmMove,[\s\S]*\.\.\.capturedRuntimePayload/);
  assert.match(install, /await loadFolders\(\);[\s\S]*?await library\.load\?\.\(\)/);
  assert.match(server, /async function listLorasForRuntime\(runtimeId = runtimeRegistry\.defaultRuntimeId\)/);
  assert.match(server, /provider\.descriptor\.id === "reforge"[\s\S]*?refreshLoras\(config\.reforge\)[\s\S]*?: await provider\.listLoras\(\)/);
  assert.match(server, /loras: await listLorasForRuntime\(runtimeId\)/);
});
