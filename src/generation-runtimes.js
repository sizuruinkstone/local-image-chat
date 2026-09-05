import {
  checkReforge,
  generateImages,
  getIpAdapterOptions,
  listCheckpoints,
  listLoras,
  listSamplers,
  switchCheckpoint
} from "./reforge.js";
import { createForgeNeoProvider } from "./forge-neo.js";

const REFORGE_ID = "reforge";
const REFORGE_DESCRIPTOR = Object.freeze({
  id: REFORGE_ID,
  label: "ReForge",
  provider: "reforge",
  available: true,
  supportedModes: ["txt2img", "img2img", "inpaint"],
  features: {
    txt2img: true,
    img2img: true,
    inpaint: true,
    hires: true,
    ipAdapter: true
  }
});

export function createGenerationRuntimeRegistry({
  config = {},
  overrides = {},
  logger = console,
  fetchImpl = globalThis.fetch
} = {}) {
  const reforgeConfig = config.reforge ?? {};
  const reforge = createReforgeProvider({ config: reforgeConfig, overrides, logger });
  const providers = new Map([[REFORGE_ID, reforge]]);
  const neoConfig = config.runtimes?.forgeNeoAnima;
  if (isRecord(neoConfig)) {
    providers.set("forge-neo-anima", createForgeNeoProvider({
      config: neoConfig,
      fetchImpl,
      logger
    }));
  }

  const requestedDefault = normalizeRuntimeId(config.runtimes?.default);
  const defaultRuntimeId = requestedDefault && providers.get(requestedDefault)?.descriptor.available !== false
    ? requestedDefault
    : REFORGE_ID;

  function resolve(runtimeId) {
    const id = runtimeId === undefined || runtimeId === null || runtimeId === ""
      ? defaultRuntimeId
      : normalizeRuntimeId(runtimeId);
    const provider = providers.get(id);
    if (!provider) throw runtimeError("RUNTIME_NOT_FOUND", "指定したRuntimeが見つかりません", 404);
    if (provider.descriptor.available === false) {
      throw runtimeError("RUNTIME_UNAVAILABLE", "指定したRuntimeは無効です", 503);
    }
    return provider;
  }

  function listDescriptors() {
    return [...providers.values()].map((provider) => cloneDescriptor(provider.descriptor));
  }

  async function healthAll() {
    const entries = await Promise.all([...providers.entries()].map(async ([id, provider]) => {
      if (typeof provider.checkHealth !== "function") {
        return [id, { ...cloneDescriptor(provider.descriptor), ok: provider.descriptor.available !== false }];
      }
      try {
        return [id, await provider.checkHealth()];
      } catch (error) {
        return [id, {
          ...cloneDescriptor(provider.descriptor),
          available: false,
          ok: false,
          error: publicHealthError(error)
        }];
      }
    }));
    return Object.fromEntries(entries);
  }

  return {
    defaultRuntimeId,
    resolve,
    listDescriptors,
    healthAll,
    providers
  };
}

function createReforgeProvider({ config, overrides, logger }) {
  const listCheckpointsFn = overrides.listCheckpoints ?? listCheckpoints;
  const listSamplersFn = overrides.listSamplers ?? listSamplers;
  const listLorasFn = overrides.listLoras ?? listLoras;
  const getIpAdapterOptionsFn = overrides.getIpAdapterOptions ?? getIpAdapterOptions;
  const generateImagesFn = overrides.generateImages ?? generateImages;
  const switchCheckpointFn = overrides.switchCheckpoint ?? switchCheckpoint;

  return {
    descriptor: REFORGE_DESCRIPTOR,
    config,
    validateRequest({ mode } = {}) {
      if (!["txt2img", "img2img", "inpaint"].includes(mode)) {
        throw runtimeError("RUNTIME_MODE_NOT_SUPPORTED", "ReForgeの生成モードが不正です", 400);
      }
    },
    checkHealth: async () => {
      try {
        return { ...cloneDescriptor(REFORGE_DESCRIPTOR), ...(await checkReforge(config)), available: true };
      } catch (error) {
        logger.warn?.(`[ReForge] health確認をスキップ: ${error.message}`);
        return {
          ...cloneDescriptor(REFORGE_DESCRIPTOR),
          available: false,
          ok: false,
          error: publicHealthError(error)
        };
      }
    },
    listCheckpoints: () => listCheckpointsFn(config),
    listSamplers: () => listSamplersFn(config),
    listLoras: () => listLorasFn(config),
    getIpAdapterOptions: () => getIpAdapterOptionsFn(config),
    switchCheckpoint: (checkpoint) => switchCheckpointFn(config, checkpoint),
    resolveV1Checkpoint: overrides.resolveV1Checkpoint
      ? (requested) => overrides.resolveV1Checkpoint(requested)
      : (requested) => resolveCheckpointFromCatalog({
          listCheckpoints: () => listCheckpointsFn(config),
          requested
        }),
    prepareGeneration: async () => ({}),
    generateImages: (request, context) => generateImagesFn(config, request, context)
  };
}

async function resolveCheckpointFromCatalog({ listCheckpoints: list, requested }) {
  let catalog;
  try {
    catalog = await list();
  } catch (error) {
    throw runtimeError("CAPABILITIES_UNAVAILABLE", "Checkpoint一覧を取得できません", 503, error);
  }
  const checkpoints = Array.isArray(catalog?.checkpoints) ? catalog.checkpoints : [];
  const targetId = requested === undefined || requested === null ? String(catalog?.activeCheckpoint ?? "") : String(requested);
  const target = checkpoints.find((item) => [item?.title, item?.modelName, item?.filename]
    .some((value) => safeName(value) && value === targetId));
  if (!target) throw runtimeError("INVALID_CHECKPOINT", "指定したCheckpointが見つかりません", 400);
  return {
    id: target.title,
    title: target.title,
    modelName: String(target.modelName ?? target.title),
    hash: String(target.hash ?? ""),
    active: target.title === String(catalog?.activeCheckpoint ?? "")
  };
}

function cloneDescriptor(descriptor) {
  return {
    id: descriptor.id,
    label: descriptor.label,
    provider: descriptor.provider,
    available: descriptor.available !== false,
    supportedModes: [...(descriptor.supportedModes ?? [])],
    features: { ...(descriptor.features ?? {}) }
  };
}

function normalizeRuntimeId(value) {
  if (typeof value !== "string") return "";
  const id = value.trim();
  return /^[a-z0-9][a-z0-9._-]{0,79}$/i.test(id) ? id : "";
}

function safeName(value) {
  return typeof value === "string" && value.trim()
    && !/^[a-z]:[\\/]/i.test(value)
    && !value.trim().startsWith("/")
    && !value.trim().startsWith("\\")
    && !value.trim().split(/[\\/]/).includes("..");
}

function publicHealthError(error) {
  if (error?.apiCode === "RUNTIME_TIMEOUT") return "Runtimeへの接続がタイムアウトしました";
  return "Runtimeへ接続できません";
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function runtimeError(code, message, statusCode = 503, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.apiCode = code;
  error.statusCode = statusCode;
  return error;
}
