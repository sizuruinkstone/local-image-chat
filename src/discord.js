import fs from "node:fs/promises";
import path from "node:path";
import { JsonStore } from "./json-store.js";

// Favorite画像のDiscord送信。
// 方針:
// - Webhook URLはサーバー内だけで保持し、APIレスポンスへは絶対に含めない
// - Favorite操作は待たせない。送信は状態を「sending」にしてから非同期で行う
// - sending / sent の画像は再送しない（二重投稿の防止）

export const DISCORD_SEND_STATUSES = ["not_sent", "sending", "sent", "failed"];

const DISCORD_CONTENT_LIMIT = 2000;
const PROMPT_FILE_NAME = "prompt.txt";
const TRUNCATED_NOTICE = `…（全文は ${PROMPT_FILE_NAME} を参照）`;
const SEND_TIMEOUT_MS = 30000;

export function normalizeDiscordState(input) {
  const status = DISCORD_SEND_STATUSES.includes(input?.status) ? input.status : "not_sent";
  return {
    status,
    messageId: typeof input?.messageId === "string" && input.messageId ? input.messageId.slice(0, 40) : null,
    sentAt: typeof input?.sentAt === "string" && input.sentAt ? input.sentAt.slice(0, 40) : null,
    error: typeof input?.error === "string" ? input.error.slice(0, 500) : ""
  };
}

// 送信先はDiscordのWebhookだけを許可する（任意のURLへ画像を投げないため）。
export function isDiscordWebhookUrl(value) {
  let url;
  try {
    url = new URL(String(value ?? "").trim());
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const allowedHosts = ["discord.com", "discordapp.com", "ptb.discord.com", "canary.discord.com"];
  if (!allowedHosts.includes(url.hostname)) return false;
  return /^\/api(\/v\d+)?\/webhooks\/\d+\/[\w-]+$/.test(url.pathname);
}

// 画面へ返す表示用。トークン部分は伏せる。
export function maskWebhookUrl(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    const id = url.pathname.split("/").filter(Boolean).at(-2) ?? "";
    return `${url.hostname}/api/webhooks/${id}/••••`;
  } catch {
    return "設定済み";
  }
}

function formatLoras(loras) {
  if (!Array.isArray(loras) || !loras.length) return "";
  return loras
    .filter((lora) => lora && typeof lora.name === "string" && lora.name.trim())
    .map((lora) => {
      const weight = Number(lora.weight);
      return Number.isFinite(weight) ? `${lora.name}:${Number(weight.toFixed(2))}` : lora.name;
    })
    .join(", ");
}

// 投稿本文を組み立てる。Discordの本文上限を超える場合はPromptを切り詰め、
// 全文はテキストファイルとして添付する。
export function buildFavoriteMessage({
  generation = {},
  image = {},
  includePrompt = true,
  includeMetadata = true
} = {}) {
  const lines = ["⭐ Favorite"];
  if (includeMetadata) {
    const settings = generation.settings ?? {};
    const model = settings.checkpointModelName || settings.checkpoint || "";
    const seed = image.seed ?? settings.seed;
    const meta = [];
    if (model) meta.push(`Model: ${model}`);
    if (seed !== undefined && seed !== null && String(seed).trim() !== "") meta.push(`Seed: ${seed}`);
    meta.push(`LoRA: ${formatLoras(generation.loras) || "なし"}`);
    lines.push("", ...meta);
  }

  const prompt = String(generation.prompt || generation.effectivePrompt || "").trim();
  if (!includePrompt || !prompt) {
    return { content: lines.join("\n").slice(0, DISCORD_CONTENT_LIMIT), promptFile: null };
  }

  const header = [...lines, "", "Prompt:"].join("\n");
  const available = DISCORD_CONTENT_LIMIT - header.length - 1;
  if (available >= prompt.length) {
    return { content: `${header}\n${prompt}`, promptFile: null };
  }
  const room = Math.max(0, available - TRUNCATED_NOTICE.length);
  const truncated = prompt.slice(0, room).trimEnd();
  return {
    content: `${header}\n${truncated}${TRUNCATED_NOTICE}`.slice(0, DISCORD_CONTENT_LIMIT),
    promptFile: { name: PROMPT_FILE_NAME, text: prompt }
  };
}

// Webhookへ画像とテキストを送る。成功時はDiscordのメッセージIDを返す。
export async function postToDiscordWebhook(webhookUrl, {
  content,
  promptFile = null,
  image,
  fetchImpl = fetch
}) {
  const url = new URL(webhookUrl);
  url.searchParams.set("wait", "true");

  const form = new FormData();
  form.append("payload_json", JSON.stringify({
    content,
    // プロンプト本文に@everyoneなどが含まれていてもメンションを飛ばさない。
    allowed_mentions: { parse: [] }
  }));
  form.append("files[0]", new Blob([image.buffer], { type: image.contentType }), image.filename);
  if (promptFile) {
    form.append("files[1]", new Blob([promptFile.text], { type: "text/plain" }), promptFile.name);
  }

  const response = await fetchImpl(url, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS)
  });

  if (!response.ok) {
    if (response.status === 413) throw new Error("画像サイズがDiscordの上限を超えています");
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      throw new Error(`Discordの送信先が無効です（HTTP ${response.status}）。Webhook URLを確認してください`);
    }
    if (response.status === 429) throw new Error("Discordのレート制限に達しました。しばらくしてから再送してください");
    throw new Error(`Discord送信に失敗しました（HTTP ${response.status}）`);
  }

  const body = await response.json().catch(() => ({}));
  return typeof body?.id === "string" ? body.id : null;
}

const IMAGE_CONTENT_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

export function createDiscordService({
  dataDir,
  history,
  outputDir,
  webhookFromEnv = "",
  webhookFromConfig = "",
  fetchImpl = fetch,
  logger = console
}) {
  const store = new JsonStore(path.join(dataDir, "discord-settings.json"), {
    schemaVersion: 1,
    settings: { autoSend: true, includePrompt: true, includeMetadata: true, webhookUrl: "" }
  });
  // 実行中の送信。プロセス内で同じ画像を二重に走らせない。
  const running = new Set();

  async function readSettings() {
    const data = await store.read();
    const settings = data.settings ?? {};
    return {
      autoSend: settings.autoSend !== false,
      includePrompt: settings.includePrompt !== false,
      includeMetadata: settings.includeMetadata !== false,
      webhookUrl: typeof settings.webhookUrl === "string" ? settings.webhookUrl : ""
    };
  }

  // 環境変数 > config.local.json > 画面で保存した値 の順に採用する。
  function resolveWebhook(storedWebhookUrl) {
    if (isDiscordWebhookUrl(webhookFromEnv)) return { url: webhookFromEnv.trim(), source: "env" };
    if (isDiscordWebhookUrl(webhookFromConfig)) return { url: webhookFromConfig.trim(), source: "config" };
    if (isDiscordWebhookUrl(storedWebhookUrl)) return { url: storedWebhookUrl.trim(), source: "stored" };
    return { url: "", source: "none" };
  }

  // 画面へ返す形。Webhook URLそのものは含めない。
  function toPublicSettings(settings) {
    const webhook = resolveWebhook(settings.webhookUrl);
    return {
      autoSend: settings.autoSend,
      includePrompt: settings.includePrompt,
      includeMetadata: settings.includeMetadata,
      webhookConfigured: Boolean(webhook.url),
      webhookSource: webhook.source,
      webhookHint: maskWebhookUrl(webhook.url),
      // 環境変数・config.local.jsonの値は画面から消せない。
      webhookEditable: webhook.source !== "env" && webhook.source !== "config",
      storedWebhookConfigured: isDiscordWebhookUrl(settings.webhookUrl)
    };
  }

  async function readImageFile(filename) {
    const safeName = path.basename(String(filename ?? ""));
    if (!safeName || safeName !== filename) throw new Error("送信できる画像ファイルがありません");
    const extension = path.extname(safeName).toLowerCase();
    const contentType = IMAGE_CONTENT_TYPES[extension];
    if (!contentType) throw new Error("送信できない画像形式です");
    const buffer = await fs.readFile(path.join(outputDir, safeName));
    return { buffer, filename: safeName, contentType };
  }

  async function run(imageId) {
    running.add(imageId);
    try {
      const settings = await readSettings();
      const webhook = resolveWebhook(settings.webhookUrl);
      if (!webhook.url) throw new Error("Discordの送信先が設定されていません");

      const recipe = await history.getRecipe(imageId);
      const image = recipe.selectedImage;
      const { content, promptFile } = buildFavoriteMessage({
        generation: recipe,
        image,
        includePrompt: settings.includePrompt,
        includeMetadata: settings.includeMetadata
      });
      const file = await readImageFile(image.filename);
      const messageId = await postToDiscordWebhook(webhook.url, {
        content,
        promptFile,
        image: file,
        fetchImpl
      });
      return await history.completeDiscordSend(imageId, { messageId });
    } catch (error) {
      const message = error?.message ?? String(error);
      logger.warn?.(`[Discord] 送信に失敗しました: ${message}`);
      return await history.failDiscordSend(imageId, message).catch(() => null);
    } finally {
      running.delete(imageId);
    }
  }

  // 状態を「sending」にできた場合だけ送信を始める。戻り値は最新の送信状態。
  async function start(imageId, { background = true } = {}) {
    const claimed = await history.beginDiscordSend(imageId);
    if (!claimed) return history.getDiscordState(imageId);
    const finished = run(imageId);
    if (!background) return finished;
    // Favorite操作を待たせないため、完了は待たない。
    void finished;
    return history.getDiscordState(imageId);
  }

  return {
    async getSettings() {
      return toPublicSettings(await readSettings());
    },

    async updateSettings(patch = {}) {
      const next = await store.update((data) => {
        const settings = { ...(data.settings ?? {}) };
        if (patch.autoSend !== undefined) settings.autoSend = patch.autoSend === true || patch.autoSend === "true";
        if (patch.includePrompt !== undefined) {
          settings.includePrompt = patch.includePrompt === true || patch.includePrompt === "true";
        }
        if (patch.includeMetadata !== undefined) {
          settings.includeMetadata = patch.includeMetadata === true || patch.includeMetadata === "true";
        }
        if (patch.clearWebhook === true) {
          settings.webhookUrl = "";
        } else if (typeof patch.webhookUrl === "string" && patch.webhookUrl.trim()) {
          const webhookUrl = patch.webhookUrl.trim();
          if (!isDiscordWebhookUrl(webhookUrl)) {
            throw new Error("DiscordのWebhook URLではありません（https://discord.com/api/webhooks/… の形式）");
          }
          settings.webhookUrl = webhookUrl;
        }
        data.settings = settings;
        return data;
      });
      return toPublicSettings({
        autoSend: next.settings.autoSend !== false,
        includePrompt: next.settings.includePrompt !== false,
        includeMetadata: next.settings.includeMetadata !== false,
        webhookUrl: next.settings.webhookUrl ?? ""
      });
    },

    // Favorite直後の自動送信。設定OFF・送信先未設定なら何もしない。
    async sendForFavorite(imageId) {
      const settings = await readSettings();
      if (!settings.autoSend) return history.getDiscordState(imageId);
      if (!resolveWebhook(settings.webhookUrl).url) return history.getDiscordState(imageId);
      return start(imageId);
    },

    // 失敗した画像の手動再送。sent / sending は対象外。
    async resend(imageId, options = {}) {
      const settings = await readSettings();
      if (!resolveWebhook(settings.webhookUrl).url) {
        throw new Error("Discordの送信先が設定されていません");
      }
      const current = await history.getDiscordState(imageId);
      if (current.status === "sent") throw new Error("この画像はすでにDiscordへ送信済みです");
      if (current.status === "sending" || running.has(imageId)) throw new Error("この画像はDiscordへ送信中です");
      return start(imageId, options);
    },

    getState(imageId) {
      return history.getDiscordState(imageId);
    }
  };
}
