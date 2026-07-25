import express from "express";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { AMBIGUOUS_ROOT_MESSAGE } from "./lora-root.js";
import { migrateDataFiles } from "./migrations.js";
import { createCheckpointSetService } from "./checkpoint-sets.js";
import {
  MAX_RETRY_COUNT,
  buildRecoveryPlan,
  buildRetryInfo,
  classifyGenerationError,
  describeRecoveryPlan
} from "./recovery.js";
import {
  COMPARABLE_PARAMETERS,
  MAX_EXPERIMENT_IMAGES,
  createExperimentService,
  isComparableParameter
} from "./experiments.js";
import { checkOllama, createPrompt, unloadOllama } from "./ollama.js";
import {
  checkReforge,
  generateImages,
  listCheckpoints,
  listLoras,
  refreshLoras,
  switchCheckpoint
} from "./reforge.js";
import { createHistoryService } from "./history.js";
import { createJobManager } from "./job-manager.js";
import { createCivitaiService } from "./civitai.js";
import { createUpdater } from "./updater.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const MAX_INIT_IMAGE_BYTES = 20 * 1024 * 1024;
const baseConfig = JSON.parse(await fs.readFile(path.join(rootDir, "config.json"), "utf8"));
const localConfigPath = process.env.LOCAL_IMAGE_CHAT_CONFIG
  ? path.resolve(process.env.LOCAL_IMAGE_CHAT_CONFIG)
  : path.join(rootDir, "config.local.json");
const localConfig = await readOptionalJson(localConfigPath);
const packageJson = JSON.parse(await fs.readFile(path.join(rootDir, "package.json"), "utf8"));
const config = deepMerge(baseConfig, localConfig);
const outputDir = process.env.LOCAL_IMAGE_CHAT_OUTPUT_DIR
  ? path.resolve(process.env.LOCAL_IMAGE_CHAT_OUTPUT_DIR)
  : path.join(rootDir, "outputs");
const favoritesDir = process.env.LOCAL_IMAGE_CHAT_FAVORITES_DIR
  ? path.resolve(process.env.LOCAL_IMAGE_CHAT_FAVORITES_DIR)
  : path.join(outputDir, "favorite");
const dataDir = process.env.LOCAL_IMAGE_CHAT_DATA_DIR
  ? path.resolve(process.env.LOCAL_IMAGE_CHAT_DATA_DIR)
  : path.join(rootDir, "data");
await Promise.all([
  fs.mkdir(outputDir, { recursive: true }),
  fs.mkdir(favoritesDir, { recursive: true }),
  fs.mkdir(dataDir, { recursive: true })
]);

// 既存データを読む前に、バックアップを作ってからschemaVersionを上げる。
await migrateDataFiles(dataDir);

const history = createHistoryService(dataDir, {
  limit: config.storage?.historyLimit ?? 500
});
const civitai = createCivitaiService({
  dataDir,
  loraConfig: config.lora,
  reforgeConfig: config.reforge
});
const updater = createUpdater(rootDir, {
  repository: config.github?.repository ?? "sizuruinkstone/local-image-chat",
  branch: config.github?.branch ?? "main"
}, packageJson.version);
const jobs = createJobManager(generateWithRecovery);
const checkpointSets = createCheckpointSetService(dataDir);
const experiments = createExperimentService(dataDir, {
  jobs,
  maxImages: config.experiments?.maxImages ?? MAX_EXPERIMENT_IMAGES
});

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(rootDir, "public")));
app.use("/outputs", express.static(outputDir));
app.use("/favorites", express.static(favoritesDir));

app.get("/api/config", (_request, response) => {
  response.json({
    version: packageJson.version,
    defaults: config.defaults,
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

app.get("/api/health", async (_request, response) => {
  const [ollama, reforge] = await Promise.allSettled([
    checkOllama(config.ollama),
    checkReforge(config.reforge)
  ]);
  response.json({
    ollama: ollama.status === "fulfilled" ? ollama.value : { ok: false, error: ollama.reason.message },
    reforge: reforge.status === "fulfilled" ? reforge.value : { ok: false, error: reforge.reason.message }
  });
});

app.post("/api/prompt", async (request, response) => {
  try {
    const description = requireText(request.body.description, "生成したい内容");
    const generated = await createPrompt(config.ollama, description);
    response.json({
      ...generated,
      prompt: appendUniqueTags(generated.prompt, validatePromptBoosts(request.body.promptBoosts))
    });
  } catch (error) {
    response.status(500).json({ error: readableError(error) });
  }
});

app.get("/api/loras", async (_request, response) => {
  try {
    response.json({ loras: await getInstalledLoras() });
  } catch (error) {
    response.status(500).json({ error: readableError(error) });
  }
});

app.get("/api/checkpoints", async (_request, response) => {
  try {
    response.json(await listCheckpoints(config.reforge));
  } catch (error) {
    response.status(500).json({ error: readableError(error) });
  }
});

app.post("/api/checkpoints/select", async (request, response) => {
  try {
    const selected = requireText(request.body.checkpoint, "Checkpoint");
    const available = await listCheckpoints(config.reforge);
    const checkpoint = available.checkpoints.find((item) =>
      [item.title, item.modelName, item.filename].some((value) => value === selected)
    );
    if (!checkpoint) throw new Error("選択したCheckpointがReForgeに見つかりません");
    response.json(await switchCheckpoint(config.reforge, checkpoint.title));
  } catch (error) {
    response.status(500).json({ error: readableError(error) });
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

app.post("/api/loras/refresh", async (_request, response) => {
  try {
    const loras = await refreshLoras(config.reforge);
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

app.post("/api/civitai/inspect", async (request, response) => {
  try {
    const url = requireText(request.body.url, "Civitai URL");
    const metadata = await civitai.inspect(url, sanitizeSecret(request.body.token));
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
      token: sanitizeSecret(request.body.token),
      category: textOrDefault(request.body.category, "style"),
      folder: typeof request.body.folder === "string" ? request.body.folder : ""
    }));
  } catch (error) {
    response.status(500).json({ error: readableError(error) });
  }
});

app.post("/api/civitai/install", async (request, response) => {
  try {
    const result = await civitai.install({
      url: requireText(request.body.url, "Civitai URL"),
      token: sanitizeSecret(request.body.token),
      category: textOrDefault(request.body.category, "style"),
      folder: typeof request.body.folder === "string" ? request.body.folder : "",
      overwrite: request.body.overwrite === true,
      mode: validateInstallMode(request.body.mode),
      filename: typeof request.body.filename === "string" ? request.body.filename : "",
      confirmMove: request.body.confirmMove === true
    });
    const loras = await refreshLoras(config.reforge);
    response.json({
      ...result,
      loras: await civitai.mergeWithInstalled(loras)
    });
  } catch (error) {
    response.status(500).json({ error: readableError(error) });
  }
});

app.post("/api/civitai/refresh-registrations", async (request, response) => {
  try {
    const result = await civitai.refreshRegistrations(sanitizeSecret(request.body.token));
    response.json(result);
  } catch (error) {
    response.status(500).json({ error: readableError(error) });
  }
});

app.get("/api/history", async (request, response) => {
  try {
    const generations = await history.list({
      favoritesOnly: request.query.favorites === "1",
      limit: request.query.limit
    });
    response.json({ generations });
  } catch (error) {
    response.status(500).json({ error: readableError(error) });
  }
});

app.get("/api/history/preferences", async (_request, response) => {
  try {
    response.json(await history.getPreferences());
  } catch (error) {
    response.status(500).json({ error: readableError(error) });
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
    const favorite = request.body.favorite !== false;
    const image = await history.setFavorite(requireId(request.params.imageId), favorite);
    await syncFavoriteFile(image, favorite);
    response.json({ image, preferences: await history.getPreferences() });
  } catch (error) {
    response.status(404).json({ error: readableError(error) });
  }
});

app.delete("/api/history/:imageId", async (request, response) => {
  try {
    const removed = await history.deleteImage(requireId(request.params.imageId));
    await deleteOutputImage(removed.filename ?? removed.imageUrl);
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
  const job = jobs.create(request.body ?? {});
  response.status(202).json({ job });
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
    response.status(400).json({ error: readableError(error) });
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
    response.json(await performGeneration(request.body ?? {}, {
      signal: request.signal,
      report: () => {}
    }));
  } catch (error) {
    response.status(500).json({ error: readableError(error) });
  }
});

app.listen(config.port, "127.0.0.1", () => {
  console.log(`Local Image Chat v${packageJson.version}: http://127.0.0.1:${config.port}`);
});

backfillFavorites();

// 失敗時に原因を判定し、安全側の設定で1回だけ再試行する。
// 自動再試行がOFFの場合は、提案内容をjob.recoveryへ載せてユーザーへ確認させる。
async function generateWithRecovery(body, context) {
  try {
    return await performGeneration(body, context);
  } catch (error) {
    if (context.signal?.aborted) throw error;
    const previousCount = Number(body?.retryInfo?.retryCount ?? 0);
    if (previousCount >= MAX_RETRY_COUNT) throw error;

    const classification = classifyGenerationError(error);
    if (!classification.retryable) throw error;
    const originalSettings = validateSettings(body?.settings ?? {});
    const plan = buildRecoveryPlan(originalSettings, classification.kind);
    if (!plan) throw error;

    const description = describeRecoveryPlan(classification, plan);
    if (body?.autoRetry !== true) {
      // ユーザー確認を挟むため、提案付きで失敗させる。
      const failure = new Error(`${classification.message}。設定を下げて再試行できます`);
      failure.recovery = description;
      throw failure;
    }

    const retryInfo = buildRetryInfo({
      originalSettings,
      retrySettings: plan.settings,
      classification,
      previousCount
    });
    const summary = description.changes.map((change) => `${change.label}: ${change.from} → ${change.to}`).join("・");
    context.report(4, `${classification.label}のため設定を下げて再試行します${summary ? `（${summary}）` : ""}`);
    console.warn(`[Recovery] ${classification.label}: 1回だけ再試行します ${summary}`);
    return performGeneration({ ...body, settings: plan.settings, retryInfo }, context);
  }
}

async function performGeneration(body, { signal, report }) {
  const description = requireText(body.description, "生成したい内容");
  const mode = validateGenerationMode(body.mode);
  const settings = validateSettings(body.settings ?? {});
  const loras = validateLoras(body.loras);
  const promptBoosts = validatePromptBoosts(body.promptBoosts);
  const sourceImage = await resolveSourceImage(body, mode);
  const maskImage = resolveMaskImage(body, mode, settings);

  report(5, "プロンプトを準備中");
  const generatedPrompt = body.prompt?.trim()
    ? {
        prompt: body.prompt.trim(),
        negative_prompt: body.negativePrompt?.trim() ?? "",
        explanation_ja: "画面で編集したプロンプトを使用しました。"
      }
    : await createPrompt(config.ollama, description, { signal });

  const promptWithBoosts = appendUniqueTags(generatedPrompt.prompt, promptBoosts);
  report(18, "OllamaをVRAMから解放中");
  try {
    await unloadOllama(config.ollama, { signal });
  } catch (error) {
    // unloadに失敗してもReForge生成自体は可能なので、警告に留める。
    if (signal?.aborted) throw error;
    console.warn(`[Ollama] VRAM解放に失敗しましたが生成を続行します: ${error.message}`);
    report(19, "Ollamaの解放に失敗しましたが生成を続行します");
  }

  const effectivePrompt = appendLoras(promptWithBoosts, loras);
  const effectiveNegativePrompt = appendLoraNegatives(generatedPrompt.negative_prompt, loras);
  report(25, "ReForgeで生成を開始");
  const generated = await generateImages(config.reforge, {
    mode,
    prompt: effectivePrompt,
    negativePrompt: effectiveNegativePrompt,
    initImageBase64: sourceImage?.base64,
    maskBase64: maskImage?.base64,
    ...settings
  }, {
    signal,
    onProgress: (value, detail) => report(25 + value * 68, detail)
  });

  report(94, "画像とレシピを保存中");
  const runId = timestamp();
  let sourceImageUrl = sourceImage?.imageUrl ?? null;
  if (sourceImage?.uploaded) {
    sourceImageUrl = await saveContentAddressedImage("img2img-source", sourceImage);
  }
  const maskImageUrl = maskImage
    ? await saveContentAddressedImage("inpaint-mask", maskImage)
    : null;
  const outputSize = outputDimensions(mode, settings);
  const savedImages = await Promise.all(generated.images.map(async (image, index) => {
    const kind = settings.hiresEnabled ? "hires" : `candidate-${index + 1}`;
    const filename = `${runId}_${kind}_seed-${image.seed}.png`;
    await fs.writeFile(path.join(outputDir, filename), Buffer.from(image.base64, "base64"));
    return {
      imageUrl: `/outputs/${filename}`,
      filename,
      seed: image.seed,
      width: outputSize.width,
      height: outputSize.height
    };
  }));

  const experiment = validateExperimentMeta(body.experiment);
  const derivation = validateDerivation(body.derivation);
  const stored = await history.addGeneration({
    kind: settings.hiresEnabled ? "hires" : "candidates",
    mode,
    parentImageId: body.parentImageId,
    parentGenerationId: passthroughText(body.parentGenerationId, 80) || null,
    experimentId: experiment?.id ?? null,
    experimentName: experiment?.name ?? null,
    experimentType: experiment?.type ?? null,
    comparedParameter: experiment?.parameter ?? null,
    comparedValue: experiment?.value ?? null,
    baseSeed: experiment?.baseSeed ?? null,
    derivationType: derivation?.type ?? null,
    derivationInstruction: derivation?.instruction ?? null,
    retryInfo: validateRetryInfo(body.retryInfo),
    sourceImageId: sourceImage?.imageId,
    sourceImageUrl,
    maskImageUrl,
    description,
    prompt: promptWithBoosts,
    negativePrompt: generatedPrompt.negative_prompt,
    effectivePrompt,
    effectiveNegativePrompt,
    settings,
    loras,
    images: savedImages
  });

  if (experiment) {
    await experiments.recordRun(experiment.id, experiment.value, {
      generationId: stored.id,
      imageIds: stored.images.map((image) => image.id)
    }).catch((error) => console.warn(`[Experiment] 記録に失敗: ${error.message}`));
  }

  report(99, "完了");
  return {
    generationId: stored.id,
    experimentId: stored.experimentId,
    mode,
    sourceImageId: stored.sourceImageId,
    sourceImageUrl: stored.sourceImageUrl,
    maskImageUrl: stored.maskImageUrl,
    images: stored.images,
    prompt: promptWithBoosts,
    negativePrompt: generatedPrompt.negative_prompt,
    effectivePrompt,
    effectiveNegativePrompt,
    loras,
    explanation: loras.length
      ? `${generatedPrompt.explanation_ja} LoRA: ${loras.map((item) => `${item.name} (${item.weight})${item.negativeWords ? "・標準衣装抑制" : ""}`).join(", ")}`
      : generatedPrompt.explanation_ja,
    settings
  };
}

async function getInstalledLoras() {
  return civitai.mergeWithInstalled(await listLoras(config.reforge));
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

function validateSettings(input) {
  const defaults = config.defaults;
  const hiresEnabled = input.hiresEnabled === true || input.hiresEnabled === "true";
  return {
    width: boundedInt(input.width, defaults.width, 256, 1536, 64),
    height: boundedInt(input.height, defaults.height, 256, 1536, 64),
    steps: boundedInt(input.steps, defaults.steps, 1, 80),
    cfgScale: boundedNumber(input.cfgScale, defaults.cfgScale, 1, 20),
    seed: boundedInt(input.seed, -1, -1, 4294967295),
    samplerName: textOrDefault(input.samplerName, defaults.samplerName),
    scheduler: textOrDefault(input.scheduler, defaults.scheduler),
    noiseSchedule: normalizeNoiseSchedule(input.noiseSchedule, defaults.noiseSchedule),
    candidateCount: hiresEnabled ? 1 : boundedInt(input.candidateCount, defaults.candidateCount ?? 4, 1, 4),
    img2imgDenoising: boundedNumber(
      input.img2imgDenoising,
      defaults.img2imgDenoising ?? 0.45,
      0.05,
      0.95
    ),
    img2imgResizeMode: boundedInt(
      input.img2imgResizeMode,
      defaults.img2imgResizeMode ?? 1,
      0,
      2
    ),
    inpaintDenoising: boundedNumber(
      input.inpaintDenoising,
      defaults.inpaintDenoising ?? 0.55,
      0.05,
      0.95
    ),
    maskBlur: boundedInt(input.maskBlur, defaults.maskBlur ?? 4, 0, 64),
    inpaintFill: boundedInt(input.inpaintFill, defaults.inpaintFill ?? 1, 0, 3),
    inpaintFullRes: booleanOrDefault(input.inpaintFullRes, defaults.inpaintFullRes ?? true),
    inpaintFullResPadding: boundedInt(
      input.inpaintFullResPadding,
      defaults.inpaintFullResPadding ?? 32,
      0,
      256,
      4
    ),
    hiresEnabled,
    hiresScale: boundedNumber(input.hiresScale, defaults.hiresScale ?? 1.5, 1, 2),
    hiresSteps: boundedInt(input.hiresSteps, defaults.hiresSteps ?? 20, 1, 50),
    hiresDenoising: boundedNumber(input.hiresDenoising, defaults.hiresDenoising ?? 0.4, 0.1, 0.8),
    hiresUpscaler: textOrDefault(input.hiresUpscaler, defaults.hiresUpscaler ?? "R-ESRGAN 4x+ Anime6B"),
    // 履歴表示用のCheckpoint情報。生成には使わず、settingsへそのまま保存する。
    checkpoint: passthroughText(input.checkpoint),
    checkpointHash: passthroughText(input.checkpointHash),
    checkpointModelName: passthroughText(input.checkpointModelName),
    checkpointFilename: passthroughText(input.checkpointFilename)
  };
}

function passthroughText(value, max = 400) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

// 実験メタデータはサーバー内部（experiments.create）で組み立てた形だけ受け付ける。
function validateExperimentMeta(value) {
  if (!isPlainObject(value)) return null;
  if (!/^[a-z0-9-]{8,80}$/i.test(String(value.id ?? ""))) return null;
  if (!isComparableParameter(value.parameter)) return null;
  return {
    id: String(value.id),
    name: passthroughText(value.name, 120),
    type: passthroughText(value.type, 40) || "parameter",
    parameter: String(value.parameter),
    target: passthroughText(value.target, 200),
    value: typeof value.value === "number" ? value.value : passthroughText(value.value, 100),
    baseSeed: Number.isFinite(Number(value.baseSeed)) ? Number(value.baseSeed) : null
  };
}

const DERIVATION_TYPES = ["same-seed", "lora", "outfit", "background", "expression", "duplicate"];

function validateDerivation(value) {
  if (!isPlainObject(value)) return null;
  const type = DERIVATION_TYPES.includes(value.type) ? value.type : null;
  if (!type) return null;
  return { type, instruction: passthroughText(value.instruction, 500) };
}

const RETRY_TRACKED_KEYS = [
  "width", "height", "steps", "cfgScale", "candidateCount",
  "hiresEnabled", "hiresScale", "hiresSteps", "hiresDenoising"
];

function validateRetryInfo(value) {
  if (!isPlainObject(value)) return null;
  return {
    retryReason: passthroughText(value.retryReason, 40),
    retryReasonLabel: passthroughText(value.retryReasonLabel, 60),
    retryCount: boundedInt(value.retryCount, 1, 0, 3),
    retriedAt: passthroughText(value.retriedAt, 40),
    originalSettings: pickRetrySettings(value.originalSettings),
    retrySettings: pickRetrySettings(value.retrySettings)
  };
}

function pickRetrySettings(value) {
  if (!isPlainObject(value)) return {};
  const picked = {};
  for (const key of RETRY_TRACKED_KEYS) {
    const item = value[key];
    if (typeof item === "number" || typeof item === "boolean") picked[key] = item;
    else if (typeof item === "string" && item) picked[key] = item.slice(0, 40);
  }
  return picked;
}

const INSTALL_MODES = ["auto", "reuse", "metadata", "rename", "move"];

function validateInstallMode(value) {
  return INSTALL_MODES.includes(value) ? value : "auto";
}

function validateGenerationMode(value) {
  if (value === undefined || value === null || value === "" || value === "txt2img") return "txt2img";
  if (value === "img2img") return "img2img";
  if (value === "inpaint") return "inpaint";
  throw new Error("生成モードが不正です");
}

async function resolveSourceImage(body, mode) {
  if (!["img2img", "inpaint"].includes(mode)) return null;

  if (body.initImageId) {
    const imageId = requireId(body.initImageId);
    const recipe = await history.getRecipe(imageId);
    const filename = path.basename(String(recipe.selectedImage.filename ?? ""));
    if (!filename || filename !== recipe.selectedImage.filename) {
      throw new Error("参照画像の保存先が不正です");
    }
    const buffer = await fs.readFile(path.join(outputDir, filename));
    validateImageBuffer(buffer, extensionFromFilename(filename));
    return {
      base64: buffer.toString("base64"),
      buffer,
      extension: extensionFromFilename(filename),
      imageId,
      imageUrl: recipe.selectedImage.imageUrl,
      uploaded: false
    };
  }

  if (typeof body.initImage === "string" && body.initImage) {
    return {
      ...parseImageDataUrl(body.initImage),
      imageId: null,
      imageUrl: null,
      uploaded: true
    };
  }

  throw new Error(`${mode === "inpaint" ? "部分修正" : "img2img"}の参照画像を選択してください`);
}

function resolveMaskImage(body, mode, settings) {
  if (mode !== "inpaint" || settings.hiresEnabled) return null;
  if (typeof body.maskImage !== "string" || !body.maskImage) {
    throw new Error("修正したい範囲を白く塗ってください");
  }
  const mask = parseImageDataUrl(body.maskImage);
  if (mask.extension !== "png") throw new Error("InpaintマスクはPNG形式で送信してください");
  return mask;
}

function parseImageDataUrl(value) {
  const matched = value.match(/^data:image\/(png|jpe?g|webp);base64,([a-z0-9+/]+={0,2})$/i);
  if (!matched) throw new Error("参照画像はPNG・JPEG・WebPを選択してください");
  const extension = matched[1].toLowerCase().replace("jpeg", "jpg");
  const buffer = Buffer.from(matched[2], "base64");
  validateImageBuffer(buffer, extension);
  return { base64: matched[2], buffer, extension };
}

function validateImageBuffer(buffer, extension) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("参照画像が空です");
  if (buffer.length > MAX_INIT_IMAGE_BYTES) throw new Error("参照画像は20MB以下にしてください");

  const valid = extension === "png"
    ? buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    : extension === "jpg"
      ? buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
      : extension === "webp"
        ? buffer.subarray(0, 4).toString("ascii") === "RIFF"
          && buffer.subarray(8, 12).toString("ascii") === "WEBP"
        : false;
  if (!valid) throw new Error("参照画像の形式を確認できませんでした");
}

function extensionFromFilename(filename) {
  const extension = path.extname(filename).slice(1).toLowerCase().replace("jpeg", "jpg");
  if (!["png", "jpg", "webp"].includes(extension)) {
    throw new Error("履歴の参照画像形式に対応していません");
  }
  return extension;
}

function outputDimensions(mode, settings) {
  if (!["img2img", "inpaint"].includes(mode) || !settings.hiresEnabled) {
    return {
      width: settings.hiresEnabled ? Math.round(settings.width * settings.hiresScale) : settings.width,
      height: settings.hiresEnabled ? Math.round(settings.height * settings.hiresScale) : settings.height
    };
  }
  return img2imgRefineDimensions(settings.width, settings.height, settings.hiresScale);
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

async function saveContentAddressedImage(prefix, image) {
  const hash = crypto.createHash("sha256").update(image.buffer).digest("hex").slice(0, 20);
  const filename = `${prefix}_${hash}.${image.extension}`;
  try {
    await fs.writeFile(path.join(outputDir, filename), image.buffer, { flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  return `/outputs/${filename}`;
}

function roundToMultiple(value, multiple) {
  return Math.max(multiple, Math.round(Number(value) / multiple) * multiple);
}

function img2imgRefineDimensions(width, height, scale) {
  let targetWidth = Number(width) * Number(scale);
  let targetHeight = Number(height) * Number(scale);
  const maximumPixels = 2_600_000;
  if (targetWidth * targetHeight > maximumPixels) {
    const reduction = Math.sqrt(maximumPixels / (targetWidth * targetHeight));
    targetWidth *= reduction;
    targetHeight *= reduction;
  }
  return {
    width: roundToMultiple(targetWidth, 8),
    height: roundToMultiple(targetHeight, 8)
  };
}

function validateLoras(input) {
  if (!Array.isArray(input)) return [];
  const maximum = boundedInt(config.lora?.maxSelected, 4, 1, 8);
  const fallbackWeight = boundedNumber(config.lora?.defaultWeight, 0.7, 0.05, 2);
  const unique = new Map();

  for (const item of input) {
    if (unique.size >= maximum) break;
    if (!item || typeof item.name !== "string") continue;
    const name = item.name.trim().slice(0, 200);
    if (!name || /[<>:\r\n]/.test(name)) continue;
    const key = name.toLowerCase().replaceAll("\\", "/");
    if (unique.has(key)) continue;
    unique.set(key, {
      name,
      weight: Number(boundedNumber(item.weight, fallbackWeight, 0.05, 2).toFixed(2)),
      triggerWords: sanitizeTriggerWords(item.triggerWords),
      negativeWords: sanitizeTriggerWords(item.negativeWords)
    });
  }

  return [...unique.values()];
}

function validatePromptBoosts(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((value) => typeof value === "string")
    .flatMap(splitTags)
    .map((value) => value.replace(/[<>]/g, "").slice(0, 120))
    .filter(Boolean)
    .slice(0, 40);
}

function appendLoras(prompt, loras) {
  if (!loras.length) return prompt;
  const normalizedPrompt = prompt.toLowerCase().replaceAll(/\s+/g, " ");
  const existing = new Set(
    [...prompt.matchAll(/<lora:([^:>]+)(?::[^>]*)?>/gi)]
      .map((match) => match[1].trim().toLowerCase().replaceAll("\\", "/"))
  );
  const triggerWords = loras
    .map((item) => item.triggerWords)
    .filter((value) => value && !normalizedPrompt.includes(value.toLowerCase().replaceAll(/\s+/g, " ")));
  const loraTags = loras
    .filter((item) => !existing.has(item.name.toLowerCase().replaceAll("\\", "/")))
    .map((item) => `<lora:${item.name}:${item.weight}>`);
  return appendUniqueTags(prompt, [...triggerWords, ...loraTags]);
}

function appendLoraNegatives(negativePrompt, loras) {
  return appendUniqueTags(negativePrompt, loras.flatMap((item) => splitTags(item.negativeWords)));
}

function appendUniqueTags(prompt, additions) {
  const baseWords = [];
  const seen = new Set();
  for (const tag of splitTags(prompt)) {
    const normalized = normalizeTag(tag);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    baseWords.push(tag);
  }
  for (const tag of additions.flatMap((value) => splitTags(value))) {
    const normalized = normalizeTag(tag);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    baseWords.push(tag);
  }
  return baseWords.join(", ");
}

function splitTags(value) {
  if (typeof value !== "string") return [];
  return value.split(",").map((tag) => tag.trim()).filter(Boolean);
}

function normalizeTag(value) {
  return value.toLowerCase().replaceAll(/\s+/g, " ");
}

function sanitizeTriggerWords(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[<>]/g, "")
    .replace(/[\r\n]+/g, ", ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/(?:,\s*){2,}/g, ", ")
    .trim()
    .slice(0, 500);
}

function sanitizeSecret(value) {
  return typeof value === "string" ? value.trim().slice(0, 500) : "";
}

function boundedInt(value, fallback, min, max, multiple = 1) {
  let number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) number = fallback;
  number = Math.min(max, Math.max(min, number));
  return Math.round(number / multiple) * multiple;
}

function boundedNumber(value, fallback, min, max) {
  let number = Number(value);
  if (!Number.isFinite(number)) number = fallback;
  return Math.min(max, Math.max(min, number));
}

function booleanOrDefault(value, fallback) {
  if (value === undefined || value === null || value === "") return Boolean(fallback);
  return value === true || value === "true";
}

function textOrDefault(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 100) : fallback;
}

const NOISE_SCHEDULE_CHOICES = ["Automatic", "Zero Terminal SNR"];

function normalizeNoiseSchedule(value, fallback) {
  const requested = typeof value === "string" ? value.trim() : "";
  if (NOISE_SCHEDULE_CHOICES.includes(requested)) return requested;
  if (NOISE_SCHEDULE_CHOICES.includes(fallback)) return fallback;
  return "Automatic";
}

function timestamp() {
  return new Date().toISOString()
    .replace("T", "_")
    .replace("Z", "")
    .replaceAll(":", "-")
    .replace(".", "-");
}

function readableError(error) {
  if (error?.name === "TimeoutError") return "処理がタイムアウトしました";
  if (error?.name === "AbortError" || /中止/.test(error?.message ?? "")) return "処理を中止しました";
  if (error?.cause?.code === "ECONNREFUSED") return "接続できません。OllamaとReForgeが起動しているか確認してください";
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
