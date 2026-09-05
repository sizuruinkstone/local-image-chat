const DEFAULT_BASE_URL = "http://127.0.0.1:3030";
const DEFAULT_TIMEOUT_MS = 10_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_TEXT_LENGTH = 16 * 1024 * 1024;
const MAX_ERROR_TEXT_LENGTH = 64 * 1024;
const MAX_MCP_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_REFERENCE_ASSET_BYTES = 12 * 1024 * 1024;
const REFERENCE_ASSET_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const JOB_STATUSES = new Set(["queued", "running", "done", "failed", "cancelled"]);
const CONNECTION_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH"
]);

export class LocalImageChatError extends Error {
  constructor(code, message, status = null) {
    super(message);
    this.name = "LocalImageChatError";
    this.code = code;
    this.status = Number.isInteger(status) ? status : null;
  }
}

export function normalizeBaseUrl(value = DEFAULT_BASE_URL) {
  if (typeof value !== "string" || !value.trim()) {
    throw new LocalImageChatError(
      "LOCAL_IMAGE_CHAT_INVALID_CONFIG",
      "Local Image Chatの接続先URLが未指定です"
    );
  }

  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new LocalImageChatError(
      "LOCAL_IMAGE_CHAT_INVALID_CONFIG",
      "Local Image Chatの接続先URLが不正です"
    );
  }
  if (!["http:", "https:"].includes(parsed.protocol)
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || (parsed.pathname !== "" && parsed.pathname !== "/")) {
    throw new LocalImageChatError(
      "LOCAL_IMAGE_CHAT_INVALID_CONFIG",
      "Local Image Chatの接続先URLは認証情報、query、hash、追加pathを含めないHTTP URLで指定してください"
    );
  }
  return parsed.origin;
}

export function resolveTimeoutMs(value, fallback = DEFAULT_TIMEOUT_MS) {
  const fallbackValue = validTimeout(fallback) ? fallback : DEFAULT_TIMEOUT_MS;
  if (value === undefined || value === null || value === "") return fallbackValue;
  const parsed = Number(value);
  return validTimeout(parsed) ? parsed : fallbackValue;
}

export function createLocalImageChatClient(options = {}) {
  const environment = options.env ?? process.env;
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? environment.LOCAL_IMAGE_CHAT_URL ?? DEFAULT_BASE_URL);
  const timeoutMs = resolveTimeoutMs(
    options.timeoutMs ?? environment.LOCAL_IMAGE_CHAT_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS
  );
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new LocalImageChatError(
      "LOCAL_IMAGE_CHAT_INVALID_CONFIG",
      "HTTP fetchが利用できません"
    );
  }

  async function requestJson(pathname, {
    method = "GET",
    body,
    query,
    rawBody,
    contentType
  } = {}) {
    const url = buildApiUrl(baseUrl, pathname, query);
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    timer.unref?.();

    try {
      const headers = { Accept: "application/json" };
      const requestOptions = {
        method,
        headers,
        redirect: "error",
        signal: controller.signal
      };
      if (rawBody !== undefined) {
        const bytes = toUint8Array(rawBody);
        if (!bytes || !REFERENCE_ASSET_MIME_TYPES.has(normalizeContentType(contentType))) {
          throw new LocalImageChatError(
            "INVALID_REQUEST",
            "参照画像のraw bytesまたはMIME typeが不正です",
            400
          );
        }
        if (bytes.byteLength === 0 || bytes.byteLength > MAX_REFERENCE_ASSET_BYTES) {
          throw new LocalImageChatError(
            "ASSET_TOO_LARGE",
            "参照画像は12MiB以下にしてください",
            413
          );
        }
        headers["Content-Type"] = normalizeContentType(contentType);
        requestOptions.body = Buffer.from(bytes);
      } else if (body !== undefined) {
        headers["Content-Type"] = "application/json";
        try {
          requestOptions.body = JSON.stringify(body);
        } catch {
          throw new LocalImageChatError(
            "LOCAL_IMAGE_CHAT_REQUEST_FAILED",
            "Backendリクエストを作成できません"
          );
        }
      }

      const response = await fetchImpl(url, requestOptions);
      verifyResponseOrigin(response, baseUrl);
      if (response.status >= 300 && response.status < 400) {
        throw new LocalImageChatError(
          "LOCAL_IMAGE_CHAT_REQUEST_FAILED",
          "Backendへのリダイレクトは許可されていません",
          response.status
        );
      }

      const text = await readResponseText(
        response,
        response.ok ? MAX_RESPONSE_TEXT_LENGTH : MAX_ERROR_TEXT_LENGTH,
        controller.signal
      );
      if (!response.ok) throw createApiError(response.status, text);

      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        throw invalidResponseError();
      }
      return payload;
    } catch (error) {
      if (timedOut || error?.name === "AbortError") {
        throw timeoutError();
      }
      if (error instanceof LocalImageChatError) throw error;
      if (isConnectionFailure(error)) {
        throw new LocalImageChatError(
          "LOCAL_IMAGE_CHAT_UNAVAILABLE",
          "Local Image Chat Backendへ接続できません"
        );
      }
      throw new LocalImageChatError(
        "LOCAL_IMAGE_CHAT_REQUEST_FAILED",
        "Local Image ChatへのHTTP requestに失敗しました"
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async function requestImage(imageId) {
    const url = buildImageUrl(baseUrl, imageId);
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    timer.unref?.();

    try {
      const response = await fetchImpl(url, {
        method: "GET",
        headers: { Accept: "image/webp" },
        redirect: "error",
        signal: controller.signal
      });
      verifyResponseOrigin(response, baseUrl, { requireUrl: true });
      if (response.status >= 300 && response.status < 400) {
        throw new LocalImageChatError(
          "LOCAL_IMAGE_CHAT_REQUEST_FAILED",
          "Backendへのリダイレクトは許可されていません",
          response.status
        );
      }
      if (response.status !== 200) {
        const text = await readResponseText(response, MAX_ERROR_TEXT_LENGTH, controller.signal);
        throw createApiError(response.status, text);
      }
      if (normalizeContentType(getResponseHeader(response, "content-type")) !== "image/webp") {
        throw invalidResponseError();
      }

      const bytes = await readResponseBytes(response, MAX_MCP_IMAGE_BYTES, controller.signal);
      if (bytes.byteLength === 0 || !isWebpBytes(bytes)) throw invalidResponseError();
      return {
        imageId,
        variant: "thumbnail",
        mimeType: "image/webp",
        byteLength: bytes.byteLength,
        bytes
      };
    } catch (error) {
      if (timedOut || error?.name === "AbortError") {
        throw timeoutError();
      }
      if (error instanceof LocalImageChatError) throw error;
      if (isConnectionFailure(error)) {
        throw new LocalImageChatError(
          "LOCAL_IMAGE_CHAT_UNAVAILABLE",
          "Local Image Chat Backendへ接続できません"
        );
      }
      throw new LocalImageChatError(
        "LOCAL_IMAGE_CHAT_REQUEST_FAILED",
        "Local Image Chatへの画像HTTP requestに失敗しました"
      );
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    baseUrl,
    timeoutMs,

    async getCapabilities(runtimeId) {
      const query = new URLSearchParams();
      if (runtimeId !== undefined && runtimeId !== null && runtimeId !== "") {
        if (!isSafeRuntimeId(runtimeId)) {
          throw new LocalImageChatError("INVALID_REQUEST", "runtimeIdが不正です", 400);
        }
        query.set("runtimeId", runtimeId);
      }
      const payload = await requestJson("/api/v1/capabilities", { query });
      return validateCapabilities(payload);
    },

    async createGeneration(request) {
      const payload = await requestJson("/api/v1/generations", {
        method: "POST",
        body: request
      });
      if (!isRecord(payload) || typeof payload.id !== "string" || payload.status !== "queued") {
        throw invalidResponseError();
      }
      return payload;
    },

    async getGeneration(id) {
      const payload = await requestJson(`/api/v1/generations/${encodeURIComponent(requireJobId(id))}`);
      return mapJobPayload(validateJobPayload(payload), baseUrl);
    },

    async cancelGeneration(id) {
      const payload = await requestJson(`/api/v1/generations/${encodeURIComponent(requireJobId(id))}/cancel`, {
        method: "POST"
      });
      return mapJobPayload(validateJobPayload(payload), baseUrl);
    },

    async getHistory({ limit, cursor, favorites, rating } = {}) {
      const query = new URLSearchParams();
      if (limit !== undefined) query.set("limit", String(limit));
      if (cursor !== undefined) query.set("cursor", cursor);
      if (favorites === true) query.set("favorites", "1");
      if (rating !== undefined) query.set("rating", requireHistoryRating(rating));
      const payload = await requestJson("/api/v1/history", { query });
      return mapHistoryPayload(validateHistoryPayload(payload), baseUrl);
    },

    async getImage(imageId) {
      return requestImage(requireImageId(imageId));
    },

    async importReferenceImage({ bytes, mimeType } = {}) {
      const rawBytes = toUint8Array(bytes);
      const normalizedMimeType = normalizeContentType(mimeType);
      if (!rawBytes || !REFERENCE_ASSET_MIME_TYPES.has(normalizedMimeType)) {
        throw new LocalImageChatError(
          "INVALID_REQUEST",
          "参照画像のraw bytesまたはMIME typeが不正です",
          400
        );
      }
      if (rawBytes.byteLength === 0 || rawBytes.byteLength > MAX_REFERENCE_ASSET_BYTES) {
        throw new LocalImageChatError(
          "ASSET_TOO_LARGE",
          "参照画像は12MiB以下にしてください",
          413
        );
      }
      const payload = await requestJson("/api/v1/assets/images", {
        method: "POST",
        rawBody: rawBytes,
        contentType: normalizedMimeType
      });
      return mapReferenceAssetPayload(validateReferenceAssetPayload(payload), baseUrl);
    },

    async getHistoryItem(id) {
      const payload = await requestJson(`/api/v1/history/${encodeURIComponent(requireHistoryId(id))}`);
      return mapHistoryItemPayload(validateHistoryItemPayload(payload), baseUrl);
    },

    async createRegeneration(historyId, request = {}) {
      if (!isRecord(request)) {
        throw new LocalImageChatError("INVALID_REQUEST", "再生成requestが不正です", 400);
      }
      const body = { ...request };
      delete body.historyId;
      delete body.metadata;
      const payload = await requestJson(
        `/api/v1/history/${encodeURIComponent(requireHistoryId(historyId))}/regenerations`,
        {
          method: "POST",
          body: { ...body, metadata: { client: "mcp" } }
        }
      );
      if (!isRecord(payload) || typeof payload.id !== "string" || payload.status !== "queued") {
        throw invalidResponseError();
      }
      return { id: payload.id, status: "queued" };
    }
  };
}

function buildApiUrl(baseUrl, pathname, query) {
  if (typeof pathname !== "string" || !pathname.startsWith("/api/v1/")) {
    throw new LocalImageChatError(
      "LOCAL_IMAGE_CHAT_INVALID_CONFIG",
      "MCPから呼び出せるBackend API pathが不正です"
    );
  }
  const url = new URL(pathname, `${baseUrl}/`);
  if (url.origin !== baseUrl) {
    throw new LocalImageChatError(
      "LOCAL_IMAGE_CHAT_INVALID_CONFIG",
      "Backend APIのoriginが不正です"
    );
  }
  if (query && query.toString()) url.search = query.toString();
  return url;
}

function buildImageUrl(baseUrl, imageId) {
  const url = new URL(
    `/api/images/${encodeURIComponent(requireImageId(imageId))}/thumbnail`,
    `${baseUrl}/`
  );
  if (url.origin !== baseUrl || url.search || url.hash) {
    throw new LocalImageChatError(
      "LOCAL_IMAGE_CHAT_INVALID_CONFIG",
      "画像取得先のBackend originが不正です"
    );
  }
  return url;
}

async function readResponseText(response, maximum, signal) {
  let abortHandler;
  let abortPromise;
  if (signal) {
    abortPromise = new Promise((_resolve, reject) => {
      abortHandler = () => reject(createAbortError());
      if (signal.aborted) {
        abortHandler();
      } else {
        signal.addEventListener("abort", abortHandler, { once: true });
      }
    });
  }

  try {
    const bodyPromise = Promise.resolve().then(async () => {
      if (typeof response?.text === "function") return response.text();
      const value = await response.json();
      return JSON.stringify(value);
    });
    const text = abortPromise
      ? await Promise.race([bodyPromise, abortPromise])
      : await bodyPromise;
    if (typeof text !== "string" || text.length > maximum) throw new Error("response too large");
    return text;
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw invalidResponseError();
  } finally {
    if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
  }
}

async function readResponseBytes(response, maximum, signal) {
  const declaredLength = getContentLength(response);
  if (declaredLength !== null && declaredLength > maximum) throw imagePayloadTooLargeError();

  const reader = response?.body?.getReader?.();
  if (!reader) throw invalidResponseError();

  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const result = await awaitWithAbort(reader.read(), signal);
      if (!result || typeof result.done !== "boolean") throw invalidResponseError();
      if (result.done) break;
      const chunk = toUint8Array(result.value);
      if (!chunk) throw invalidResponseError();
      total += chunk.byteLength;
      if (total > maximum) throw imagePayloadTooLargeError();
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof LocalImageChatError || error?.name === "AbortError") throw error;
    throw invalidResponseError();
  } finally {
    try {
      await reader.cancel?.();
    } catch {
      // The response is already being discarded.
    }
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

async function awaitWithAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) throw createAbortError();
  let abortHandler;
  const abortPromise = new Promise((_resolve, reject) => {
    abortHandler = () => reject(createAbortError());
    signal.addEventListener("abort", abortHandler, { once: true });
  });
  try {
    return await Promise.race([promise, abortPromise]);
  } finally {
    signal.removeEventListener("abort", abortHandler);
  }
}

function getContentLength(response) {
  const value = getResponseHeader(response, "content-length");
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function getResponseHeader(response, name) {
  return typeof response?.headers?.get === "function" ? response.headers.get(name) : null;
}

function normalizeContentType(value) {
  return typeof value === "string" ? value.split(";", 1)[0].trim().toLowerCase() : "";
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
}

function isWebpBytes(bytes) {
  return bytes.byteLength >= 12
    && bytes[0] === 0x52
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x46
    && bytes[8] === 0x57
    && bytes[9] === 0x45
    && bytes[10] === 0x42
    && bytes[11] === 0x50;
}

function verifyResponseOrigin(response, baseUrl, { requireUrl = false } = {}) {
  if (!response?.url) {
    if (!requireUrl) return;
    throw new LocalImageChatError(
      "LOCAL_IMAGE_CHAT_INVALID_RESPONSE",
      "Backend responseのURLがありません"
    );
  }
  let responseUrl;
  try {
    responseUrl = new URL(response.url);
  } catch {
    throw new LocalImageChatError(
      "LOCAL_IMAGE_CHAT_INVALID_RESPONSE",
      "Backend responseのURLが不正です"
    );
  }
  if (responseUrl.origin !== baseUrl || !["http:", "https:"].includes(responseUrl.protocol)) {
    throw new LocalImageChatError(
      "LOCAL_IMAGE_CHAT_REQUEST_FAILED",
      "Backendへの別origin redirectは許可されていません"
    );
  }
}

function createApiError(status, text) {
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    // The response body is intentionally not returned to the MCP Host.
  }
  const apiError = isRecord(payload?.error) ? payload.error : null;
  const code = safeErrorCode(apiError?.code)
    ?? (status >= 500 ? "INTERNAL_ERROR" : status === 404 ? "NOT_FOUND" : "LOCAL_IMAGE_CHAT_REQUEST_FAILED");
  const message = status >= 500
    ? "Local Image Chat Backendの処理に失敗しました"
    : safeMessage(apiError?.message) ?? "Local Image Chat Backend requestに失敗しました";
  return new LocalImageChatError(code, message, status);
}

function validateCapabilities(payload) {
  if (!isRecord(payload)
    || !Array.isArray(payload.checkpoints)
    || !Array.isArray(payload.samplers)
    || !Array.isArray(payload.schedulers)
    || !Array.isArray(payload.loras)
    || !isRecord(payload.defaults)) {
    throw invalidResponseError();
  }
  return payload;
}

function validateJobPayload(payload) {
  if (!isRecord(payload)
    || typeof payload.id !== "string"
    || !JOB_STATUSES.has(payload.status)
    || typeof payload.progress !== "number"
    || !Number.isFinite(payload.progress)
    || payload.progress < 0
    || payload.progress > 1) {
    throw invalidResponseError();
  }
  if (payload.result !== undefined
    && (!isRecord(payload.result) || !Array.isArray(payload.result.images))) {
    throw invalidResponseError();
  }
  return payload;
}

function validateHistoryPayload(payload) {
  if (!isRecord(payload) || !Array.isArray(payload.generations)) throw invalidResponseError();
  for (const generation of payload.generations) {
    if (isRecord(generation) && generation.contentRating === undefined) generation.contentRating = "unrated";
  }
  if (payload.nextCursor !== undefined
    && payload.nextCursor !== null
    && typeof payload.nextCursor !== "string") {
    throw invalidResponseError();
  }
  if (payload.hasMore !== undefined && typeof payload.hasMore !== "boolean") {
    throw invalidResponseError();
  }
  if (payload.generations.some((generation) => !isRecord(generation)
    || !isHistoryContentRating(generation.contentRating))) throw invalidResponseError();
  return payload;
}

function validateHistoryItemPayload(payload) {
  if (isRecord(payload) && payload.contentRating === undefined) payload.contentRating = "unrated";
  if (!isRecord(payload)
    || typeof payload.id !== "string"
    || !isSafeId(payload.id)
    || !isRecord(payload.prompt)
    || !isRecord(payload.settings)
    || !Array.isArray(payload.loras)
    || !Array.isArray(payload.images)) {
    throw invalidResponseError();
  }
  if (!isHistoryContentRating(payload.contentRating)) throw invalidResponseError();
  for (const key of ["rawPrompt", "effectivePrompt", "negativePrompt"]) {
    if (payload.prompt[key] !== undefined && typeof payload.prompt[key] !== "string") {
      throw invalidResponseError();
    }
  }
  if (Object.hasOwn(payload.prompt, "rawOverride")) {
    throw invalidResponseError();
  }
  if (payload.prompt.rawPromptOverride !== undefined && typeof payload.prompt.rawPromptOverride !== "boolean") {
    throw invalidResponseError();
  }
  if (payload.prompt.structured !== null && payload.prompt.structured !== undefined
    && !isRecord(payload.prompt.structured)) {
    throw invalidResponseError();
  }
  if (payload.loras.some((lora) => !isRecord(lora) || typeof lora.name !== "string")) {
    throw invalidResponseError();
  }
  if (payload.images.some((image) => !isRecord(image) || typeof image.id !== "string" || !isSafeId(image.id))) {
    throw invalidResponseError();
  }
  validateIpAdapterPayload(payload.ipAdapter);
  validateRuntimePayload(payload.runtime);
  if (payload.derivation !== null && payload.derivation !== undefined && !isRecord(payload.derivation)) {
    throw invalidResponseError();
  }
  return payload;
}

function isHistoryContentRating(value) {
  return ["general", "nsfw", "unrated"].includes(value);
}

function requireHistoryRating(value) {
  if (!["all", "general", "nsfw", "unrated"].includes(value)) {
    throw new LocalImageChatError("INVALID_REQUEST", "ratingが不正です", 400);
  }
  return value;
}

function validateRuntimePayload(value) {
  if (value === undefined || value === null) return;
  if (!isRecord(value)
    || Object.keys(value).sort().join(",") !== "id,provider"
    || !isSafeRuntimeId(value.id)
    || !isSafeRuntimeId(value.provider)) {
    throw invalidResponseError();
  }
}

function validateReferenceAssetPayload(payload) {
  const expectedKeys = [
    "byteLength", "createdAt", "height", "id", "kind", "mimeType",
    "originalUrl", "thumbnailUrl", "width"
  ];
  if (!isRecord(payload)
    || Object.keys(payload).sort().join(",") !== expectedKeys.join(",")
    || typeof payload.id !== "string"
    || !isSafeId(payload.id)
    || !payload.id.toLowerCase().startsWith("asset-")
    || payload.kind !== "reference-asset"
    || !REFERENCE_ASSET_MIME_TYPES.has(payload.mimeType)
    || !Number.isInteger(payload.width) || payload.width < 1 || payload.width > 8192
    || !Number.isInteger(payload.height) || payload.height < 1 || payload.height > 8192
    || !Number.isSafeInteger(payload.byteLength) || payload.byteLength <= 0
    || typeof payload.createdAt !== "string"
    || typeof payload.originalUrl !== "string"
    || typeof payload.thumbnailUrl !== "string") {
    throw invalidResponseError();
  }
  return payload;
}

function validateIpAdapterPayload(value) {
  if (value === undefined || value === null) return;
  if (!isRecord(value)) throw invalidResponseError();
  const keys = Object.keys(value).sort();
  if (keys.join(",") !== "guidanceEnd,guidanceStart,referenceImageId,weight") {
    throw invalidResponseError();
  }
  if (!isSafeId(value.referenceImageId)
    || typeof value.weight !== "number"
    || !Number.isFinite(value.weight)
    || value.weight < 0
    || value.weight > 2
    || typeof value.guidanceStart !== "number"
    || !Number.isFinite(value.guidanceStart)
    || value.guidanceStart < 0
    || value.guidanceStart > 1
    || typeof value.guidanceEnd !== "number"
    || !Number.isFinite(value.guidanceEnd)
    || value.guidanceEnd < 0
    || value.guidanceEnd > 1
    || value.guidanceStart >= value.guidanceEnd) {
    throw invalidResponseError();
  }
}

function mapJobPayload(payload, baseUrl) {
  if (!payload.result) return payload;
  return {
    ...payload,
    result: {
      ...payload.result,
      images: mapImages(payload.result.images, baseUrl)
    }
  };
}

function mapHistoryPayload(payload, baseUrl) {
  return {
    ...payload,
    generations: payload.generations.map((generation) => {
      if (!Array.isArray(generation.images)) return generation;
      return {
        ...generation,
        images: mapImages(generation.images, baseUrl)
      };
    })
  };
}

function mapHistoryItemPayload(payload, baseUrl) {
  return {
    ...payload,
    images: mapImages(payload.images, baseUrl)
  };
}

function mapReferenceAssetPayload(payload, baseUrl) {
  const id = encodeURIComponent(payload.id);
  const originalUrl = normalizeImageUrl(payload.originalUrl, baseUrl);
  const thumbnailUrl = normalizeImageUrl(payload.thumbnailUrl, baseUrl);
  const originalPath = `/api/images/${id}/original`;
  const thumbnailPath = `/api/images/${id}/thumbnail`;
  if (!matchesFixedImagePath(originalUrl, originalPath)
    || !matchesFixedImagePath(thumbnailUrl, thumbnailPath)) {
    throw invalidResponseError();
  }
  return {
    ...payload,
    originalUrl,
    thumbnailUrl
  };
}

function matchesFixedImagePath(value, expectedPath) {
  try {
    const url = new URL(value);
    return url.pathname === expectedPath && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function mapImages(images, baseUrl) {
  return images.map((image) => {
    if (!isRecord(image) || typeof image.id !== "string" || !isSafeId(image.id)) throw invalidResponseError();
    const mapped = { ...image };
    for (const field of ["originalUrl", "thumbnailUrl"]) {
      if (Object.hasOwn(image, field)) {
        if (typeof image[field] !== "string") throw invalidResponseError();
        mapped[field] = normalizeImageUrl(image[field], baseUrl);
      }
    }
    return mapped;
  });
}

function normalizeImageUrl(value, baseUrl) {
  if (!value.trim() || value.startsWith("//") || /^(?:data|file):/i.test(value)) throw invalidResponseError();
  let url;
  try {
    url = new URL(value, `${baseUrl}/`);
  } catch {
    throw invalidResponseError();
  }
  if (!["http:", "https:"].includes(url.protocol)
    || url.origin !== baseUrl
    || url.username
    || url.password) {
    throw invalidResponseError();
  }
  return url.href;
}

function requireJobId(value) {
  const id = typeof value === "string" ? value : "";
  if (!/^[A-Za-z0-9-]{8,80}$/.test(id)) {
    throw new LocalImageChatError("INVALID_REQUEST", "Job IDが不正です", 400);
  }
  return id;
}

function requireHistoryId(value) {
  const id = typeof value === "string" ? value : "";
  if (!isSafeId(id)) {
    throw new LocalImageChatError("INVALID_REQUEST", "History IDが不正です", 400);
  }
  return id;
}

function requireImageId(value) {
  const id = typeof value === "string" ? value : "";
  if (!isSafeId(id)) {
    throw new LocalImageChatError("INVALID_REQUEST", "Image IDが不正です", 400);
  }
  return id;
}

function isSafeId(value) {
  return typeof value === "string" && /^[A-Za-z0-9-]{8,80}$/.test(value);
}

function isSafeRuntimeId(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value);
}

function validTimeout(value) {
  return Number.isInteger(value) && value >= MIN_TIMEOUT_MS && value <= MAX_TIMEOUT_MS;
}

function isConnectionFailure(error) {
  return CONNECTION_ERROR_CODES.has(error?.code) || CONNECTION_ERROR_CODES.has(error?.cause?.code);
}

function invalidResponseError() {
  return new LocalImageChatError(
    "LOCAL_IMAGE_CHAT_INVALID_RESPONSE",
    "Local Image Chat Backendのresponseが不正です"
  );
}

function timeoutError() {
  return new LocalImageChatError(
    "LOCAL_IMAGE_CHAT_TIMEOUT",
    "Local Image ChatへのHTTP requestがタイムアウトしました"
  );
}

function imagePayloadTooLargeError() {
  return new LocalImageChatError(
    "LOCAL_IMAGE_CHAT_PAYLOAD_TOO_LARGE",
    "画像データが大きすぎます",
    413
  );
}

function createAbortError() {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

function safeErrorCode(value) {
  if (typeof value !== "string") return null;
  const code = value.trim();
  return /^[A-Z][A-Z0-9_]{0,79}$/.test(code) ? code : null;
}

function safeMessage(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, 500);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export const MCP_DEFAULT_BASE_URL = DEFAULT_BASE_URL;
export const MCP_DEFAULT_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;
