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

const SYSTEM_PROMPT = `Convert the user's Japanese image description into Danbooru-style English comma-separated tags for Illustrious/NoobAI anime models.
Return only the tags. Do not explain. Do not use JSON or Markdown.
Always begin with: masterpiece, best quality, amazing quality, newest, absurdres, highres
For one female subject include: 1girl, solo
Keep every requested subject, clothing, body feature, pose, composition, background and lighting detail.
Never output generic placeholder words such as pose, composition, background, or lighting by themselves.
When pose, framing, background, or lighting is unspecified, choose concrete attractive defaults such as dynamic pose, cowboy shot, simple background, soft lighting.
Include detailed face, detailed eyes, anime coloring unless the user requests a different style.
Do not add extra characters or unrelated objects.`;

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
          temperature: 0.2,
          num_predict: 220,
          num_ctx: 4096
        }
      }),
      signal: requestSignal(signal, config.timeoutMs ?? 300000)
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Ollama HTTP ${response.status}: ${detail.slice(0, 300)}`);
    }

    const body = await response.json();
    const prompt = cleanTags(body.response);
    if (!prompt) throw new Error("Ollamaからプロンプトが返りませんでした");

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

function cleanTags(value) {
  if (typeof value !== "string") return "";
  let result = value
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:text)?/gi, "")
    .replace(/^\s*(?:tags?|prompt)\s*:\s*/i, "")
    .replace(/[\r\n]+/g, ", ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/(?:,\s*){2,}/g, ", ")
    .trim()
    .replace(/^['"]|['"]$/g, "");

  if (!/masterpiece/i.test(result)) {
    result = `masterpiece, best quality, amazing quality, newest, absurdres, highres, ${result}`;
  }
  return result;
}

function formatSeconds(startedAt) {
  return ((Date.now() - startedAt) / 1000).toFixed(1);
}

function requestSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
