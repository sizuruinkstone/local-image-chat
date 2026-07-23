import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkOllama, createPrompt, unloadOllama } from "./ollama.js";
import { checkReforge, generateImages, listLoras, refreshLoras } from "./reforge.js";
import { createHistoryService } from "./history.js";
import { createJobManager } from "./job-manager.js";
import { createCivitaiService } from "./civitai.js";
import { createUpdater } from "./updater.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
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
const dataDir = process.env.LOCAL_IMAGE_CHAT_DATA_DIR
  ? path.resolve(process.env.LOCAL_IMAGE_CHAT_DATA_DIR)
  : path.join(rootDir, "data");
await Promise.all([
  fs.mkdir(outputDir, { recursive: true }),
  fs.mkdir(dataDir, { recursive: true })
]);

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
const jobs = createJobManager(performGeneration);

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(rootDir, "public")));
app.use("/outputs", express.static(outputDir));

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

app.post("/api/loras/refresh", async (_request, response) => {
  try {
    const loras = await refreshLoras(config.reforge);
    response.json({ loras: await civitai.mergeWithInstalled(loras) });
  } catch (error) {
    response.status(500).json({ error: readableError(error) });
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

app.post("/api/civitai/install", async (request, response) => {
  try {
    const result = await civitai.install({
      url: requireText(request.body.url, "Civitai URL"),
      token: sanitizeSecret(request.body.token),
      category: textOrDefault(request.body.category, "style"),
      overwrite: request.body.overwrite === true
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
    const image = await history.setFavorite(
      requireId(request.params.imageId),
      request.body.favorite !== false
    );
    response.json({ image, preferences: await history.getPreferences() });
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

async function performGeneration(body, { signal, report }) {
  const description = requireText(body.description, "生成したい内容");
  const settings = validateSettings(body.settings ?? {});
  const loras = validateLoras(body.loras);
  const promptBoosts = validatePromptBoosts(body.promptBoosts);

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
  await unloadOllama(config.ollama, { signal });

  const effectivePrompt = appendLoras(promptWithBoosts, loras);
  const effectiveNegativePrompt = appendLoraNegatives(generatedPrompt.negative_prompt, loras);
  report(25, "ReForgeで生成を開始");
  const generated = await generateImages(config.reforge, {
    prompt: effectivePrompt,
    negativePrompt: effectiveNegativePrompt,
    ...settings
  }, {
    signal,
    onProgress: (value, detail) => report(25 + value * 68, detail)
  });

  report(94, "画像とレシピを保存中");
  const runId = timestamp();
  const savedImages = await Promise.all(generated.images.map(async (image, index) => {
    const kind = settings.hiresEnabled ? "hires" : `candidate-${index + 1}`;
    const filename = `${runId}_${kind}_seed-${image.seed}.png`;
    await fs.writeFile(path.join(outputDir, filename), Buffer.from(image.base64, "base64"));
    return {
      imageUrl: `/outputs/${filename}`,
      filename,
      seed: image.seed,
      width: settings.hiresEnabled ? Math.round(settings.width * settings.hiresScale) : settings.width,
      height: settings.hiresEnabled ? Math.round(settings.height * settings.hiresScale) : settings.height
    };
  }));

  const stored = await history.addGeneration({
    kind: settings.hiresEnabled ? "hires" : "candidates",
    parentImageId: body.parentImageId,
    description,
    prompt: promptWithBoosts,
    negativePrompt: generatedPrompt.negative_prompt,
    effectivePrompt,
    effectiveNegativePrompt,
    settings,
    loras,
    images: savedImages
  });

  report(99, "完了");
  return {
    generationId: stored.id,
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

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}を入力してください`);
  return value.trim().slice(0, 4000);
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
    candidateCount: hiresEnabled ? 1 : boundedInt(input.candidateCount, defaults.candidateCount ?? 4, 1, 4),
    hiresEnabled,
    hiresScale: boundedNumber(input.hiresScale, defaults.hiresScale ?? 1.5, 1, 2),
    hiresSteps: boundedInt(input.hiresSteps, defaults.hiresSteps ?? 20, 1, 50),
    hiresDenoising: boundedNumber(input.hiresDenoising, defaults.hiresDenoising ?? 0.4, 0.1, 0.8),
    hiresUpscaler: textOrDefault(input.hiresUpscaler, defaults.hiresUpscaler ?? "R-ESRGAN 4x+ Anime6B")
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
  const baseWords = splitTags(prompt);
  const seen = new Set(baseWords.map(normalizeTag));
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

function textOrDefault(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 100) : fallback;
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
