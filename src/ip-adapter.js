export const IP_ADAPTER_FAMILY = "sdxl";
export const IP_ADAPTER_MODULE = "CLIP-ViT-H (IPAdapter)";
export const IP_ADAPTER_MODEL_BASENAME = "ip-adapter-plus_sdxl_vit-h";
export const IP_ADAPTER_DEFAULT_WEIGHT = 0.65;
export const IP_ADAPTER_DEFAULT_START = 0;
export const IP_ADAPTER_DEFAULT_END = 1;

const IMAGE_ID_PATTERN = /^[a-z0-9-]{8,80}$/i;
const REFERENCE_URL_PATTERN = /^\/outputs\/ip-adapter-reference_[a-f0-9]{20}\.(?:png|jpg|webp)$/i;
const IMAGE_DATA_URL_PATTERN = /^data:image\/(png|jpe?g|webp);base64,([a-z0-9+/]+={0,2})$/i;

export function validateIpAdapter(input) {
  if (input === undefined || input === null) return null;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("IP-Adapter設定が不正です");
  }
  if (input.enabled !== true && input.enabled !== false) {
    throw new Error("IP-Adapterの有効状態が不正です");
  }
  if (input.enabled !== true) return null;

  const referenceKeys = ["referenceImageId", "referenceImage", "referenceImageUrl"]
    .filter((key) => input[key] !== undefined && input[key] !== null && input[key] !== "");
  if (referenceKeys.length !== 1) {
    throw new Error("IP-Adapter参照画像を1つ選択してください");
  }

  const weight = boundedNumber(input.weight, IP_ADAPTER_DEFAULT_WEIGHT, 0, 2, "Weight");
  const guidanceStart = boundedNumber(input.guidanceStart, IP_ADAPTER_DEFAULT_START, 0, 1, "Start");
  const guidanceEnd = boundedNumber(input.guidanceEnd, IP_ADAPTER_DEFAULT_END, 0, 1, "End");
  if (guidanceStart >= guidanceEnd) {
    throw new Error("IP-AdapterのStartはEndより小さくしてください");
  }

  const referenceKey = referenceKeys[0];
  const referenceValue = String(input[referenceKey]);
  if (referenceKey === "referenceImageId" && !IMAGE_ID_PATTERN.test(referenceValue)) {
    throw new Error("IP-Adapter参照画像IDが不正です");
  }
  if (referenceKey === "referenceImageUrl" && !REFERENCE_URL_PATTERN.test(referenceValue)) {
    throw new Error("IP-Adapter参照画像URLが不正です");
  }
  if (referenceKey === "referenceImage" && !IMAGE_DATA_URL_PATTERN.test(referenceValue)) {
    throw new Error("IP-Adapter参照画像はPNG・JPEG・WebPを選択してください");
  }

  return {
    enabled: true,
    family: normalizeLabel(input.family, IP_ADAPTER_FAMILY, 40),
    module: normalizeLabel(input.module, IP_ADAPTER_MODULE, 160),
    model: normalizeLabel(input.model, "", 240),
    weight,
    guidanceStart,
    guidanceEnd,
    [referenceKey]: referenceValue
  };
}

// 履歴へ保存する値は、生成入力全体から分離した安全なメタデータだけに限定する。
// data URL、Buffer、ローカルパス、未知の追加キーはここで落とす。
export function normalizeIpAdapter(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || input.enabled !== true) {
    return null;
  }

  const referenceImageId = IMAGE_ID_PATTERN.test(String(input.referenceImageId ?? ""))
    ? String(input.referenceImageId)
    : "";
  const referenceImageUrl = REFERENCE_URL_PATTERN.test(String(input.referenceImageUrl ?? ""))
    ? String(input.referenceImageUrl)
    : "";
  if (!referenceImageId && !referenceImageUrl) return null;
  const weight = normalizedNumber(input.weight, IP_ADAPTER_DEFAULT_WEIGHT, 0, 2);
  const guidanceStart = normalizedNumber(input.guidanceStart, IP_ADAPTER_DEFAULT_START, 0, 1);
  const guidanceEnd = normalizedNumber(input.guidanceEnd, IP_ADAPTER_DEFAULT_END, 0, 1);
  if (weight === null || guidanceStart === null || guidanceEnd === null || guidanceStart >= guidanceEnd) {
    return null;
  }

  const result = {
    enabled: true,
    family: normalizeLabel(input.family, IP_ADAPTER_FAMILY, 40),
    module: normalizeLabel(input.module, IP_ADAPTER_MODULE, 160),
    model: normalizeLabel(input.model, "", 240),
    weight,
    guidanceStart,
    guidanceEnd
  };
  // 同時に入っていても、履歴には安全なIDを優先して一方だけを保存する。
  if (referenceImageId) result.referenceImageId = referenceImageId;
  else result.referenceImageUrl = referenceImageUrl;
  return result;
}

export function selectIpAdapterCapability({ moduleNames = [], modelNames = [], checkpoint = "" } = {}) {
  const family = classifyCheckpointFamily(checkpoint);
  const module = moduleNames
    .map((value) => String(value ?? "").trim())
    .find((value) => value === IP_ADAPTER_MODULE) ?? null;
  const model = modelNames
    .map((value) => String(value ?? "").trim())
    .find((value) => modelBasename(value) === IP_ADAPTER_MODEL_BASENAME) ?? null;

  if (family !== IP_ADAPTER_FAMILY) {
    return unavailableCapability(family, module, model, "現在のCheckpointではSDXL用IP-Adapterを利用できません");
  }
  if (!module) {
    return unavailableCapability(family, null, model, "ReForgeにIP-Adapterモジュールがありません");
  }
  if (!model) {
    return unavailableCapability(family, module, null, "ReForgeにIP-Adapterモデルがありません");
  }
  return {
    available: true,
    family,
    module,
    model,
    message: "利用できます"
  };
}

export function unavailableIpAdapterCapability(message = "IP-Adapterを利用できません") {
  return {
    available: false,
    family: null,
    module: null,
    model: null,
    message
  };
}

export function modelBasename(value) {
  let name = String(value ?? "").trim().replaceAll("\\", "/").split("/").pop() ?? "";
  name = name.replace(/\s*(?:\[[^\]]*\]|\([^)]*\))\s*$/g, "").trim();
  name = name.replace(/\.(?:safetensors|ckpt|pt)$/i, "");
  return name;
}

export function classifyCheckpointFamily(value) {
  const name = String(value ?? "").toLowerCase();
  if (/(?:sd[_ .-]?1[._-]?5|sd15|v1[-_]?5)/i.test(name)) return "sd15";
  if (/(?:sdxl|illustrious|noobai|pony|animagine|juggernaut.*xl|xl)/i.test(name)) return IP_ADAPTER_FAMILY;
  return "unknown";
}

export function buildIpAdapterControlNetUnit({
  referenceBase64,
  module = IP_ADAPTER_MODULE,
  model,
  weight = IP_ADAPTER_DEFAULT_WEIGHT,
  guidanceStart = IP_ADAPTER_DEFAULT_START,
  guidanceEnd = IP_ADAPTER_DEFAULT_END
} = {}) {
  const image = stripImageDataUrl(referenceBase64);
  if (!image) throw new Error("IP-Adapter参照画像を解決できませんでした");
  return {
    enabled: true,
    image,
    module,
    model,
    weight,
    resize_mode: "Crop and Resize",
    guidance_start: guidanceStart,
    guidance_end: guidanceEnd,
    pixel_perfect: false,
    processor_res: -1,
    threshold_a: -1,
    threshold_b: -1,
    control_mode: "Balanced",
    save_detected_map: false
  };
}

export function mergeIpAdapterPayload(payload, ipAdapter) {
  if (!ipAdapter?.enabled) return payload;
  const unit = buildIpAdapterControlNetUnit(ipAdapter);
  const scripts = payload?.alwayson_scripts && typeof payload.alwayson_scripts === "object"
    ? payload.alwayson_scripts
    : {};
  const existing = scripts.ControlNet && typeof scripts.ControlNet === "object"
    ? scripts.ControlNet
    : {};
  const existingArgs = Array.isArray(existing.args) ? existing.args : [];
  return {
    ...payload,
    alwayson_scripts: {
      ...scripts,
      ControlNet: {
        ...existing,
        args: [...existingArgs, unit]
      }
    }
  };
}

export function stripImageDataUrl(value) {
  const text = String(value ?? "").trim();
  const matched = text.match(IMAGE_DATA_URL_PATTERN);
  return matched ? matched[2] : text;
}

export function isSafeIpAdapterReferenceUrl(value) {
  return REFERENCE_URL_PATTERN.test(String(value ?? ""));
}

export function ipAdapterReferenceFilename(value) {
  const text = String(value ?? "");
  if (!isSafeIpAdapterReferenceUrl(text)) throw new Error("IP-Adapter参照画像URLが不正です");
  return text.slice("/outputs/".length);
}

function unavailableCapability(family, module, model, message) {
  return { available: false, family, module, model, message };
}

function boundedNumber(value, fallback, minimum, maximum, label) {
  const candidate = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(candidate) || candidate < minimum || candidate > maximum) {
    throw new Error(`IP-Adapterの${label}は${minimum}〜${maximum}で指定してください`);
  }
  return candidate;
}

function normalizedNumber(value, fallback, minimum, maximum) {
  const candidate = value === undefined ? fallback : Number(value);
  return Number.isFinite(candidate) && candidate >= minimum && candidate <= maximum
    ? candidate
    : null;
}

function normalizeLabel(value, fallback, maximumLength) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().slice(0, maximumLength);
  if (/^(?:[a-z]:[\\/]|[\\/]{1,2}|file:)/i.test(normalized) || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(normalized)) {
    return fallback;
  }
  return normalized || fallback;
}
