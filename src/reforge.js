export async function checkReforge(config) {
  const response = await fetch(`${config.url}/sdapi/v1/options`, {
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new Error(`ReForge HTTP ${response.status}`);
  const body = await response.json();
  return { ok: true, checkpoint: body.sd_model_checkpoint ?? "不明" };
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

export async function generateImages(config, request) {
  const count = request.hiresEnabled ? 1 : request.candidateCount;
  const label = request.hiresEnabled ? "Hires.fix" : `${count} candidate(s)`;
  const startedAt = Date.now();
  const images = [];
  const effectiveRequest = request.hiresEnabled
    ? { ...request, hiresUpscaler: await resolveUpscaler(config, request.hiresUpscaler) }
    : request;
  console.log(`[ReForge] ${label} started`);

  try {
    // 4枚を一度にVRAMへ載せず、API呼び出し自体を1枚ずつ行う。
    // これによりRX 6700 XT 12GBでのメモリ不足とグリッド画像混入を避ける。
    for (let index = 0; index < count; index += 1) {
      const requestedSeed = effectiveRequest.seed === -1 ? -1 : (effectiveRequest.seed + index) >>> 0;
      if (count > 1) console.log(`[ReForge] Candidate ${index + 1}/${count}`);
      const result = await generateOne(config, effectiveRequest, requestedSeed);
      images.push(result);
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

async function generateOne(config, request, seed) {
  const payload = {
    prompt: request.prompt,
    negative_prompt: request.negativePrompt,
    seed,
    sampler_name: request.samplerName,
    scheduler: request.scheduler,
    batch_size: 1,
    n_iter: 1,
    steps: request.steps,
    cfg_scale: request.cfgScale,
    width: request.width,
    height: request.height,
    enable_hr: request.hiresEnabled,
    do_not_save_grid: true,
    save_images: true
  };

  if (request.hiresEnabled) {
    Object.assign(payload, {
      hr_scale: request.hiresScale,
      hr_upscaler: request.hiresUpscaler,
      hr_second_pass_steps: request.hiresSteps,
      denoising_strength: request.hiresDenoising
    });
  }

  const response = await fetch(`${config.url}/sdapi/v1/txt2img`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(config.timeoutMs ?? 900000)
  });

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
