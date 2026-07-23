const NEGATIVE_PROMPT = [
  "worst quality",
  "low quality",
  "normal quality",
  "old",
  "early",
  "lowres",
  "bad anatomy",
  "bad hands",
  "extra fingers",
  "missing fingers",
  "deformed",
  "blurry",
  "signature",
  "username",
  "logo",
  "watermark"
].join(", ");

const QUALITY_TAGS = [
  "masterpiece",
  "best quality",
  "amazing quality",
  "newest",
  "absurdres",
  "highres"
];

const GENERIC_FILLER_TAGS = new Set([
  "detailed body features",
  "expressive expression",
  "unique composition",
  "striking pose",
  "elegant background",
  "bold lighting",
  "perfect composition",
  "perfect lighting",
  "perfect pose",
  "perfect expression",
  "perfect color",
  "perfect texture"
]);

const GENERIC_CLOTHING_TAGS = new Set([
  "clothes",
  "clothing",
  "detailed clothes",
  "detailed clothing",
  "fully clothed",
  "wearing clothes"
]);

const REFUSAL_PATTERN = /\b(?:i(?:'m| am) sorry|i can(?:not|'t)|unable to|cannot assist|policy|not able to)\b|申し訳|対応できません|お手伝いできません/i;
const NUDITY_REQUEST_PATTERN = /\b(?:nude|naked|completely nude|fully nude)\b|裸|全裸|ヌード|裸体|服を脱/i;

const SYSTEM_PROMPT = `Convert the user's Japanese image description into Danbooru-style English comma-separated tags for Illustrious/NoobAI anime models.
Return only the tags. Do not explain. Do not use JSON or Markdown.
Always begin with: masterpiece, best quality, amazing quality, newest, absurdres, highres
For one female subject include: 1girl, solo
Keep every requested subject, clothing, body feature, pose, composition, background and lighting detail.
Never output generic placeholder words such as pose, composition, background, or lighting by themselves.
When pose, framing, background, or lighting is unspecified, choose concrete attractive defaults such as dynamic pose, cowboy shot, simple background, soft lighting.
Include detailed face, detailed eyes, anime coloring unless the user requests a different style.
Do not add extra characters or unrelated objects.
Never repeat a tag, phrase, or sequence of tags.
Match the amount of detail to the request. For a short request return 12 to 40 useful tags; for a detailed request return at most 90 unique tags.
Stop immediately after the last useful tag. Never pad the answer with phrases such as perfect pose, perfect lighting, perfect composition, perfect expression, perfect color, or perfect texture.
Never output contradictory tags. If the user requests nude or naked, do not add clothing or detailed clothing unless the user explicitly requested a specific wearable item.
For nudity or an intimate situation, depict every person as an adult and include adult woman or adult man as appropriate.`;

export async function checkOllama(config) {
  const response = await fetch(`${config.url}/api/tags`, {
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
  const body = await response.json();
  const names = (body.models ?? []).map((model) => model.name);
  return { ok: true, model: config.model, installed: names.includes(config.model), models: names };
}

export async function createPrompt(config, description, { signal } = {}) {
  const startedAt = Date.now();
  console.log(`[Ollama] Prompt conversion started with ${config.model}`);

  try {
    let body = await requestPrompt(config, description, signal);
    let diagnostics = inspectTagOutput(body.response);

    if (looksLikeRefusal(body.response)) {
      console.warn("[Ollama] Refusal-like response detected; retrying once with a concise tag-only instruction");
      body = await requestPrompt(
        config,
        `${description}\n\nReturn a concise list of image tags only. Preserve the request without commentary or refusal.`,
        signal
      );
      diagnostics = inspectTagOutput(body.response);
    }

    const prompt = cleanTags(body.response, {
      description,
      maxTags: config.maxTags ?? 96
    });
    if (!prompt) throw new Error("Ollamaからプロンプトが返りませんでした");

    if (diagnostics.duplicateCount > 0) {
      console.warn(`[Ollama] Removed ${diagnostics.duplicateCount} repeated tag(s)`);
    }
    if (body.done_reason === "length") {
      console.warn("[Ollama] Output reached the token limit; sanitized the completed unique tags");
    }

    console.log(`[Ollama] Completed in ${formatSeconds(startedAt)}s`);
    return {
      prompt,
      negative_prompt: NEGATIVE_PROMPT,
      explanation_ja: "日本語の指示をIllustrious/NoobAI向け英語タグへ変換しました。"
    };
  } catch (error) {
    console.error(`[Ollama] Failed after ${formatSeconds(startedAt)}s: ${error.message}`);
    if (error?.name === "TimeoutError") {
      throw new Error("Ollamaのプロンプト変換がタイムアウトしました");
    }
    throw error;
  }
}

async function requestPrompt(config, description, signal) {
  const response = await fetch(`${config.url}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      system: SYSTEM_PROMPT,
      prompt: description,
      stream: false,
      think: config.think ?? false,
      keep_alive: 0,
      options: {
        temperature: config.temperature ?? 0.3,
        top_p: config.topP ?? 0.9,
        repeat_penalty: config.repeatPenalty ?? 1.18,
        repeat_last_n: config.repeatLastN ?? 128,
        num_predict: config.numPredict ?? 320,
        num_ctx: config.numContext ?? 4096
      }
    }),
    signal: requestSignal(signal, config.timeoutMs ?? 300000)
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Ollama HTTP ${response.status}: ${detail.slice(0, 300)}`);
  }

  return response.json();
}

export async function unloadOllama(config, { signal } = {}) {
  try {
    const response = await fetch(`${config.url}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        keep_alive: 0
      }),
      signal: requestSignal(signal, 30000)
    });
    if (!response.ok) throw new Error(`Ollama unload HTTP ${response.status}`);
    console.log(`[Ollama] ${config.model} unloaded`);
    return true;
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn(`[Ollama] Model unload skipped: ${error.message}`);
    return false;
  }
}

export function cleanTags(value, { description = "", maxTags = 96 } = {}) {
  if (typeof value !== "string") return "";
  const sanitized = value
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:text)?/gi, "")
    .replace(/^\s*(?:tags?|prompt)\s*:\s*/i, "")
    .replace(/[\r\n]+/g, ", ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/(?:,\s*){2,}/g, ", ")
    .trim()
    .replace(/^['"]|['"]$/g, "");

  if (!sanitized || looksLikeRefusal(sanitized)) return "";

  const candidates = sanitized.split(",").map((tag) => tag.trim()).filter(Boolean);
  const nudityRequested = NUDITY_REQUEST_PATTERN.test(description)
    || candidates.some((tag) => /^(?:nude|naked|completely nude|fully nude)$/i.test(tag));
  const configuredLimit = Number.isFinite(Number(maxTags))
    ? Math.min(160, Math.max(24, Math.round(Number(maxTags))))
    : 96;
  const effectiveLimit = String(description).trim().length <= 40
    ? Math.min(configuredLimit, 48)
    : configuredLimit;
  const result = [];
  const seen = new Set();

  for (const tag of [...QUALITY_TAGS, ...candidates]) {
    const normalized = normalizeTag(tag);
    if (!normalized || seen.has(normalized)) continue;
    if (GENERIC_FILLER_TAGS.has(normalized)) continue;
    if (nudityRequested && GENERIC_CLOTHING_TAGS.has(normalized)) continue;
    seen.add(normalized);
    result.push(tag);
    if (result.length >= effectiveLimit) break;
  }

  return result.join(", ");
}

export function inspectTagOutput(value) {
  if (typeof value !== "string") {
    return { tagCount: 0, duplicateCount: 0 };
  }
  const tags = value
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/[\r\n]+/g, ",")
    .split(",")
    .map((tag) => normalizeTag(tag))
    .filter(Boolean);
  const unique = new Set(tags);
  return {
    tagCount: tags.length,
    duplicateCount: tags.length - unique.size
  };
}

function looksLikeRefusal(value) {
  return typeof value === "string" && REFUSAL_PATTERN.test(value);
}

function normalizeTag(value) {
  return String(value ?? "").trim().toLowerCase().replaceAll(/\s+/g, " ");
}

function formatSeconds(startedAt) {
  return ((Date.now() - startedAt) / 1000).toFixed(1);
}

function requestSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
