import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createCivitaiService,
  deriveCivitaiOutfitPresets,
  parseCivitaiUrl,
  resolveLoraInstallRoot
} from "../src/civitai.js";
import { createCivitaiTokenResolver } from "../src/civitai-token.js";

test("Civitai tokenはrequest入力、起動時環境変数、空文字の順で解決する", () => {
  const withEnvironment = createCivitaiTokenResolver("  environment-token  ");
  assert.equal(withEnvironment("  request-token  "), "request-token");
  assert.equal(withEnvironment("   "), "environment-token");
  assert.equal(withEnvironment(undefined), "environment-token");

  const withoutEnvironment = createCivitaiTokenResolver(undefined);
  assert.equal(withoutEnvironment(undefined), "");
  assert.equal(withoutEnvironment("  trimmed-token  "), "trimmed-token");
  assert.equal(withoutEnvironment("x".repeat(501)).length, 500);
});

test("4つのCivitai routeが共通resolverを使い、env exampleと起動scriptに秘密値を持たない", async () => {
  const [serverSource, packageSource, envExample] = await Promise.all([
    fs.readFile(new URL("../src/server.js", import.meta.url), "utf8"),
    fs.readFile(new URL("../package.json", import.meta.url), "utf8"),
    fs.readFile(new URL("../.env.example", import.meta.url), "utf8")
  ]);
  const routeNames = ["inspect", "check-duplicate", "install", "refresh-registrations"];
  for (const routeName of routeNames) {
    const routeStart = serverSource.indexOf(`app.post("/api/civitai/${routeName}"`);
    assert.notEqual(routeStart, -1, `${routeName} routeが存在する`);
    const nextRoute = serverSource.indexOf("app.", routeStart + 10);
    const routeSource = serverSource.slice(routeStart, nextRoute === -1 ? undefined : nextRoute);
    assert.match(routeSource, /resolveCivitaiToken\(request\.body\.token\)/, `${routeName}が共通resolverを使う`);
  }
  assert.match(serverSource, /createCivitaiTokenResolver\(\s*process\.env\.LOCAL_IMAGE_CHAT_CIVITAI_TOKEN\s*\)/);
  assert.equal(envExample, "LOCAL_IMAGE_CHAT_CIVITAI_TOKEN=\n");
  assert.equal(JSON.parse(packageSource).scripts.start, "node --env-file-if-exists=.env src/server.js");
  assert.match(JSON.parse(packageSource).scripts.check, /node --check src\/civitai-token\.js/);
});

test("CivitaiモデルURLからモデルIDとバージョンIDを取得する", () => {
  assert.deepEqual(
    parseCivitaiUrl("https://civitai.com/models/1327407/example?modelVersionId=2439947"),
    { modelId: 1327407, versionId: 2439947 }
  );
  assert.throws(() => parseCivitaiUrl("https://example.com/models/1"), /civitai\.com/);
});

test("ReForgeの既存LoRAパスからWindowsのLoRAルートを推定する", () => {
  const root = resolveLoraInstallRoot("", [{
    name: "Characters/example",
    path: "C:\\AI\\Models\\Lora\\Characters\\example.safetensors"
  }]);
  assert.equal(root, "C:\\AI\\Models\\Lora");
});

test("Civitai説明文の専用トリガーを衣装ごとのプリセットへ分ける", () => {
  assert.deepEqual(deriveCivitaiOutfitPresets(
    ["EmaDefault", "EmaMilitary", "EmaRoomwear"],
    `
      <p>EmaDefault: long hair, black dress, black heels</p>
      <p>EmaMilitary: hairband, military uniform, white coat, boots</p>
      <p>EmaRoomwear: twin braids, striped hoodie, black shorts, slippers</p>
    `
  ), [
    {
      id: "civitai-outfit-emadefault",
      name: "Ema Default",
      triggerWords: "EmaDefault, long hair, black dress, black heels"
    },
    {
      id: "civitai-outfit-emamilitary",
      name: "Ema Military",
      triggerWords: "EmaMilitary, hairband, military uniform, white coat, boots"
    },
    {
      id: "civitai-outfit-emaroomwear",
      name: "Ema Roomwear",
      triggerWords: "EmaRoomwear, twin braids, striped hoodie, black shorts, slippers"
    }
  ]);
});

test("一般的な服タグを別々の衣装プリセットと誤判定しない", () => {
  assert.deepEqual(
    deriveCivitaiOutfitPresets(["march7th", "choker", "jacket", "skirt"], ""),
    [{
      id: "civitai-outfit-march7th",
      name: "march7th",
      triggerWords: "march7th"
    }]
  );
});

test("全部入りTrigger Wordsを衣装ごとのプリセットとして保持する", () => {
  assert.deepEqual(deriveCivitaiOutfitPresets([
    "mari_\\(blue_archive\\), blue eyes, orange hair, nun, white dress",
    "mari_\\(idol\\)_\\(blue_archive\\), blue eyes, orange hair, top hat, frilled dress"
  ], `
    <h3>Default:</h3><p>Trigger Words:</p><pre><code>mari_\\(blue_archive\\),</code></pre>
    <h3>Idol:</h3><p>Trigger Words:</p><pre><code>mari_\\(idol\\)_\\(blue_archive\\),</code></pre>
  `), [
    {
      id: "civitai-outfit-mari-blue-archive",
      name: "Default",
      triggerWords: "mari_\\(blue_archive\\), blue eyes, orange hair, nun, white dress"
    },
    {
      id: "civitai-outfit-mari-idol-blue-archive",
      name: "Idol",
      triggerWords: "mari_\\(idol\\)_\\(blue_archive\\), blue eyes, orange hair, top hat, frilled dress"
    }
  ]);
});

test("同じキャラトリガーの複数外見を別プリセットとして残す", () => {
  const presets = deriveCivitaiOutfitPresets([
    "dfblth, dark blue hair, blue eyes, black armor",
    "dfblth, light green hair, green eyes, black armor"
  ]);
  assert.equal(presets.length, 2);
  assert.equal(presets[0].id, "civitai-outfit-dfblth");
  assert.equal(presets[1].id, "civitai-outfit-dfblth-2");
  assert.equal(presets[1].name, "dfblth (2)");
  assert.match(presets[1].triggerWords, /light green hair/);
});

test("APIのtrainedWordsにない説明文の追加衣装を補完する", () => {
  const presets = deriveCivitaiOutfitPresets([
    "AkariUniform, twintails, white sailor shirt, plaid skirt"
  ], `
    <h3>School uniform:</h3>
    <p>Trigger Words:</p><pre><code>AkariUniform,</code></pre>
    <p>Hair:</p><pre><code>twintails, hair ribbon,</code></pre>
    <p>Clothing:</p><pre><code>white sailor shirt, plaid skirt,</code></pre>
    <h3>Military uniform:</h3>
    <p>Trigger Words:</p><pre><code>AkariMilitary,</code></pre>
    <p>Hair:</p><pre><code>long hair, single earring,</code></pre>
    <p>or</p><pre><code>short hair, single earring,</code></pre>
    <p>Clothing:</p><pre><code>off-shoulder shirt, side capelet, layered skirt,</code></pre>
  `);

  assert.equal(presets.length, 2);
  assert.deepEqual(presets[1], {
    id: "civitai-outfit-akarimilitary",
    name: "Military uniform",
    triggerWords: "AkariMilitary, long hair, single earring, off-shoulder shirt, side capelet, layered skirt"
  });
});

test("登録済みLoRAを再ダウンロードせず一括再解析する", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "local-image-chat-civitai-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dataDir, "lora-registry.json"), JSON.stringify({
    schemaVersion: 1,
    entries: [
      {
        id: "100:101",
        modelName: "更新前",
        sourceUrl: "https://civitai.com/models/100?modelVersionId=101",
        relativeName: "Characters/example",
        filename: "example.safetensors",
        category: "character",
        triggerWords: "oldTrigger",
        outfitPresets: []
      },
      {
        id: "200:201",
        modelName: "取得失敗モデル",
        sourceUrl: "https://civitai.com/models/200?modelVersionId=201",
        relativeName: "Characters/failure",
        triggerWords: "keepMe"
      }
    ]
  }));

  const receivedTokens = [];
  const service = createCivitaiService({
    dataDir,
    loraConfig: {},
    reforgeConfig: {},
    inspectCivitai: async (url, token) => {
      receivedTokens.push(token);
      if (url.includes("/200?")) throw new Error("Civitai API HTTP 429");
      return {
        modelId: 100,
        versionId: 101,
        modelName: "更新後",
        versionName: "v2",
        baseModel: "Illustrious",
        sourceUrl: url,
        trainedWords: ["NewDefault, black dress", "NewSwimsuit, bikini"],
        outfitPresets: [
          { id: "default", name: "標準", triggerWords: "NewDefault, black dress" },
          { id: "swimsuit", name: "水着", triggerWords: "NewSwimsuit, bikini" }
        ],
        recommendedWeight: 0.8,
        previewUrl: "https://example.com/preview.jpg"
      };
    }
  });

  const result = await service.refreshRegistrations("secret-token");
  assert.equal(result.total, 2);
  assert.equal(result.updated, 1);
  assert.equal(result.failed, 1);
  assert.deepEqual(receivedTokens, ["secret-token", "secret-token"]);

  const stored = JSON.parse(await fs.readFile(path.join(dataDir, "lora-registry.json"), "utf8"));
  assert.equal(stored.entries[0].modelName, "更新後");
  assert.equal(stored.entries[0].triggerWords, "NewDefault");
  assert.equal(stored.entries[0].characterTriggerWords, "NewDefault");
  assert.equal(stored.entries[0].outfitPresets.length, 2);
  assert.deepEqual(stored.entries[0].outfitPresets.map((preset) => preset.triggerWords), [
    "black dress",
    "NewSwimsuit, bikini"
  ]);
  assert.equal(stored.entries[0].category, "character");
  assert.equal(stored.entries[0].filename, "example.safetensors");
  assert.equal(stored.entries[1].triggerWords, "keepMe");
});

test("保存先フォルダ一覧をLoRAルートのサブフォルダから列挙する", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "local-image-chat-civitai-fld-"));
  const loraRoot = await fs.mkdtemp(path.join(os.tmpdir(), "local-image-chat-lora-root-"));
  t.after(() => Promise.all([
    fs.rm(dataDir, { recursive: true, force: true }),
    fs.rm(loraRoot, { recursive: true, force: true })
  ]));
  await fs.mkdir(path.join(loraRoot, "Characters", "Blue Archive"), { recursive: true });
  await fs.mkdir(path.join(loraRoot, "Characters", "Arknights"), { recursive: true });
  await fs.mkdir(path.join(loraRoot, "Style"), { recursive: true });

  const service = createCivitaiService({
    dataDir,
    loraConfig: { installDir: loraRoot },
    reforgeConfig: { url: "http://127.0.0.1:1" }, // 到達不可 → rawLoras空
    inspectCivitai: async () => ({})
  });
  const result = await service.listInstallFolders();
  assert.ok(result.folders.includes("Characters"));
  assert.ok(result.folders.includes("Characters/Blue Archive"));
  assert.ok(result.folders.includes("Characters/Arknights"));
  assert.ok(result.folders.includes("Style"));
  // 実在しない分類デフォルトは既存フォルダ一覧へ混ぜない
  assert.equal(result.folders.includes("Body"), false);
  assert.deepEqual(result.recommended.body, { folder: "Body", exists: false });
  assert.deepEqual(result.recommended.character, { folder: "Characters", exists: true });
  assert.deepEqual(result.recommended.style, { folder: "Style", exists: true });
  assert.equal(result.defaults.character, "Characters");
  // 区切りは / に統一・重複なし・昇順
  assert.ok(result.folders.every((f) => !f.includes("\\")));
  assert.equal(new Set(result.folders.map((f) => f.toLowerCase())).size, result.folders.length);
  const ascending = [...result.folders].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  assert.deepEqual(result.folders, ascending);
});

test("Civitaiインストールで指定フォルダへ保存し、不正フォルダを拒否する", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "local-image-chat-civitai-inst-"));
  const loraRoot = await fs.mkdtemp(path.join(os.tmpdir(), "local-image-chat-lora-inst-"));
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
    return Promise.all([
      fs.rm(dataDir, { recursive: true, force: true }),
      fs.rm(loraRoot, { recursive: true, force: true })
    ]);
  });
  global.fetch = async (url) => {
    const target = String(url);
    if (target.includes("/sdapi/v1/loras")) {
      return new Response(JSON.stringify([]), { headers: { "content-type": "application/json" } });
    }
    if (target.includes("download")) return new Response("fake-lora-bytes");
    return new Response("not found", { status: 404 });
  };

  const metadata = {
    modelId: 1, versionId: 2, modelName: "Test LoRA", versionName: "v1", modelType: "LORA",
    baseModel: "Illustrious", sourceUrl: "https://civitai.com/models/1?modelVersionId=2",
    trainedWords: [], outfitPresets: [], recommendedWeight: 0.75, recommendedWeightMin: null,
    recommendedWeightMax: null, recommendedWeightLabel: null, recommendedWeightSource: "fallback",
    previewUrl: "", file: { name: "myLora.safetensors", sizeKB: 1, downloadUrl: "https://download/models/2" }
  };
  const service = createCivitaiService({
    dataDir,
    loraConfig: { installDir: loraRoot },
    reforgeConfig: { url: "http://reforge.test" },
    inspectCivitai: async () => metadata
  });

  const result = await service.install({
    url: "https://civitai.com/models/1?modelVersionId=2",
    category: "character",
    folder: "characters/Blue Archive"
  });
  assert.equal(result.folder, "characters/Blue Archive");
  assert.equal(result.reusedExisting, false);
  assert.equal(result.entry.relativeName, "characters/Blue Archive/myLora");
  await fs.access(path.join(loraRoot, "characters", "Blue Archive", "myLora.safetensors"));

  // folder未指定なら分類デフォルト（Characters）へ
  await fs.rm(path.join(dataDir, "lora-registry.json"), { force: true });
  const defaulted = await service.install({
    url: "https://civitai.com/models/1?modelVersionId=2",
    category: "character"
  });
  assert.equal(defaulted.folder, "Characters");

  // LoRAルート外は拒否
  await assert.rejects(() => service.install({
    url: "https://civitai.com/models/1?modelVersionId=2",
    category: "character",
    folder: "../escape"
  }), /ルート外/);
});

test("明示した共有LoRA rootがあればReForge停止中でもCivitai LoRAを保存する", async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "local-image-chat-civitai-neo-"));
  const loraRoot = await fs.mkdtemp(path.join(os.tmpdir(), "local-image-chat-lora-neo-"));
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
    return Promise.all([
      fs.rm(dataDir, { recursive: true, force: true }),
      fs.rm(loraRoot, { recursive: true, force: true })
    ]);
  });

  global.fetch = async (url) => {
    const target = String(url);
    if (target.includes("/sdapi/v1/loras")) {
      const error = new Error("ReForge is offline");
      error.cause = { code: "ECONNREFUSED" };
      throw error;
    }
    if (target.includes("download")) return new Response("fake-neo-lora-bytes");
    return new Response("not found", { status: 404 });
  };

  const metadata = {
    modelId: 10, versionId: 20, modelName: "Neo LoRA", versionName: "v1", modelType: "LORA",
    baseModel: "Anima", sourceUrl: "https://civitai.com/models/10?modelVersionId=20",
    trainedWords: [], outfitPresets: [], recommendedWeight: 0.7, recommendedWeightMin: null,
    recommendedWeightMax: null, recommendedWeightLabel: null, recommendedWeightSource: "fallback",
    previewUrl: "", file: { name: "neo-lora.safetensors", sizeKB: 1, downloadUrl: "https://download/models/20" }
  };
  const service = createCivitaiService({
    dataDir,
    loraConfig: { installDir: loraRoot },
    reforgeConfig: { url: "http://127.0.0.1:7861" },
    inspectCivitai: async () => metadata
  });

  const result = await service.install({
    url: "https://civitai.com/models/10?modelVersionId=20",
    category: "style",
    folder: "Anima/Style"
  });
  assert.equal(result.reusedExisting, false);
  await fs.access(path.join(loraRoot, "Anima", "Style", "neo-lora.safetensors"));
  const registry = JSON.parse(await fs.readFile(path.join(dataDir, "lora-registry.json"), "utf8"));
  assert.equal(registry.entries[0].relativeName, "Anima/Style/neo-lora");
});
