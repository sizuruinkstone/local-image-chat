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
import { applyPromptWeights, dedupeLoraTags, sameLoraName } from "../../public/lora-tags.js";
import {
  buildGenerationTitle,
  normalizeManualTitle,
  normalizeTitleMode,
  normalizeTitleTemplate
} from "../../public/history-title.js";
import { ipAdapterReferenceFilename, validateIpAdapter } from "../ip-adapter.js";
import { appendUniqueTags, normalizePromptBoosts, resolvePrompt } from "./prompt-service.js";
import { PROMPT_FIELDS } from "../../public/structured-prompt.js";

const MAX_INIT_IMAGE_BYTES = 20 * 1024 * 1024;
const DERIVATION_TYPES = ["same-seed", "lora", "outfit", "background", "expression", "duplicate"];
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

  async function executeWithRecovery(body, context) {
    try {
      return await performGeneration(body, context);
    } catch (error) {
      if (context.signal?.aborted) throw error;
      const previousCount = Number(body?.retryInfo?.retryCount ?? 0);
      if (previousCount >= MAX_RETRY_COUNT) throw error;

      const classification = classifyGenerationError(error);
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
    const hasPrompt = Boolean(body.prompt?.trim());
    if (!description && !hasPrompt) throw new Error("生成したい内容かPromptを入力してください");
    const mode = validateGenerationMode(body.mode);
    let settings = validateSettings(body.settings ?? {}, config);
    if (body._source === "api-v1") {
      settings = await prepareApiCheckpoint(settings, body._checkpointId);
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
    const ipAdapter = await resolveIpAdapter(body, deps, getIpAdapterOptionsFn);

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

    reportProgress(25, "ReForgeで生成を開始");
    const generated = await generateImagesFn(config.reforge, {
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
    resolveOutputImagePath
  };
}

export function createGenerationService({ jobs, runtime, config, capabilityDependencies = {}, history }) {
  const listCheckpointsFn = capabilityDependencies.listCheckpoints
    ?? ((reforgeConfig) => listCheckpoints(reforgeConfig));
  const listSamplersFn = capabilityDependencies.listSamplers
    ?? (async () => ({ samplers: [], schedulers: [] }));
  const listLorasFn = capabilityDependencies.listLoras
    ?? ((reforgeConfig) => listLoras(reforgeConfig));

  async function getCapabilities() {
    try {
      const [checkpointData, samplerData, loras] = await Promise.all([
        listCheckpointsFn(config.reforge),
        listSamplersFn(config.reforge),
        listLorasFn(config.reforge)
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
        defaults: publicDefaults(config.defaults, config.lora)
      };
    } catch (error) {
      throw apiError("CAPABILITIES_UNAVAILABLE", "生成能力一覧を取得できません", 503, error);
    }
  }

  async function createV1Job(request) {
    if (!isPlainObject(request)) throw apiError("INVALID_REQUEST", "リクエストJSONが不正です", 400);
    const mode = request.mode ?? "txt2img";
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

    const settingsInput = normalizeV1Settings(request.settings);
    const checkpoint = settingsInput.checkpoint === undefined
      ? null
      : await runtime.resolveV1Checkpoint(settingsInput.checkpoint);
    if (checkpoint) {
      settingsInput.checkpoint = checkpoint.id;
      settingsInput.checkpointHash = checkpoint.hash;
      settingsInput.checkpointModelName = checkpoint.modelName;
    }
    const loras = await normalizeV1Loras(request.loras, listLorasFn, config);
    const client = normalizeClient(request.metadata?.client);
    const payload = {
      mode: "txt2img",
      prompt: resolvedPrompt.positive,
      negativePrompt: resolvedPrompt.negative,
      structuredPrompt: resolvedPrompt.structured,
      rawPromptOverride: resolvedPrompt.mode === "raw",
      rawPrompt: resolvedPrompt.mode === "raw" ? resolvedPrompt.positive : "",
      loras,
      settings: settingsInput,
      _source: "api-v1",
      _checkpointId: checkpoint?.id ?? null
    };
    return jobs.create(payload, {
      kind: "generation",
      label: describeGenerationJob(payload),
      client
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
        limit: query.limit,
        cursor: query.cursor
      });
    } catch (error) {
      throw apiError("INVALID_REQUEST", error.message, 400, error);
    }
  }

  return {
    createLegacyJob: (body, meta) => jobs.create(body, meta),
    generateLegacyNow: (body, context) => runtime.execute(body, context),
    getCapabilities,
    createV1Job,
    getV1Job,
    cancelV1Job,
    listHistory
  };
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

async function resolveIpAdapter(body, deps, getIpAdapterOptionsFn) {
  const normalized = validateIpAdapter(body.ipAdapter);
  if (!normalized) return null;
  const capability = await getIpAdapterOptionsFn(deps.config.reforge);
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
