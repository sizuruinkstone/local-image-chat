import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildGenerationMessage,
  buildFavoriteMessage,
  createDiscordService,
  isDiscordWebhookUrl,
  maskWebhookUrl,
  normalizeDiscordState,
  postToDiscordWebhook
} from "../src/discord.js";
import { createHistoryService } from "../src/history.js";

const WEBHOOK = "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz";

const generation = {
  prompt: "1girl, blue eyes, masterpiece",
  negativePrompt: "low quality",
  settings: { checkpoint: "model_name.safetensors", checkpointModelName: "model_name" },
  loras: [
    { name: "character_lora", weight: 0.8 },
    { name: "style_lora", weight: 1 }
  ]
};

test("投稿本文にModel・Seed・LoRA・Promptを含める", () => {
  const { content, promptFile } = buildFavoriteMessage({ generation, image: { seed: 123456789 } });
  assert.equal(content, [
    "⭐ Favorite",
    "",
    "Model: model_name",
    "Seed: 123456789",
    "LoRA: character_lora:0.8, style_lora:1",
    "",
    "Prompt:",
    "1girl, blue eyes, masterpiece"
  ].join("\n"));
  assert.equal(promptFile, null);
});

test("メタデータ・プロンプトの除外設定を尊重する", () => {
  const noMeta = buildFavoriteMessage({ generation, image: { seed: 1 }, includeMetadata: false });
  assert.equal(noMeta.content, "⭐ Favorite\n\nPrompt:\n1girl, blue eyes, masterpiece");

  const noPrompt = buildFavoriteMessage({ generation, image: { seed: 1 }, includePrompt: false });
  assert.equal(noPrompt.content.includes("Prompt:"), false);
  assert.equal(noPrompt.content.includes("Seed: 1"), true);
  assert.equal(noPrompt.promptFile, null);
});

test("LoRAが無ければ「なし」と書く", () => {
  const { content } = buildFavoriteMessage({ generation: { ...generation, loras: [] }, image: { seed: 5 } });
  assert.match(content, /LoRA: なし/);
});

test("長すぎるPromptは切り詰めて全文をテキスト添付する", () => {
  const longPrompt = Array.from({ length: 400 }, (_, index) => `tag_${index}`).join(", ");
  const { content, promptFile } = buildFavoriteMessage({
    generation: { ...generation, prompt: longPrompt },
    image: { seed: 7 }
  });
  assert.ok(content.length <= 2000, "Discord本文の上限を超えない");
  assert.match(content, /…（全文は prompt\.txt を参照）$/);
  assert.equal(promptFile.name, "prompt.txt");
  assert.equal(promptFile.text, longPrompt);
});

test("生成完了通知はタイトル・生成メタデータ・枚数だけを含みPromptを送らない", () => {
  const { content } = buildGenerationMessage({
    generation: {
      title: "夜の街",
      description: "旧説明文",
      prompt: "secret prompt should not be sent",
      settings: { checkpointModelName: "model_name", width: 768, height: 1024 },
      images: [
        { seed: 123, width: 768, height: 1024 },
        { seed: 124, width: 768, height: 1024 },
        { seed: 125, width: 768, height: 1024 },
        { seed: 126, width: 768, height: 1024 }
      ]
    },
    startedAt: "2026-08-05T00:00:00.000Z",
    completedAt: "2026-08-05T00:00:12.345Z"
  });
  assert.match(content, /^Local Image Chatで画像生成が完了しました/);
  assert.match(content, /タイトル: 夜の街/);
  assert.match(content, /Model: model_name/);
  assert.match(content, /Seed: 123/);
  assert.match(content, /解像度: 768 × 1024/);
  assert.match(content, /生成時間: 12秒/);
  assert.match(content, /生成枚数: 4/);
  assert.equal(content.includes("secret prompt"), false);
});

test("送信先はDiscordのWebhook URLだけ許可する", () => {
  assert.equal(isDiscordWebhookUrl(WEBHOOK), true);
  assert.equal(isDiscordWebhookUrl("https://canary.discord.com/api/v10/webhooks/1234/abcd"), true);
  assert.equal(isDiscordWebhookUrl("http://discord.com/api/webhooks/1234/abcd"), false, "httpは不可");
  assert.equal(isDiscordWebhookUrl("https://example.com/api/webhooks/1234/abcd"), false, "別ドメインは不可");
  assert.equal(isDiscordWebhookUrl("https://discord.com/channels/1234"), false);
  assert.equal(isDiscordWebhookUrl(""), false);
  assert.equal(isDiscordWebhookUrl(null), false);
});

test("表示用URLはトークンを伏せる", () => {
  const masked = maskWebhookUrl(WEBHOOK);
  assert.equal(masked, "discord.com/api/webhooks/123456789012345678/••••");
  assert.equal(masked.includes("abcdefghij"), false);
});

test("送信状態は既知の値だけを受け付ける", () => {
  assert.deepEqual(normalizeDiscordState(undefined), {
    status: "not_sent", messageId: null, sentAt: null, error: ""
  });
  assert.equal(normalizeDiscordState({ status: "妙な値" }).status, "not_sent");
  assert.equal(normalizeDiscordState({ status: "sent", messageId: "42" }).messageId, "42");
});

async function setupService({ fetchImpl, webhookFromEnv = "", stored = WEBHOOK, images = null } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "local-image-chat-discord-"));
  const dataDir = path.join(directory, "data");
  const outputDir = path.join(directory, "outputs");
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });
  const imageInputs = images ?? [{ filename: "one.png", imageUrl: "/outputs/one.png", seed: 123456789 }];
  await Promise.all(imageInputs.map((image) =>
    fs.writeFile(path.join(outputDir, image.filename), Buffer.from(`fake-${image.filename}`))
  ));

  const history = createHistoryService(dataDir);
  const stored_ = await history.addGeneration({
    description: "テスト",
    ...generation,
    title: "テストタイトル",
    images: imageInputs
  });
  const service = createDiscordService({
    dataDir,
    history,
    outputDir,
    webhookFromEnv,
    fetchImpl,
    logger: { warn: () => {} }
  });
  if (stored) await service.updateSettings({ webhookUrl: stored });
  return { directory, history, service, image: stored_.images[0], stored: stored_ };
}

test("Favorite時にWebhookへ画像を送り、状態をsentにする", async (t) => {
  const calls = [];
  const { directory, service, history, image } = await setupService({
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return { ok: true, status: 200, json: async () => ({ id: "message-1" }) };
    }
  });
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  // sendForFavoriteは状態確保だけを待つ。完了はバックグラウンド。
  const started = await service.sendForFavorite(image.id);
  assert.equal(started.status, "sending");
  await waitForStatus(history, image.id, "sent");

  const state = await history.getDiscordState(image.id);
  assert.equal(state.status, "sent");
  assert.equal(state.messageId, "message-1");
  assert.ok(state.sentAt);
  assert.equal(state.error, "");

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/discord\.com\/api\/webhooks\/.+wait=true$/);
  const form = calls[0].options.body;
  const payload = JSON.parse(form.get("payload_json"));
  assert.match(payload.content, /⭐ Favorite/);
  assert.match(payload.content, /Seed: 123456789/);
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  assert.ok(form.get("files[0]"), "画像を添付する");
});

test("生成完了後の通知はFavoriteと別状態で1回だけ送り、先頭画像を添付する", async (t) => {
  const calls = [];
  const { directory, service, history, image, stored } = await setupService({
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return { ok: true, status: 200, json: async () => ({ id: "generation-message-1" }) };
    }
  });
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  await service.updateSettings({ generationAutoSend: true, generationIncludeImage: true });
  const first = await service.sendForGeneration(stored, {
    startedAt: "2026-08-05T00:00:00.000Z",
    completedAt: "2026-08-05T00:00:01.000Z"
  });
  assert.equal(first.status, "sending");
  // 同じgenerationをもう一度開始しても、先に確保した状態を再利用する。
  assert.ok(["sending", "sent"].includes((await service.sendForGeneration(stored)).status));
  await waitForStatus(history, image.id, "sent", "generation");

  assert.equal(calls.length, 1);
  const form = calls[0].options.body;
  const payload = JSON.parse(form.get("payload_json"));
  assert.match(payload.content, /Local Image Chatで画像生成が完了しました/);
  assert.match(payload.content, /生成枚数: 1/);
  assert.equal(payload.content.includes("Prompt"), false);
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  assert.ok(form.get("files[0]"), "生成完了通知へ先頭画像を添付する");
  assert.equal((await history.getDiscordState(image.id)).status, "not_sent", "Favorite状態を変更しない");
});

test("生成完了通知の添付OFF・通知OFF・test通知を分離して扱う", async (t) => {
  const calls = [];
  const fourImages = Array.from({ length: 4 }, (_, index) => ({
    filename: `image-${index + 1}.png`,
    imageUrl: `/outputs/image-${index + 1}.png`,
    seed: 100 + index,
    width: 512,
    height: 512
  }));
  const { directory, service, history, stored } = await setupService({
    images: fourImages,
    fetchImpl: async (_url, options) => {
      calls.push(options);
      return { ok: true, status: 200, json: async () => ({ id: `message-${calls.length}` }) };
    }
  });
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  // 既定OFFでは、生成完了しても送信しない。
  assert.equal((await service.sendForGeneration(stored)).status, "not_sent");
  assert.equal(calls.length, 0);
  await service.updateSettings({ generationAutoSend: true, generationIncludeImage: false });
  await service.sendForGeneration(stored);
  await waitForStatus(history, stored.images[0].id, "sent", "generation");
  assert.equal(calls.length, 1);
  const notificationPayload = JSON.parse(calls[0].body.get("payload_json"));
  assert.match(notificationPayload.content, /生成枚数: 4/);
  assert.equal(calls[0].body.get("files[0]"), null, "添付OFFでは画像を送らない");

  const testResult = await service.sendTestNotification();
  assert.equal(testResult.messageId, "message-2");
  const testPayload = JSON.parse(calls[1].body.get("payload_json"));
  assert.equal(testPayload.content, "Local Image Chat Discord通知テスト\n\n接続に成功しました。");
  assert.equal(calls[1].body.get("files[0]"), null, "test通知へ画像を添付しない");
});

test("生成完了通知のfailedだけを再送でき、sentは再送できない", async (t) => {
  let shouldFail = true;
  let calls = 0;
  const { directory, service, history, stored } = await setupService({
    fetchImpl: async () => {
      calls += 1;
      return shouldFail
        ? { ok: false, status: 500, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => ({ id: "generation-message-2" }) };
    }
  });
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  await service.updateSettings({ generationAutoSend: true });
  await service.sendForGeneration(stored);
  await waitForStatus(history, stored.images[0].id, "failed", "generation");
  assert.match((await history.getDiscordState(stored.images[0].id, "generation")).error, /HTTP 500/);
  assert.equal((await service.sendForGeneration(stored)).status, "failed", "失敗は自動再送しない");
  assert.equal(calls, 1);

  shouldFail = false;
  await service.resendGeneration(stored.images[0].id);
  await waitForStatus(history, stored.images[0].id, "sent", "generation");
  assert.equal(calls, 2);
  await assert.rejects(
    () => service.resendGeneration(stored.images[0].id),
    /すでにDiscordへ送信済み/
  );
});

test("sending・sentの画像は再送しない", async (t) => {
  let calls = 0;
  const { directory, service, history, image } = await setupService({
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => ({ id: "message-1" }) };
    }
  });
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  await service.sendForFavorite(image.id);
  await waitForStatus(history, image.id, "sent");
  // 連続でFavorite操作しても二重投稿しない
  await service.sendForFavorite(image.id);
  await service.sendForFavorite(image.id);
  await assert.rejects(() => service.resend(image.id), /送信済み/);
  assert.equal(calls, 1);

  // sending中も掴めない
  await history.failDiscordSend(image.id, "テスト");
  await history.beginDiscordSend(image.id);
  assert.equal(await history.beginDiscordSend(image.id), null);
});

test("送信に失敗すると理由付きでfailedになり、再送できる", async (t) => {
  let shouldFail = true;
  const { directory, service, history, image } = await setupService({
    fetchImpl: async () => (shouldFail
      ? { ok: false, status: 500, json: async () => ({}) }
      : { ok: true, status: 200, json: async () => ({ id: "message-2" }) })
  });
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  await service.sendForFavorite(image.id);
  await waitForStatus(history, image.id, "failed");
  const failed = await history.getDiscordState(image.id);
  assert.match(failed.error, /HTTP 500/);

  // Favoriteは取り消されない
  const recipe = await history.getRecipe(image.id);
  assert.equal(recipe.selectedImage.discord.status, "failed");

  shouldFail = false;
  await service.resend(image.id);
  await waitForStatus(history, image.id, "sent");
  assert.equal((await history.getDiscordState(image.id)).messageId, "message-2");
});

test("自動送信OFF・送信先未設定なら送信しない", async (t) => {
  let calls = 0;
  const { directory, service, history, image } = await setupService({
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => ({ id: "x" }) };
    },
    stored: null
  });
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  // 送信先が無い場合
  assert.equal((await service.sendForFavorite(image.id)).status, "not_sent");
  await assert.rejects(() => service.resend(image.id), /送信先が設定されていません/);

  // 送信先はあるが自動送信OFF
  await service.updateSettings({ webhookUrl: WEBHOOK, autoSend: false });
  assert.equal((await service.sendForFavorite(image.id)).status, "not_sent");
  assert.equal(calls, 0);

  // 自動送信OFFでも手動再送はできる
  await service.resend(image.id);
  await waitForStatus(history, image.id, "sent");
  assert.equal(calls, 1);
});

test("設定APIはWebhook URLを返さない", async (t) => {
  const { directory, service } = await setupService({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }) });
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const settings = await service.getSettings();
  assert.equal(JSON.stringify(settings).includes("abcdefghij"), false, "トークンを返さない");
  assert.equal(settings.webhookConfigured, true);
  assert.equal(settings.webhookSource, "stored");
  assert.equal(settings.webhookEditable, true);

  await assert.rejects(() => service.updateSettings({ webhookUrl: "https://example.com/hook" }), /Webhook URL/);

  const cleared = await service.updateSettings({ clearWebhook: true });
  assert.equal(cleared.webhookConfigured, false);
});

test("環境変数の送信先が最優先で、画面からは編集できない", async (t) => {
  const envWebhook = "https://discord.com/api/webhooks/999999999999999999/zzzzzzzzzzzzzzzzzzz";
  const { directory, service } = await setupService({
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    webhookFromEnv: envWebhook
  });
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const settings = await service.getSettings();
  assert.equal(settings.webhookSource, "env");
  assert.equal(settings.webhookEditable, false);
  assert.equal(settings.webhookHint, "discord.com/api/webhooks/999999999999999999/••••");
});

test("HTTPステータスごとに分かりやすい理由へ変換する", async () => {
  const image = { buffer: Buffer.from("x"), filename: "one.png", contentType: "image/png" };
  const send = (status) => postToDiscordWebhook(WEBHOOK, {
    content: "x",
    image,
    fetchImpl: async () => ({ ok: false, status, json: async () => ({}) })
  });
  await assert.rejects(() => send(413), /画像サイズ/);
  await assert.rejects(() => send(401), /送信先が無効/);
  await assert.rejects(() => send(429), /レート制限/);
});

async function waitForStatus(history, imageId, status, channelOrTimeout = "favorite", timeoutMs = 3000) {
  const channel = typeof channelOrTimeout === "string" ? channelOrTimeout : "favorite";
  if (typeof channelOrTimeout === "number") timeoutMs = channelOrTimeout;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = await history.getDiscordState(imageId, channel);
    if (state.status === status) return state;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`状態が ${status} になりませんでした`);
}
