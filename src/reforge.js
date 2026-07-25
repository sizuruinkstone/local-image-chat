export async function checkReforge(config) {
  const response = await fetch(`${config.url}/sdapi/v1/options`, {
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new Error(`ReForge HTTP ${response.status}`);
  const body = await response.json();
  return { ok: true, checkpoint: body.sd_model_checkpoint ?? "不明" };
}

export async function listCheckpoints(config) {
  const [modelsResponse, optionsResponse] = await Promise.all([
    fetch(`${config.url}/sdapi/v1/sd-models`, {
      signal: AbortSignal.timeout(15000)
    }),
    fetch(`${config.url}/sdapi/v1/options`, {
      signal: AbortSignal.timeout(15000)
    })
  ]);
  if (!modelsResponse.ok) throw new Error(`ReForge Checkpoint一覧 HTTP ${modelsResponse.status}`);
  if (!optionsResponse.ok) throw new Error(`ReForge 設定取得 HTTP ${optionsResponse.status}`);

  const [models, options] = await Promise.all([
    modelsResponse.json(),
    optionsResponse.json()
  ]);
  if (!Array.isArray(models)) throw new Error("ReForgeからCheckpoint一覧が返りませんでした");

  return {
    checkpoints: models
      .map((item) => normalizeCheckpoint(item))
      .filter(Boolean)
      .sort((left, right) => left.title.localeCompare(right.title, "ja", { numeric: true })),
    activeCheckpoint: String(options.sd_model_checkpoint ?? "")
  };
}

export async function switchCheckpoint(config, checkpoint) {
  const selected = String(checkpoint ?? "").trim();
  if (!selected) throw new Error("Checkpointを選択してください");

  const response = await fetch(`${config.url}/sdapi/v1/options`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sd_model_checkpoint: selected }),
    signal: AbortSignal.timeout(Math.max(300000, config.timeoutMs ?? 0))
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`ReForge Checkpoint切替 HTTP ${response.status}: ${detail.slice(0, 300)}`);
  }

  const current = await checkReforge({
    ...config,
    timeoutMs: Math.max(300000, config.timeoutMs ?? 0)
  });
  return { checkpoint: current.checkpoint };
}

export function normalizeCheckpoint(item) {
  if (!item || typeof item !== "object") return null;
  const title = String(item.title ?? item.model_name ?? "").trim();
  if (!title) return null;
  return {
    title,
    modelName: String(item.model_name ?? title).trim(),
    filename: String(item.filename ?? "").trim(),
    hash: String(item.hash ?? "").trim(),
    sha256: String(item.sha256 ?? "").trim()
  };
}

// ReForge/A1111の起動オプションからLoRAディレクトリを取得する。
// 未対応バージョンや接続失敗では空文字を返し、呼び出し側の推定へ委ねる。
export async function fetchLoraDirectory(config) {
  try {
    const response = await fetch(`${config.url}/sdapi/v1/cmd-flags`, {
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return "";
    const body = await response.json();
    const value = body?.lora_dir ?? body?.lora_dir_path ?? body?.lyco_dir ?? "";
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

export async function listLoras(config) {
  const response = await fetch(`${config.url}/sdapi/v1/loras`, {
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`ReForge LoRA一覧 HTTP ${response.status}`);

  const body = await response.json();
  if (!Array.isArray(body)) throw new Error("ReForgeからLoRA一覧が返りませんでした");

  return body
    .map((item) => normalizeLora(item))
    .filter(Boolean)
    .sort((left, right) => left.displayName.localeCompare(right.displayName, "ja", { numeric: true }));
}

export async function refreshLoras(config) {
  const response = await fetch(`${config.url}/sdapi/v1/refresh-loras`, {
    method: "POST",
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`ReForge LoRA再読込 HTTP ${response.status}`);
  return listLoras(config);
}

export async function generateImages(config, request, { signal, onProgress } = {}) {
  const isImg2Img = Boolean(request.initImageBase64);
  const isInpaint = request.mode === "inpaint";
  const count = request.hiresEnabled ? 1 : request.candidateCount;
  const label = request.hiresEnabled
    ? isInpaint ? "inpaint refine" : isImg2Img ? "img2img refine" : "Hires.fix"
    : `${count} ${isInpaint ? "inpaint " : isImg2Img ? "img2img " : ""}candidate(s)`;
  const startedAt = Date.now();
  const images = [];
  const effectiveRequest = request.hiresEnabled && !isImg2Img
    ? { ...request, hiresUpscaler: await resolveUpscaler(config, request.hiresUpscaler) }
    : request;
  console.log(`[ReForge] ${label} started`);

  // 生成前にNoise schedule（Zero Terminal SNR等）をReForgeのoptionsへ反映する。
  await applyNoiseSchedule(config, request.noiseSchedule);

  try {
    // 4枚を一度にVRAMへ載せず、API呼び出し自体を1枚ずつ行う。
    // これによりRX 6700 XT 12GBでのメモリ不足とグリッド画像混入を避ける。
    for (let index = 0; index < count; index += 1) {
      const requestedSeed = effectiveRequest.seed === -1 ? -1 : (effectiveRequest.seed + index) >>> 0;
      if (count > 1) console.log(`[ReForge] Candidate ${index + 1}/${count}`);
      const result = await generateOne(config, effectiveRequest, requestedSeed, {
        signal,
        onProgress: (value, detail) => {
          const combined = (index + value) / count;
          onProgress?.(combined, detail || `候補 ${index + 1}/${count}`);
        }
      });
      images.push(result);
      onProgress?.((index + 1) / count, `候補 ${index + 1}/${count} 完了`);
    }

    console.log(`[ReForge] ${label} completed in ${formatSeconds(startedAt)}s`);
    return { images };
  } catch (error) {
    console.error(`[ReForge] ${label} failed after ${formatSeconds(startedAt)}s: ${error.message}`);
    if (error?.name === "TimeoutError") {
      throw new Error("ReForgeの画像生成がタイムアウトしました。ReForgeの画面とコンソールを確認してください");
    }
    throw error;
  }
}

// "Noise schedule for sampling" のoptions APIキー。ReForgeにより異なる場合は
// config.reforge.noiseScheduleOptionKey で上書きできる。
const NOISE_SCHEDULE_OPTION_KEY = "sd_noise_schedule_sampling";

async function applyNoiseSchedule(config, noiseSchedule) {
  const value = typeof noiseSchedule === "string" ? noiseSchedule.trim() : "";
  if (!value) return;
  const key = config.noiseScheduleOptionKey || NOISE_SCHEDULE_OPTION_KEY;
  try {
    const response = await fetch(`${config.url}/sdapi/v1/options`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: value }),
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(`[ReForge] Noise schedule設定に失敗 HTTP ${response.status}: ${detail.slice(0, 200)}`);
    }
  } catch (error) {
    // オプション設定なので、失敗しても生成自体は継続する。
    console.warn(`[ReForge] Noise schedule設定をスキップ: ${error.message}`);
  }
}

async function resolveUpscaler(config, requestedName) {
  try {
    const response = await fetch(`${config.url}/sdapi/v1/upscalers`, {
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return requestedName;
    const upscalers = await response.json();
    const names = upscalers.map((item) => item.name).filter(Boolean);
    const exact = names.find((name) => name.toLowerCase() === requestedName.toLowerCase());
    if (exact) return exact;
    const fallback = names.find((name) => /anime6b/i.test(name))
      ?? names.find((name) => /r-esrgan.*4x/i.test(name))
      ?? names.find((name) => /latent.*antialias/i.test(name))
      ?? names.find((name) => /^latent$/i.test(name));
    if (fallback) {
      console.warn(`[ReForge] Upscaler "${requestedName}" not found; using "${fallback}"`);
      return fallback;
    }
    return requestedName;
  } catch {
    return requestedName;
  }
}

async function generateOne(config, request, seed, { signal, onProgress } = {}) {
  const isImg2Img = Boolean(request.initImageBase64);
  const refinedSize = request.hiresEnabled && isImg2Img
    ? img2imgRefineDimensions(request.width, request.height, request.hiresScale)
    : { width: request.width, height: request.height };
  const payload = {
    prompt: request.prompt,
    negative_prompt: request.negativePrompt,
    seed,
    sampler_name: request.samplerName,
    scheduler: request.scheduler,
    batch_size: 1,
    n_iter: 1,
    steps: request.hiresEnabled && isImg2Img ? request.hiresSteps : request.steps,
    cfg_scale: request.cfgScale,
    width: refinedSize.width,
    height: refinedSize.height,
    do_not_save_grid: true,
    save_images: true
  };

  if (isImg2Img) {
    Object.assign(payload, {
      init_images: [request.initImageBase64],
      resize_mode: request.img2imgResizeMode,
      denoising_strength: request.hiresEnabled
        ? request.hiresDenoising
        : request.maskBase64
          ? request.inpaintDenoising
          : request.img2imgDenoising,
      include_init_images: false
    });
    if (request.maskBase64) {
      Object.assign(payload, {
        mask: request.maskBase64,
        mask_blur: request.maskBlur,
        inpainting_fill: request.inpaintFill,
        inpaint_full_res: request.inpaintFullRes,
        inpaint_full_res_padding: request.inpaintFullResPadding,
        inpainting_mask_invert: 0
      });
    }
  } else {
    payload.enable_hr = request.hiresEnabled;
    if (request.hiresEnabled) {
      Object.assign(payload, {
        hr_scale: request.hiresScale,
        hr_upscaler: request.hiresUpscaler,
        hr_second_pass_steps: request.hiresSteps,
        denoising_strength: request.hiresDenoising
      });
    }
  }

  const stopProgressPolling = startProgressPolling(config, signal, onProgress);
  let response;
  try {
    response = await fetch(`${config.url}/sdapi/v1/${isImg2Img ? "img2img" : "txt2img"}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: requestSignal(signal, config.timeoutMs ?? 900000)
    });
  } finally {
    stopProgressPolling();
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`ReForge HTTP ${response.status}: ${detail.slice(0, 500)}`);
  }

  const body = await response.json();
  if (!body.images?.[0]) throw new Error("ReForgeから画像が返りませんでした");

  let info = {};
  try {
    info = typeof body.info === "string" ? JSON.parse(body.info) : body.info ?? {};
  } catch {
    info = {};
  }

  const returnedSeed = info.all_seeds?.[0];
  const actualSeed = validSeed(returnedSeed) && returnedSeed !== -1
    ? returnedSeed
    : validSeed(info.seed) && info.seed !== -1
      ? info.seed
      : seed;

  return { base64: body.images[0], seed: actualSeed };
}

function validSeed(value) {
  return Number.isInteger(value) && value >= -1 && value <= 4294967295;
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

export function normalizeLora(item) {
  if (!item || typeof item.name !== "string") return null;
  const name = item.name.trim();
  if (!name) return null;
  const alias = typeof item.alias === "string" ? item.alias.trim() : "";
  const folder = inferLoraFolder(item, name);
  return {
    name,
    alias,
    displayName: alias && alias.toLowerCase() !== "none" ? alias : basenameWithoutExtension(name),
    folder,
    category: isCharacterFolder(folder) ? "character" : "direction"
  };
}

function inferLoraFolder(item, name) {
  const normalizedName = normalizePath(name);
  const nameFolder = dirname(normalizedName);
  if (nameFolder) return nameFolder;

  const normalizedPath = normalizePath(typeof item.path === "string" ? item.path : "");
  if (!normalizedPath) return "";

  const marker = normalizedPath.match(/(?:^|\/)(?:lora|loras|lycoris)(?:\/|$)/i);
  const relativePath = marker
    ? normalizedPath.slice((marker.index ?? 0) + marker[0].length)
    : normalizedPath.split("/").slice(-2).join("/");
  return dirname(relativePath);
}

function isCharacterFolder(folder) {
  return folder
    .split("/")
    .filter(Boolean)
    .some((part) => /^(?:characters?|char(?:a)?|キャラ(?:クター)?)(?:[-_\s].*)?$/i.test(part));
}

function basenameWithoutExtension(value) {
  const filename = normalizePath(value).split("/").pop() ?? value;
  return filename.replace(/\.(?:safetensors|ckpt|pt)$/i, "");
}

function dirname(value) {
  const normalized = normalizePath(value).replace(/\/+$/, "");
  const separator = normalized.lastIndexOf("/");
  return separator > 0 ? normalized.slice(0, separator) : "";
}

function normalizePath(value) {
  return String(value ?? "").replaceAll("\\", "/").replace(/\/+/g, "/");
}

function formatSeconds(startedAt) {
  return ((Date.now() - startedAt) / 1000).toFixed(1);
}

function startProgressPolling(config, signal, onProgress) {
  if (!onProgress) return () => {};
  let stopped = false;
  let timer = null;

  const poll = async () => {
    if (stopped || signal?.aborted) return;
    try {
      const response = await fetch(`${config.url}/sdapi/v1/progress?skip_current_image=true`, {
        signal: requestSignal(signal, 3000)
      });
      if (response.ok) {
        const body = await response.json();
        const progress = Math.max(0, Math.min(0.99, Number(body.progress) || 0));
        const eta = Number(body.eta_relative);
        onProgress(progress, Number.isFinite(eta) && eta > 0
          ? `ReForge生成中・残り約${Math.ceil(eta)}秒`
          : "ReForge生成中");
      }
    } catch {
      // ReForge本体の生成リクエストを優先し、進捗取得失敗は無視する。
    }
    if (!stopped) timer = setTimeout(poll, 1000);
  };
  timer = setTimeout(poll, 800);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

function requestSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
