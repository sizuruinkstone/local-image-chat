import {createSectionProfileService} from "./section-profiles.js";
import {createSceneService} from "./scenes.js";
import express from "express";
import { installFrontendEntry } from "./frontend-entry.js";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { AMBIGUOUS_ROOT_MESSAGE } from "./lora-root.js";
import { migrateDataFiles } from "./migrations.js";
import { createCheckpointSetService } from "./checkpoint-sets.js";
import {
  COMPARABLE_PARAMETERS,
  MAX_EXPERIMENT_IMAGES,
  createExperimentService,
  describeExperimentSubject,
  describeExperimentValue,
  isComparableParameter
} from "./experiments.js";
import { checkOllama, createPrompt } from "./ollama.js";
import {
  listCheckpoints,
  listSamplers,
  refreshLoras
} from "./reforge.js";
import { appendUniqueTags, normalizePromptBoosts } from "./services/prompt-service.js";
import { buildGrokShareMarkdown, createAiShareService } from "./ai-share.js";
import { createDiscordService, normalizeDiscordState } from "./discord.js";
import { hashOutputImage } from "./content-hash.js";
import { createIntegrationsRouter, isUsableIntegrationKey } from "./integrations.js";
import { createHistoryService } from "./history.js";
import {
  buildGenerationTitle,
  normalizeManualTitle,
  normalizeTitleMode,
  normalizeTitleTemplate
} from "../public/history-title.js";
import { describeBinding, resolveServerBinding } from "./net-info.js";
import { createPromptTemplateService } from "./prompt-template.js";
import { createJobManager } from "./job-manager.js";
import { createCivitaiService } from "./civitai.js";
import { createCivitaiTokenResolver } from "./civitai-token.js";
import { createUpdater } from "./updater.js";
import { createThumbnailService } from "./thumbnails.js";
import { acquireInstanceLock, InstanceAlreadyRunningError } from "./instance-lock.js";
import { createStorageSettingsService } from "./storage-settings.js";
import { createReferenceAssetBodyParser } from "./api/v1/assets.js";
import {
  createReferenceAssetService,
  createReferenceImageResolver,
  isReferenceAssetId
} from "./reference-assets.js";
import {
  createGenerationRuntime,
  createGenerationService,
  createOutputImagePathResolver,
  describeGenerationJob,
  serializeGeneration
} from "./services/generation-service.js";
import { createV1ErrorMiddleware, createV1Router } from "./api/v1/router.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const baseConfig = JSON.parse(await fs.readFile(path.join(rootDir, "config.json"), "utf8"));
const localConfigPath = process.env.LOCAL_IMAGE_CHAT_CONFIG
  ? path.resolve(process.env.LOCAL_IMAGE_CHAT_CONFIG)
  : path.join(rootDir, "config.local.json");
const localConfig = await readOptionalJson(localConfigPath);
const packageJson = JSON.parse(await fs.readFile(path.join(rootDir, "package.json"), "utf8"));
const config = deepMerge(baseConfig, localConfig);
const binding = resolveServerBinding({ env: process.env, config });
const runtimeStartedAt = new Date().toISOString();
let instanceLock;
try {
  instanceLock = await acquireInstanceLock({
    rootDir,
    port: binding.port,
    version: packageJson.version
  });
} catch (error) {
  if (error instanceof InstanceAlreadyRunningError || error?.code === "INSTANCE_ALREADY_RUNNING") {
    console.error(error.message);
    process.exitCode = 1;
    process.exit(1);
  }
  throw error;
}
process.once("exit", () => instanceLock.releaseSync());

let startupComplete = false;
let startupFailureHandled = false;

function clearStartupFailureHandlers() {
  process.off("uncaughtException", handleStartupFailure);
  process.off("unhandledRejection", handleStartupFailure);
}

function handleStartupFailure(error) {
  if (startupComplete || startupFailureHandled) return;
  startupFailureHandled = true;
  clearStartupFailureHandlers();
  console.error(`[Server] 起動に失敗しました: ${readableError(error)}`);
  void instanceLock.release()
    .catch((releaseError) => {
      console.error(`[Server] インスタンスロックの解放に失敗しました: ${readableError(releaseError)}`);
    })
    .finally(() => {
      process.exitCode = 1;
      process.exit(1);
    });
}

process.once("uncaughtException", handleStartupFailure);
process.once("unhandledRejection", handleStartupFailure);

const dataDir = process.env.LOCAL_IMAGE_CHAT_DATA_DIR
  ? path.resolve(process.env.LOCAL_IMAGE_CHAT_DATA_DIR)
  : path.join(rootDir, "data");
const storageSettings = createStorageSettingsService({
  rootDir,
  dataDir,
  env: process.env,
  logger: console
});
// 設定済みの移行はinstance lock取得後、listen前に完了させる。
// 失敗時はstorage-settings側が旧保存先を返すため、既存履歴をそのまま使って起動できる。
const storageStartup = await storageSettings.prepareStartup();
const outputDir = storageStartup.outputDir;
const favoritesDir = process.env.LOCAL_IMAGE_CHAT_FAVORITES_DIR
  ? path.resolve(process.env.LOCAL_IMAGE_CHAT_FAVORITES_DIR)
  : path.join(outputDir, "favorite");
const thumbnailDir = path.join(outputDir, "thumbnails");
await Promise.all([
  fs.mkdir(outputDir, { recursive: true }),
  fs.mkdir(favoritesDir, { recursive: true }),
  fs.mkdir(thumbnailDir, { recursive: true }),
  fs.mkdir(dataDir, { recursive: true })
]);

// 既存データを読む前に、バックアップを作ってからschemaVersionを上げる。
await migrateDataFiles(dataDir);

const history = createHistoryService(dataDir, {
  limit: config.storage?.historyLimit ?? 500
});
const referenceAssets = createReferenceAssetService({ outputDir, dataDir });
await referenceAssets.ensureStorage();
const thumbnails = createThumbnailService({ outputDir, thumbnailDir });
const civitai = createCivitaiService({
  dataDir,
  loraConfig: config.lora,
  reforgeConfig: config.reforge
});
const updater = createUpdater(rootDir, {
  repository: config.github?.repository ?? "sizuruinkstone/local-image-chat",
  branch: config.github?.branch ?? "main"
}, packageJson.version);
const checkpointSets = createCheckpointSetService(dataDir);
const promptTemplate = createPromptTemplateService(dataDir);
const aiShare = createAiShareService(dataDir);
// Webhook URLはサーバー内だけで保持する（APIレスポンスにも画面にも出さない）。
const discord = createDiscordService({
  dataDir,
  history,
  outputDir,
  webhookFromEnv: process.env.LOCAL_IMAGE_CHAT_DISCORD_WEBHOOK ?? "",
  webhookFromConfig: config.discord?.webhookUrl ?? ""
});
const resolveCivitaiToken = createCivitaiTokenResolver(
  process.env.LOCAL_IMAGE_CHAT_CIVITAI_TOKEN
);
const resolveOutputImagePath = createOutputImagePathResolver(outputDir);
const resolveReferenceImage = createReferenceImageResolver({
  history,
  referenceAssets,
  resolveOutputImagePath
});
const generationDependencies = {
  config,
  history,
  thumbnails,
  discord,
  experiments: null,
  outputDir,
  resolveOutputImagePath,
  resolveReferenceImage
};
const generationRuntime = createGenerationRuntime(generationDependencies);
const runtimeRegistry = generationRuntime.registry;
const jobs = createJobManager(generationRuntime.executeWithRecovery);
const experiments = createExperimentService(dataDir, {
  jobs,
  maxImages: config.experiments?.maxImages ?? MAX_EXPERIMENT_IMAGES
});
generationDependencies.experiments = experiments;
const generationService = createGenerationService({
  jobs,
  runtime: generationRuntime,
  config,
  history,
  resolveReferenceImage,
  runtimeRegistry,
  capabilityDependencies: {
    listCheckpoints: (reforgeConfig) => listCheckpoints(reforgeConfig),
    listSamplers: (reforgeConfig) => listSamplers(reforgeConfig),
    listLoras: () => getInstalledLoras()
  }
});

const app = express();
app.use("/api/v1/assets/images", createReferenceAssetBodyParser());
app.use(express.json({ limit: "50mb" }));
installFrontendEntry(app, path.join(rootDir, "public"));
const immutableImageStaticOptions = {
  etag: true,
  lastModified: true,
  maxAge: "1y",
  immutable: true,
  fallthrough: false
};
app.use("/outputs/.reference-assets", (_request, response) => {
  response.status(404).end();
});
app.use("/outputs", express.static(outputDir, immutableImageStaticOptions));
app.use("/favorites", express.static(favoritesDir, immutableImageStaticOptions));

// stable-diffusion-manager からの Favorite 同期。
// 連携キーが未設定なら 503 を返して無効のままにする。
const integrationKey = String(process.env.LOCAL_IMAGE_CHAT_INTEGRATION_KEY ?? "").trim();
app.use(
  "/api/integrations",
  createIntegrationsRouter({
    history,
    discord,
    integrationKey,
    onDiscordError: (error) => {
      console.warn(`[Discord] 連携からの自動送信を開始できませんでした: ${error.message}`);
    }
  })
);
const scenes = createSceneService({dataDir,outputDir,history,getCatalog:recipe=>getInstalledLoras(recipe.runtime?.id ?? recipe.runtimeId ?? 'reforge')});
await scenes.recover();
app.use("/api/v1", createV1Router({ generationService, referenceAssets, scenes, sectionProfiles:createSectionProfileService(dataDir) }));
app.use(createV1ErrorMiddleware());

app.get("/api/config", (_request, response) => {
  response.json({
    sectionProfileApi: true,
    version: packageJson.version,
    runtime: {
      pid: process.pid,
      startedAt: runtimeStartedAt,
      uptimeSeconds: Math.max(0, Math.floor(process.uptime())),
      binding: {
        host: binding.host,
        port: binding.port,
        exposed: binding.exposed
      }
    },
    defaults: config.defaults,
    runtimes: runtimeRegistry.listDescriptors(),
    defaultRuntimeId: runtimeRegistry.defaultRuntimeId,
    ollamaModel: config.ollama.model,
    lora: {
      defaultWeight: config.lora?.defaultWeight ?? 0.7,
      maxSelected: config.lora?.maxSelected ?? 4,
      installDirConfigured: Boolean(config.lora?.installDir)
    },
    github: {
      repository: config.github?.repository ?? "sizuruinkstone/local-image-chat",
      branch: config.github?.branch ?? "main"
    }
  });
});

app.get("/api/runtimes", async (_request, response) => {
  try {
    const health = await runtimeRegistry.healthAll();
    response.json({
      runtimes: runtimeRegistry.listDescriptors().map((descriptor) =>
        mergeRuntimeHealthDescriptor(descriptor, health[descriptor.id])
      ),
      defaultRuntimeId: runtimeRegistry.defaultRuntimeId
    });
  } catch (error) {
    response.status(503).json({ error: "Runtimeの接続状態を確認できません" });
  }
});

app.get("/api/storage/settings", async (_request, response) => {
  try {
    response.json(await storageSettings.getSettings());
  } catch (error) {
    response.status(error?.statusCode ?? 500).json({ error: readableError(error) });
  }
});

app.post("/api/storage/plan", async (request, response) => {
  try {
    const plan = await storageSettings.plan(request.body?.targetOutputDir);
    if (!plan.valid) {
      response.status(400).json({ error: plan.error, ...plan });
      return;
    }
    response.json(plan);
  } catch (error) {
    response.status(error?.statusCode ?? 400).json({ error: readableError(error) });
  }
});

app.patch("/api/storage/settings", async (request, response) => {
  try {
    const body = request.body ?? {};
    if (body.cancelPending === true) {
      response.json(await storageSettings.cancelPending());
      return;
    }
    response.json(await storageSettings.reserve(body.targetOutputDir, {
      confirmMigration: body.confirmMigration === true
    }));
  } catch (error) {
    response.status(error?.statusCode ?? 400).json({ error: readableError(error) });
  }
});

app.get("/api/health", async (_request, response) => {
  const [ollama, runtimes] = await Promise.all([
    Promise.allSettled([checkOllama(config.ollama)]),
    runtimeRegistry.healthAll()
  ]);
  const ollamaResult = ollama[0];
  const reforge = runtimes.reforge ?? { ok: false, error: "ReForgeへ接続できません" };
  response.json({
    ollama: ollamaResult.status === "fulfilled" ? ollamaResult.value : { ok: false, error: "Ollamaへ接続できません" },
    reforge,
    runtimes
  });
});

app.post("/api/prompt", async (request, response) => {
  try {
    const description = requireText(request.body.description, "生成したい内容");
    const generated = await createPrompt(config.ollama, description);
    response.json({
      ...generated,
      prompt: appendUniqueTags(generated.prompt, normalizePromptBoosts(request.body.promptBoosts))
    });
  } catch (error) {
    response.status(500).json({ error: readableError(error) });
  }
});

app.get("/api/loras", async (request, response) => {
  try {
    const provider = runtimeRegistry.resolve(request.query.runtimeId);
    const loras = await provider.listLoras();
    response.json({ loras: await civitai.mergeWithInstalled(loras) });
  } catch (error) {
    response.status(error?.statusCode ?? 500).json({ error: readableError(error) });
  }
});

// Sampler / Schedulerの候補。ReForgeが落ちていても既定値で選択できるようにする。
app.get("/api/samplers", async (request, response) => {
  try {
    response.json(await runtimeRegistry.resolve(request.query.runtimeId).listSamplers());
  } catch (error) {
    response.status(error?.statusCode ?? 500).json({ error: readableError(error) });
  }
});

app.get("/api/reforge/ip-adapter/options", async (request, response) => {
  try {
    response.json(await runtimeRegistry.resolve(request.query.runtimeId).getIpAdapterOptions());
  } catch (error) {
    response.status(error?.statusCode ?? 500).json({ error: readableError(error) });
  }
});

app.get("/api/checkpoints", async (request, response) => {
  try {
    response.json(await runtimeRegistry.resolve(request.query.runtimeId).listCheckpoints());
  } catch (error) {
    response.status(error?.statusCode ?? 500).json({ error: readableError(error) });
  }
});

app.post("/api/checkpoints/refresh", async (request, response) => {
  try {
    const provider = runtimeRegistry.resolve(request.query.runtimeId);
    const checkpoints = typeof provider.refreshCheckpoints === "function"
      ? await provider.refreshCheckpoints()
      : await provider.listCheckpoints();
    response.json(checkpoints);
  } catch (error) {
    response.status(error?.statusCode ?? 500).json({ error: readableError(error) });
  }
});

app.post("/api/checkpoints/select", async (request, response) => {
  try {
    const selected = requireText(request.body.checkpoint, "Checkpoint");
    const provider = runtimeRegistry.resolve(request.body.runtimeId);
    if (provider.descriptor.id !== "reforge") {
      const checkpoint = await provider.resolveV1Checkpoint(selected);
      response.json({ checkpoint: checkpoint.id });
      return;
    }
    const available = await provider.listCheckpoints();
    const checkpoint = available.checkpoints.find((item) =>
      [item.title, item.modelName, item.filename].some((value) => value === selected)
    );
    if (!checkpoint) throw new Error("選択したCheckpointがReForgeに見つかりません");
    response.json(await provider.switchCheckpoint(checkpoint.title));
  } catch (error) {
    response.status(error?.statusCode ?? 500).json({ error: readableError(error) });
  }
});

app.get("/api/loras/registry", async (_request, response) => {
  try {
    response.json({ entries: await civitai.listRegistry() });
  } catch (error) {
    response.status(500).json({ error: readableError(error) });
  }
});

// Civitai経由でないLoRAも編集できるよう、必要時に登録を作る。
app.post("/api/loras/registry/ensure", async (request, response) => {
  try {
    const entry = await civitai.ensureEntry({
      relativeName: requireText(request.body.relativeName, "LoRA名"),
      displayName: typeof request.body.displayName === "string" ? request.body.displayName : ""
    });
    response.json({ entry });
  } catch (error) {
    response.status(400).json({ error: readableError(error) });
  }
});

app.get("/api/loras/:uid", async (request, response) => {
  try {
    response.json({ entry: await civitai.getEntry(requireId(request.params.uid)) });
  } catch (error) {
    response.status(404).json({ error: readableError(error) });
  }
});

app.patch("/api/loras/:uid", async (request, response) => {
  try {
    const entry = await civitai.updateEntry(requireId(request.params.uid), request.body ?? {});
    const loras = await getInstalledLoras().catch(() => []);
    response.json({ entry, loras });
  } catch (error) {
    response.status(400).json({ error: readableError(error) });
  }
});

app.post("/api/loras/:uid/move", async (request, response) => {
  try {
    const result = await civitai.moveEntry(requireId(request.params.uid), {
      folder: requireText(request.body.folder, "保存先フォルダ"),
      confirm: request.body.confirm === true
    });
    // 移動後はReForgeへLoRA再読込を促し、最新一覧を返す。
    const loras = await refreshLoras(config.reforge).then((items) => civitai.mergeWithInstalled(items)).catch(() => []);
    response.json({ ...result, loras });
  } catch (error) {
    response.status(400).json({ error: readableError(error) });
  }
});

app.post("/api/loras/refresh", async (request, response) => {
  try {
    const provider = runtimeRegistry.resolve(request.query.runtimeId);
    // 各Runtimeに正式な再走査処理があれば使用する。ReForgeの既存経路も維持する。
    const loras = provider.descriptor.id === "reforge"
      ? await refreshLoras(config.reforge)
      : typeof provider.refreshLoras === "function"
        ? await provider.refreshLoras()
        : await provider.listLoras();
    response.json({ loras: await civitai.mergeWithInstalled(loras) });
  } catch (error) {
    response.status(500).json({ error: readableError(error) });
  }
});

app.get("/api/lora/install-root", async (_request, response) => {
  try {
    response.json(await civitai.describeInstallRoot());
  } catch (error) {
    response.status(500).json({ error: readableError(error) });
  }
});

// LoRAルートをOSのファイラで開く。ユーザー入力は一切受け取らず、
// サーバー側で確定したパスだけをshellを介さずに渡す。
app.post("/api/lora/open-root", async (_request, response) => {
  try {
    const { root } = await civitai.describeInstallRoot();
    if (!root) throw new Error(AMBIGUOUS_ROOT_MESSAGE);
    const stats = await fs.stat(root).catch(() => null);
    if (!stats?.isDirectory()) throw new Error("LoRAルートのフォルダが見つかりません");
    openDirectory(root);
    response.json({ ok: true, root });
  } catch (error) {
    response.status(400).json({ error: readableError(error) });
  }
});

// Never return the credential itself to the browser.
app.get("/api/civitai/auth-status", (_request,response)=>response.json({configured:Boolean(resolveCivitaiToken(""))}));

app.post("/api/civitai/inspect", async (request, response) => {
  try {
    const url = requireText(request.body.url, "Civitai URL");
    const metadata = await civitai.inspect(url, resolveCivitaiToken(request.body.token));
    response.json({ metadata });
  } catch (error) {
    response.status(500).json({ error: readableError(error) });
  }
});

app.get("/api/civitai/install-folders", async (_request, response) => {
  try {
    response.json(await civitai.listInstallFolders());
  } catch (error) {
    response.status(500).json({ error: readableError(error) });
  }
});

app.post("/api/civitai/check-duplicate", async (request, response) => {
  try {
    response.json(await civitai.checkDuplicate({
      url: requireText(request.body.url, "Civitai URL"),
      token: resolveCivitaiToken(request.body.token),
      category: textOrDefault(request.body.category, "style"),
      folder: typeof request.body.folder === "string" ? request.body.folder : ""
    }));
  } catch (error) {
    response.status(500).json({ error: readableError(error) });
  }
});

app.post("/api/civitai/install", async (request, response) => {
  const requestedRuntimeId = typeof request.body?.runtimeId === "string"
    ? request.body.runtimeId.trim()
    : "";
  const runtimeId = requestedRuntimeId || runtimeRegistry.defaultRuntimeId;
  try {
    const result = await civitai.install({
      url: requireText(request.body.url, "Civitai URL"),
      token: resolveCivitaiToken(request.body.token),
      category: textOrDefault(request.body.category, "style"),
      folder: typeof request.body.folder === "string" ? request.body.folder : "",
      overwrite: request.body.overwrite === true,
      mode: validateInstallMode(request.body.mode),
      filename: typeof request.body.filename === "string" ? request.body.filename : "",
      confirmMove: request.body.confirmMove === true
    });
    response.json({
      ...result,
      loras: await listLorasForRuntime(runtimeId)
    });
  } catch (error) {
    response.status(500).json({ error: readableError(error, runtimeLabelForId(runtimeId)) });
  }
});

app.post("/api/civitai/refresh-registrations", async (request, response) => {
  try {
    const result = await civitai.refreshRegistrations(resolveCivitaiToken(request.body.token));
    response.json(result);
  } catch (error) {
    response.status(500).json({ error: readableError(error) });
  }
});

app.get("/api/history", async (request, response) => {
  try {
    const page = await history.listPage({
      favoritesOnly: request.query.favorites === "1",
      contentRating: request.query.rating,
      limit: request.query.limit,
      cursor: request.query.cursor,
      search: request.query.search, sort: request.query.sort
    });
    response.json({
      ...page,
      generations: page.generations.map(serializeGeneration)
    });
  } catch (error) {
    response.status(400).json({ error: readableError(error) });
  }
});

app.get("/api/images/:imageId/thumbnail", async (request, response) => {
  let image = null;
  let imagePaths = null;
  try {
    const imageId = requireId(request.params.imageId);
    if (isReferenceAssetId(imageId)) {
      const thumbnailPath = await referenceAssets.resolveAssetPath(imageId, "thumbnail");
      await sendImmutableImage(request, response, thumbnailPath, { allowDotfiles: true });
      return;
    }
    image = await history.getImage(imageId);
    imagePaths = thumbnails.pathsFor(image);
    const { thumbnailPath } = await thumbnails.ensure(image);
    await sendImmutableImage(request, response, thumbnailPath);
  } catch (error) {
    if (isReferenceAssetId(request.params.imageId)) {
      response.status(404).json({ error: "参照画像が見つかりません" });
      return;
    }
    if (image) {
      console.warn(
        `[Thumbnail] action=serve imageId=${image.id}`
        + ` originalPath=${imagePaths?.sourcePath ?? "(unresolved)"}`
        + ` thumbnailPath=${imagePaths?.thumbnailPath ?? "(unresolved)"}`
        + ` error=${readableError(error)}`
      );
    }
    const missingOriginal = error?.code === "ENOENT";
    response.status(missingOriginal ? 404 : 422).json({
      error: missingOriginal
        ? "原画像が見つからないためサムネイルを生成できません"
        : "サムネイルを生成または取得できません"
    });
  }
});

app.get("/api/images/:imageId/original", async (request, response) => {
  try {
    const imageId = requireId(request.params.imageId);
    if (isReferenceAssetId(imageId)) {
      const originalPath = await referenceAssets.resolveAssetPath(imageId, "original");
      await sendImmutableImage(request, response, originalPath, { allowDotfiles: true });
      return;
    }
    const image = await history.getImage(imageId);
    const originalPath = resolveOutputImagePath(image.filename);
    await fs.access(originalPath);
    await sendImmutableImage(request, response, originalPath);
  } catch (error) {
    response.status(404).json({ error: readableError(error) });
  }
});

app.get("/api/history/preferences", async (_request, response) => {
  try {
    response.json(await history.getPreferences());
  } catch (error) {
    response.status(500).json({ error: readableError(error) });
  }
});

app.get("/api/experiments/:experimentId/history", async (request, response) => {
  try {
    const generations = await history.listByExperiment(requireId(request.params.experimentId));
    response.json({ generations: generations.map(serializeGeneration) });
  } catch (error) {
    response.status(404).json({ error: readableError(error) });
  }
});

app.get("/api/history/:imageId/recipe", async (request, response) => {
  try {
    response.json(await history.getRecipe(requireId(request.params.imageId)));
  } catch (error) {
    response.status(404).json({ error: readableError(error) });
  }
});

app.patch("/api/history/:imageId/favorite", async (request, response) => {
  try {
    const imageId = requireId(request.params.imageId);
    const favorite = request.body.favorite !== false;
    const image = await history.setFavorite(imageId, favorite);
    await syncFavoriteFile(image, favorite);
    // Favorite自体はここで完了。Discord送信は状態を確保するだけで、完了は待たない。
    // 送信が失敗してもFavoriteは取り消さない。解除時は投稿を消さない。
    const discordState = favorite
      ? await discord.sendForFavorite(imageId).catch((error) => {
        console.warn(`[Discord] 自動送信を開始できませんでした: ${error.message}`);
        return normalizeDiscordState(image.discord);
      })
      : normalizeDiscordState(image.discord);
    response.json({
      image: { ...image, discord: discordState },
      preferences: await history.getPreferences()
    });
  } catch (error) {
    response.status(404).json({ error: readableError(error) });
  }
});

app.get("/api/history/:imageId/discord", async (request, response) => {
  try {
    response.json({ discord: await discord.getState(requireId(request.params.imageId)) });
  } catch (error) {
    response.status(404).json({ error: readableError(error) });
  }
});

app.patch("/api/history/:imageId/content-rating", async (request, response) => {
  try {
    const result = await history.setContentRating(
      requireId(request.params.imageId),
      request.body?.contentRating
    );
    response.json(result);
  } catch (error) {
    const notFound = /履歴にありません/.test(String(error?.message ?? ""));
    response.status(notFound ? 404 : 400).json({ error: readableError(error) });
  }
});

app.get("/api/history/:imageId/discord/generation", async (request, response) => {
  try {
    response.json({ discord: await discord.getGenerationState(requireId(request.params.imageId)) });
  } catch (error) {
    response.status(404).json({ error: readableError(error) });
  }
});

// 失敗した画像の手動再送。sent / sending は拒否する（二重投稿の防止）。
app.post("/api/history/:imageId/discord/send", async (request, response) => {
  try {
    response.json({ discord: await discord.resend(requireId(request.params.imageId)) });
  } catch (error) {
    response.status(409).json({ error: readableError(error) });
  }
});

// 失敗した生成完了通知の手動再送。Favorite送信とは別状態で扱う。
app.post("/api/history/:imageId/discord/generation/send", async (request, response) => {
  try {
    response.json({ discord: await discord.resendGeneration(requireId(request.params.imageId)) });
  } catch (error) {
    response.status(409).json({ error: readableError(error) });
  }
});

// ---- AI共有（CSV更新 / Grok用全コピー） ----

app.get("/api/ai-share", async (_request, response) => {
  try {
    response.json({ state: await aiShare.getState(), csv: await aiShare.readCsv() });
  } catch (error) {
    response.status(500).json({ error: readableError(error) });
  }
});

// 画面の手入力Trigger Wordsを受け取り、レジストリの値とマージしてCSVを作り直す。
app.post("/api/ai-share/csv", async (request, response) => {
  try {
    await aiShare.saveManualTriggerWords(request.body?.triggerWords);
    const result = await aiShare.updateCsv(await getInstalledLoras());
    response.json({
      path: result.path,
      csv: result.csv,
      rowCount: result.rowCount,
      triggerWordCount: result.triggerWordCount,
      changed: result.changed,
      generatedAt: result.generatedAt
    });
  } catch (error) {
    response.status(500).json({ error: readableError(error) });
  }
});

// Grokへ貼り付けるMarkdown。CSVと同じ値をそのまま載せる。
app.post("/api/ai-share/grok", async (request, response) => {
  try {
    await aiShare.saveManualTriggerWords(request.body?.triggerWords);
    const loras = await getInstalledLoras();
    const result = await aiShare.updateCsv(loras);
    const template = await promptTemplate.get();
    // ReForgeが落ちていてもコピー自体は成功させる。
    const checkpointInfo = await listCheckpoints(config.reforge).catch(() => ({ checkpoints: [], activeCheckpoint: "" }));
    response.json({
      markdown: buildGrokShareMarkdown({
        rows: result.rows,
        csv: result.csv,
        setupDoc: template.setupDoc,
        instructions: template.instructions,
        checkpoints: checkpointInfo.checkpoints,
        activeCheckpoint: checkpointInfo.activeCheckpoint,
        version: packageJson.version
      }),
      rowCount: result.rowCount,
      triggerWordCount: result.triggerWordCount,
      path: result.path
    });
  } catch (error) {
    response.status(500).json({ error: readableError(error) });
  }
});

app.get("/api/prompt-template", async (_request, response) => {
  try {
    response.json({ template: await promptTemplate.get() });
  } catch (error) {
    response.status(500).json({ error: readableError(error) });
  }
});

app.patch("/api/prompt-template", async (request, response) => {
  try {
    const body = request.body ?? {};
    response.json({
      template: await promptTemplate.update({
        instructions: body.instructions,
        setupDoc: body.setupDoc,
        loraCsv: body.loraCsv
      })
    });
  } catch (error) {
    response.status(400).json({ error: readableError(error) });
  }
});

app.get("/api/discord/settings", async (_request, response) => {
  try {
    response.json({ settings: await discord.getSettings() });
  } catch (error) {
    response.status(500).json({ error: readableError(error) });
  }
});

app.patch("/api/discord/settings", async (request, response) => {
  try {
    const body = request.body ?? {};
    response.json({
      settings: await discord.updateSettings({
        autoSend: body.autoSend,
        includePrompt: body.includePrompt,
        includeMetadata: body.includeMetadata,
        generationAutoSend: body.generationAutoSend,
        generationIncludeImage: body.generationIncludeImage,
        generationIncludeTitle: body.generationIncludeTitle,
        generationIncludeModel: body.generationIncludeModel,
        generationIncludeSeed: body.generationIncludeSeed,
        generationIncludeDuration: body.generationIncludeDuration,
        generationAttachmentMode: body.generationAttachmentMode,
        // 受け取ったWebhook URLはサーバー内に保存するだけで、返却も記録もしない。
        webhookUrl: typeof body.webhookUrl === "string" ? body.webhookUrl : undefined,
        clearWebhook: body.clearWebhook === true
      })
    });
  } catch (error) {
    response.status(400).json({ error: readableError(error) });
  }
});

app.post("/api/discord/test", async (_request, response) => {
  try {
    response.json({ ok: true, result: await discord.sendTestNotification() });
  } catch (error) {
    response.status(400).json({ error: readableError(error) });
  }
});

app.delete("/api/history/:imageId", async (request, response) => {
  try {
    const removed = await history.deleteImage(requireId(request.params.imageId));
    await deleteOutputImage(removed.filename ?? removed.imageUrl);
    await thumbnails.remove(removed).catch(() => {});
    await syncFavoriteFile(removed, false);
    response.json({ ok: true, preferences: await history.getPreferences() });
  } catch (error) {
    response.status(404).json({ error: readableError(error) });
  }
});

app.get("/api/jobs", (_request, response) => {
  response.json({ jobs: jobs.list() });
});

app.post("/api/jobs", (request, response) => {
  try {
    const body = request.body ?? {};
    const job = generationService.createLegacyJob(body, {
      kind: "generation",
      label: describeGenerationJob(body)
    });
    response.status(202).json({ job });
  } catch (error) {
    response.status(error?.statusCode ?? 400).json({ error: readableError(error) });
  }
});

// ヘッダー右上のキュー表示用。通常生成と比較実験をまとめて返す。
app.get("/api/queue", async (_request, response) => {
  try {
    response.json(await buildQueueSnapshot());
  } catch (error) {
    response.status(500).json({ error: readableError(error) });
  }
});

app.get("/api/jobs/:jobId", (request, response) => {
  try {
    response.json({ job: jobs.get(requireId(request.params.jobId)) });
  } catch (error) {
    response.status(404).json({ error: readableError(error) });
  }
});

app.delete("/api/jobs/:jobId", (request, response) => {
  try {
    response.json({ job: jobs.cancel(requireId(request.params.jobId)) });
  } catch (error) {
    response.status(404).json({ error: readableError(error) });
  }
});

// ---- Checkpoint別LoRAセット ----

app.get("/api/checkpoint-lora-sets", async (_request, response) => {
  try {
    response.json({ sets: await checkpointSets.list() });
  } catch (error) {
    response.status(500).json({ error: readableError(error) });
  }
});

app.post("/api/checkpoint-lora-sets", async (request, response) => {
  try {
    response.status(201).json({ set: await checkpointSets.create(request.body ?? {}) });
  } catch (error) {
    response.status(400).json({ error: readableError(error) });
  }
});

app.patch("/api/checkpoint-lora-sets/:setId", async (request, response) => {
  try {
    const setId = requireId(request.params.setId);
    const set = request.body?.duplicate === true
      ? await checkpointSets.duplicate(setId)
      : await checkpointSets.patch(setId, request.body ?? {});
    response.json({ set });
  } catch (error) {
    response.status(400).json({ error: readableError(error) });
  }
});

app.delete("/api/checkpoint-lora-sets/:setId", async (request, response) => {
  try {
    await checkpointSets.remove(requireId(request.params.setId));
    response.json({ ok: true });
  } catch (error) {
    response.status(404).json({ error: readableError(error) });
  }
});

// ---- パラメータ比較（実験） ----

app.get("/api/experiments", async (request, response) => {
  try {
    response.json({
      experiments: await experiments.list({ limit: request.query.limit }),
      limits: experiments.limits(),
      parameters: COMPARABLE_PARAMETERS
    });
  } catch (error) {
    response.status(500).json({ error: readableError(error) });
  }
});

app.post("/api/experiments", async (request, response) => {
  try {
    const body = request.body ?? {};
    if (!isComparableParameter(body.parameter)) throw new Error("比較できないパラメータです");
    const experiment = await experiments.create({
      baseRequest: body.baseRequest ?? {},
      parameter: body.parameter,
      target: typeof body.target === "string" ? body.target : "",
      values: body.values,
      fixedSeed: body.fixedSeed,
      name: typeof body.name === "string" ? body.name : ""
    });
    response.status(202).json({ experiment });
  } catch (error) {
    // 未完了の比較実験が残っている場合は409（GPUキューが直列なので同時実行させない）。
    response.status(error?.statusCode ?? 400).json({ error: readableError(error) });
  }
});

app.get("/api/experiments/:experimentId", async (request, response) => {
  try {
    response.json({ experiment: await experiments.get(requireId(request.params.experimentId)) });
  } catch (error) {
    response.status(404).json({ error: readableError(error) });
  }
});

app.patch("/api/experiments/:experimentId", async (request, response) => {
  try {
    const experiment = await experiments.patch(requireId(request.params.experimentId), {
      name: request.body?.name,
      bestImageId: request.body?.bestImageId,
      note: request.body?.note
    });
    response.json({ experiment });
  } catch (error) {
    response.status(404).json({ error: readableError(error) });
  }
});

app.post("/api/experiments/:experimentId/cancel", async (request, response) => {
  try {
    response.json({ experiment: await experiments.cancel(requireId(request.params.experimentId)) });
  } catch (error) {
    response.status(404).json({ error: readableError(error) });
  }
});

// 実験の一括削除。画像も消すかどうかはクライアントで選ばせる。
app.delete("/api/experiments/:experimentId", async (request, response) => {
  try {
    const experimentId = requireId(request.params.experimentId);
    const deleteImages = request.query.deleteImages === "1";
    // 履歴を消す前に必ずジョブを止める。止めないと削除後に画像と履歴が増える。
    await experiments.get(experimentId);
    await experiments.stopJobs(experimentId);
    const generations = await history.listByExperiment(experimentId);
    let removedImages = 0;
    for (const generation of generations) {
      const removed = await history.deleteGeneration(generation.id).catch(() => null);
      if (!removed) continue;
      for (const image of removed.images) {
        await syncFavoriteFile(image, false);
        if (deleteImages) {
          await deleteOutputImage(image.filename ?? image.imageUrl);
          removedImages += 1;
        }
      }
    }
    await experiments.remove(experimentId);
    response.json({ ok: true, removedGenerations: generations.length, removedImages });
  } catch (error) {
    response.status(404).json({ error: readableError(error) });
  }
});

app.get("/api/comparisons", async (_request, response) => {
  try {
    response.json({ comparisons: await experiments.listComparisons({}) });
  } catch (error) {
    response.status(500).json({ error: readableError(error) });
  }
});

// A/B比較の投票。履歴の画像側にも結果を残す。
app.post("/api/comparisons", async (request, response) => {
  try {
    const imageIds = validateImageIds(request.body?.imageIds);
    const winnerImageId = request.body?.winnerImageId ? requireId(request.body.winnerImageId) : null;
    if (winnerImageId && !imageIds.includes(winnerImageId)) throw new Error("勝ち画像が比較対象に含まれていません");
    const comparison = await experiments.addComparison({
      imageIds,
      winnerImageId,
      result: request.body?.result,
      parameter: request.body?.parameter,
      note: request.body?.note
    });
    for (const imageId of imageIds) {
      const vote = comparison.result === "draw" ? "draw" : imageId === winnerImageId ? "win" : "lose";
      await history.setImageVote(imageId, vote).catch(() => {});
    }
    response.json({ comparison });
  } catch (error) {
    response.status(400).json({ error: readableError(error) });
  }
});

app.post("/api/update/check", async (request, response) => {
  try {
    response.json(await updater.check(sanitizeSecret(request.body.token)));
  } catch (error) {
    response.status(500).json({ error: readableError(error) });
  }
});

app.post("/api/update/apply", async (request, response) => {
  try {
    response.json(await updater.apply(sanitizeSecret(request.body.token)));
  } catch (error) {
    response.status(500).json({ error: readableError(error) });
  }
});

// v2.0クライアントや外部スクリプト向けの同期APIも維持する。
app.post("/api/generate", async (request, response) => {
  try {
    response.json(await generationService.generateLegacyNow(request.body ?? {}, {
      signal: request.signal,
      report: () => {}
    }));
  } catch (error) {
    response.status(error?.statusCode ?? 500).json({ error: readableError(error) });
  }
});

// 既定はPC内のみ（127.0.0.1）。スマホから使うときだけ 0.0.0.0 などへ広げる。
// ReForge・Ollamaへの接続は従来どおりサーバー側から127.0.0.1へ行い、端末へは公開しない。
const server = app.listen(binding.port, binding.host, () => {
  startupComplete = true;
  clearStartupFailureHandlers();
  console.log(`Local Image Chat v${packageJson.version}`);
  for (const line of describeBinding(binding)) console.log(`  ${line}`);
  // 起動に成功した後だけ、既存データの補完処理を開始する。
  void backfillFavorites();
  void recoverStuckDiscordSends();
  void backfillContentHashes();
});

server.once("error", (error) => {
  if (startupComplete) {
    console.error(`[Server] 待ち受け中にエラーが発生しました: ${readableError(error)}`);
    return;
  }
  const startupError = error?.code === "EADDRINUSE"
    ? new Error(`ポート ${binding.port} は既に使用されています。別のポートを指定してください。`)
    : error;
  handleStartupFailure(startupError);
});

let shutdownPromise;
async function shutdownServer(signal) {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    clearStartupFailureHandlers();
    console.log(`[Server] ${signal}を受信したため終了します。`);
    try {
      if (server.listening) {
        await new Promise((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        });
      }
    } finally {
      await instanceLock.release();
    }
    process.exitCode = 0;
    process.exit(0);
  })().catch((error) => {
    console.error(`[Server] 終了処理に失敗しました: ${readableError(error)}`);
    process.exitCode = 1;
    process.exit(1);
  });
  return shutdownPromise;
}

process.once("SIGINT", () => void shutdownServer("SIGINT"));
process.once("SIGTERM", () => void shutdownServer("SIGTERM"));

if (!integrationKey) {
  console.warn(
    "[Favorite連携] LOCAL_IMAGE_CHAT_INTEGRATION_KEY が未設定のため、連携APIは無効です。"
  );
  console.warn(
    "  stable-diffusion-manager からのFavorite同期を使う場合は、鍵を設定して再起動してください。"
  );
} else if (!isUsableIntegrationKey(integrationKey)) {
  // ヘッダーへ載せられない鍵は、送信側が送れずに必ず 401 になる。
  console.warn(
    "[Favorite連携] LOCAL_IMAGE_CHAT_INTEGRATION_KEY にASCII以外の文字が含まれています。"
  );
  console.warn("  HTTPヘッダーで送れないため、半角英数字と記号だけの鍵へ変更してください。");
}

// ---- キュー表示（ヘッダー右上） ----

// 完了直後の結果も出したいので、終了から一定時間はキューへ残す。
const QUEUE_RECENT_MS = 10 * 60 * 1000;
const TERMINAL_JOB_STATUSES = ["done", "failed", "cancelled"];

async function buildQueueSnapshot() {
  const now = Date.now();
  const isRecent = (finishedAt) => !finishedAt || now - new Date(finishedAt).getTime() <= QUEUE_RECENT_MS;

  // jobs.list()は新しい順。待機番号は投入順（古い順）で数える。
  const generation = [];
  let generationQueuePosition = 0;
  for (const job of jobs.list().reverse()) {
    if (job.meta?.kind === "comparison") continue;
    if (!isRecent(job.finishedAt)) continue;
    if (job.status === "queued") generationQueuePosition += 1;
    generation.push({
      id: job.id,
      type: "generation",
      label: job.meta?.label || "画像生成",
      status: job.status,
      // 取得できない状態では偽の進捗率を出さずnullにする。
      progress: job.status === "running" ? numberOrNull(job.progress) : job.status === "done" ? 100 : null,
      message: job.message ?? "",
      queuePosition: job.status === "queued" ? generationQueuePosition : null,
      errorMessage: job.error ?? null,
      recoverable: Boolean(job.recovery),
      createdAt: job.createdAt,
      finishedAt: job.finishedAt
    });
  }

  const comparison = [];
  let comparisonQueuePosition = 0;
  const experimentList = await experiments.list({ limit: 20 });
  for (const experiment of [...experimentList].reverse()) {
    const entry = toComparisonQueueEntry(experiment);
    if (!entry) continue;
    if (entry.status === "queued") {
      comparisonQueuePosition += 1;
      entry.queuePosition = comparisonQueuePosition;
    }
    // 失敗・完了も一定時間は残す（失敗した実験がキューから消えないようにする）。
    if (entry.status === "queued" || entry.status === "running" || entry.status === "saving" || isRecent(entry.finishedAt)) {
      comparison.push(entry);
    }
  }

  const activeGeneration = generation.filter((item) => !TERMINAL_JOB_STATUSES.includes(item.status));
  const activeComparison = comparison.filter((item) => ["queued", "running", "saving"].includes(item.status));
  return {
    generation,
    comparison,
    summary: {
      activeCount: activeGeneration.length + activeComparison.length,
      generationActive: activeGeneration.length,
      comparisonActive: activeComparison.length,
      hasError: generation.some((item) => item.status === "failed")
        || comparison.some((item) => item.status === "failed" || item.failedCases > 0)
    }
  };
}

// 実験1件をキュー1行へ変換する。人が読める比較内容と、完了/総パターン数を持たせる。
function toComparisonQueueEntry(experiment) {
  const runs = experiment.runs ?? [];
  if (!runs.length) return null;
  const completedCases = runs.filter((run) => run.status === "done").length;
  const failedCases = runs.filter((run) => run.status === "failed").length;
  const cancelledCases = runs.filter((run) => run.status === "cancelled").length;
  const pendingCases = runs.filter((run) => run.status === "queued").length;
  const running = runs.find((run) => run.status === "running");
  const failedRun = runs.find((run) => run.status === "failed" && run.error);
  const finishedAt = runs.map((run) => run.finishedAt).filter(Boolean).sort().at(-1) ?? null;

  const status = running
    ? (Number(running.progress) >= 94 ? "saving" : "running")
    : experiment.status === "cancelled"
      ? "cancelled"
      : pendingCases
        ? "queued"
        : failedCases === runs.length
          ? "failed"
          : "completed";

  return {
    id: experiment.id,
    type: "comparison",
    name: experiment.name,
    subject: describeExperimentSubject(experiment),
    status,
    queuePosition: null,
    completedCases,
    failedCases,
    cancelledCases,
    pendingCases,
    totalCases: runs.length,
    // 1パターン1枚で生成するため、画像数は記録済みの画像IDから数える。
    completedImages: runs.reduce((total, run) => total + (run.imageIds?.length ?? 0), 0),
    totalImages: runs.length,
    currentCaseLabel: running
      ? describeExperimentValue(experiment.parameter, experiment.target, running.value)
      : null,
    progress: running ? numberOrNull(running.progress) : null,
    message: running?.message ?? "",
    resultId: completedCases ? experiment.id : null,
    errorMessage: failedRun?.error ?? null,
    createdAt: experiment.createdAt,
    finishedAt
  };
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function listLorasForRuntime(runtimeId = runtimeRegistry.defaultRuntimeId) {
  const provider = runtimeRegistry.resolve(runtimeId);
  const loras = provider.descriptor.id === "reforge"
    ? await refreshLoras(config.reforge)
    : typeof provider.refreshLoras === "function"
      ? await provider.refreshLoras()
      : await provider.listLoras();
  return civitai.mergeWithInstalled(loras);
}

async function getInstalledLoras(runtimeId = "reforge") {
  const provider = runtimeRegistry.resolve(runtimeId);
  const installed = await provider.listLoras();
  return civitai.mergeWithInstalled(installed);
}

// shellを経由せず、確定済みディレクトリパスだけを引数として渡す。
function openDirectory(directory) {
  const command = process.platform === "win32"
    ? { file: "explorer.exe", args: [directory] }
    : process.platform === "darwin"
      ? { file: "open", args: [directory] }
      : { file: "xdg-open", args: [directory] };
  const child = spawn(command.file, command.args, { shell: false, detached: true, stdio: "ignore" });
  // explorer.exeは成功時も終了コード1を返すため、エラーは握りつぶす。
  child.on("error", (error) => console.warn(`[LoRA] フォルダを開けません: ${error.message}`));
  child.unref();
}

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}を入力してください`);
  return value.trim().slice(0, 4000);
}

function validateImageIds(value) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 4) {
    throw new Error("比較は2〜4枚で行ってください");
  }
  const ids = [...new Set(value.map((item) => requireId(item)))];
  if (ids.length < 2) throw new Error("比較は異なる2枚以上を選んでください");
  return ids;
}

function requireId(value) {
  const id = String(value ?? "");
  if (!/^[a-z0-9-]{8,80}$/i.test(id)) throw new Error("IDが不正です");
  return id;
}

const INSTALL_MODES = ["auto", "reuse", "metadata", "rename", "move"];

function validateInstallMode(value) {
  return INSTALL_MODES.includes(value) ? value : "auto";
}

async function sendImmutableImage(request, response, filePath, { allowDotfiles = false } = {}) {
  const stats = await fs.stat(filePath);
  const etag = `W/"${stats.size.toString(16)}-${Math.trunc(stats.mtimeMs).toString(16)}"`;
  response.set({
    "Cache-Control": "public, max-age=31536000, immutable",
    ETag: etag,
    "Last-Modified": stats.mtime.toUTCString(),
    "X-Content-Type-Options": "nosniff"
  });
  if (request.headers["if-none-match"] === etag) {
    response.status(304).end();
    return;
  }
  if (allowDotfiles) {
    // Reference Assetはドットディレクトリ配下だが、ID検証済みの固定APIだけに限定する。
    response.sendFile(filePath, { dotfiles: "allow" });
    return;
  }
  response.sendFile(filePath);
}

async function syncFavoriteFile(image, favorite) {
  const filename = image?.filename;
  // 履歴の生成画像はoutputs直下に保存されるため、パス区切りを含む名前は対象外にする
  if (!filename || path.basename(filename) !== filename) return;
  const destination = path.join(favoritesDir, filename);
  try {
    if (favorite) {
      await fs.copyFile(path.join(outputDir, filename), destination);
    } else {
      await fs.rm(destination, { force: true });
    }
  } catch (error) {
    // お気に入りフォルダは履歴フラグのミラーなので、失敗しても👍操作自体は妨げない
    if (error?.code !== "ENOENT") {
      console.warn(`[Favorites] ${filename} の同期に失敗: ${error.message}`);
    }
  }
}

// 履歴削除時に出力画像ファイルを消す。outputディレクトリ外のパスは扱わない。
async function deleteOutputImage(nameOrUrl) {
  const filename = path.basename(String(nameOrUrl ?? "").replace(/^\/outputs\//, ""));
  // パス区切りを含む名前（トラバーサル）は対象外にする。
  if (!filename || path.basename(filename) !== filename) return;
  const target = path.resolve(outputDir, filename);
  if (path.relative(outputDir, target).startsWith("..")) return;
  // ファイルが存在しなくても削除は成功扱い（force: true）。
  await fs.rm(target, { force: true });
}

// 送信中のままプロセスが落ちた画像は、再送できるようにfailedへ戻す。
async function recoverStuckDiscordSends() {
  try {
    const recovered = await history.recoverStuckDiscordSends();
    if (recovered) console.warn(`[Discord] 中断された送信を${recovered}件だけ再送可能へ戻しました`);
  } catch (error) {
    console.warn(`[Discord] 送信状態の復旧に失敗: ${error.message}`);
  }
}

// 古い履歴には画像内容のSHA-256が無い。
// stable-diffusion-manager と照合できるよう、ファイルが残っている分だけ補完する。
async function backfillContentHashes() {
  try {
    const summary = await history.backfillContentHashes((filename) =>
      hashOutputImage(outputDir, filename)
    );
    if (!summary.checked) return;
    console.log(`Favorite連携用ハッシュ: ${summary.checked}件確認`);
    console.log(`  追加: ${summary.added}`);
    console.log(`  既存: ${summary.existing}`);
    console.log(`  失敗: ${summary.failed}`);
    if (summary.failed) {
      console.log("  （ファイルが残っていない画像はハッシュを付けられません）");
    }
  } catch (error) {
    // 補完に失敗しても起動は続ける。
    console.warn(`[Favorite連携] ハッシュの補完に失敗: ${error.message}`);
  }
}

async function backfillFavorites() {
  try {
    const generations = await history.list({ favoritesOnly: true, limit: 500 });
    for (const generation of generations) {
      for (const image of generation.images) {
        await syncFavoriteFile(image, true);
      }
    }
  } catch (error) {
    console.warn(`[Favorites] 既存お気に入りの同期に失敗: ${error.message}`);
  }
}

function sanitizeSecret(value) {
  return typeof value === "string" ? value.trim().slice(0, 500) : "";
}

function textOrDefault(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 100) : fallback;
}

function mergeRuntimeHealthDescriptor(descriptor, health) {
  const live = health && typeof health === "object" && !Array.isArray(health) ? health : {};
  const online = live.ok === true && live.available !== false;
  const merged = {
    ...descriptor,
    available: online,
    ok: online
  };
  if (typeof live.error === "string" && live.error.trim()) {
    merged.error = live.error.trim().slice(0, 200);
  }
  return merged;
}

function runtimeLabelForId(runtimeId) {
  try {
    return runtimeRegistry.resolve(runtimeId).descriptor.label;
  } catch {
    return "";
  }
}

function readableError(error, runtimeLabel = "") {
  if (error?.name === "TimeoutError") return "処理がタイムアウトしました";
  if (error?.name === "AbortError" || /中止/.test(error?.message ?? "")) return "処理を中止しました";
  if (error?.cause?.code === "ECONNREFUSED") {
    return runtimeLabel ? `${runtimeLabel}へ接続できません` : "接続できません。OllamaとReForgeが起動しているか確認してください";
  }
  return error?.message ?? "不明なエラーが発生しました";
}

async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

function deepMerge(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) return structuredClone(override);
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    result[key] = isPlainObject(value) && isPlainObject(result[key])
      ? deepMerge(result[key], value)
      : structuredClone(value);
  }
  return result;
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}
