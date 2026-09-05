import { normalizeLora as normalizeReforgeLora } from "./reforge.js";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const FORGE_NEO_ID = "forge-neo-anima";
const FORGE_NEO_LABEL = "Forge Neo / Anima";
const FORGE_NEO_PROVIDER = "forge-neo";
const DEFAULT_NEO_CHECKPOINT = "sd\\oneObsessionAnima_v30.safetensors";
const DEFAULT_NEO_MODULES = Object.freeze([
  "qwen_image_vae.safetensors",
  "oneObsessionAnima_v30_txt.safetensors"
]);
const DEFAULT_NEO_PROFILE_ID = "anima-default";
const ALLOWED_NEO_PRESETS = new Set(["anima", "xl"]);
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 900_000;
const DEFAULT_HEALTH_TIMEOUT_MS = 5_000;
const MAX_HEALTH_TIMEOUT_MS = 30_000;

export function normalizeForgeNeoConfig(input = {}) {
  const source = isRecord(input) ? input : {};
  const profiles = Object.hasOwn(source, "profiles")
    ? normalizeProfiles(source.profiles)
    : [normalizeProfile({
        id: DEFAULT_NEO_PROFILE_ID,
        label: FORGE_NEO_LABEL,
        checkpoint: source.checkpoint ?? DEFAULT_NEO_CHECKPOINT,
        preset: source.preset ?? "anima",
        additionalModules: source.additionalModules ?? DEFAULT_NEO_MODULES
      })];
  const primaryProfile = profiles[0];
  const url = normalizeOrigin(source.url);
  return {
    enabled: source.enabled === true,
    id: FORGE_NEO_ID,
    label: FORGE_NEO_LABEL,
    provider: FORGE_NEO_PROVIDER,
    url,
    activationMode: source.activationMode === "preloaded" ? "preloaded" : "managed-options",
    // 旧単一設定の呼び出し元を壊さないため、先頭Profileの値も残す。
    // Profileが明示された場合、実際の解決はprofilesだけを正本にする。
    preset: primaryProfile.preset,
    checkpoint: primaryProfile.checkpoint,
    additionalModules: [...primaryProfile.additionalModules],
    profiles,
    supportedModes: ["txt2img"],
    timeoutMs: clampTimeout(source.timeoutMs),
    healthTimeoutMs: clampHealthTimeout(source.healthTimeoutMs)
  };
}

export function createForgeNeoProvider({ config = {}, fetchImpl = globalThis.fetch, logger = console } = {}) {
  const neoConfig = normalizeForgeNeoConfig(config);
  if (typeof fetchImpl !== "function") throw new Error("Forge Neo用のfetchが利用できません");

  const descriptor = Object.freeze({
    id: FORGE_NEO_ID,
    label: FORGE_NEO_LABEL,
    provider: FORGE_NEO_PROVIDER,
    available: neoConfig.enabled,
    supportedModes: [...neoConfig.supportedModes],
    features: {
      txt2img: true,
      img2img: false,
      inpaint: false,
      hires: false,
      ipAdapter: false
    }
  });

  async function requestJson(pathname, {
    method = "GET",
    body,
    signal,
    timeoutMs = neoConfig.timeoutMs
  } = {}) {
    if (!neoConfig.url) {
      throw runtimeError("RUNTIME_UNAVAILABLE", "Forge Neoの接続先が設定されていません", 503);
    }
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, Math.max(MIN_TIMEOUT_MS, Number(timeoutMs) || neoConfig.timeoutMs));
    timer.unref?.();
    const abort = () => controller.abort(signal.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await fetchImpl(`${neoConfig.url}/sdapi/v1/${String(pathname).replace(/^\//, "")}`, {
        method,
        headers: body === undefined ? { Accept: "application/json" } : {
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      });
      if (!response?.ok) {
        throw runtimeError("RUNTIME_UNAVAILABLE", "Forge Neoが要求に応答できません", response?.status >= 500 ? 503 : 502);
      }
      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        throw runtimeError("RUNTIME_UNAVAILABLE", "Forge Neoのresponseを解釈できません", 503, error);
      }
      return payload;
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? abortError();
      if (timedOut || error?.name === "TimeoutError" || error?.name === "AbortError") {
        throw runtimeError("RUNTIME_TIMEOUT", "Forge Neoへの接続がタイムアウトしました", 504, error);
      }
      if (error?.apiCode) throw error;
      throw runtimeError("RUNTIME_UNAVAILABLE", "Forge Neoへ接続できません", 503, error);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }

  async function requestLongRunningJson(pathname, { method = "GET", body, signal } = {}) {
    // Injected fetch implementations are retained for the existing isolated tests.
    // Production txt2img uses node:http(s), avoiding Undici's fixed 300s header timeout.
    if (fetchImpl !== globalThis.fetch) {
      return requestJson(pathname, { method, body, signal, timeoutMs: neoConfig.timeoutMs });
    }
    if (!neoConfig.url) {
      throw runtimeError("RUNTIME_UNAVAILABLE", "Forge Neoの接続先が設定されていません", 503);
    }
    if (signal?.aborted) throw signal.reason ?? abortError();

    const url = new URL(`${neoConfig.url}/sdapi/v1/${String(pathname).replace(/^\//, "")}`);
    const serializedBody = body === undefined ? null : JSON.stringify(body);
    const requestImpl = url.protocol === "https:" ? httpsRequest : httpRequest;
    let timedOut = false;
    let activeRequest;
    const abort = () => activeRequest?.destroy(abortError());
    const timer = setTimeout(() => {
      timedOut = true;
      activeRequest?.destroy(abortError());
    }, neoConfig.timeoutMs);
    timer.unref?.();
    signal?.addEventListener("abort", abort, { once: true });

    try {
      return await new Promise((resolve, reject) => {
        activeRequest = requestImpl(url, {
          method,
          headers: serializedBody === null ? { Accept: "application/json" } : {
            Accept: "application/json",
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(serializedBody)
          }
        }, (response) => {
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            response.resume();
            reject(runtimeError(
              "RUNTIME_UNAVAILABLE",
              "Forge Neoが要求に応答できません",
              response.statusCode >= 500 ? 503 : 502
            ));
            return;
          }
          const chunks = [];
          response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          response.on("end", () => {
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            } catch (error) {
              reject(runtimeError("RUNTIME_UNAVAILABLE", "Forge Neoのresponseを解釈できません", 503, error));
            }
          });
          response.on("error", reject);
        });
        activeRequest.on("error", reject);
        if (serializedBody !== null) activeRequest.write(serializedBody);
        activeRequest.end();
        if (signal?.aborted) abort();
      });
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? abortError();
      if (timedOut) {
        throw runtimeError("RUNTIME_TIMEOUT", "Forge Neoへの接続がタイムアウトしました", 504, error);
      }
      if (error?.apiCode) throw error;
      throw runtimeError("RUNTIME_UNAVAILABLE", "Forge Neoへ接続できません", 503, error);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }

  async function getOptions({ signal, timeoutMs } = {}) {
    return requestJson("options", { signal, timeoutMs });
  }

  async function readActivationCatalog({ signal, timeoutMs } = {}) {
    // 読み取り順は設計書どおりに固定する。cmd-flagsはreadinessに使わない。
    const options = await getOptions({ signal, timeoutMs });
    const models = await requestJson("sd-models", { signal, timeoutMs });
    const modules = await requestJson("sd-modules", { signal, timeoutMs });
    if (!Array.isArray(models)) {
      throw runtimeError("RUNTIME_UNAVAILABLE", "Forge NeoのCheckpoint一覧を確認できません", 503);
    }
    const normalizedModules = normalizeModuleCatalog(modules);
    const profiles = neoConfig.profiles.map((profile) => {
      const checkpoint = resolveCheckpointCatalog(models, profile.checkpoint);
      let requiredModuleNames = [];
      let moduleError = null;
      if (checkpoint) {
        try {
          requiredModuleNames = resolveRequiredModules(normalizedModules, profile.additionalModules);
        } catch (error) {
          moduleError = error;
        }
      }
      return { profile, checkpoint, requiredModuleNames, moduleError };
    });
    if (!profiles.some((profile) => profile.checkpoint)) {
      throw runtimeError("RUNTIME_CHECKPOINT_NOT_ALLOWED", "Forge Neoの設定済みCheckpointが見つかりません", 503);
    }
    const primary = profiles[0];
    return {
      options,
      models,
      modules: normalizedModules,
      profiles,
      checkpoint: primary?.checkpoint ?? null,
      requiredModuleNames: primary?.requiredModuleNames ?? [],
      preset: primary?.profile.preset ?? ""
    };
  }

  async function listCheckpoints() {
    const catalog = await readActivationCatalog({});
    const checkpoints = catalog.profiles
      .filter((profile) => profile.checkpoint)
      .map((profile) => publicCheckpoint(profile.checkpoint))
      .filter(Boolean);
    return {
      checkpoints,
      activeCheckpoint: publicCurrentCheckpoint(catalog.options, catalog.profiles)
    };
  }

  async function refreshCheckpoints() {
    await requestJson("refresh-checkpoints", { method: "POST" });
    return listCheckpoints();
  }

  async function resolveV1Checkpoint(requested) {
    const catalog = await readActivationCatalog({});
    const selected = selectProfile(catalog, requested);
    const target = selected.checkpoint;
    return {
      id: target.publicName,
      title: target.publicName,
      modelName: target.modelName,
      hash: target.hash,
      active: !selected.moduleError && activationMatches(catalog.options, desiredActivation(selected))
    };
  }

  async function prepareGeneration({ signal, requestedCheckpoint } = {}) {
    const catalog = await readActivationCatalog({ signal });
    const selected = selectProfile(catalog, requestedCheckpoint);
    assertProfileReady(selected);
    const desired = desiredActivation(selected);
    if (neoConfig.activationMode === "preloaded") {
      assertActivation(catalog.options, desired);
      return { checkpoint: desired.checkpoint.publicName };
    }

    if (activationMatches(catalog.options, desired)) {
      return { checkpoint: desired.checkpoint.publicName };
    }

    try {
      if (!desired.checkpoint.modelName) {
        throw runtimeError("NEO_ANIMA_ACTIVATION_FAILED", "Forge NeoのCheckpoint aliasを確認できないためProfileを有効化できません", 503);
      }
      await requestJson("options", {
        method: "POST",
        body: {
          sd_model_checkpoint: desired.checkpoint.modelName,
          forge_preset: desired.preset,
          forge_additional_modules: desired.modules
        },
        signal
      });
    } catch (error) {
      if (error?.apiCode === "RUNTIME_TIMEOUT") throw error;
      throw runtimeError("NEO_ANIMA_ACTIVATION_FAILED", "Forge NeoのProfile有効化に失敗しました", 503, error);
    }
    let verified;
    try {
      verified = await getOptions({ signal });
      assertActivation(verified, desired);
    } catch (error) {
      if (error?.apiCode === "NEO_ANIMA_MODULE_NOT_FOUND"
        || error?.apiCode === "NEO_ANIMA_MODULES_NOT_LOADED") throw error;
      throw runtimeError("NEO_ANIMA_ACTIVATION_FAILED", "Forge NeoのProfile有効化状態を確認できません", 503, error);
    }
    return { checkpoint: desired.checkpoint.publicName };
  }

  async function listSamplers() {
    const [samplers, schedulers] = await Promise.all([
      requestJson("samplers"),
      requestJson("schedulers")
    ]);
    return {
      samplers: normalizeNameList(samplers),
      schedulers: normalizeNameList(schedulers)
    };
  }

  async function listLoras() {
    const body = await requestJson("loras");
    if (!Array.isArray(body)) {
      throw runtimeError("RUNTIME_UNAVAILABLE", "Forge NeoのLoRA一覧を確認できません", 503);
    }
    return body
      .map((item) => normalizeLora(item))
      .filter(Boolean)
      .sort((left, right) => left.displayName.localeCompare(right.displayName, "ja", { numeric: true }));
  }

  async function refreshLoras() {
    await requestJson("refresh-loras", { method: "POST" });
    return listLoras();
  }

  async function getIpAdapterOptions() {
    return {
      available: false,
      family: null,
      module: null,
      model: null,
      message: "Forge Neo / AnimaではIP-Adapterを利用できません"
    };
  }

  function validateRequest({ mode, settings, body } = {}) {
    if (mode !== "txt2img") {
      throw runtimeError("RUNTIME_MODE_NOT_SUPPORTED", "Forge Neo / Animaはtxt2imgだけに対応しています", 400);
    }
    if (settings?.hiresEnabled === true || body?.initImageId || body?.initImage || body?.maskImage
      || body?.maskBase64 || body?.ipAdapter) {
      throw runtimeError("RUNTIME_MODE_NOT_SUPPORTED", "Forge Neo / Animaではimg2img、inpaint、Hires、IP-Adapterを利用できません", 400);
    }
  }

  async function generateImages(request, { signal, onProgress } = {}) {
    validateRequest({ mode: request?.mode, settings: request, body: request });
    const count = clampCandidateCount(request?.candidateCount);
    const images = [];
    for (let index = 0; index < count; index += 1) {
      const requestedSeed = request.seed === -1
        ? -1
        : (Number(request.seed) + index) >>> 0;
      const result = await generateOne(request, requestedSeed, { signal, onProgress, index, count });
      images.push(result);
      onProgress?.((index + 1) / count, `候補 ${index + 1}/${count} 完了`);
    }
    return { images };
  }

  async function checkHealth() {
    if (!neoConfig.enabled) return { ...descriptor, available: false, ok: false, error: "Runtimeが無効です" };
    const controller = new AbortController();
    let timedOut = false;
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(runtimeError("RUNTIME_TIMEOUT", "Forge Neoへの接続がタイムアウトしました", 504));
      }, neoConfig.healthTimeoutMs);
      timer.unref?.();
    });
    try {
      const catalog = await Promise.race([
        readActivationCatalog({ signal: controller.signal, timeoutMs: neoConfig.healthTimeoutMs }),
        timeout
      ]);
      const active = catalog.profiles.find((profile) => profile.checkpoint
        && !profile.moduleError
        && activationMatches(catalog.options, desiredActivation(profile)));
      if (active) {
        return {
          ...descriptor,
          available: true,
          ok: true,
          checkpoint: active.checkpoint.publicName
        };
      }

      const hasAvailableProfile = catalog.profiles.some((profile) => profile.checkpoint && !profile.moduleError);
      if (neoConfig.activationMode === "managed-options" && hasAvailableProfile) {
        return {
          ...descriptor,
          available: true,
          ok: true
        };
      }
      if (neoConfig.activationMode === "preloaded" && hasAvailableProfile) {
        return {
          ...descriptor,
          available: true,
          ok: false,
          error: "Forge Neoの設定済みProfileが有効ではありません"
        };
      }
      throw runtimeError("RUNTIME_CHECKPOINT_NOT_ALLOWED", "Forge Neoの設定済みCheckpointが利用できません", 503);
    } catch (error) {
      logger.warn?.(`[Forge Neo] health確認をスキップ: ${error.message}`);
      return {
        ...descriptor,
        available: false,
        ok: false,
        error: timedOut ? "Forge Neoへの接続がタイムアウトしました" : publicErrorMessage(error)
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async function generateOne(request, seed, { signal, onProgress, index, count }) {
    let interrupted = false;
    const interrupt = async () => {
      if (interrupted) return;
      interrupted = true;
      await requestJson("interrupt", { method: "POST", signal: undefined, timeoutMs: 5_000 });
    };
    const removeAbortListener = watchAbort(signal, () => {
      void interrupt().catch((error) => logger.warn?.(`[Forge Neo] interruptに失敗: ${error.message}`));
    });
    const stopProgressPolling = startProgressPolling({ signal, onProgress, index, count });
    try {
      const body = await requestLongRunningJson("txt2img", {
        method: "POST",
        signal,
        body: {
          prompt: request.prompt,
          negative_prompt: request.negativePrompt,
          width: request.width,
          height: request.height,
          steps: request.steps,
          cfg_scale: request.cfgScale,
          seed,
          sampler_name: request.samplerName,
          scheduler: request.scheduler,
          batch_size: 1,
          n_iter: 1,
          do_not_save_grid: true,
          save_images: true
        }
      });
      if (!body || !Array.isArray(body.images) || typeof body.images[0] !== "string" || !body.images[0]) {
        throw runtimeError("RUNTIME_UNAVAILABLE", "Forge Neoから画像が返りませんでした", 503);
      }
      return { base64: stripDataUrl(body.images[0]), seed: responseSeed(body, seed) };
    } finally {
      stopProgressPolling();
      removeAbortListener();
    }
  }

  function startProgressPolling({ signal, onProgress, index, count }) {
    if (typeof onProgress !== "function") return () => {};
    let stopped = false;
    let timer = null;
    const poll = async () => {
      if (stopped || signal?.aborted) return;
      try {
        const body = await requestJson("progress", { signal, timeoutMs: 3_000 });
        const progress = Math.max(0, Math.min(0.99, Number(body?.progress) || 0));
        onProgress((index + progress) / count, "Forge Neo生成中");
      } catch (error) {
        if (!signal?.aborted) logger.warn?.(`[Forge Neo] progress確認をスキップ: ${error.message}`);
      }
      if (!stopped) timer = setTimeout(poll, 800);
    };
    timer = setTimeout(poll, 250);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }

  return {
    descriptor,
    config: neoConfig,
    validateRequest,
    checkHealth,
    getIpAdapterOptions,
    listCheckpoints,
    refreshCheckpoints,
    listLoras,
    refreshLoras,
    listSamplers,
    resolveV1Checkpoint,
    prepareGeneration,
    generateImages
  };
}

function createRequestError(code, message, statusCode = 503, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.apiCode = code;
  error.statusCode = statusCode;
  return error;
}

function runtimeError(code, message, statusCode = 503, cause) {
  return createRequestError(code, message, statusCode, cause);
}

function publicErrorMessage(error) {
  if (error?.apiCode === "NEO_ANIMA_MODULE_NOT_FOUND"
    || error?.apiCode === "NEO_ANIMA_MODULES_NOT_LOADED"
    || error?.apiCode === "RUNTIME_CHECKPOINT_NOT_ALLOWED"
    || error?.apiCode === "RUNTIME_CHECKPOINT_AMBIGUOUS") return error.message;
  if (error?.apiCode === "RUNTIME_TIMEOUT") return "Forge Neoへの接続がタイムアウトしました";
  return "Forge Neoへ接続できません";
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeProfiles(value) {
  if (!Array.isArray(value) || value.length === 0) throw forgeNeoConfigError();
  const profiles = value.map((item) => normalizeProfile(item));
  const ids = new Set();
  for (const profile of profiles) {
    const key = profile.id.toLowerCase();
    if (ids.has(key)) throw forgeNeoConfigError();
    ids.add(key);
  }
  for (let index = 0; index < profiles.length; index += 1) {
    for (let other = index + 1; other < profiles.length; other += 1) {
      if (sameResource(profiles[index].checkpoint, profiles[other].checkpoint)) {
        throw forgeNeoConfigError();
      }
    }
  }
  return Object.freeze(profiles.map((profile) => Object.freeze({
    ...profile,
    additionalModules: Object.freeze([...profile.additionalModules])
  })));
}

function normalizeProfile(value) {
  if (!isRecord(value)) throw forgeNeoConfigError();
  const id = normalizeProfileIdentifier(value.id);
  const checkpoint = normalizeConfiguredResource(value.checkpoint);
  const preset = normalizeProfilePreset(value.preset);
  const additionalModules = normalizeConfiguredModules(
    Object.hasOwn(value, "additionalModules") ? value.additionalModules : []
  );
  const label = normalizeProfileLabel(value.label ?? id);
  return { id, label, checkpoint, preset, additionalModules };
}

function normalizeProfileIdentifier(value) {
  if (typeof value !== "string") throw forgeNeoConfigError();
  const identifier = value.trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(identifier)) throw forgeNeoConfigError();
  return identifier;
}

function normalizeProfilePreset(value) {
  if (typeof value !== "string") throw forgeNeoConfigError();
  const preset = value.trim().toLowerCase();
  if (!ALLOWED_NEO_PRESETS.has(preset)) throw forgeNeoConfigError();
  return preset;
}

function normalizeProfileLabel(value) {
  if (typeof value !== "string") throw forgeNeoConfigError();
  const label = value.trim();
  if (!label || label.length > 160 || /[\u0000-\u001f\u007f]/.test(label)) throw forgeNeoConfigError();
  return label;
}

function normalizeConfiguredResource(value) {
  if (typeof value !== "string") throw forgeNeoConfigError();
  const resource = value.trim().replaceAll("\\", "/");
  if (!resource || resource.length > 400 || resource.startsWith("/")
    || /^[a-z]:\//i.test(resource) || resource.includes("://")
    || resource.split("/").some((part) => !part || part === "..")
    || /[\u0000-\u001f\u007f?#]/.test(resource)) {
    throw forgeNeoConfigError();
  }
  return resource;
}

function normalizeConfiguredModules(value) {
  if (!Array.isArray(value) || value.length > 8) throw forgeNeoConfigError();
  const modules = [];
  const keys = new Set();
  for (const item of value) {
    if (typeof item !== "string") throw forgeNeoConfigError();
    const module = item.trim();
    if (!/^[a-z0-9][a-z0-9._-]{0,399}$/i.test(module)) throw forgeNeoConfigError();
    const key = module.toLowerCase();
    if (keys.has(key)) throw forgeNeoConfigError();
    keys.add(key);
    modules.push(module);
  }
  return modules;
}

function forgeNeoConfigError() {
  const error = new Error("Forge NeoのProfile設定が不正です");
  error.apiCode = "FORGE_NEO_CONFIG_INVALID";
  error.statusCode = 500;
  return error;
}

function normalizeOrigin(value) {
  try {
    const url = new URL(String(value ?? ""));
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password
      || url.search || url.hash || (url.pathname !== "" && url.pathname !== "/")) return "";
    return url.origin;
  } catch {
    return "";
  }
}

function normalizeResource(value) {
  const resource = String(value ?? "").trim().replaceAll("\\", "/");
  if (!resource || resource.startsWith("/") || /^[a-z]:\//i.test(resource)
    || resource.split("/").includes("..")) return "";
  return resource.slice(0, 400);
}

function normalizeCatalogResource(value) {
  const raw = String(value ?? "").trim().replaceAll("\\", "/");
  const normalized = normalizeResource(raw);
  if (normalized) return normalized;
  const item = basename(raw);
  if (!item || item === "." || item === ".." || item.includes("..")
    || /[\u0000-\u001f\u007f]/.test(item)) return "";
  return item.slice(0, 400);
}

function normalizeNeoModelName(value) {
  if (typeof value !== "string") return "";
  const modelName = value.trim();
  if (!modelName || modelName.length > 400 || modelName.startsWith("/")
    || /^[a-z]:/i.test(modelName) || modelName.includes("\\") || modelName.includes("/")
    || modelName.includes("://") || modelName.includes("..")
    || /[\u0000-\u001f\u007f?#]/.test(modelName)) return "";
  return modelName;
}

function normalizeModules(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => basename(normalizeResource(item))).filter(Boolean))].slice(0, 8);
}

function normalizeIdentifier(value, fallback) {
  const result = String(value ?? fallback).trim();
  return /^[a-z0-9._-]{1,80}$/i.test(result) ? result : fallback;
}

function clampTimeout(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= MIN_TIMEOUT_MS && parsed <= MAX_TIMEOUT_MS
    ? parsed
    : 900_000;
}

function clampHealthTimeout(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_HEALTH_TIMEOUT_MS
    ? parsed
    : DEFAULT_HEALTH_TIMEOUT_MS;
}

function normalizeModuleCatalog(body) {
  const values = Array.isArray(body) ? body : body?.modules ?? body?.sd_modules;
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  return values.map((item) => {
    const raw = typeof item === "string"
      ? item
      : item?.name ?? item?.label ?? item?.model_name ?? item?.filename;
    const name = basename(normalizeCatalogResource(raw));
    if (name) {
      const key = name.toLowerCase();
      if (seen.has(key)) throw runtimeError("NEO_MODULE_AMBIGUOUS", "Forge Neoのmodule名が曖昧です", 503);
      seen.add(key);
    }
    return name ? { name, key: name.toLowerCase() } : null;
  }).filter(Boolean);
}

function resolveRequiredModules(modules, configuredModules) {
  const available = new Map(modules.map((item) => [item.key, item.name]));
  return configuredModules.map((module) => {
    const key = module.toLowerCase();
    const resolved = available.get(key);
    if (!resolved) {
      throw runtimeError("NEO_ANIMA_MODULE_NOT_FOUND", "Forge NeoのProfileに必要なmoduleが見つかりません", 503);
    }
    return resolved;
  });
}

function resolveCheckpointCatalog(models, configuredCheckpoint) {
  const normalized = models.map(normalizeModel).filter(Boolean);
  if (!normalized.length) {
    throw runtimeError("RUNTIME_UNAVAILABLE", "Forge NeoのCheckpoint一覧が空です", 503);
  }
  const configured = normalizeResource(configuredCheckpoint);
  const matches = normalized.filter((item) => [item.title, item.filename, item.modelName]
    .filter(Boolean)
    .some((candidate) => sameResource(candidate, configured)));
  if (matches.length > 1) {
    throw runtimeError("RUNTIME_CHECKPOINT_AMBIGUOUS", "Forge Neoの設定Checkpointが曖昧です", 503);
  }
  const target = matches[0];
  if (!target) return null;
  target.requestName = configured;
  target.publicName = safePublicResource(target.title) || safePublicResource(target.filename)
    || basename(configured);
  return target;
}

function normalizeModel(item) {
  if (!isRecord(item)) return null;
  const title = normalizeCatalogResource(item.title ?? item.model_name ?? item.name ?? "");
  const filename = normalizeCatalogResource(item.filename ?? item.path ?? "");
  const modelName = normalizeNeoModelName(item.model_name ?? item.name);
  const hash = String(item.hash ?? item.sha256 ?? "").trim().slice(0, 200);
  if (!title && !filename) return null;
  return { title, filename, modelName, hash, publicName: safePublicResource(title || filename) };
}

function publicCheckpoint(item) {
  if (!item) return null;
  return {
    title: item.publicName,
    modelName: safePublicResource(item.modelName) || item.publicName,
    filename: safePublicResource(item.filename),
    hash: item.hash
  };
}

function publicCurrentCheckpoint(options, target) {
  const current = String(options?.sd_model_checkpoint ?? "").trim();
  if (!current || !Array.isArray(target)) return "";
  return target.find((profile) => profile.checkpoint
    && !profile.moduleError
    && activationMatches(options, desiredActivation(profile)))
    ?.checkpoint.publicName ?? "";
}

function safePublicResource(value) {
  const resource = normalizeResource(value);
  return resource && !resource.includes("/") ? resource : resource ? resource : "";
}

function checkpointMatches(value, target) {
  const requested = normalizeResource(value);
  return Boolean(requested && target) && [target.requestName, target.publicName, target.filename, target.modelName]
    .filter(Boolean)
    .some((candidate) => sameResource(requested, candidate));
}

function sameResource(left, right) {
  const a = normalizeCheckpointIdentity(left);
  const b = normalizeCheckpointIdentity(right);
  return Boolean(a && b) && (a === b || basename(a).toLowerCase() === basename(b).toLowerCase());
}

function normalizeCheckpointIdentity(value) {
  return normalizeCatalogResource(value).replace(/\s+\[[0-9a-f]{4,128}\]$/i, "");
}

function basename(value) {
  const normalized = String(value ?? "").replaceAll("\\", "/").replace(/\/+$/, "");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

function selectProfile(catalog, requested) {
  const requestedValue = requested === undefined || requested === null ? "" : String(requested).trim();
  if (requestedValue) {
    const matches = catalog.profiles.filter((profile) => checkpointMatches(requestedValue, profile.checkpoint));
    if (matches.length > 1) {
      throw runtimeError("RUNTIME_CHECKPOINT_AMBIGUOUS", "Forge Neoの指定Checkpointが曖昧です", 400);
    }
    if (!matches.length) {
      throw runtimeError("RUNTIME_CHECKPOINT_NOT_ALLOWED", "Forge Neoでは指定Profile以外のCheckpointを使用できません", 400);
    }
    return matches[0];
  }
  const primary = catalog.profiles[0];
  if (!primary?.checkpoint) {
    throw runtimeError("RUNTIME_CHECKPOINT_NOT_ALLOWED", "Forge Neoの既定Profileが利用できません", 503);
  }
  return primary;
}

function assertProfileReady(profile) {
  if (!profile?.checkpoint) {
    throw runtimeError("RUNTIME_CHECKPOINT_NOT_ALLOWED", "Forge Neoの指定Profileが利用できません", 503);
  }
  if (profile.moduleError) throw profile.moduleError;
}

function desiredActivation(profile) {
  return {
    profile: profile.profile,
    checkpoint: profile.checkpoint,
    preset: profile.profile.preset,
    modules: profile.requiredModuleNames
  };
}

function activationMatches(options, desired) {
  return checkpointMatches(options?.sd_model_checkpoint, desired.checkpoint)
    && String(options?.forge_preset ?? "") === desired.preset
    && sameModuleSet(options?.forge_additional_modules, desired.modules);
}

function assertActivation(options, desired) {
  const profileName = desired.profile?.preset === "anima" ? "Anima" : "指定Profile";
  if (!checkpointMatches(options?.sd_model_checkpoint, desired.checkpoint)) {
    throw runtimeError("NEO_ANIMA_ACTIVATION_FAILED", `Forge Neoの${profileName} Checkpointが有効ではありません`, 503);
  }
  if (String(options?.forge_preset ?? "") !== desired.preset) {
    throw runtimeError("NEO_ANIMA_ACTIVATION_FAILED", `Forge Neoの${profileName} presetが有効ではありません`, 503);
  }
  if (!sameModuleSet(options?.forge_additional_modules, desired.modules)) {
    throw runtimeError("NEO_ANIMA_MODULES_NOT_LOADED", `Forge Neoの${profileName} moduleがすべて読み込まれていません`, 503);
  }
}

function sameModuleSet(current, desired) {
  const currentSet = new Set(normalizeModuleList(current).map((value) => value.toLowerCase()));
  const desiredSet = new Set(normalizeModuleList(desired).map((value) => value.toLowerCase()));
  return currentSet.size === desiredSet.size && [...desiredSet].every((value) => currentSet.has(value));
}

function normalizeModuleList(value) {
  return Array.isArray(value)
    ? value.map((item) => basename(normalizeCatalogResource(typeof item === "string" ? item : item?.name ?? item?.filename))).filter(Boolean)
    : [];
}

function normalizeNameList(value) {
  const values = Array.isArray(value) ? value : value?.samplers ?? value?.schedulers;
  return Array.isArray(values)
    ? [...new Set(values.map((item) => typeof item === "string" ? item : item?.name ?? item?.label)
      .filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()))]
    : [];
}

function normalizeLora(item) {
  if (!isRecord(item)) return null;
  return normalizeReforgeLora({
    ...item,
    name: typeof item.name === "string" ? item.name : item.alias
  });
}

function responseSeed(body, fallback) {
  let info = body?.info;
  if (typeof info === "string") {
    try { info = JSON.parse(info); } catch { info = {}; }
  }
  const candidate = info?.all_seeds?.[0] ?? info?.seed ?? body?.seed;
  return Number.isInteger(candidate) && candidate >= 0 && candidate <= 4294967295 ? candidate : fallback;
}

function stripDataUrl(value) {
  return String(value).replace(/^data:[^;]+;base64,/i, "");
}

function clampCandidateCount(value) {
  const count = Number(value);
  return Number.isInteger(count) && count >= 1 && count <= 4 ? count : 1;
}

function watchAbort(signal, callback) {
  if (!signal || typeof callback !== "function") return () => {};
  if (signal.aborted) callback();
  else signal.addEventListener("abort", callback, { once: true });
  return () => signal.removeEventListener("abort", callback);
}

function abortError() {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}
