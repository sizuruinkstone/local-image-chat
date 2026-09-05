import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  MAX_RETRY_COUNT,
  buildRecoveryPlan,
  buildRetryInfo,
  classifyGenerationError,
  describeRecoveryPlan
} from "../recovery.js";
import { createPrompt, unloadOllama } from "../ollama.js";
import {
  generateImages,
  getIpAdapterOptions,
  listCheckpoints,
  listLoras,
  switchCheckpoint
} from "../reforge.js";
import { isComparableParameter } from "../experiments.js";
import { hashOutputImage, sha256OfBuffer } from "../content-hash.js";
import {
  applyPromptWeights,
  dedupeLoraTags,
  parseLoraTags,
  removeLoraTags,
  sameLoraName
} from "../../public/lora-tags.js";
import {
  buildGenerationTitle,
  normalizeManualTitle,
  normalizeTitleMode,
  normalizeTitleTemplate
} from "../../public/history-title.js";
import { ipAdapterReferenceFilename, validateIpAdapter } from "../ip-adapter.js";
import {
  HistoryGenerationNotFoundError,
  normalizeNewContentRating,
  requireHistoryContentRatingFilter,
  requireNewContentRating
} from "../history.js";
import { appendUniqueTags, normalizePromptBoosts, resolvePrompt } from "./prompt-service.js";
import { PROMPT_FIELDS } from "../../public/structured-prompt.js";
import { createGenerationRuntimeRegistry } from "../generation-runtimes.js";

const MAX_INIT_IMAGE_BYTES = 20 * 1024 * 1024;
const DERIVATION_TYPES = ["same-seed", "lora", "outfit", "background", "expression", "duplicate", "ai-workflow"];
const INSTALL_MODES = ["auto", "reuse", "metadata", "rename", "move"];
const LORA_NOTICE_TYPES = ["duplicate", "unresolved", "ambiguous", "invalidWeight"];
const RETRY_TRACKED_KEYS = [
  "width", "height", "steps", "cfgScale", "candidateCount",
  "hiresEnabled", "hiresScale", "hiresSteps", "hiresDenoising"
];
const NOISE_SCHEDULE_CHOICES = ["Automatic", "Zero Terminal SNR"];

export function createGenerationRuntime(dependencies) {
  const deps = dependencies;
  const config = deps.config;
  const logger = deps.logger ?? console;
  const outputDir = deps.outputDir;
  const resolveOutputImagePath = deps.resolveOutputImagePath
    ?? createOutputImagePathResolver(outputDir);
  const createPromptFn = deps.createPrompt ?? createPrompt;
  const unloadOllamaFn = deps.unloadOllama ?? unloadOllama;
  const generateImagesFn = deps.generateImages ?? generateImages;
  const getIpAdapterOptionsFn = deps.getIpAdapterOptions ?? getIpAdapterOptions;
  const listCheckpointsFn = deps.listCheckpoints ?? listCheckpoints;
  const switchCheckpointFn = deps.switchCheckpoint ?? switchCheckpoint;
  const runtimeRegistry = deps.runtimeRegistry ?? createGenerationRuntimeRegistry({
    config,
    logger,
    overrides: {
      generateImages: generateImagesFn,
      getIpAdapterOptions: getIpAdapterOptionsFn,
      listCheckpoints: listCheckpointsFn,
      switchCheckpoint: switchCheckpointFn,
      resolveV1Checkpoint: deps.resolveV1Checkpoint
    }
  });

  async function executeWithRecovery(body, context) {
    try {
      return await performGeneration(body, context);
    } catch (error) {
      if (context.signal?.aborted) throw error;
      const previousCount = Number(body?.retryInfo?.retryCount ?? 0);
      if (previousCount >= MAX_RETRY_COUNT) throw error;

      const classification = localizeRecoveryClassification(
        classifyGenerationError(error),
        runtimeDescriptorForRecovery(body, runtimeRegistry)
      );
      if (!classification.retryable) throw error;
      const originalSettings = validateSettings(body?.settings ?? {}, config);
      const plan = buildRecoveryPlan(originalSettings, classification.kind);
      if (!plan) throw error;

      const description = describeRecoveryPlan(classification, plan);
      if (body?.autoRetry !== true) {
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
      const summary = description.changes
        .map((change) => `${change.label}: ${change.from} → ${change.to}`)
        .join("・");
      context.report(4, `${classification.label}のため設定を下げて再試行します${summary ? `（${summary}）` : ""}`);
      logger.warn(`[Recovery] ${classification.label}: 1回だけ再試行します ${summary}`);
      return performGeneration({ ...body, settings: plan.settings, retryInfo }, context);
    }
  }

  async function performGeneration(body, { signal, report } = {}) {
    const reportProgress = typeof report === "function" ? report : () => {};
    const generationStartedAt = new Date().toISOString();
    const description = passthroughText(body.description, 4000).trim();
    const contentRating = normalizeNewContentRating(body.contentRating);
    const hasPrompt = Boolean(body.prompt?.trim());
    if (!description && !hasPrompt) throw new Error("生成したい内容かPromptを入力してください");
    const mode = validateGenerationMode(body.mode);
    const provider = runtimeRegistry.resolve(body.runtimeId ?? body._runtimeId);
    let settings = validateSettings(body.settings ?? {}, config);
    provider.validateRequest?.({ mode, settings, body });
    if (body._source === "api-v1") {
      if (provider.descriptor.id === "reforge") settings = await prepareApiCheckpoint(settings, body._checkpointId);
    }
    const loras = validateLoras(body.loras, config);
    const promptBoosts = normalizePromptBoosts(body.promptBoosts);
    const manualTitle = normalizeManualTitle(body.title);
    const titleMode = normalizeTitleMode(body.titleMode);
    const titleTemplate = normalizeTitleTemplate(body.titleTemplate);
    const structuredPrompt = validateStructuredPrompt(body.structuredPrompt);
    const appliedTriggerWords = validateAppliedTriggerWords(body.appliedTriggerWords);
    const rawPromptOverride = body.rawPromptOverride === true;
    const rawPrompt = rawPromptOverride ? passthroughText(body.rawPrompt, 12000) : "";
    const sourceImage = await resolveSourceImage(body, mode, deps);
    const maskImage = resolveMaskImage(body, mode, settings);
    const ipAdapter = await resolveIpAdapter(
      body,
      deps,
      provider.getIpAdapterOptions ?? getIpAdapterOptionsFn,
      provider.config ?? config.reforge
    );

    reportProgress(5, "プロンプトを準備中");
    const generatedPrompt = hasPrompt
      ? {
          prompt: body.prompt.trim(),
          negative_prompt: body.negativePrompt?.trim() ?? "",
          explanation_ja: "画面で編集したプロンプトを使用しました。"
        }
      : await createPromptFn(config.ollama, description, { signal });

    const promptWithBoosts = appendUniqueTags(generatedPrompt.prompt, promptBoosts);
    reportProgress(18, "OllamaをVRAMから解放中");
    try {
      await unloadOllamaFn(config.ollama, { signal });
    } catch (error) {
      if (signal?.aborted) throw error;
      logger.warn(`[Ollama] VRAM解放に失敗しましたが生成を続行します: ${error.message}`);
      reportProgress(19, "Ollamaの解放に失敗しましたが生成を続行します");
    }

    const deduped = dedupeLoraTags(appendLoras(promptWithBoosts, loras));
    const effectivePrompt = deduped.text;
    const effectiveNegativePrompt = appendLoraNegatives(generatedPrompt.negative_prompt, loras);
    const effectiveLoras = applyPromptWeights(loras, effectivePrompt);
    const clientLoraNotices = validateLoraNotices(body.loraNotices);
    const loraNotices = [
      ...clientLoraNotices,
      ...deduped.duplicates
        .filter((item) => !clientLoraNotices.some(
          (notice) => notice.type === "duplicate" && sameLoraName(notice.name, item.name)
        ))
        .map((item) => ({ type: "duplicate", name: item.name, weights: item.weights, weight: item.weight }))
    ];

    reportProgress(25, `${provider.descriptor.label}で生成を開始`);
    const prepared = await provider.prepareGeneration?.({
      settings,
      requestedCheckpoint: body._checkpointId ?? settings.checkpoint,
      signal
    });
    if (prepared && typeof prepared === "object") settings = { ...settings, ...prepared };
    const generated = await provider.generateImages({
      mode,
      prompt: effectivePrompt,
      negativePrompt: effectiveNegativePrompt,
      initImageBase64: sourceImage?.base64,
      maskBase64: maskImage?.base64,
      ipAdapter: ipAdapter?.request,
      ...settings
    }, {
      signal,
      onProgress: (value, detail) => reportProgress(25 + value * 68, detail)
    });

    reportProgress(94, "画像とレシピを保存中");
    const runId = timestamp();
    let sourceImageUrl = sourceImage?.imageUrl ?? null;
    if (sourceImage?.uploaded) {
      sourceImageUrl = await saveContentAddressedImage("img2img-source", sourceImage, outputDir);
    }
    const maskImageUrl = maskImage
      ? await saveContentAddressedImage("inpaint-mask", maskImage, outputDir)
      : null;
    let ipAdapterHistory = ipAdapter?.metadata ?? null;
    if (ipAdapter?.reference.uploaded) {
      ipAdapterHistory = {
        ...ipAdapterHistory,
        referenceImageUrl: await saveContentAddressedImage("ip-adapter-reference", ipAdapter.reference, outputDir)
      };
    }
    const outputSize = outputDimensions(mode, settings);
    const savedImages = await Promise.all(generated.images.map(async (image, index) => {
      const kind = settings.hiresEnabled ? "hires" : `candidate-${index + 1}`;
      const filename = `${runId}_${kind}_seed-${image.seed}.png`;
      const buffer = Buffer.from(image.base64, "base64");
      await fs.writeFile(path.join(outputDir, filename), buffer);
      let contentSha256 = null;
      try {
        contentSha256 = sha256OfBuffer(buffer);
      } catch (error) {
        logger.warn(`[Favorite連携] ${filename} のハッシュ計算に失敗: ${error.message}`);
      }
      const saved = {
        id: crypto.randomUUID(),
        imageUrl: `/outputs/${filename}`,
        filename,
        seed: image.seed,
        width: outputSize.width,
        height: outputSize.height,
        contentSha256
      };
      await deps.thumbnails.ensure(saved).catch((error) => {
        logger.warn(`[Thumbnail] ${filename} の生成に失敗: ${error.message}`);
      });
      return saved;
    }));

    const experiment = validateExperimentMeta(body.experiment);
    const derivation = validateDerivation(body.derivation);
    const retryInfo = validateRetryInfo(body.retryInfo);
    const createdAt = new Date().toISOString();
    const title = buildGenerationTitle({
      title: manualTitle,
      titleMode,
      titleTemplate,
      structuredPrompt,
      settings,
      images: savedImages,
      createdAt
    });
    const stored = await deps.history.addGeneration({
      createdAt,
      title,
      kind: settings.hiresEnabled ? "hires" : "candidates",
      contentRating,
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
      retryInfo,
      sourceImageId: sourceImage?.imageId,
      sourceImageUrl,
      maskImageUrl,
      ipAdapter: ipAdapterHistory,
      description,
      prompt: promptWithBoosts,
      negativePrompt: generatedPrompt.negative_prompt,
      effectivePrompt,
      effectiveNegativePrompt,
      structuredPrompt,
      rawPromptOverride,
      rawPrompt,
      appliedTriggerWords,
      settings,
      loras: effectiveLoras,
      loraNotices,
      runtime: provider.descriptor,
      images: savedImages
    });

    const generationCompletedAt = new Date().toISOString();
    void deps.discord?.sendForGeneration(stored, {
      startedAt: generationStartedAt,
      completedAt: generationCompletedAt
    }).catch((error) => {
      logger.warn(`[Discord] 生成完了通知を開始できませんでした: ${error.message}`);
    });

    if (experiment && deps.experiments?.recordRunCompleted) {
      await deps.experiments.recordRunCompleted(experiment.id, experiment.value, {
        generationId: stored.id,
        imageIds: stored.images.map((image) => image.id),
        retryInfo
      }).catch((error) => logger.warn(`[Experiment] 記録に失敗: ${error.message}`));
    }

    reportProgress(99, "完了");
    return {
      generationId: stored.id,
      title: stored.title,
      experimentId: stored.experimentId,
      mode,
      sourceImageId: stored.sourceImageId,
      sourceImageUrl: stored.sourceImageUrl,
      maskImageUrl: stored.maskImageUrl,
      ipAdapter: stored.ipAdapter,
      runtime: stored.runtime,
      contentRating: stored.contentRating,
      images: stored.images.map(serializeImage),
      prompt: promptWithBoosts,
      negativePrompt: generatedPrompt.negative_prompt,
      effectivePrompt,
      effectiveNegativePrompt,
      structuredPrompt,
      rawPromptOverride,
      rawPrompt,
      appliedTriggerWords,
      loras: effectiveLoras,
      loraNotices,
      explanation: effectiveLoras.length
        ? `${generatedPrompt.explanation_ja} LoRA: ${effectiveLoras.map((item) => `${item.name} (${item.weight})${item.negativeWords ? "・標準衣装抑制" : ""}`).join(", ")}`
        : generatedPrompt.explanation_ja,
      settings
    };
  }

  async function resolveV1Checkpoint(requested) {
    let catalog;
    try {
      catalog = await listCheckpointsFn(config.reforge);
    } catch (error) {
      throw apiError("CAPABILITIES_UNAVAILABLE", "Checkpoint一覧を取得できません", 503, error);
    }
    const checkpoints = Array.isArray(catalog?.checkpoints) ? catalog.checkpoints : [];
    const requestedId = requested === undefined || requested === null ? null : String(requested);
    const target = requestedId
      ? checkpoints.find((item) => isSafePublicName(item?.title) && item.title === requestedId)
      : checkpoints.find((item) => isSafePublicName(item?.title)
        && item?.title === String(catalog?.activeCheckpoint ?? ""));
    if (!target) throw apiError("INVALID_CHECKPOINT", "指定したCheckpointが見つかりません", 400);
    return {
      id: target.title,
      title: target.title,
      modelName: String(target.modelName ?? target.title),
      hash: String(target.hash ?? ""),
      active: target.title === String(catalog?.activeCheckpoint ?? "")
    };
  }

  async function prepareApiCheckpoint(settings, requested) {
    const selection = await resolveV1Checkpoint(requested);
    if (!selection.active) await switchCheckpointFn(config.reforge, selection.title);
    return {
      ...settings,
      checkpoint: selection.id,
      checkpointHash: selection.hash,
      checkpointModelName: selection.modelName
    };
  }

  return {
    executeWithRecovery,
    execute: performGeneration,
    validateSettings: (input) => validateSettings(input, config),
    resolveV1Checkpoint,
    resolveOutputImagePath,
    registry: runtimeRegistry
  };
}

export function createGenerationService({
  jobs,
  runtime,
  config,
  capabilityDependencies = {},
  history,
  resolveReferenceImage = null,
  runtimeRegistry = null
}) {
  const listCheckpointsFn = capabilityDependencies.listCheckpoints
    ?? ((reforgeConfig) => listCheckpoints(reforgeConfig));
  const listSamplersFn = capabilityDependencies.listSamplers
    ?? (async () => ({ samplers: [], schedulers: [] }));
  const listLorasFn = capabilityDependencies.listLoras
    ?? ((reforgeConfig) => listLoras(reforgeConfig));
  const registry = runtimeRegistry ?? runtime?.registry ?? createGenerationRuntimeRegistry({
    config,
    overrides: {
      listCheckpoints: listCheckpointsFn,
      listSamplers: listSamplersFn,
      listLoras: listLorasFn,
      resolveV1Checkpoint: runtime?.resolveV1Checkpoint
    }
  });

  function resolveProvider(runtimeId) {
    return registry.resolve(runtimeId);
  }

  function providerLoras(provider) {
    return provider.descriptor.id === "reforge"
      ? listLorasFn(config.reforge)
      : provider.listLoras();
  }

  function providerCheckpoints(provider) {
    return provider.descriptor.id === "reforge"
      ? listCheckpointsFn(config.reforge)
      : provider.listCheckpoints();
  }

  function providerSamplers(provider) {
    return provider.descriptor.id === "reforge"
      ? listSamplersFn(config.reforge)
      : provider.listSamplers();
  }

  function providerCheckpointResolver(provider) {
    return provider.resolveV1Checkpoint;
  }

  async function getCapabilities(runtimeId) {
    const provider = resolveProvider(runtimeId);
    try {
      const [checkpointData, samplerData, loras] = await Promise.all([
        providerCheckpoints(provider),
        providerSamplers(provider),
        providerLoras(provider)
      ]);
      const active = String(checkpointData?.activeCheckpoint ?? "");
      return {
        checkpoints: (checkpointData?.checkpoints ?? [])
          .map((item) => publicCheckpoint(item, active))
          .filter(Boolean),
        samplers: safeStringList(samplerData?.samplers),
        schedulers: safeStringList(samplerData?.schedulers),
        loras: (Array.isArray(loras) ? loras : [])
          .map((item) => publicLora(item, config.lora?.defaultWeight))
          .filter(Boolean),
        defaults: publicDefaults(config.defaults, config.lora),
        runtime: provider.descriptor,
        runtimes: registry.listDescriptors(),
        defaultRuntimeId: registry.defaultRuntimeId
      };
    } catch (error) {
      throw apiError("CAPABILITIES_UNAVAILABLE", "生成能力一覧を取得できません", 503, error);
    }
  }

  function enqueueV1Request({
    resolvedPrompt,
    settings,
    loras,
    checkpoint,
    client,
    ipAdapter = null,
    provenance = null,
    runtimeId = null,
    contentRating = "general"
  }) {
    const payload = {
      mode: "txt2img",
      prompt: resolvedPrompt.positive,
      negativePrompt: resolvedPrompt.negative,
      structuredPrompt: resolvedPrompt.structured,
      rawPromptOverride: resolvedPrompt.mode === "raw",
      rawPrompt: resolvedPrompt.mode === "raw" ? resolvedPrompt.positive : "",
      loras,
      settings,
      _source: "api-v1",
      _checkpointId: checkpoint?.id ?? null,
      contentRating
    };
    if (runtimeId && runtimeId !== "reforge") payload.runtimeId = runtimeId;
    if (ipAdapter) payload.ipAdapter = ipAdapter;
    if (provenance) Object.assign(payload, provenance);
    return jobs.create(payload, {
      kind: "generation",
      label: describeGenerationJob(payload),
      client
    });
  }

  async function createV1Job(request) {
    if (!isPlainObject(request)) throw apiError("INVALID_REQUEST", "リクエストJSONが不正です", 400);
    const mode = request.mode ?? "txt2img";
    const contentRating = validateRequestedContentRating(request.contentRating);
    const provider = resolveProvider(request.runtimeId);
    provider.validateRequest?.({ mode, settings: request.settings ?? {}, body: request });
    if (mode !== "txt2img") {
      throw apiError("UNSUPPORTED_MODE", "このモードはAPI v1では利用できません", 400);
    }
    const promptInput = request.prompt ?? {};
    if (!isPlainObject(promptInput)) throw apiError("INVALID_REQUEST", "promptが不正です", 400);
    if (promptInput.structured !== undefined && promptInput.structured !== null
      && !isPlainObject(promptInput.structured)) {
      throw apiError("INVALID_REQUEST", "prompt.structuredが不正です", 400);
    }
    if (promptInput.negative !== undefined && typeof promptInput.negative !== "string") {
      throw apiError("INVALID_REQUEST", "prompt.negativeは文字列で指定してください", 400);
    }
    let resolvedPrompt;
    try {
      resolvedPrompt = resolvePrompt(promptInput);
    } catch (error) {
      throw apiError("INVALID_REQUEST", error.message, 400, error);
    }
    if (!resolvedPrompt.positive) throw apiError("INVALID_REQUEST", "positive Promptを指定してください", 400);
    const ipAdapter = await resolveV1IpAdapter(request.ipAdapter, history, resolveReferenceImage);

    const settingsInput = normalizeV1Settings(request.settings);
    provider.validateRequest?.({ mode, settings: settingsInput, body: request });
    const checkpoint = settingsInput.checkpoint === undefined
      ? null
      : await providerCheckpointResolver(provider)(settingsInput.checkpoint);
    if (checkpoint) {
      settingsInput.checkpoint = checkpoint.id;
      settingsInput.checkpointHash = checkpoint.hash;
      settingsInput.checkpointModelName = checkpoint.modelName;
    }
    const loras = await normalizeV1Loras(request.loras, () => providerLoras(provider), config);
    const client = normalizeClient(request.metadata?.client);
    return enqueueV1Request({
      resolvedPrompt,
      settings: settingsInput,
      loras,
      checkpoint,
      client,
      ipAdapter,
      runtimeId: provider.descriptor.id,
      contentRating
    });
  }

  async function getHistoryItem(generationId) {
    const id = requireId(generationId);
    try {
      const generation = await history.getGeneration(id);
      if (!generation) throw new HistoryGenerationNotFoundError(id);
      return generation;
    } catch (error) {
      if (error instanceof HistoryGenerationNotFoundError || error?.code === "HISTORY_NOT_FOUND") {
        throw apiError("HISTORY_NOT_FOUND", "指定した生成履歴が見つかりません", 404, error);
      }
      throw error;
    }
  }

  async function createV1Regeneration(historyId, request) {
    if (!isPlainObject(request)) throw apiError("INVALID_REQUEST", "リクエストJSONが不正です", 400);
    const generationId = requireId(historyId);
    const sourceImageId = requireSourceImageId(request.sourceImageId);
    let sourceGeneration;
    try {
      sourceGeneration = await history.getGeneration(generationId);
      if (!sourceGeneration) throw new HistoryGenerationNotFoundError(generationId);
    } catch (error) {
      if (error instanceof HistoryGenerationNotFoundError || error?.code === "HISTORY_NOT_FOUND") {
        throw apiError("HISTORY_NOT_FOUND", "指定した生成履歴が見つかりません", 404, error);
      }
      throw error;
    }
    if (sourceGeneration?.mode !== "txt2img") {
      throw apiError("UNSUPPORTED_HISTORY_MODE", "この履歴モードはAI Workflow再生成に対応していません", 400);
    }
    const inheritedRuntimeId = sourceGeneration?.runtime?.id ?? "reforge";
    const provider = resolveProvider(request.runtimeId ?? inheritedRuntimeId);
    provider.validateRequest?.({ mode: sourceGeneration.mode, settings: request.settings ?? {}, body: request });
    const sourceImage = Array.isArray(sourceGeneration.images)
      ? sourceGeneration.images.find((image) => image?.id === sourceImageId)
      : null;
    if (!sourceImage) throw apiError("SOURCE_IMAGE_NOT_FOUND", "指定した画像が生成履歴にありません", 404);
    const ipAdapter = await resolveV1IpAdapter(request.ipAdapter, history, resolveReferenceImage);

    if (request.loras !== undefined && !Array.isArray(request.loras)) {
      throw apiError("INVALID_REQUEST", "lorasが不正です", 400);
    }
    const inheritedPositive = usesInheritedPositivePrompt(request.prompt);
    const promptInput = buildRegenerationPromptInput(sourceGeneration, request.prompt);
    if (request.loras !== undefined && inheritedPositive) {
      removeInheritedLoraTags(promptInput);
    }
    let resolvedPrompt;
    try {
      resolvedPrompt = resolvePrompt(promptInput);
    } catch (error) {
      throw apiError("INVALID_REQUEST", error.message, 400, error);
    }
    if (!resolvedPrompt.positive) throw apiError("INVALID_REQUEST", "positive Promptを指定してください", 400);

    const settingsInput = normalizeV1Settings(request.settings);
    const inheritedSettings = historySettingsToV1(sourceGeneration.settings);
    const mergedSettings = { ...inheritedSettings, ...settingsInput };
    provider.validateRequest?.({ mode: sourceGeneration.mode, settings: mergedSettings, body: request });
    if (!Object.hasOwn(settingsInput, "candidateCount")) mergedSettings.candidateCount = 1;

    const reuseSeed = request.reuseSeed === undefined ? false : request.reuseSeed;
    if (typeof reuseSeed !== "boolean") {
      throw apiError("INVALID_REQUEST", "reuseSeedはbooleanで指定してください", 400);
    }
    if (reuseSeed && isPlainObject(request.settings) && Object.hasOwn(request.settings, "seed")) {
      throw apiError("INVALID_REQUEST", "reuseSeed=trueのときsettings.seedは指定できません", 400);
    }
    if (reuseSeed) {
      const sourceSeed = Number(sourceImage.seed);
      if (!Number.isInteger(sourceSeed) || sourceSeed < 0 || sourceSeed > 4294967295) {
        throw apiError("INVALID_REQUEST", "指定した画像のseedを再利用できません", 400);
      }
      mergedSettings.seed = sourceSeed;
    } else if (!Object.hasOwn(settingsInput, "seed")) {
      mergedSettings.seed = -1;
    }

    const checkpoint = mergedSettings.checkpoint === undefined
      ? null
      : await providerCheckpointResolver(provider)(mergedSettings.checkpoint);
    if (checkpoint) {
      mergedSettings.checkpoint = checkpoint.id;
      mergedSettings.checkpointHash = checkpoint.hash;
      mergedSettings.checkpointModelName = checkpoint.modelName;
    }

    const historyLoras = request.loras === undefined;
    const normalizedLoras = await normalizeV1Loras(
      historyLoras ? historyLorasToV1(sourceGeneration.loras) : request.loras,
      () => providerLoras(provider),
      config
    );
    const loras = historyLoras
      ? restoreHistoryLoraMetadata(normalizedLoras, sourceGeneration.loras)
      : normalizedLoras;
    const client = normalizeClient(request.metadata?.client);
    const instruction = normalizeWorkflowInstruction(request.instruction);
    const contentRating = request.contentRating === undefined
      ? normalizeNewContentRating(sourceGeneration.contentRating)
      : validateRequestedContentRating(request.contentRating);
    return enqueueV1Request({
      resolvedPrompt,
      settings: mergedSettings,
      loras,
      checkpoint,
      client,
      ipAdapter,
      contentRating,
      runtimeId: provider.descriptor.id,
      provenance: {
        parentGenerationId: generationId,
        parentImageId: sourceImageId,
        derivation: { type: "ai-workflow", instruction }
      }
    });
  }

  function getV1Job(id) {
    const jobId = requireJobId(id);
    try {
      return jobs.get(jobId);
    } catch (error) {
      throw apiError("JOB_NOT_FOUND", "指定したJobが見つかりません", 404, error);
    }
  }

  function cancelV1Job(id) {
    const jobId = requireJobId(id);
    let job;
    try {
      job = jobs.get(jobId);
    } catch (error) {
      throw apiError("JOB_NOT_FOUND", "指定したJobが見つかりません", 404, error);
    }
    if (["done", "failed", "cancelled"].includes(job.status)) {
      throw apiError("JOB_NOT_CANCELLABLE", "このJobはキャンセルできません", 409);
    }
    const statusBeforeCancel = job.status;
    try {
      const cancelled = jobs.cancel(jobId);
      if (statusBeforeCancel !== "queued"
        && ["done", "failed", "cancelled"].includes(cancelled.status)) {
        throw apiError("JOB_NOT_CANCELLABLE", "このJobはキャンセルできません", 409);
      }
      return cancelled;
    } catch (error) {
      if (error?.apiCode === "JOB_NOT_CANCELLABLE") throw error;
      throw apiError("JOB_NOT_FOUND", "指定したJobが見つかりません", 404, error);
    }
  }

  async function listHistory(query = {}) {
    try {
      return await history.listPage({
        favoritesOnly: query.favorites === "1",
        contentRating: requireHistoryContentRatingFilter(query.rating),
        limit: query.limit,
        cursor: query.cursor
      });
    } catch (error) {
      throw apiError("INVALID_REQUEST", error.message, 400, error);
    }
  }

  return {
    createLegacyJob: (body, meta) => createLegacyJob(body, meta),
    generateLegacyNow: (body, context) => generateLegacyNow(body, context),
    getCapabilities,
    createV1Job,
    getHistoryItem,
    createV1Regeneration,
    getV1Job,
    cancelV1Job,
    listHistory
  };

  function createLegacyJob(body, meta) {
    if (!isPlainObject(body)) throw apiError("INVALID_REQUEST", "リクエストJSONが不正です", 400);
    validateRequestedContentRating(body.contentRating);
    const provider = resolveProvider(body.runtimeId ?? body._runtimeId);
    provider.validateRequest?.({
      mode: validateGenerationMode(body.mode),
      settings: body.settings ?? {},
      body
    });
    const payload = provider.descriptor.id === "reforge"
      ? body
      : { ...body, runtimeId: provider.descriptor.id };
    return jobs.create(payload, meta);
  }

  async function generateLegacyNow(body, context) {
    if (!isPlainObject(body)) throw apiError("INVALID_REQUEST", "リクエストJSONが不正です", 400);
    validateRequestedContentRating(body.contentRating);
    const provider = resolveProvider(body.runtimeId ?? body._runtimeId);
    provider.validateRequest?.({
      mode: validateGenerationMode(body.mode),
      settings: body.settings ?? {},
      body
    });
    if (provider.descriptor.id === "reforge") {
      return runtime.execute(body, context);
    }

    // Forge Neoのmodel/module transitionと生成を、旧同期APIでも既存JobManagerへ合流させる。
    // ReForgeの従来同期経路は変更しない。
    const payload = { ...body, runtimeId: provider.descriptor.id };
    const job = jobs.create(payload, {
      kind: "generation",
      label: describeGenerationJob(payload),
      client: "legacy-sync"
    });
    return waitForLegacyJob(job.id, context);
  }

  function waitForLegacyJob(jobId, { signal } = {}) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let unsubscribe = () => {};

      const cleanup = () => {
        unsubscribe();
        signal?.removeEventListener("abort", onAbort);
      };
      const settle = (job) => {
        if (settled) return;
        if (job.status === "done") {
          settled = true;
          cleanup();
          resolve(job.result);
          return;
        }
        if (job.status === "failed") {
          settled = true;
          cleanup();
          const error = new Error(job.error ?? "生成に失敗しました");
          error.statusCode = 500;
          reject(error);
          return;
        }
        if (job.status === "cancelled") {
          settled = true;
          cleanup();
          const error = new Error("生成を中止しました");
          error.name = "AbortError";
          error.statusCode = 499;
          reject(error);
        }
      };
      const onAbort = () => {
        try {
          jobs.cancel(jobId);
        } catch {
          // Jobがすでにterminalなら、下のresponse待機結果を優先する。
        }
        if (settled) return;
        settled = true;
        cleanup();
        const error = new Error("生成を中止しました");
        error.name = "AbortError";
        error.statusCode = 499;
        reject(error);
      };

      unsubscribe = jobs.subscribe((job) => {
        if (job.id === jobId) settle(job);
      });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        settle(jobs.get(jobId));
      } catch (error) {
        settled = true;
        cleanup();
        reject(error);
      }
    });
  }
}

export function createOutputImagePathResolver(outputDir) {
  return function resolveOutputImagePath(filename) {
    const safeFilename = String(filename ?? "");
    if (!safeFilename || path.basename(safeFilename) !== safeFilename) {
      throw new Error("原画像のファイル名が不正です");
    }
    extensionFromFilename(safeFilename);
    const resolved = path.resolve(outputDir, safeFilename);
    if (path.dirname(resolved) !== path.resolve(outputDir)) {
      throw new Error("原画像の保存先が不正です");
    }
    return resolved;
  };
}

export function serializeGeneration(generation) {
  return {
    ...generation,
    images: (generation.images ?? []).map(serializeImage)
  };
}

export function serializeImage(image) {
  const id = requireId(image.id);
  return {
    ...image,
    thumbnailUrl: `/api/images/${encodeURIComponent(id)}/thumbnail`,
    originalUrl: `/api/images/${encodeURIComponent(id)}/original`
  };
}

export function describeGenerationJob(body) {
  const modeLabel = { img2img: "img2img", inpaint: "部分修正" }[body?.mode] ?? "新規生成";
  const settings = isPlainObject(body?.settings) ? body.settings : {};
  if (settings.hiresEnabled === true || settings.hiresEnabled === "true") return `${modeLabel}・Hires仕上げ`;
  const count = Number(settings.candidateCount);
  return Number.isFinite(count) && count > 0
    ? `${modeLabel}・候補${Math.min(Math.trunc(count), 4)}枚`
    : modeLabel;
}

export function apiError(code, message, statusCode = 400, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.apiCode = code;
  error.statusCode = statusCode;
  return error;
}

const V1_IP_ADAPTER_KEYS = new Set([
  "referenceImageId",
  "weight",
  "guidanceStart",
  "guidanceEnd"
]);

export function normalizeV1IpAdapter(input) {
  if (input === undefined) return null;
  if (!isPlainObject(input)) throw apiError("INVALID_REQUEST", "ipAdapterが不正です", 400);

  const unknownKey = Object.keys(input).find((key) => !V1_IP_ADAPTER_KEYS.has(key));
  if (unknownKey) throw apiError("INVALID_REQUEST", "ipAdapterに許可されていないfieldがあります", 400);
  if (typeof input.referenceImageId !== "string" || !input.referenceImageId.trim()) {
    throw apiError("INVALID_REQUEST", "ipAdapter.referenceImageIdが不正です", 400);
  }
  for (const key of ["weight", "guidanceStart", "guidanceEnd"]) {
    if (input[key] !== undefined && (typeof input[key] !== "number" || !Number.isFinite(input[key]))) {
      throw apiError("INVALID_REQUEST", `ipAdapter.${key}は有限数で指定してください`, 400);
    }
  }

  const referenceImageId = requireId(input.referenceImageId.trim());
  let normalized;
  try {
    normalized = validateIpAdapter({
      enabled: true,
      referenceImageId,
      weight: input.weight,
      guidanceStart: input.guidanceStart,
      guidanceEnd: input.guidanceEnd
    });
  } catch (error) {
    throw apiError("INVALID_REQUEST", error.message, 400, error);
  }
  return {
    enabled: true,
    referenceImageId,
    weight: normalized.weight,
    guidanceStart: normalized.guidanceStart,
    guidanceEnd: normalized.guidanceEnd
  };
}

async function resolveV1IpAdapter(input, historyService, referenceResolver = null) {
  const normalized = normalizeV1IpAdapter(input);
  if (!normalized) return null;
  try {
    const image = referenceResolver
      ? await referenceResolver(normalized.referenceImageId)
      : await historyService.getImage(normalized.referenceImageId);
    if (!image) throw new Error("指定された画像が履歴にありません");
  } catch (error) {
    if (error?.message === "指定された画像が履歴にありません"
      || error?.code === "HISTORY_IMAGE_NOT_FOUND"
      || error?.code === "ASSET_NOT_FOUND"
      || error?.apiCode === "ASSET_NOT_FOUND") {
      throw apiError("REFERENCE_IMAGE_NOT_FOUND", "指定した参照画像が見つかりません", 404, error);
    }
    throw error;
  }
  return normalized;
}

function requireSourceImageId(value) {
  if (typeof value !== "string") throw apiError("INVALID_REQUEST", "sourceImageIdが不正です", 400);
  return requireId(value);
}

function buildRegenerationPromptInput(generation, override) {
  const input = historyPromptInput(generation);
  if (override === undefined) return input;
  if (!isPlainObject(override)) throw apiError("INVALID_REQUEST", "promptが不正です", 400);

  if (override.rawOverride !== undefined && override.rawOverride !== null) {
    if (typeof override.rawOverride !== "string") {
      throw apiError("INVALID_REQUEST", "prompt.rawOverrideは文字列で指定してください", 400);
    }
    input.rawOverride = override.rawOverride;
  } else if (override.structured !== undefined && override.structured !== null) {
    input.structured = requireCompleteStructuredPrompt(override.structured);
    input.rawOverride = null;
  }
  if (override.negative !== undefined) {
    if (typeof override.negative !== "string") {
      throw apiError("INVALID_REQUEST", "prompt.negativeは文字列で指定してください", 400);
    }
    input.negative = override.negative;
  }
  return input;
}

function usesInheritedPositivePrompt(override) {
  if (override === undefined) return true;
  if (!isPlainObject(override)) return false;
  if (override.rawOverride !== undefined && override.rawOverride !== null) return false;
  if (override.structured !== undefined && override.structured !== null) return false;
  return true;
}

function removeInheritedLoraTags(promptInput) {
  if (typeof promptInput.rawOverride === "string") {
    promptInput.rawOverride = removeAllLoraTags(promptInput.rawOverride);
  }
  if (isPlainObject(promptInput.structured)) {
    promptInput.structured = Object.fromEntries(PROMPT_FIELDS.map((field) => [
      field,
      removeAllLoraTags(promptInput.structured[field])
    ]));
  }
}

function removeAllLoraTags(value) {
  let result = typeof value === "string" ? value : "";
  const names = [...new Set([...parseLoraTags(result)].map((tag) => tag.name))];
  for (const name of names) result = removeLoraTags(result, name).text;
  return result;
}

function historyPromptInput(generation) {
  const negative = typeof generation?.negativePrompt === "string"
    ? generation.negativePrompt
    : typeof generation?.effectiveNegativePrompt === "string"
      ? generation.effectiveNegativePrompt
      : "";
  if (generation?.rawPromptOverride === true) {
    const raw = firstNonEmptyString(generation.rawPrompt, generation.prompt, generation.effectivePrompt);
    return { structured: null, rawOverride: raw, negative };
  }
  if (isPlainObject(generation?.structuredPrompt)) {
    return { structured: generation.structuredPrompt, rawOverride: null, negative };
  }
  const raw = firstNonEmptyString(generation?.rawPrompt, generation?.prompt, generation?.effectivePrompt);
  return { structured: null, rawOverride: raw, negative };
}

function requireCompleteStructuredPrompt(value) {
  if (!isPlainObject(value) || PROMPT_FIELDS.some((field) => typeof value[field] !== "string")) {
    throw apiError("INVALID_REQUEST", "prompt.structuredは6項目すべてを文字列で指定してください", 400);
  }
  return Object.fromEntries(PROMPT_FIELDS.map((field) => [field, value[field]]));
}

function firstNonEmptyString(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() ?? "";
}

function historySettingsToV1(settings) {
  if (!isPlainObject(settings)) return {};
  const result = {};
  if (settings.checkpoint !== undefined && settings.checkpoint !== null && String(settings.checkpoint).trim()) {
    if (!isSafePublicName(settings.checkpoint)) {
      throw apiError("INVALID_CHECKPOINT", "履歴に保存されたCheckpoint identifierが不正です", 400);
    }
    result.checkpoint = String(settings.checkpoint).trim();
  }
  copyHistoryInteger(settings.width, result, "width", 256, 1536, 64);
  copyHistoryInteger(settings.height, result, "height", 256, 1536, 64);
  copyHistoryInteger(settings.steps, result, "steps", 1, 80);
  copyHistoryNumber(settings.cfgScale, result, "cfgScale", 1, 20);
  copyHistoryString(settings.samplerName ?? settings.sampler, result, "samplerName", 100);
  copyHistoryString(settings.scheduler, result, "scheduler", 100);
  copyHistoryString(settings.noiseSchedule, result, "noiseSchedule", 100);
  if (typeof settings.hiresEnabled === "boolean") result.hiresEnabled = settings.hiresEnabled;
  copyHistoryNumber(settings.hiresScale, result, "hiresScale", 1, 2);
  copyHistoryInteger(settings.hiresSteps, result, "hiresSteps", 1, 50);
  copyHistoryNumber(settings.hiresDenoising, result, "hiresDenoising", 0.1, 0.8);
  copyHistoryString(settings.hiresUpscaler, result, "hiresUpscaler", 200);
  return result;
}

function historyLorasToV1(loras) {
  if (!Array.isArray(loras)) return [];
  return loras.map((lora) => {
    const normalized = {
      name: lora?.name,
      weight: lora?.weight,
      enabled: lora?.enabled !== false
    };
    for (const [key, maximum] of [
      ["triggerWords", 500],
      ["negativeWords", 500],
      ["characterTriggerWords", 500],
      ["outfitChoiceId", 200],
      ["outfitPresetName", 200],
      ["outfitTriggerWords", 500]
    ]) {
      if (typeof lora?.[key] === "string") normalized[key] = lora[key].slice(0, maximum);
    }
    if (["ui", "prompt", "both"].includes(lora?.source)) normalized.source = lora.source;
    return normalized;
  });
}

function restoreHistoryLoraMetadata(normalized, sourceLoras) {
  const source = historyLorasToV1(sourceLoras);
  return normalized.map((lora) => {
    const stored = source.find((item) => sameLoraName(item.name, lora.name));
    if (!stored) return lora;
    const restored = { ...lora };
    for (const key of [
      "triggerWords",
      "negativeWords",
      "characterTriggerWords",
      "outfitChoiceId",
      "outfitPresetName",
      "outfitTriggerWords",
      "source"
    ]) {
      if (stored[key] !== undefined) restored[key] = stored[key];
    }
    return restored;
  });
}

function copyHistoryString(value, output, key, maximum) {
  if (typeof value === "string" && value.trim() && isSafePublicName(value)) {
    output[key] = value.trim().slice(0, maximum);
  }
}

function copyHistoryInteger(value, output, key, minimum, maximum, multiple = 1) {
  if (Number.isInteger(value) && value >= minimum && value <= maximum && value % multiple === 0) {
    output[key] = value;
  }
}

function copyHistoryNumber(value, output, key, minimum, maximum) {
  if (Number.isFinite(value) && value >= minimum && value <= maximum) output[key] = value;
}

function normalizeWorkflowInstruction(value) {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.length > 500 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw apiError("INVALID_REQUEST", "instructionは制御文字を含まない500文字以内で指定してください", 400);
  }
  return value;
}

function normalizeV1Settings(input) {
  if (input === undefined) return {};
  if (!isPlainObject(input)) throw apiError("INVALID_REQUEST", "settingsが不正です", 400);
  const hires = input.hires;
  if (hires !== undefined && hires !== null && !isPlainObject(hires)) {
    throw apiError("INVALID_REQUEST", "settings.hiresが不正です", 400);
  }
  const result = {};
  copyOptionalInteger(input, result, "width", 256, 1536, 64);
  copyOptionalInteger(input, result, "height", 256, 1536, 64);
  copyOptionalInteger(input, result, "steps", 1, 80);
  copyOptionalNumber(input, result, "cfgScale", 1, 20);
  copyOptionalInteger(input, result, "seed", -1, 4294967295);
  copyOptionalInteger(input, result, "candidateCount", 1, 4);
  copyOptionalString(input, result, "checkpoint", 200);
  copyOptionalString(input, result, "scheduler", 100);
  copyOptionalString(input, result, "noiseSchedule", 100);
  const sampler = input.sampler ?? input.samplerName;
  if (sampler !== undefined) result.samplerName = requiredString(sampler, "settings.sampler", 100);
  const hiresInput = hires ?? {};
  const enabled = hires?.enabled ?? input.hiresEnabled;
  if (enabled !== undefined) result.hiresEnabled = strictBoolean(enabled, "settings.hires.enabled");
  copyOptionalNumber(hiresInput, result, "scale", 1, 2, "hiresScale");
  copyOptionalInteger(hiresInput, result, "steps", 1, 50, 1, "hiresSteps");
  copyOptionalNumber(hiresInput, result, "denoising", 0.1, 0.8, "hiresDenoising");
  copyOptionalString(hiresInput, result, "upscaler", 200, "hiresUpscaler");
  return result;
}

async function normalizeV1Loras(input, listLorasFn, config) {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw apiError("INVALID_REQUEST", "lorasが不正です", 400);
  if (input.length > Number(config.lora?.maxSelected ?? 4)) {
    throw apiError("INVALID_REQUEST", "選択できるLoRAの数を超えています", 400);
  }
  if (!input.length) return [];
  let installed;
  try {
    installed = await listLorasFn(config.reforge);
  } catch (error) {
    throw apiError("CAPABILITIES_UNAVAILABLE", "LoRA一覧を取得できません", 503, error);
  }
  const allowed = new Set((Array.isArray(installed) ? installed : [])
    .map((item) => item?.name)
    .filter((name) => isSafePublicName(name)));
  return input.map((item) => {
    if (!isPlainObject(item) || typeof item.name !== "string" || !item.name.trim()) {
      throw apiError("INVALID_REQUEST", "LoRA指定が不正です", 400);
    }
    const name = item.name.trim();
    if (!isSafePublicName(name) || !allowed.has(name)) {
      throw apiError("INVALID_REQUEST", "指定したLoRAが見つかりません", 400);
    }
    const weight = item.weight === undefined ? Number(config.lora?.defaultWeight ?? 0.7) : Number(item.weight);
    if (!Number.isFinite(weight) || weight < 0.05 || weight > 2) {
      throw apiError("INVALID_REQUEST", "LoRA weightが範囲外です", 400);
    }
    if (item.enabled !== undefined && typeof item.enabled !== "boolean") {
      throw apiError("INVALID_REQUEST", "LoRA enabledが不正です", 400);
    }
    return {
      name,
      weight: Number(weight.toFixed(2)),
      enabled: item.enabled !== false
    };
  });
}

function normalizeClient(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw apiError("INVALID_REQUEST", "metadata.clientが不正です", 400);
  const client = value.trim();
  if (!client || client.length > 40 || /[\u0000-\u001f\u007f]/.test(client)) {
    throw apiError("INVALID_REQUEST", "metadata.clientは40文字以内の識別子で指定してください", 400);
  }
  return client;
}

function validateRequestedContentRating(value) {
  if (value === undefined || value === null || value === "") return "general";
  try {
    return requireNewContentRating(value);
  } catch (error) {
    throw apiError("INVALID_REQUEST", "contentRatingはgeneralまたはnsfwで指定してください", 400, error);
  }
}

function publicCheckpoint(item, active) {
  if (!item || !isSafePublicName(item.title)) return null;
  const title = item.title.trim();
  const modelName = typeof item.modelName === "string" && isSafePublicName(item.modelName)
    ? item.modelName
    : title;
  return {
    id: title,
    title,
    modelName,
    hash: typeof item.hash === "string" ? item.hash : "",
    active: title === active
  };
}

function publicLora(item, recommendedWeight = 0.7) {
  if (!item || !isSafePublicName(item.name)) return null;
  const name = item.name.trim();
  const displayName = typeof item.displayName === "string" && isSafePublicName(item.displayName)
    ? item.displayName
    : name;
  return {
    name,
    displayName,
    recommendedWeight: Number.isFinite(Number(recommendedWeight)) ? Number(recommendedWeight) : 0.7
  };
}

function publicDefaults(defaults = {}, loraConfig = {}) {
  return {
    width: defaults.width,
    height: defaults.height,
    steps: defaults.steps,
    cfgScale: defaults.cfgScale,
    sampler: defaults.samplerName,
    scheduler: defaults.scheduler,
    noiseSchedule: defaults.noiseSchedule,
    seed: -1,
    candidateCount: defaults.candidateCount,
    hires: {
      enabled: false,
      scale: defaults.hiresScale,
      steps: defaults.hiresSteps,
      denoising: defaults.hiresDenoising,
      upscaler: defaults.hiresUpscaler
    },
    loraDefaultWeight: loraConfig.defaultWeight ?? 0.7
  };
}

function safeStringList(value) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()))]
    : [];
}

function requireJobId(value) {
  const id = requireId(value);
  return id;
}

function requireId(value) {
  const id = String(value ?? "");
  if (!/^[a-z0-9-]{8,80}$/i.test(id)) throw apiError("INVALID_REQUEST", "Job IDが不正です", 400);
  return id;
}

function validateSettings(input, config = null) {
  const defaults = config?.defaults ?? input?._defaults ?? {};
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
    img2imgDenoising: boundedNumber(input.img2imgDenoising, defaults.img2imgDenoising ?? 0.45, 0.05, 0.95),
    img2imgResizeMode: boundedInt(input.img2imgResizeMode, defaults.img2imgResizeMode ?? 1, 0, 2),
    inpaintDenoising: boundedNumber(input.inpaintDenoising, defaults.inpaintDenoising ?? 0.55, 0.05, 0.95),
    maskBlur: boundedInt(input.maskBlur, defaults.maskBlur ?? 4, 0, 64),
    inpaintFill: boundedInt(input.inpaintFill, defaults.inpaintFill ?? 1, 0, 3),
    inpaintFullRes: booleanOrDefault(input.inpaintFullRes, defaults.inpaintFullRes ?? true),
    inpaintFullResPadding: boundedInt(input.inpaintFullResPadding, defaults.inpaintFullResPadding ?? 32, 0, 256, 4),
    hiresEnabled,
    hiresScale: boundedNumber(input.hiresScale, defaults.hiresScale ?? 1.5, 1, 2),
    hiresSteps: boundedInt(input.hiresSteps, defaults.hiresSteps ?? 20, 1, 50),
    hiresDenoising: boundedNumber(input.hiresDenoising, defaults.hiresDenoising ?? 0.4, 0.1, 0.8),
    hiresUpscaler: textOrDefault(input.hiresUpscaler, defaults.hiresUpscaler ?? "R-ESRGAN 4x+ Anime6B"),
    checkpoint: passthroughText(input.checkpoint),
    checkpointHash: passthroughText(input.checkpointHash),
    checkpointModelName: passthroughText(input.checkpointModelName),
    checkpointFilename: passthroughText(input.checkpointFilename)
  };
}

function validateLoras(input, config = null) {
  if (!Array.isArray(input)) return [];
  const maximum = boundedInt(config?.lora?.maxSelected, 4, 1, 8);
  const fallbackWeight = boundedNumber(config?.lora?.defaultWeight, 0.7, 0.05, 2);
  const unique = new Map();
  for (const item of input) {
    if (unique.size >= maximum) break;
    if (!item || typeof item.name !== "string") continue;
    const name = item.name.trim().slice(0, 200);
    if (!name || /[<>:\r\n]/.test(name)) continue;
    const key = name.toLowerCase().replaceAll("\\", "/");
    if (unique.has(key)) continue;
    const normalized = {
      name,
      weight: Number(boundedNumber(item.weight, fallbackWeight, 0.05, 2).toFixed(2)),
      triggerWords: sanitizeTriggerWords(item.triggerWords),
      negativeWords: sanitizeTriggerWords(item.negativeWords),
      source: ["ui", "prompt", "both"].includes(item.source) ? item.source : "ui"
    };
    if (typeof item.enabled === "boolean") normalized.enabled = item.enabled;
    if (typeof item.characterTriggerWords === "string") normalized.characterTriggerWords = sanitizeTriggerWords(item.characterTriggerWords);
    if (typeof item.outfitChoiceId === "string") normalized.outfitChoiceId = passthroughText(item.outfitChoiceId, 200);
    if (typeof item.outfitPresetName === "string") normalized.outfitPresetName = passthroughText(item.outfitPresetName, 200);
    if (typeof item.outfitTriggerWords === "string") normalized.outfitTriggerWords = sanitizeTriggerWords(item.outfitTriggerWords);
    unique.set(key, normalized);
  }
  return [...unique.values()];
}

function validateGenerationMode(value) {
  if (value === undefined || value === null || value === "" || value === "txt2img") return "txt2img";
  if (value === "img2img") return "img2img";
  if (value === "inpaint") return "inpaint";
  throw new Error("生成モードが不正です");
}

async function resolveSourceImage(body, mode, deps = null) {
  const state = deps ?? body._generationDeps;
  if (!state || !["img2img", "inpaint"].includes(mode)) return null;
  if (body.initImageId) {
    const imageId = requireId(body.initImageId);
    const recipe = await state.history.getRecipe(imageId);
    const filename = path.basename(String(recipe.selectedImage.filename ?? ""));
    if (!filename || filename !== recipe.selectedImage.filename) throw new Error("参照画像の保存先が不正です");
    const buffer = await fs.readFile(path.join(state.outputDir, filename));
    validateImageBuffer(buffer, extensionFromFilename(filename));
    return {
      base64: buffer.toString("base64"), buffer, extension: extensionFromFilename(filename),
      imageId, imageUrl: recipe.selectedImage.imageUrl, uploaded: false
    };
  }
  if (typeof body.initImage === "string" && body.initImage) {
    return { ...parseImageDataUrl(body.initImage), imageId: null, imageUrl: null, uploaded: true };
  }
  throw new Error(`${mode === "inpaint" ? "部分修正" : "img2img"}の参照画像を選択してください`);
}

async function resolveIpAdapter(body, deps, getIpAdapterOptionsFn, providerConfig = null) {
  const normalized = validateIpAdapter(body.ipAdapter);
  if (!normalized) return null;
  const capability = await getIpAdapterOptionsFn(providerConfig ?? deps.config.reforge);
  if (!capability.available) throw new Error(capability.message || "IP-Adapterを利用できないため生成できません");
  const reference = await resolveIpAdapterReference(normalized, deps);
  const metadata = {
    enabled: true,
    family: capability.family,
    module: capability.module,
    model: capability.model,
    weight: normalized.weight,
    guidanceStart: normalized.guidanceStart,
    guidanceEnd: normalized.guidanceEnd
  };
  if (reference.imageId) metadata.referenceImageId = reference.imageId;
  if (reference.imageUrl) metadata.referenceImageUrl = reference.imageUrl;
  return {
    request: {
      enabled: true,
      referenceBase64: reference.base64,
      module: capability.module,
      model: capability.model,
      weight: normalized.weight,
      guidanceStart: normalized.guidanceStart,
      guidanceEnd: normalized.guidanceEnd
    },
    metadata,
    reference
  };
}

async function resolveIpAdapterReference(input, deps) {
  if (input.referenceImageId) {
    const imageId = requireId(input.referenceImageId);
    if (typeof deps.resolveReferenceImage === "function") {
      const reference = await deps.resolveReferenceImage(imageId);
      const buffer = reference?.buffer;
      const extension = extensionFromFilename(`reference.${reference?.extension ?? ""}`);
      validateImageBuffer(buffer, extension);
      return {
        base64: buffer.toString("base64"),
        buffer,
        extension,
        imageId,
        imageUrl: reference.imageUrl ?? `/api/images/${encodeURIComponent(imageId)}/original`,
        uploaded: false
      };
    }
    const image = await deps.history.getImage(imageId);
    const filename = path.basename(String(image.filename ?? ""));
    if (!filename || filename !== image.filename) throw new Error("IP-Adapter参照画像の保存先が不正です");
    const buffer = await fs.readFile(deps.resolveOutputImagePath(filename));
    const extension = extensionFromFilename(filename);
    validateImageBuffer(buffer, extension);
    return { base64: buffer.toString("base64"), buffer, extension, imageId, imageUrl: `/outputs/${filename}`, uploaded: false };
  }
  if (input.referenceImageUrl) {
    const filename = ipAdapterReferenceFilename(input.referenceImageUrl);
    const buffer = await fs.readFile(deps.resolveOutputImagePath(filename));
    const extension = extensionFromFilename(filename);
    validateImageBuffer(buffer, extension);
    return { base64: buffer.toString("base64"), buffer, extension, imageId: null, imageUrl: `/outputs/${filename}`, uploaded: false };
  }
  const parsed = parseImageDataUrl(input.referenceImage);
  return { ...parsed, imageId: null, imageUrl: null, uploaded: true };
}

function resolveMaskImage(body, mode, settings) {
  if (mode !== "inpaint" || settings.hiresEnabled) return null;
  if (typeof body.maskImage !== "string" || !body.maskImage) throw new Error("修正したい範囲を白く塗ってください");
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
        ? buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP"
        : false;
  if (!valid) throw new Error("参照画像の形式を確認できませんでした");
}

function extensionFromFilename(filename) {
  const extension = path.extname(filename).slice(1).toLowerCase().replace("jpeg", "jpg");
  if (!["png", "jpg", "webp"].includes(extension)) throw new Error("履歴の参照画像形式に対応していません");
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

async function saveContentAddressedImage(prefix, image, outputDir) {
  const hash = crypto.createHash("sha256").update(image.buffer).digest("hex").slice(0, 20);
  const filename = `${prefix}_${hash}.${image.extension}`;
  try {
    await fs.writeFile(path.join(outputDir, filename), image.buffer, { flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  return `/outputs/${filename}`;
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
  return { width: roundToMultiple(targetWidth, 8), height: roundToMultiple(targetHeight, 8) };
}

function validateExperimentMeta(value) {
  if (!isPlainObject(value)) return null;
  if (!/^[a-z0-9-]{8,80}$/i.test(String(value.id ?? "")) || !isComparableParameter(value.parameter)) return null;
  return {
    id: String(value.id),
    name: passthroughText(value.name, 120),
    type: passthroughText(value.type, 40) || "parameter",
    parameter: passthroughText(value.parameter, 80),
    target: passthroughText(value.target, 200),
    value: typeof value.value === "number" ? value.value : passthroughText(value.value, 100),
    baseSeed: Number.isFinite(Number(value.baseSeed)) ? Number(value.baseSeed) : null
  };
}

function validateDerivation(value) {
  if (!isPlainObject(value)) return null;
  const type = DERIVATION_TYPES.includes(value.type) ? value.type : null;
  return type ? { type, instruction: passthroughText(value.instruction, 500) } : null;
}

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

function validateStructuredPrompt(input) {
  if (!isPlainObject(input)) return null;
  const sections = {};
  let filled = false;
  for (const field of PROMPT_FIELDS) {
    const value = passthroughText(input[field], 4000).trim();
    sections[field] = value;
    if (value) filled = true;
  }
  return filled ? sections : null;
}

function validateAppliedTriggerWords(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const result = [];
  for (const item of input) {
    if (result.length >= 60 || !isPlainObject(item)) continue;
    const text = sanitizeTriggerWords(item.text).slice(0, 200).trim();
    if (!text) continue;
    const key = normalizeTag(text);
    if (seen.has(key)) continue;
    seen.add(key);
    const sourceLoraIds = Array.isArray(item.sourceLoraIds)
      ? [...new Set(item.sourceLoraIds.filter((value) => typeof value === "string" && value.trim())
        .map((value) => value.trim().slice(0, 200)))].slice(0, 8)
      : [];
    const sourceLoraId = passthroughText(item.sourceLoraId, 200).trim() || sourceLoraIds[0] || "";
    result.push({
      id: passthroughText(item.id, 200) || `trigger:${key}`,
      sourceLoraId,
      sourceLoraIds: sourceLoraIds.length ? sourceLoraIds : (sourceLoraId ? [sourceLoraId] : []),
      text,
      weight: Number(boundedNumber(item.weight, 1, 0.05, 2).toFixed(2)),
      targetField: PROMPT_FIELDS.includes(item.targetField) ? item.targetField : "extra",
      enabled: item.enabled !== false
    });
  }
  return result;
}

function validateLoraNotices(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((item) => isPlainObject(item) && LORA_NOTICE_TYPES.includes(item.type))
    .slice(0, 20)
    .map((item) => {
      const notice = { type: item.type, name: passthroughText(item.name, 200) };
      if (Array.isArray(item.weights)) {
        notice.weights = item.weights.map(Number).filter(Number.isFinite).slice(0, 10);
      }
      if (item.weight !== undefined) notice.weight = boundedNumber(item.weight, 1, 0.05, 2);
      if (Array.isArray(item.candidates)) {
        notice.candidates = item.candidates.filter((value) => typeof value === "string")
          .map((value) => value.slice(0, 200)).slice(0, 10);
      }
      if (item.weightText !== undefined) notice.weightText = passthroughText(item.weightText, 40);
      return notice;
    });
}

function appendLoras(prompt, loras) {
  const enabledLoras = loras.filter((item) => item.enabled !== false);
  if (!enabledLoras.length) return prompt;
  const normalizedPrompt = prompt.toLowerCase().replaceAll(/\s+/g, " ");
  const existing = new Set([...prompt.matchAll(/<lora:([^:>]+)(?::[^>]*)?>/gi)]
    .map((match) => match[1].trim().toLowerCase().replaceAll("\\", "/")));
  const triggerWords = enabledLoras
    .map((item) => item.triggerWords)
    .filter((value) => value && !normalizedPrompt.includes(value.toLowerCase().replaceAll(/\s+/g, " ")));
  const loraTags = enabledLoras
    .filter((item) => !existing.has(item.name.toLowerCase().replaceAll("\\", "/")))
    .map((item) => `<lora:${item.name}:${item.weight}>`);
  return appendUniqueTags(prompt, [...triggerWords, ...loraTags]);
}

function appendLoraNegatives(negativePrompt, loras) {
  return appendUniqueTags(negativePrompt, loras.filter((item) => item.enabled !== false).flatMap((item) => splitTags(item.negativeWords)));
}

function splitTags(value) {
  if (typeof value !== "string") return [];
  return value.split(",").map((tag) => tag.trim()).filter(Boolean);
}

function sanitizeTriggerWords(value) {
  if (typeof value !== "string") return "";
  return value.replace(/[<>]/g, "").replace(/[\r\n]+/g, ", ").replace(/\s*,\s*/g, ", ")
    .replace(/(?:,\s*){2,}/g, ", ").trim().slice(0, 500);
}

function normalizeTag(value) {
  return value.toLowerCase().replaceAll(/\s+/g, " ");
}

function passthroughText(value, max = 400) {
  return typeof value === "string" ? value.slice(0, max) : "";
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

function runtimeDescriptorForRecovery(body, runtimeRegistry) {
  try {
    return runtimeRegistry?.resolve?.(body?.runtimeId ?? body?._runtimeId);
  } catch {
    return null;
  }
}

function localizeRecoveryClassification(classification, provider) {
  const runtimeLabel = String(provider?.descriptor?.label ?? "").trim();
  if (!runtimeLabel || runtimeLabel === "ReForge") return classification;
  return {
    ...classification,
    label: replaceRecoveryRuntimeName(classification.label, runtimeLabel),
    message: replaceRecoveryRuntimeName(classification.message, runtimeLabel)
  };
}

function replaceRecoveryRuntimeName(value, runtimeLabel) {
  return String(value ?? "").replaceAll("ReForge", runtimeLabel);
}

function normalizeNoiseSchedule(value, fallback) {
  const requested = typeof value === "string" ? value.trim() : "";
  if (NOISE_SCHEDULE_CHOICES.includes(requested)) return requested;
  if (NOISE_SCHEDULE_CHOICES.includes(fallback)) return fallback;
  return "Automatic";
}

function roundToMultiple(value, multiple) {
  return Math.max(multiple, Math.round(Number(value) / multiple) * multiple);
}

function timestamp() {
  return new Date().toISOString().replace("T", "_").replace("Z", "")
    .replaceAll(":", "-").replace(".", "-");
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function isSafePublicName(value) {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  return Boolean(normalized)
    && !/^[a-z]:[\\/]/i.test(normalized)
    && !normalized.startsWith("/")
    && !normalized.startsWith("\\")
    && !normalized.split(/[\\/]/).includes("..");
}

function requiredString(value, label, max) {
  if (typeof value !== "string" || !value.trim()) throw apiError("INVALID_REQUEST", `${label}は文字列で指定してください`, 400);
  return value.trim().slice(0, max);
}

function copyOptionalString(input, output, key, max, outputKey = key) {
  if (input[key] !== undefined) output[outputKey] = requiredString(input[key], `settings.${key}`, max);
}

function copyOptionalInteger(input, output, key, min, max, multiple = 1, outputKey = key) {
  if (input[key] === undefined) return;
  const value = Number(input[key]);
  if (!Number.isInteger(value) || value < min || value > max || value % multiple !== 0) {
    throw apiError("INVALID_REQUEST", `settings.${key}が範囲外です`, 400);
  }
  output[outputKey] = value;
}

function copyOptionalNumber(input, output, key, min, max, outputKey = key) {
  if (input[key] === undefined) return;
  const value = Number(input[key]);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw apiError("INVALID_REQUEST", `settings.${key}が範囲外です`, 400);
  }
  output[outputKey] = value;
}

function strictBoolean(value, label) {
  if (typeof value !== "boolean") throw apiError("INVALID_REQUEST", `${label}が不正です`, 400);
  return value;
}
