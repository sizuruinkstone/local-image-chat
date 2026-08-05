import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const ONE_PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("生成キューからReForge、履歴、👍集計までAPIが往復する", async (t) => {
  const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), "local-image-chat-api-"));
  const ollama = await startMockServer(handleOllama);
  const reforgeRequests = [];
  const reforge = await startMockServer((request, response) =>
    handleReforge(request, response, reforgeRequests)
  );
  const appPort = await reservePort();
  const configPath = path.join(temporaryDir, "config.json");
  await fs.writeFile(configPath, JSON.stringify({
    port: appPort,
    ollama: { url: `http://127.0.0.1:${ollama.port}`, model: "mock", timeoutMs: 5000 },
    reforge: { url: `http://127.0.0.1:${reforge.port}`, timeoutMs: 5000 },
    defaults: {
      width: 512,
      height: 512,
      steps: 5,
      cfgScale: 5,
      samplerName: "Euler a",
      scheduler: "Automatic",
      candidateCount: 1,
      hiresScale: 1.5,
      hiresSteps: 5,
      hiresDenoising: 0.4,
      hiresUpscaler: "Mock"
    }
  }));

  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      LOCAL_IMAGE_CHAT_CONFIG: configPath,
      LOCAL_IMAGE_CHAT_DATA_DIR: path.join(temporaryDir, "data"),
      LOCAL_IMAGE_CHAT_OUTPUT_DIR: path.join(temporaryDir, "outputs")
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  t.after(async () => {
    child.kill();
    await Promise.all([ollama.close(), reforge.close()]);
    await fs.rm(temporaryDir, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${appPort}`;
  await waitForServer(`${baseUrl}/api/config`, child);
  const checkpoints = await (await fetch(`${baseUrl}/api/checkpoints`)).json();
  assert.equal(checkpoints.activeCheckpoint, "mock.safetensors");
  assert.deepEqual(checkpoints.checkpoints.map((item) => item.title), [
    "mock.safetensors",
    "waiNSFWIllustrious_v170.safetensors"
  ]);
  const switchedCheckpoint = await postJson(`${baseUrl}/api/checkpoints/select`, {
    checkpoint: "waiNSFWIllustrious_v170.safetensors"
  });
  assert.equal(switchedCheckpoint.checkpoint, "waiNSFWIllustrious_v170.safetensors");

  const refreshRegistrations = await postJson(`${baseUrl}/api/civitai/refresh-registrations`, {});
  assert.deepEqual(refreshRegistrations, {
    total: 0,
    updated: 0,
    failed: 0,
    failures: []
  });
  const queued = await postJson(`${baseUrl}/api/jobs`, {
    description: "テスト画像",
    title: " 手動タイトル ",
    prompt: "masterpiece, 1girl, blue hair",
    negativePrompt: "low quality",
    loras: [],
    settings: {
      width: 512, height: 512, steps: 5, candidateCount: 1, noiseSchedule: "Zero Terminal SNR",
      checkpoint: "waiNSFWIllustrious_v170.safetensors", checkpointHash: "abc123def"
    }
  });
  const completed = await waitForJob(baseUrl, queued.job.id);

  assert.equal(completed.status, "done");
  assert.equal(completed.result.title, "手動タイトル");
  assert.equal(completed.result.images.length, 1);
  assert.match(completed.result.images[0].id, /^[a-z0-9-]+$/i);
  assert.equal(reforgeRequests.noiseSchedule, "Zero Terminal SNR", "生成前にNoise scheduleをoptionsへ送る");

  const image = completed.result.images[0];
  assert.equal(image.thumbnailUrl, `/api/images/${image.id}/thumbnail`);
  assert.equal(image.originalUrl, `/api/images/${image.id}/original`);
  assert.equal(JSON.stringify(completed.result).includes("data:image"), false, "生成結果へdata URLを返さない");
  assert.equal(JSON.stringify(completed.result).includes(ONE_PIXEL_PNG), false, "生成結果へbase64を返さない");

  const historyPageResponse = await fetch(`${baseUrl}/api/history?limit=1`);
  const historyPage = await historyPageResponse.json();
  assert.equal(historyPage.generations.flatMap((item) => item.images).length, 1);
  assert.equal(historyPage.limit, 1);
  assert.equal(historyPage.total, 1);
  assert.equal(historyPage.generations[0].title, "手動タイトル");
  assert.equal(historyPage.hasMore, false);
  assert.equal(JSON.stringify(historyPage).includes("base64"), false, "履歴APIへbase64を含めない");
  assert.equal(historyPage.generations[0].images[0].thumbnailUrl, image.thumbnailUrl);

  const thumbnailResponse = await fetch(`${baseUrl}${image.thumbnailUrl}`);
  assert.equal(thumbnailResponse.status, 200);
  assert.equal(thumbnailResponse.headers.get("content-type"), "image/webp");
  assert.equal(thumbnailResponse.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.ok(Number(thumbnailResponse.headers.get("content-length")) > 0);

  const generatedOutputFile = path.join(temporaryDir, "outputs", path.basename(image.imageUrl));
  const generatedThumbnailFile = path.join(
    temporaryDir, "outputs", "thumbnails", `${image.id}.webp`
  );
  const hiddenOutputFile = `${generatedOutputFile}.missing-test`;
  await fs.rename(generatedOutputFile, hiddenOutputFile);
  await fs.rm(generatedThumbnailFile, { force: true });
  try {
    const missingThumbnail = await fetch(`${baseUrl}${image.thumbnailUrl}`);
    assert.equal(missingThumbnail.status, 404, "原画像がないオンデマンド生成は404を返す");
    const missingBody = await missingThumbnail.json();
    assert.equal(
      missingBody.error,
      "原画像が見つからないためサムネイルを生成できません",
      "ローカルパスや内部例外をUIへ返さない"
    );
    assert.equal(JSON.stringify(missingBody).includes(temporaryDir), false);
  } finally {
    await fs.rename(hiddenOutputFile, generatedOutputFile);
  }
  const regeneratedThumbnail = await fetch(`${baseUrl}${image.thumbnailUrl}`);
  assert.equal(regeneratedThumbnail.status, 200, "原画像を戻すとオンデマンドで再生成できる");
  assert.equal(regeneratedThumbnail.headers.get("content-type"), "image/webp");

  const originalResponse = await fetch(`${baseUrl}${image.originalUrl}`);
  assert.equal(originalResponse.status, 200);
  assert.equal(originalResponse.headers.get("content-type"), "image/png");
  assert.equal(originalResponse.headers.get("cache-control"), "public, max-age=31536000, immutable");
  const originalEtag = originalResponse.headers.get("etag");
  assert.ok(originalEtag, "原寸画像にETagが付く");
  const cachedOriginal = await fetch(`${baseUrl}${image.originalUrl}`, {
    headers: { "If-None-Match": originalEtag }
  });
  assert.equal(cachedOriginal.status, 304, "同じ原寸画像は条件付きリクエストで再転送しない");

  const traversal = await fetch(`${baseUrl}/api/images/${encodeURIComponent("../secret")}/original`);
  assert.equal([404, 422].includes(traversal.status), true, "不正な画像IDを拒否する");

  const savedRecipe = await (await fetch(`${baseUrl}/api/history/${image.id}/recipe`)).json();
  assert.equal(savedRecipe.settings.checkpoint, "waiNSFWIllustrious_v170.safetensors", "Checkpoint名が履歴へ保存される");
  assert.equal(savedRecipe.settings.checkpointHash, "abc123def", "Checkpoint hashが履歴へ保存される");

  // 用途別プロンプトとLoRAトリガーワードが履歴へそのまま残る（復元用）。
  const structuredQueued = await postJson(`${baseUrl}/api/jobs`, {
    description: "構造化プロンプトのテスト",
    titleMode: "character-outfit",
    prompt: "1girl, (character_name:1.2), classroom",
    negativePrompt: "low quality",
    structuredPrompt: {
      character: "1girl, solo, character_name",
      appearance: "sailor uniform",
      situation: "classroom",
      unknown: "無視される"
    },
    rawPromptOverride: false,
    rawPrompt: "",
    appliedTriggerWords: [{
      id: "trigger:character_name",
      sourceLoraId: "Characters/test",
      sourceLoraIds: ["Characters/test"],
      text: "character_name",
      weight: 1.2,
      targetField: "character",
      enabled: true
    }],
    // 画面側でプロンプトへ組み込み済みなので、triggerWordsは空で送る。
    loras: [
      {
        name: "Characters/test",
        weight: 0.8,
        enabled: true,
        triggerWords: "",
        characterTriggerWords: "character_name",
        outfitChoiceId: "preset:dreaming",
        outfitPresetName: "dreaming_high",
        outfitTriggerWords: "dreaming_high, white_jacket"
      },
      {
        name: "Characters/off",
        weight: 0.7,
        enabled: false,
        triggerWords: "must_not_be_sent"
      }
    ],
    settings: { width: 512, height: 512, steps: 5, candidateCount: 1 }
  });
  const structuredCompleted = await waitForJob(baseUrl, structuredQueued.job.id);
  assert.equal(structuredCompleted.status, "done");
  assert.equal(structuredCompleted.result.title, "character_name · sailor uniform");
  assert.deepEqual(structuredCompleted.result.structuredPrompt, {
    character: "1girl, solo, character_name",
    appearance: "sailor uniform",
    composition: "",
    situation: "classroom",
    style: "",
    extra: ""
  });
  assert.equal(structuredCompleted.result.appliedTriggerWords[0].weight, 1.2);
  // LoRA本体のWeightとトリガーワードのWeightは別管理。
  assert.equal(structuredCompleted.result.loras[0].weight, 0.8);
  assert.equal(structuredCompleted.result.loras[0].enabled, true);
  assert.equal(structuredCompleted.result.loras[0].characterTriggerWords, "character_name");
  assert.equal(structuredCompleted.result.loras[0].outfitChoiceId, "preset:dreaming");
  assert.equal(structuredCompleted.result.loras[0].outfitPresetName, "dreaming_high");
  assert.equal(structuredCompleted.result.loras[0].outfitTriggerWords, "dreaming_high, white_jacket");
  assert.equal(structuredCompleted.result.loras[1].enabled, false);
  assert.equal(
    structuredCompleted.result.effectivePrompt,
    "1girl, (character_name:1.2), classroom, <lora:Characters/test:0.8>",
    "組み込み済みのトリガーワードをサーバーが二重に追記しない"
  );
  assert.equal(structuredCompleted.result.effectivePrompt.includes("Characters/off"), false);
  assert.equal(structuredCompleted.result.effectivePrompt.includes("must_not_be_sent"), false);
  const structuredRecipe = await (await fetch(
    `${baseUrl}/api/history/${structuredCompleted.result.images[0].id}/recipe`
  )).json();
  assert.equal(structuredRecipe.structuredPrompt.situation, "classroom");
  assert.equal(structuredRecipe.rawPromptOverride, false);
  assert.equal(structuredRecipe.appliedTriggerWords[0].targetField, "character");
  assert.equal(structuredRecipe.loras[0].outfitChoiceId, "preset:dreaming");
  assert.equal(structuredRecipe.loras[1].enabled, false);
  await fetch(`${baseUrl}/api/history/${structuredCompleted.result.images[0].id}`, { method: "DELETE" });

  // プロンプト内のLoRAタグが実効Weightとして履歴へ残り、重複タグは1つにまとめられる。
  const loraTagQueued = await postJson(`${baseUrl}/api/jobs`, {
    description: "LoRAタグ同期",
    prompt: "1girl, <lora:Characters/saileach_IL:0.6>, blue eyes, <lora:Characters/saileach_IL:0.65>",
    negativePrompt: "low quality",
    // UI側は古い1.0のまま送っても、実際に使ったWeightへ揃える。
    loras: [{ name: "Characters/saileach_IL", weight: 1, source: "both" }],
    loraNotices: [{ type: "duplicate", name: "Characters/saileach_IL", weights: [0.6, 0.65], weight: 0.65 }],
    settings: { width: 512, height: 512, steps: 5, candidateCount: 1 }
  });
  const loraTagCompleted = await waitForJob(baseUrl, loraTagQueued.job.id);
  assert.equal(loraTagCompleted.status, "done");
  assert.equal(
    loraTagCompleted.result.effectivePrompt,
    "1girl, blue eyes, <lora:Characters/saileach_IL:0.65>",
    "同一LoRAは最後の1つだけを生成へ送る"
  );
  assert.deepEqual(loraTagCompleted.result.loras, [{
    name: "Characters/saileach_IL",
    weight: 0.65,
    triggerWords: "",
    negativeWords: "",
    source: "both"
  }]);
  const loraTagRecipe = await (await fetch(
    `${baseUrl}/api/history/${loraTagCompleted.result.images[0].id}/recipe`
  )).json();
  assert.equal(loraTagRecipe.loras[0].weight, 0.65, "履歴のWeightがeffectivePromptと一致する");
  assert.equal(loraTagRecipe.loras[0].source, "both");
  assert.equal(loraTagRecipe.prompt.includes("<lora:Characters/saileach_IL:0.6>"), true, "元の入力は残す");
  // 画面側で報告済みの重複は二重に記録しない。
  assert.deepEqual(loraTagRecipe.loraNotices, [
    { type: "duplicate", name: "Characters/saileach_IL", weights: [0.6, 0.65], weight: 0.65 }
  ]);
  await fetch(`${baseUrl}/api/history/${loraTagCompleted.result.images[0].id}`, { method: "DELETE" });

  // 説明文なしでもPromptがあれば生成でき、履歴には「無題」で残る。
  const untitledQueued = await postJson(`${baseUrl}/api/jobs`, {
    prompt: "1girl, untitled run",
    negativePrompt: "low quality",
    loras: [],
    settings: { width: 512, height: 512, steps: 5, candidateCount: 1 }
  });
  const untitledCompleted = await waitForJob(baseUrl, untitledQueued.job.id);
  assert.equal(untitledCompleted.status, "done");
  const untitledRecipe = await (await fetch(
    `${baseUrl}/api/history/${untitledCompleted.result.images[0].id}/recipe`
  )).json();
  assert.equal(untitledRecipe.description, "無題");
  assert.equal(untitledRecipe.prompt, "1girl, untitled run");
  await fetch(`${baseUrl}/api/history/${untitledCompleted.result.images[0].id}`, { method: "DELETE" });

  // 説明文もPromptも無い場合は拒否する。
  const emptyQueued = await postJson(`${baseUrl}/api/jobs`, {
    loras: [],
    settings: { width: 512, height: 512, steps: 5, candidateCount: 1 }
  });
  const emptyFinished = await waitForJob(baseUrl, emptyQueued.job.id);
  assert.equal(emptyFinished.status, "failed");
  assert.match(emptyFinished.error, /生成したい内容かPrompt/);
  const favorited = await patchJson(`${baseUrl}/api/history/${image.id}/favorite`, { favorite: true });
  const preferences = await (await fetch(`${baseUrl}/api/history/preferences`)).json();
  assert.equal(preferences.favoriteCount, 1);
  assert.equal(preferences.topTags[0].name, "blue hair");

  // Discord: 送信先が未設定でもFavoriteは成功し、状態はnot_sentのまま。
  assert.equal(favorited.image.favorite, true);
  assert.deepEqual(favorited.image.discord, {
    status: "not_sent", messageId: null, sentAt: null, error: ""
  });
  const discordState = await (await fetch(`${baseUrl}/api/history/${image.id}/discord`)).json();
  assert.equal(discordState.discord.status, "not_sent");
  const noTarget = await fetch(`${baseUrl}/api/history/${image.id}/discord/send`, { method: "POST" });
  assert.equal(noTarget.status, 409);
  assert.match((await noTarget.json()).error, /送信先が設定されていません/);

  // 設定APIはWebhook URLを返さない。Discord以外のURLは拒否する。
  const discordSettings = await (await fetch(`${baseUrl}/api/discord/settings`)).json();
  assert.deepEqual(Object.keys(discordSettings.settings).sort(), [
    "autoSend", "generationAttachmentMode", "generationAutoSend", "generationIncludeDuration",
    "generationIncludeImage", "generationIncludeModel", "generationIncludeSeed", "generationIncludeTitle",
    "includeMetadata", "includePrompt", "storedWebhookConfigured",
    "webhookConfigured", "webhookEditable", "webhookHint", "webhookSource"
  ]);
  assert.equal(discordSettings.settings.webhookConfigured, false);
  const rejected = await fetch(`${baseUrl}/api/discord/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ webhookUrl: "https://example.com/api/webhooks/1/abc" })
  });
  assert.equal(rejected.status, 400);
  const savedSettings = await patchJson(`${baseUrl}/api/discord/settings`, {
    webhookUrl: "https://discord.com/api/webhooks/123456789012345678/token-value-here",
    autoSend: false,
    includePrompt: false
  });
  assert.equal(savedSettings.settings.webhookConfigured, true);
  assert.equal(savedSettings.settings.autoSend, false);
  assert.equal(savedSettings.settings.includePrompt, false);
  assert.equal(JSON.stringify(savedSettings).includes("token-value-here"), false, "Webhook URLを返さない");
  assert.equal(savedSettings.settings.webhookHint, "discord.com/api/webhooks/123456789012345678/••••");
  await patchJson(`${baseUrl}/api/discord/settings`, { clearWebhook: true, autoSend: true, includePrompt: true });

  const favoritesDir = path.join(temporaryDir, "outputs", "favorite");
  const favoritedFile = path.join(favoritesDir, path.basename(image.imageUrl));
  assert.ok(await fileExists(favoritedFile), "お気に入りにするとoutputs/favoriteへ複製する");
  const favoriteResponse = await fetch(`${baseUrl}/favorites/${path.basename(image.imageUrl)}`);
  assert.equal(favoriteResponse.status, 200);

  await patchJson(`${baseUrl}/api/history/${image.id}/favorite`, { favorite: false });
  assert.equal(await fileExists(favoritedFile), false, "お気に入り解除でoutputs/favoriteから削除する");

  await patchJson(`${baseUrl}/api/history/${image.id}/favorite`, { favorite: true });

  // 履歴削除: 出力ファイル・お気に入り複製・履歴エントリがすべて消える
  const outputFile = path.join(temporaryDir, "outputs", path.basename(image.imageUrl));
  assert.ok(await fileExists(outputFile), "削除前は出力ファイルが存在する");
  const deleteResult = await (await fetch(`${baseUrl}/api/history/${image.id}`, { method: "DELETE" })).json();
  assert.equal(deleteResult.ok, true);
  assert.equal(await fileExists(outputFile), false, "削除でoutputファイルも消える");
  assert.equal(
    await fileExists(path.join(temporaryDir, "outputs", "thumbnails", `${image.id}.webp`)),
    false,
    "削除でサムネイルも消える"
  );
  assert.equal(await fileExists(favoritedFile), false, "削除でお気に入り複製も消える");
  const goneRecipe = await fetch(`${baseUrl}/api/history/${image.id}/recipe`);
  assert.equal(goneRecipe.status, 404, "削除後は履歴から引けない");
  const gonePreferences = await (await fetch(`${baseUrl}/api/history/preferences`)).json();
  assert.equal(gonePreferences.favoriteCount, 0, "削除で👍集計からも外れる");

  const img2imgQueued = await postJson(`${baseUrl}/api/jobs`, {
    mode: "img2img",
    description: "衣装だけ変更",
    prompt: "masterpiece, 1girl, red dress",
    negativePrompt: "low quality",
    initImage: `data:image/png;base64,${ONE_PIXEL_PNG}`,
    loras: [],
    settings: {
      width: 512,
      height: 512,
      steps: 5,
      candidateCount: 1,
      img2imgDenoising: 0.45,
      img2imgResizeMode: 2
    }
  });
  const img2imgCompleted = await waitForJob(baseUrl, img2imgQueued.job.id);
  assert.equal(img2imgCompleted.status, "done");
  assert.equal(img2imgCompleted.result.mode, "img2img");
  assert.match(img2imgCompleted.result.sourceImageUrl, /^\/outputs\/img2img-source_[a-f0-9]{20}\.png$/);

  const img2imgRequest = reforgeRequests.find((item) => item.url === "/sdapi/v1/img2img");
  assert.ok(img2imgRequest);
  assert.equal(img2imgRequest.body.init_images[0], ONE_PIXEL_PNG);
  assert.equal(img2imgRequest.body.denoising_strength, 0.45);
  assert.equal(img2imgRequest.body.resize_mode, 2);

  const img2imgImage = img2imgCompleted.result.images[0];
  const recipeResponse = await fetch(`${baseUrl}/api/history/${img2imgImage.id}/recipe`);
  const recipe = await recipeResponse.json();
  assert.equal(recipe.mode, "img2img");
  assert.equal(recipe.sourceImageUrl, img2imgCompleted.result.sourceImageUrl);

  const inpaintQueued = await postJson(`${baseUrl}/api/jobs`, {
    mode: "inpaint",
    description: "上着だけ変更",
    prompt: "masterpiece, 1girl, white jacket",
    negativePrompt: "low quality",
    initImageId: img2imgImage.id,
    maskImage: `data:image/png;base64,${ONE_PIXEL_PNG}`,
    loras: [],
    settings: {
      width: 512,
      height: 512,
      steps: 5,
      candidateCount: 1,
      img2imgResizeMode: 1,
      inpaintDenoising: 0.55,
      maskBlur: 6,
      inpaintFill: 1,
      inpaintFullRes: true,
      inpaintFullResPadding: 32
    }
  });
  const inpaintCompleted = await waitForJob(baseUrl, inpaintQueued.job.id);
  assert.equal(inpaintCompleted.status, "done");
  assert.equal(inpaintCompleted.result.mode, "inpaint");
  assert.match(inpaintCompleted.result.maskImageUrl, /^\/outputs\/inpaint-mask_[a-f0-9]{20}\.png$/);

  const inpaintRequest = reforgeRequests.filter((item) => item.url === "/sdapi/v1/img2img").at(-1);
  assert.equal(inpaintRequest.body.mask, ONE_PIXEL_PNG);
  assert.equal(inpaintRequest.body.denoising_strength, 0.55);
  assert.equal(inpaintRequest.body.mask_blur, 6);
  assert.equal(inpaintRequest.body.inpainting_fill, 1);
  assert.equal(inpaintRequest.body.inpaint_full_res, true);
  assert.equal(inpaintRequest.body.inpaint_full_res_padding, 32);
  assert.equal(inpaintRequest.body.inpainting_mask_invert, 0);

  const inpaintImage = inpaintCompleted.result.images[0];
  const inpaintRecipe = await (await fetch(`${baseUrl}/api/history/${inpaintImage.id}/recipe`)).json();
  assert.equal(inpaintRecipe.mode, "inpaint");
  assert.equal(inpaintRecipe.maskImageUrl, inpaintCompleted.result.maskImageUrl);

  const refineQueued = await postJson(`${baseUrl}/api/jobs`, {
    mode: "img2img",
    description: "高解像度仕上げ",
    prompt: "masterpiece, 1girl, red dress",
    negativePrompt: "low quality",
    initImageId: img2imgImage.id,
    parentImageId: img2imgImage.id,
    loras: [],
    settings: {
      width: 512,
      height: 512,
      steps: 5,
      candidateCount: 1,
      img2imgDenoising: 0.45,
      img2imgResizeMode: 1,
      hiresEnabled: true,
      hiresScale: 1.5,
      hiresSteps: 7,
      hiresDenoising: 0.32
    }
  });
  const refined = await waitForJob(baseUrl, refineQueued.job.id);
  assert.equal(refined.status, "done");
  assert.equal(refined.result.images[0].width, 768);
  assert.equal(refined.result.images[0].height, 768);
  const refineRequest = reforgeRequests.filter((item) => item.url === "/sdapi/v1/img2img").at(-1);
  assert.equal(refineRequest.body.width, 768);
  assert.equal(refineRequest.body.height, 768);
  assert.equal(refineRequest.body.steps, 7);
  assert.equal(refineRequest.body.denoising_strength, 0.32);
  assert.equal(refineRequest.body.enable_hr, undefined);

  const inpaintRefineQueued = await postJson(`${baseUrl}/api/jobs`, {
    mode: "inpaint",
    description: "部分修正の高解像度仕上げ",
    prompt: "masterpiece, 1girl, white jacket",
    negativePrompt: "low quality",
    initImageId: inpaintImage.id,
    parentImageId: inpaintImage.id,
    loras: [],
    settings: {
      width: 512,
      height: 512,
      steps: 5,
      candidateCount: 1,
      img2imgResizeMode: 1,
      inpaintDenoising: 0.55,
      hiresEnabled: true,
      hiresScale: 1.5,
      hiresSteps: 7,
      hiresDenoising: 0.3
    }
  });
  const inpaintRefined = await waitForJob(baseUrl, inpaintRefineQueued.job.id);
  assert.equal(inpaintRefined.status, "done");
  assert.equal(inpaintRefined.result.mode, "inpaint");
  const inpaintRefineRequest = reforgeRequests.filter((item) => item.url === "/sdapi/v1/img2img").at(-1);
  assert.equal(inpaintRefineRequest.body.mask, undefined);
  assert.equal(inpaintRefineRequest.body.denoising_strength, 0.3);
  assert.equal(inpaintRefineRequest.body.width, 768);
  assert.equal(inpaintRefineRequest.body.height, 768);
});

function handleOllama(request, response) {
  if (request.url === "/api/tags") return json(response, { models: [{ name: "mock" }] });
  if (request.url === "/api/generate") return json(response, { response: "masterpiece, 1girl, blue hair" });
  response.writeHead(404).end();
}

async function handleReforge(request, response, requests) {
  if (request.url === "/sdapi/v1/options" && request.method === "POST") {
    const body = JSON.parse(await readBody(request));
    if (body.sd_model_checkpoint !== undefined) requests.activeCheckpoint = body.sd_model_checkpoint;
    if (body.sd_noise_schedule_sampling !== undefined) requests.noiseSchedule = body.sd_noise_schedule_sampling;
    return json(response, {});
  }
  if (request.url === "/sdapi/v1/options") {
    return json(response, { sd_model_checkpoint: requests.activeCheckpoint ?? "mock.safetensors" });
  }
  if (request.url === "/sdapi/v1/sd-models") {
    return json(response, [
      { title: "mock.safetensors", model_name: "mock", filename: "C:\\Models\\mock.safetensors" },
      {
        title: "waiNSFWIllustrious_v170.safetensors",
        model_name: "waiNSFWIllustrious_v170",
        filename: "C:\\Models\\waiNSFWIllustrious_v170.safetensors"
      }
    ]);
  }
  if (request.url === "/sdapi/v1/loras") return json(response, []);
  if (request.url?.startsWith("/sdapi/v1/progress")) return json(response, { progress: 0.5, eta_relative: 1 });
  if (request.url === "/sdapi/v1/upscalers") return json(response, [{ name: "Mock" }]);
  if (request.url === "/sdapi/v1/refresh-loras") return json(response, {});
  if (request.url === "/sdapi/v1/txt2img" || request.url === "/sdapi/v1/img2img") {
    const text = await readBody(request);
    requests.push({ url: request.url, body: JSON.parse(text) });
    return json(response, {
      images: [ONE_PIXEL_PNG],
      info: JSON.stringify({ seed: 123, all_seeds: [123] })
    });
  }
  response.writeHead(404).end();
}

function startMockServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((request, response) => {
      Promise.resolve(handler(request, response)).catch((error) => {
        response.writeHead(500).end(error.message);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({
      port: server.address().port,
      close: () => new Promise((done) => server.close(done))
    }));
  });
}

async function reservePort() {
  const server = await startMockServer((_request, response) => response.end());
  const { port } = server;
  await server.close();
  return port;
}

function json(response, body) {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  let text = "";
  for await (const chunk of request) text += chunk;
  return text;
}

async function waitForServer(url, child) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5000) {
    if (child.exitCode !== null) throw new Error(`server exited with ${child.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // 起動待ち
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("server start timeout");
}

async function waitForJob(baseUrl, id) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5000) {
    const data = await (await fetch(`${baseUrl}/api/jobs/${id}`)).json();
    if (["done", "failed", "cancelled"].includes(data.job.status)) return data.job;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error("job timeout");
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return response.json();
}

async function patchJson(url, body) {
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return response.json();
}
