import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkOllama, createPrompt } from "./ollama.js";
import { checkReforge, generateImages, listLoras, refreshLoras } from "./reforge.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const config = JSON.parse(await fs.readFile(path.join(rootDir, "config.json"), "utf8"));
const outputDir = path.join(rootDir, "outputs");
await fs.mkdir(outputDir, { recursive: true });

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(express.static(path.join(rootDir, "public")));
app.use("/outputs", express.static(outputDir));

app.get("/api/config", (_request, response) => {
  response.json({
    defaults: config.defaults,
    ollamaModel: config.ollama.model,
    lora: {
      defaultWeight: config.lora?.defaultWeight ?? 0.7,
      maxSelected: config.lora?.maxSelected ?? 4
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
    const prompt = await createPrompt(config.ollama, description);
    response.json(prompt);
  } catch (error) {
    response.status(500).json({ error: readableError(error) });
  }
});

app.get("/api/loras", async (_request, response) => {
  try {
    response.json({ loras: await listLoras(config.reforge) });
  } catch (error) {
    response.status(500).json({ error: readableError(error) });
  }
});

app.post("/api/loras/refresh", async (_request, response) => {
  try {
    response.json({ loras: await refreshLoras(config.reforge) });
  } catch (error) {
    response.status(500).json({ error: readableError(error) });
  }
});

app.post("/api/generate", async (request, response) => {
  try {
    const description = requireText(request.body.description, "生成したい内容");
    const settings = validateSettings(request.body.settings ?? {});
    const loras = validateLoras(request.body.loras);

    const generatedPrompt = request.body.prompt?.trim()
      ? {
          prompt: request.body.prompt.trim(),
          negative_prompt: request.body.negativePrompt?.trim() ?? "",
          explanation_ja: "画面で編集したプロンプトを使用しました。"
        }
      : await createPrompt(config.ollama, description);

    const effectivePrompt = appendLoras(generatedPrompt.prompt, loras);
    const effectiveNegativePrompt = appendLoraNegatives(generatedPrompt.negative_prompt, loras);
    const generated = await generateImages(config.reforge, {
      prompt: effectivePrompt,
      negativePrompt: effectiveNegativePrompt,
      ...settings
    });

    const runId = timestamp();
    const images = await Promise.all(generated.images.map(async (image, index) => {
      const kind = settings.hiresEnabled ? "hires" : `candidate-${index + 1}`;
      const filename = `${runId}_${kind}_seed-${image.seed}.png`;
      await fs.writeFile(path.join(outputDir, filename), Buffer.from(image.base64, "base64"));
      return {
        imageUrl: `/outputs/${filename}`,
        filename,
        seed: image.seed
      };
    }));

    response.json({
      images,
      prompt: generatedPrompt.prompt,
      negativePrompt: generatedPrompt.negative_prompt,
      effectivePrompt,
      effectiveNegativePrompt,
      loras,
      explanation: loras.length
        ? `${generatedPrompt.explanation_ja} LoRA: ${loras.map((item) => `${item.name} (${item.weight})${item.negativeWords ? "・標準衣装抑制" : ""}`).join(", ")}`
        : generatedPrompt.explanation_ja,
      settings
    });
  } catch (error) {
    response.status(500).json({ error: readableError(error) });
  }
});

app.listen(config.port, "127.0.0.1", () => {
  console.log(`Local Image Chat: http://127.0.0.1:${config.port}`);
});

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}を入力してください`);
  return value.trim().slice(0, 4000);
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
  const additions = [...new Set(triggerWords.map((value) => value.toLowerCase()))]
    .map((normalized) => triggerWords.find((value) => value.toLowerCase() === normalized))
    .concat(loraTags);
  return additions.length ? `${prompt.replace(/\s*,?\s*$/, "")}, ${additions.join(", ")}` : prompt;
}

function appendLoraNegatives(negativePrompt, loras) {
  const baseWords = splitTags(negativePrompt);
  const additions = loras.flatMap((item) => splitTags(item.negativeWords));
  const seen = new Set(baseWords.map(normalizeTag));
  for (const tag of additions) {
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
  return new Date().toISOString().replaceAll(":", "-").replace("T", "_").slice(0, 19);
}

function readableError(error) {
  if (error?.name === "TimeoutError") return "処理がタイムアウトしました";
  if (error?.cause?.code === "ECONNREFUSED") return "接続できません。OllamaとReForgeが起動しているか確認してください";
  return error?.message ?? "不明なエラーが発生しました";
}
