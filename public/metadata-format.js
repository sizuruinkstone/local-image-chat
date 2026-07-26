// 履歴のコピー用テキストを組み立てる。UIから切り離して単体テストできるようにしておく。
// 方針: 保存されている値だけを出し、undefined / null / NaN と内部情報は絶対に出さない。

// 内部ID・ファイルパス・認証情報などは、たとえ渡されても出力しない。
const EXCLUDED_KEY_PATTERN = /(^|[^a-z])id$|token|secret|password|apikey|api_key|auth|cookie|path|filename|url/i;

function isMeaningful(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return Number.isFinite(value);
  const text = String(value).trim();
  if (!text) return false;
  return !["undefined", "null", "nan"].includes(text.toLowerCase());
}

function formatValue(value) {
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value).trim();
}

// ポジティブプロンプトだけを返す。Negativeや生成設定は含めない。
export function buildPromptText(generation) {
  const prompt = generation?.prompt;
  return isMeaningful(prompt) ? String(prompt).trim() : "";
}

// LoRAは「名前:weight」の並びにする（再生成に必要な情報のみ）。
function formatLoras(loras) {
  if (!Array.isArray(loras) || !loras.length) return "";
  return loras
    .filter((lora) => isMeaningful(lora?.name))
    .map((lora) => {
      const weight = Number(lora.weight);
      return Number.isFinite(weight) ? `${lora.name}:${Number(weight.toFixed(3))}` : String(lora.name);
    })
    .join(", ");
}

// Stable Diffusion WebUIのPNG Infoに近い形式でまとめる。
// 1行目: Positive / 2行目: Negative prompt / 3行目: 生成設定（存在する項目だけ）
export function buildMetadataText(generation, image = null) {
  const settings = generation?.settings ?? {};
  const width = image?.width ?? settings.width;
  const height = image?.height ?? settings.height;
  const seed = image?.seed ?? settings.seed;

  // LoRAタグを含む実効プロンプトがあれば、そのまま再利用できるよう優先する。
  const positive = isMeaningful(generation?.effectivePrompt)
    ? String(generation.effectivePrompt).trim()
    : buildPromptText(generation);
  const negative = isMeaningful(generation?.effectiveNegativePrompt)
    ? String(generation.effectiveNegativePrompt).trim()
    : isMeaningful(generation?.negativePrompt)
      ? String(generation.negativePrompt).trim()
      : "";

  // WebUIと同じく「Denoising strength」は1つだけ出す。
  // Hires仕上げならHiresのDenoising、img2img/部分修正ならそのDenoising。
  const denoisingStrength = settings.hiresEnabled
    ? settings.hiresDenoising
    : generation?.mode === "inpaint"
      ? settings.inpaintDenoising
      : generation?.mode === "img2img"
        ? settings.img2imgDenoising
        : null;

  const fields = [
    ["Steps", settings.steps],
    ["Sampler", settings.samplerName],
    ["Schedule type", settings.scheduler],
    ["Noise schedule", settings.noiseSchedule === "Automatic" ? null : settings.noiseSchedule],
    ["CFG scale", settings.cfgScale],
    ["Seed", Number(seed) >= 0 ? seed : null],
    ["Size", isMeaningful(width) && isMeaningful(height) ? `${width}x${height}` : null],
    ["Model", settings.checkpointModelName || settings.checkpoint],
    ["Model hash", settings.checkpointHash],
    ["VAE", settings.vae],
    ["Clip skip", settings.clipSkip],
    ["Denoising strength", denoisingStrength],
    ["Mask blur", generation?.mode === "inpaint" ? settings.maskBlur : null],
    ["Hires upscale", settings.hiresEnabled ? settings.hiresScale : null],
    ["Hires steps", settings.hiresEnabled ? settings.hiresSteps : null],
    ["Hires upscaler", settings.hiresEnabled ? settings.hiresUpscaler : null],
    ["ADetailer model", settings.adetailerModel],
    ["ControlNet", settings.controlNet],
    ["LoRA", formatLoras(generation?.loras)]
  ];

  const parameters = fields
    .filter(([label, value]) => isMeaningful(value) && !EXCLUDED_KEY_PATTERN.test(label))
    .map(([label, value]) => `${label}: ${formatValue(value)}`)
    .join(", ");

  const blocks = [positive];
  if (negative) blocks.push(`Negative prompt: ${negative}`);
  if (parameters) blocks.push(parameters);
  return blocks.filter(Boolean).join("\n\n");
}
