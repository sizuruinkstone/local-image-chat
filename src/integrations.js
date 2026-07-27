import express from "express";
import { normalizeContentSha256 } from "./content-hash.js";
import { normalizeDiscordState } from "./discord.js";

// stable-diffusion-manager との Favorite 連携。
//
// 方針:
// - Favorite と Discord 投稿の正本はこちら（local-image-chat）
// - 照合キーは画像内容の SHA-256 だけ。ファイル名・パス・UUID では照合しない
// - Discord 投稿を勝手に打たれないよう、連携キーを必須にする
// - Webhook URL・絶対パス・Discordトークンはレスポンスへ含めない

// 一括照会で一度に受け取れる件数。
export const MAX_RESOLVE_IDS = 500;

// 連携APIのヘッダー名。
export const INTEGRATION_KEY_HEADER = "x-local-integration-key";

/**
 * HTTPヘッダーへ載せられる鍵か。
 *
 * ヘッダー値は ISO-8859-1 しか運べないので、日本語などを鍵にすると
 * 送信側が送れずに必ず 401 になる。設定時点で気づけるようにする。
 */
export function isUsableIntegrationKey(value) {
  const text = String(value ?? "");
  if (!text.trim()) return false;
  // 印字可能なASCIIだけ許可する。
  return /^[\x20-\x7e]+$/.test(text);
}

// タイミング差から鍵を推測されないよう、長さを揃えて比較する。
function safeEqual(left, right) {
  const a = String(left ?? "");
  const b = String(right ?? "");
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

/**
 * Favorite 同期で Discord 送信を始めてよいか。
 *
 * 始めるのは「未送信の画像を新たに Favorite にしたとき」だけ。
 * - sending: 既存の処理を待つ
 * - sent: 再投稿しない
 * - failed: Favorite 同期では自動再送しない（明示的な再送操作を使う）
 */
export function shouldStartDiscordSend({ changed, favorite, discordStatus }) {
  if (!favorite || !changed) return false;
  return normalizeDiscordState({ status: discordStatus }).status === "not_sent";
}

/** レスポンスへ出してよい Discord 情報だけを取り出す。 */
function publicDiscordState(state) {
  const normalized = normalizeDiscordState(state);
  return {
    status: normalized.status,
    messageId: normalized.messageId,
    sentAt: normalized.sentAt,
    error: normalized.error
  };
}

/**
 * 連携ルーターを作る。
 * integrationKey が空なら、ルート自体を無効にする（503 を返す）。
 */
export function createIntegrationsRouter({ history, discord, integrationKey, onDiscordError }) {
  const router = express.Router();
  const key = String(integrationKey ?? "").trim();
  const enabled = key.length > 0;

  router.use((request, response, next) => {
    if (!enabled) {
      response.status(503).json({
        error:
          "連携APIが無効です。LOCAL_IMAGE_CHAT_INTEGRATION_KEY を設定してサーバーを再起動してください。"
      });
      return;
    }
    if (!safeEqual(request.get(INTEGRATION_KEY_HEADER), key)) {
      // 鍵の中身はログにもレスポンスにも出さない。
      response.status(401).json({ error: "連携キーが一致しません" });
      return;
    }
    next();
  });

  // Favorite の更新。Discord 投稿は条件を満たすときだけ開始する。
  router.put("/favorites/:sha256", async (request, response) => {
    const sha256 = normalizeContentSha256(request.params.sha256);
    if (!sha256) {
      response.status(400).json({ error: "SHA-256は64桁の16進数で指定してください" });
      return;
    }

    const favorite = request.body?.favorite !== false;

    try {
      const result = await history.setFavoriteByContentSha256(sha256, favorite);
      if (!result) {
        response.status(404).json({
          found: false,
          reason: "not-in-local-history",
          error: "この画像はlocal-image-chatの履歴にありません"
        });
        return;
      }

      let discordState = result.discord;
      if (shouldStartDiscordSend({
        changed: result.changed,
        favorite,
        discordStatus: result.discord.status
      })) {
        // 送信の完了は待たない。失敗しても Favorite は取り消さない。
        discordState = await discord.sendForFavorite(result.imageId).catch((error) => {
          onDiscordError?.(error);
          return result.discord;
        });
      }

      response.json({
        found: true,
        sha256,
        favorite: result.favorite,
        changed: result.changed,
        matchedCount: result.matchedCount,
        imageId: result.imageId,
        discord: publicDiscordState(discordState)
      });
    } catch (error) {
      response.status(500).json({ error: error?.message ?? String(error) });
    }
  });

  // 一覧表示用の一括照会。1 件ずつ問い合わせないためのもの。
  router.post("/favorites/resolve", async (request, response) => {
    const raw = request.body?.sha256;
    if (!Array.isArray(raw)) {
      response.status(400).json({ error: "sha256 は配列で指定してください" });
      return;
    }
    if (raw.length > MAX_RESOLVE_IDS) {
      response
        .status(400)
        .json({ error: `一度に照会できるのは ${MAX_RESOLVE_IDS} 件までです（${raw.length} 件）` });
      return;
    }

    const items = {};
    try {
      for (const value of raw) {
        const sha256 = normalizeContentSha256(value);
        // 不正な値は黙って捨てず、found:false として返す。
        if (!sha256) continue;
        if (items[sha256]) continue;
        const state = await history.getFavoriteStateByContentSha256(sha256);
        items[sha256] = state
          ? { found: true, favorite: state.favorite, discord: publicDiscordState(state.discord) }
          : { found: false };
      }
      response.json({ items });
    } catch (error) {
      response.status(500).json({ error: error?.message ?? String(error) });
    }
  });

  return router;
}
