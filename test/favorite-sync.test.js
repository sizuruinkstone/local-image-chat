import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createHistoryService } from "../src/history.js";
import { hashOutputImage, sha256OfBuffer } from "../src/content-hash.js";
import {
  createIntegrationsRouter,
  INTEGRATION_KEY_HEADER,
  isUsableIntegrationKey,
  MAX_RESOLVE_IDS,
  shouldStartDiscordSend
} from "../src/integrations.js";

// 鍵はHTTPヘッダーへ載せるのでASCIIだけ。
const KEY = "test-integration-key-0123456789";

async function makeDirs(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "local-image-chat-favsync-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dataDir = path.join(root, "data");
  const outputDir = path.join(root, "outputs");
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });
  return { root, dataDir, outputDir };
}

/** Discord の呼び出しを記録するだけのスタブ。実Webhookは叩かない。 */
function stubDiscord(history) {
  const calls = [];
  return {
    calls,
    async sendForFavorite(imageId) {
      calls.push(imageId);
      // 実サービスと同じく、状態を sending にして返す。
      const claimed = await history.beginDiscordSend(imageId);
      return history.getDiscordState(imageId).then((state) => (claimed ? state : state));
    }
  };
}

/** 連携ルーターだけを載せた最小アプリ。 */
function makeApp({ history, discord, integrationKey = KEY }) {
  const app = express();
  app.use(express.json());
  app.use("/api/integrations", createIntegrationsRouter({ history, discord, integrationKey }));
  return app;
}

/** supertest を使わず、listen して fetch で叩く。 */
async function withServer(app, run) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function put(base, sha256, body, key = KEY) {
  return fetch(`${base}/api/integrations/favorites/${sha256}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(key === null ? {} : { [INTEGRATION_KEY_HEADER]: key })
    },
    body: JSON.stringify(body)
  });
}

function resolve(base, sha256, key = KEY) {
  return fetch(`${base}/api/integrations/favorites/resolve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key === null ? {} : { [INTEGRATION_KEY_HEADER]: key })
    },
    body: JSON.stringify({ sha256 })
  });
}

async function seed(history, { contentSha256 = null, favorite = false, discord } = {}) {
  return history.addGeneration({
    description: "テスト",
    prompt: "1girl",
    images: [
      {
        filename: "one.png",
        imageUrl: "/outputs/one.png",
        seed: 1,
        favorite,
        contentSha256,
        ...(discord ? { discord } : {})
      }
    ]
  });
}

// ---- 履歴側 ----

test("新規画像の contentSha256 を保存し、古い履歴とも共存する", async (t) => {
  const { dataDir } = await makeDirs(t);
  const history = createHistoryService(dataDir);
  const sha = sha256OfBuffer(Buffer.from("画像"));

  const stored = await seed(history, { contentSha256: sha });
  assert.equal(stored.images[0].contentSha256, sha);

  // 古い履歴（ハッシュなし）は null で読める。
  const legacy = await seed(history, {});
  assert.equal(legacy.images[0].contentSha256, null);

  // 不正な値は保存しない。
  const invalid = await seed(history, { contentSha256: "not-a-hash" });
  assert.equal(invalid.images[0].contentSha256, null);
});

test("SHA-256で検索でき、同じ内容なら最新の世代を代表にする", async (t) => {
  const { dataDir } = await makeDirs(t);
  const history = createHistoryService(dataDir);
  const sha = sha256OfBuffer(Buffer.from("同じ画像"));

  const older = await history.addGeneration({
    description: "古い方",
    images: [{ filename: "old.png", imageUrl: "/outputs/old.png", seed: 1, contentSha256: sha }]
  });
  const newer = await history.addGeneration({
    description: "新しい方",
    images: [{ filename: "new.png", imageUrl: "/outputs/new.png", seed: 2, contentSha256: sha }]
  });

  const recipe = await history.getRecipeByContentSha256(sha);
  assert.equal(recipe.id, newer.id);
  assert.equal(recipe.description, "新しい方");
  assert.notEqual(recipe.id, older.id);

  assert.equal(await history.getRecipeByContentSha256("a".repeat(64)), null);
  assert.equal(await history.getRecipeByContentSha256("不正"), null);
});

test("Favorite は同じ内容の画像すべてへ反映する", async (t) => {
  const { dataDir } = await makeDirs(t);
  const history = createHistoryService(dataDir);
  const sha = sha256OfBuffer(Buffer.from("同じ画像"));

  await history.addGeneration({
    images: [{ filename: "old.png", imageUrl: "/outputs/old.png", seed: 1, contentSha256: sha }]
  });
  await history.addGeneration({
    images: [{ filename: "new.png", imageUrl: "/outputs/new.png", seed: 2, contentSha256: sha }]
  });

  const result = await history.setFavoriteByContentSha256(sha, true);
  assert.equal(result.favorite, true);
  assert.equal(result.changed, true);
  assert.equal(result.matchedCount, 2);

  const all = await history.list({ limit: 500 });
  const favorites = all.flatMap((generation) => generation.images).filter((image) => image.favorite);
  assert.equal(favorites.length, 2);

  // 同じ値をもう一度送っても changed は false。
  const again = await history.setFavoriteByContentSha256(sha, true);
  assert.equal(again.changed, false);

  // 履歴に無い画像。
  assert.equal(await history.setFavoriteByContentSha256("b".repeat(64), true), null);
});

test("バックフィルはファイルがある画像だけ補完する", async (t) => {
  const { dataDir, outputDir } = await makeDirs(t);
  const history = createHistoryService(dataDir);

  const bytes = Buffer.from("実ファイル");
  await fs.writeFile(path.join(outputDir, "exists.png"), bytes);

  await history.addGeneration({
    images: [
      { filename: "exists.png", imageUrl: "/outputs/exists.png", seed: 1 },
      { filename: "missing.png", imageUrl: "/outputs/missing.png", seed: 2 },
      {
        filename: "already.png",
        imageUrl: "/outputs/already.png",
        seed: 3,
        contentSha256: "c".repeat(64)
      }
    ]
  });

  const summary = await history.backfillContentHashes((filename) =>
    hashOutputImage(outputDir, filename)
  );

  assert.equal(summary.checked, 3);
  assert.equal(summary.added, 1);
  assert.equal(summary.existing, 1);
  // ファイルが無い 1 件だけ失敗。
  assert.equal(summary.failed, 1);

  const [generation] = await history.list({ limit: 10 });
  const byName = Object.fromEntries(generation.images.map((image) => [image.filename, image]));
  assert.equal(byName["exists.png"].contentSha256, sha256OfBuffer(bytes));
  assert.equal(byName["missing.png"].contentSha256, null);
  // 既にある値は再計算しない。
  assert.equal(byName["already.png"].contentSha256, "c".repeat(64));
});

test("バックフィルは1件の失敗で全体を止めない", async (t) => {
  const { dataDir } = await makeDirs(t);
  const history = createHistoryService(dataDir);
  const good = sha256OfBuffer(Buffer.from("良い方"));

  await history.addGeneration({
    images: [
      { filename: "boom.png", imageUrl: "/outputs/boom.png", seed: 1 },
      { filename: "ok.png", imageUrl: "/outputs/ok.png", seed: 2 }
    ]
  });

  const summary = await history.backfillContentHashes(async (filename) => {
    if (filename === "boom.png") throw new Error("読み込み失敗");
    return good;
  });

  assert.equal(summary.added, 1);
  assert.equal(summary.failed, 1);
});

// ---- Discord 送信条件 ----

test("Discord送信を始めるのは未送信をFavoriteにしたときだけ", () => {
  assert.equal(
    shouldStartDiscordSend({ changed: true, favorite: true, discordStatus: "not_sent" }),
    true
  );
  // すでに送信済み・送信中は始めない。
  assert.equal(
    shouldStartDiscordSend({ changed: true, favorite: true, discordStatus: "sent" }),
    false
  );
  assert.equal(
    shouldStartDiscordSend({ changed: true, favorite: true, discordStatus: "sending" }),
    false
  );
  // 失敗した画像も、Favorite同期だけでは自動再送しない。
  assert.equal(
    shouldStartDiscordSend({ changed: true, favorite: true, discordStatus: "failed" }),
    false
  );
  // 状態が変わっていない / 解除では始めない。
  assert.equal(
    shouldStartDiscordSend({ changed: false, favorite: true, discordStatus: "not_sent" }),
    false
  );
  assert.equal(
    shouldStartDiscordSend({ changed: true, favorite: false, discordStatus: "not_sent" }),
    false
  );
});

// ---- 連携API ----

test("Favorite同期でDiscord送信を1回だけ始める", async (t) => {
  const { dataDir } = await makeDirs(t);
  const history = createHistoryService(dataDir);
  const sha = sha256OfBuffer(Buffer.from("画像"));
  await seed(history, { contentSha256: sha });
  const discord = stubDiscord(history);

  await withServer(makeApp({ history, discord }), async (base) => {
    const first = await put(base, sha, { favorite: true, source: "stable-diffusion-manager" });
    assert.equal(first.status, 200);
    const body = await first.json();
    assert.equal(body.found, true);
    assert.equal(body.favorite, true);
    assert.equal(body.changed, true);
    assert.equal(body.sha256, sha);
    assert.equal(discord.calls.length, 1);

    // 同じPUTが再度届いても再投稿しない。
    const second = await put(base, sha, { favorite: true });
    const secondBody = await second.json();
    assert.equal(secondBody.changed, false);
    assert.equal(discord.calls.length, 1);
  });
});

test("送信済みの画像は解除→再Favoriteでも再送しない", async (t) => {
  const { dataDir } = await makeDirs(t);
  const history = createHistoryService(dataDir);
  const sha = sha256OfBuffer(Buffer.from("画像"));
  await seed(history, {
    contentSha256: sha,
    favorite: true,
    discord: { status: "sent", messageId: "123", sentAt: "2026-07-27T00:00:00.000Z" }
  });
  const discord = stubDiscord(history);

  await withServer(makeApp({ history, discord }), async (base) => {
    // 解除しても投稿は消さず、状態も維持する。
    const off = await put(base, sha, { favorite: false });
    const offBody = await off.json();
    assert.equal(offBody.favorite, false);
    assert.equal(offBody.discord.status, "sent");
    assert.equal(offBody.discord.messageId, "123");

    // 再Favoriteでも自動再投稿しない。
    const on = await put(base, sha, { favorite: true });
    const onBody = await on.json();
    assert.equal(onBody.changed, true);
    assert.equal(onBody.discord.status, "sent");
    assert.equal(discord.calls.length, 0);
  });
});

test("failed の画像はFavorite同期で自動再送しない", async (t) => {
  const { dataDir } = await makeDirs(t);
  const history = createHistoryService(dataDir);
  const sha = sha256OfBuffer(Buffer.from("画像"));
  await seed(history, {
    contentSha256: sha,
    discord: { status: "failed", error: "前回失敗しました" }
  });
  const discord = stubDiscord(history);

  await withServer(makeApp({ history, discord }), async (base) => {
    const response = await put(base, sha, { favorite: true });
    const body = await response.json();
    assert.equal(body.favorite, true);
    assert.equal(body.discord.status, "failed");
    assert.equal(discord.calls.length, 0);
  });
});

test("履歴にない画像は404で理由を返す", async (t) => {
  const { dataDir } = await makeDirs(t);
  const history = createHistoryService(dataDir);
  const discord = stubDiscord(history);

  await withServer(makeApp({ history, discord }), async (base) => {
    const response = await put(base, "d".repeat(64), { favorite: true });
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.found, false);
    assert.equal(body.reason, "not-in-local-history");
    assert.match(body.error, /履歴にありません/);
  });
});

test("不正なSHA-256を拒否する", async (t) => {
  const { dataDir } = await makeDirs(t);
  const history = createHistoryService(dataDir);
  const discord = stubDiscord(history);

  await withServer(makeApp({ history, discord }), async (base) => {
    for (const bad of ["short", "g".repeat(64), "a".repeat(63)]) {
      const response = await put(base, bad, { favorite: true });
      assert.equal(response.status, 400, `拒否されるべき: ${bad}`);
    }
  });
});

test("連携キーが一致しなければ拒否する", async (t) => {
  const { dataDir } = await makeDirs(t);
  const history = createHistoryService(dataDir);
  const sha = sha256OfBuffer(Buffer.from("画像"));
  await seed(history, { contentSha256: sha });
  const discord = stubDiscord(history);

  await withServer(makeApp({ history, discord }), async (base) => {
    assert.equal((await put(base, sha, { favorite: true }, "wrong-key")).status, 401);
    assert.equal((await put(base, sha, { favorite: true }, null)).status, 401);
    // 長さだけ同じで中身が違う鍵も拒否する。
    assert.equal((await put(base, sha, { favorite: true }, "x".repeat(KEY.length))).status, 401);
    assert.equal((await resolve(base, [sha], "wrong-key")).status, 401);
    // Favorite は変わっていない。
    const state = await history.getFavoriteStateByContentSha256(sha);
    assert.equal(state.favorite, false);
    assert.equal(discord.calls.length, 0);
  });
});

test("連携キーが未設定なら連携APIを無効にする", async (t) => {
  const { dataDir } = await makeDirs(t);
  const history = createHistoryService(dataDir);
  const discord = stubDiscord(history);

  await withServer(makeApp({ history, discord, integrationKey: "" }), async (base) => {
    const response = await put(base, "a".repeat(64), { favorite: true }, "anything");
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.match(body.error, /LOCAL_IMAGE_CHAT_INTEGRATION_KEY/);
  });
});

test("HTTPヘッダーへ載せられない鍵を検出する", () => {
  // ヘッダー値は ISO-8859-1 しか運べない。日本語の鍵は必ず失敗するので設定時に気づけるようにする。
  assert.equal(isUsableIntegrationKey("test-key-123"), true);
  assert.equal(isUsableIntegrationKey("a1B2!#$%&"), true);
  assert.equal(isUsableIntegrationKey("テスト用連携キー"), false);
  assert.equal(isUsableIntegrationKey(""), false);
  assert.equal(isUsableIntegrationKey("   "), false);
  assert.equal(isUsableIntegrationKey(null), false);
});

test("一括照会でFavoriteとDiscord状態をまとめて返す", async (t) => {
  const { dataDir } = await makeDirs(t);
  const history = createHistoryService(dataDir);
  const known = sha256OfBuffer(Buffer.from("ある画像"));
  const unknown = "e".repeat(64);
  await seed(history, {
    contentSha256: known,
    favorite: true,
    discord: { status: "sent", messageId: "999" }
  });
  const discord = stubDiscord(history);

  await withServer(makeApp({ history, discord }), async (base) => {
    const response = await resolve(base, [known, unknown, known]);
    assert.equal(response.status, 200);
    const body = await response.json();

    assert.equal(body.items[known].found, true);
    assert.equal(body.items[known].favorite, true);
    assert.equal(body.items[known].discord.status, "sent");
    assert.equal(body.items[unknown].found, false);

    // Webhook URL・絶対パス・トークンは返さない。
    const text = JSON.stringify(body);
    assert.equal(text.includes("discord.com"), false);
    assert.equal(text.includes("webhook"), false);
    assert.equal(text.includes(dataDir.replaceAll("\\", "/")), false);
    assert.equal(text.includes("filename"), false);
  });
});

test("一括照会は上限を超えると拒否する", async (t) => {
  const { dataDir } = await makeDirs(t);
  const history = createHistoryService(dataDir);
  const discord = stubDiscord(history);

  await withServer(makeApp({ history, discord }), async (base) => {
    const many = Array.from({ length: MAX_RESOLVE_IDS + 1 }, (_, index) =>
      index.toString(16).padStart(64, "0")
    );
    const response = await resolve(base, many);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, new RegExp(String(MAX_RESOLVE_IDS)));

    // 配列でない場合も拒否。
    assert.equal((await resolve(base, "not-an-array")).status, 400);
  });
});
