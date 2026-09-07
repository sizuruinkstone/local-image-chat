import crypto from "node:crypto";
import path from "node:path";
import { JsonStore } from "./json-store.js";
import { normalizeContentSha256 } from "./content-hash.js";
import { normalizeDiscordState } from "./discord.js";
import { normalizeManualTitle } from "../public/history-title.js";
import { normalizeIpAdapter } from "./ip-adapter.js";

export const UNTITLED_DESCRIPTION = "無題";
export const CONTENT_RATINGS = Object.freeze(["general", "nsfw"]);
export const HISTORY_CONTENT_RATINGS = Object.freeze([...CONTENT_RATINGS, "unrated"]);

export class HistoryGenerationNotFoundError extends Error {
  constructor(generationId) {
    super(`指定された生成履歴がありません: ${generationId}`);
    this.name = "HistoryGenerationNotFoundError";
    this.code = "HISTORY_NOT_FOUND";
  }
}

const IGNORED_TAGS = new Set([
  "masterpiece", "best quality", "amazing quality", "newest", "absurdres", "highres",
  "1girl", "solo", "detailed face", "detailed eyes", "anime coloring"
]);

const DISCORD_STATE_KEYS = {
  favorite: "discord",
  generation: "discordGeneration"
};

function discordStateKey(channel) {
  return DISCORD_STATE_KEYS[channel] ?? DISCORD_STATE_KEYS.favorite;
}

export function createHistoryService(dataDir, { limit = 500 } = {}) {
  const store = new JsonStore(path.join(dataDir, "history.json"), {
    schemaVersion: 2,
    generations: []
  });

  return {
    async addGeneration(input) {
      const generation = normalizeGeneration(input);
      await store.update((data) => {
        data.generations.unshift(generation);
        data.generations = data.generations.slice(0, limit);
        return data;
      });
      return generation;
    },

    async list({ favoritesOnly = false, contentRating = "all", limit: requestedLimit = 80 } = {}) {
      const data = await store.read();
      const maximum = Math.max(1, Math.min(Number(requestedLimit) || 80, 500));
      const rating = requireHistoryContentRatingFilter(contentRating);
      return data.generations
        .map((generation) => {
          const normalized = normalizeStoredGeneration(generation);
          return {
          ...normalized,
          images: favoritesOnly
            ? normalized.images.filter((image) => image.favorite)
            : normalized.images
          };
        })
        .filter((generation) => rating === "all" || generation.contentRating === rating)
        .filter((generation) => generation.images.length)
        .slice(0, maximum);
    },

    async listPage({
      favoritesOnly = false,
      contentRating = "all",
      limit: requestedLimit = 20,
      cursor = 0,
      search = "",
      sort = "newest"
    } = {}) {
      const data = await store.read();
      const maximum = Math.max(1, Math.min(Number(requestedLimit) || 20, 100));
      const rating = requireHistoryContentRatingFilter(contentRating);
      if (!["newest", "oldest"].includes(sort)) throw new Error("履歴の並び順が不正です");
      const terms = String(search).slice(0, 2000).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
      const entries = [];
      for (const generation of data.generations) {
        const normalized = normalizeStoredGeneration(generation);
        if (rating !== "all" && normalized.contentRating !== rating) continue;
        for (const image of normalized.images) {
          if (favoritesOnly && !image.favorite) continue;
          if (terms.length) {
            const text = [normalized.title, normalized.description, normalized.prompt, normalized.negativePrompt,
              normalized.runtime?.label, normalized.settings?.checkpoint, image.id, image.seed,
              ...(normalized.loras ?? []).map(lora => lora.name)].join(" ").toLocaleLowerCase();
            if (!terms.every(term => text.includes(term))) continue;
          }
          entries.push({ generation: normalized, image });
        }
      }

      if (sort === "oldest") entries.reverse();
      const cursorId = parseCursor(cursor);
      const cursorIndex = cursorId
        ? entries.findIndex(({ image }) => image.id === cursorId)
        : -1;
      if (cursorId && cursorIndex < 0) throw new Error("履歴カーソルが見つかりません");
      const offset = cursorIndex + 1;
      const page = entries.slice(offset, offset + maximum);
      const grouped = new Map();
      for (const { generation, image } of page) {
        if (!grouped.has(generation.id)) {
          grouped.set(generation.id, { ...structuredClone(generation), images: [] });
        }
        grouped.get(generation.id).images.push(structuredClone(image));
      }
      const nextOffset = offset + page.length;
      return {
        generations: [...grouped.values()],
        limit: maximum,
        total: entries.length,
        nextCursor: nextOffset < entries.length ? page.at(-1)?.image.id ?? null : null,
        hasMore: nextOffset < entries.length
      };
    },

    async getGeneration(generationId) {
      const data = await store.read();
      const generation = data.generations.find((item) => item?.id === generationId);
      if (!generation) throw new HistoryGenerationNotFoundError(generationId);
      return structuredClone(normalizeStoredGeneration(generation));
    },

    async getImage(imageId) {
      const data = await store.read();
      const found = findImage(data, imageId);
      if (!found) throw new Error("指定された画像が履歴にありません");
      return {
        generationId: found.generation.id,
        ...structuredClone(found.image)
      };
    },

    async setFavorite(imageId, favorite) {
      let matched = null;
      await store.update((data) => {
        for (const generation of data.generations) {
          const image = generation.images.find((item) => item.id === imageId);
          if (!image) continue;
          image.favorite = Boolean(favorite);
          matched = { generationId: generation.id, ...image };
          break;
        }
        if (!matched) throw new Error("指定された画像が履歴にありません");
        return data;
      });
      return matched;
    },

    async setContentRating(imageId, contentRating) {
      const rating = requireNewContentRating(contentRating);
      let matched = null;
      await store.update((data) => {
        const found = findImage(data, imageId);
        if (!found) throw new Error("指定された画像が履歴にありません");
        found.generation.contentRating = rating;
        matched = {
          generationId: found.generation.id,
          contentRating: rating,
          imageIds: (found.generation.images ?? []).map((image) => image.id)
        };
        return data;
      });
      return structuredClone(matched);
    },

    // ---- Discord送信状態 ----

    // 「not_sent」または「failed」のときだけ「sending」を確保する。
    // 既に sending / sent なら null を返し、二重送信を防ぐ。
    async beginDiscordSend(imageId, channel = "favorite") {
      const stateKey = discordStateKey(channel);
      let claimed = null;
      await store.update((data) => {
        const found = findImage(data, imageId);
        if (!found) throw new Error("指定された画像が履歴にありません");
        const state = normalizeDiscordState(found.image[stateKey]);
        if (state.status === "sending" || state.status === "sent") return data;
        found.image[stateKey] = { ...state, status: "sending", error: "" };
        claimed = { generationId: found.generation.id, ...structuredClone(found.image) };
        return data;
      });
      return claimed;
    },

    async completeDiscordSend(imageId, { messageId = null } = {}, channel = "favorite") {
      return updateDiscordState(store, imageId, () => ({
        status: "sent",
        messageId: typeof messageId === "string" && messageId ? messageId.slice(0, 40) : null,
        sentAt: new Date().toISOString(),
        error: ""
      }), channel);
    },

    async failDiscordSend(imageId, message = "", channel = "favorite") {
      return updateDiscordState(store, imageId, (state) => ({
        ...state,
        status: "failed",
        error: String(message ?? "").slice(0, 500)
      }), channel);
    },

    async getDiscordState(imageId, channel = "favorite") {
      const stateKey = discordStateKey(channel);
      const data = await store.read();
      const found = findImage(data, imageId);
      if (!found) throw new Error("指定された画像が履歴にありません");
      return normalizeDiscordState(found.image[stateKey]);
    },

    // サーバー再起動などで「sending」のまま残った画像を再送可能な状態へ戻す。
    async recoverStuckDiscordSends() {
      let recovered = 0;
      await store.update((data) => {
        for (const generation of data.generations) {
          for (const image of generation.images) {
            for (const stateKey of Object.values(DISCORD_STATE_KEYS)) {
              const state = normalizeDiscordState(image[stateKey]);
              if (state.status !== "sending") continue;
              image[stateKey] = {
                ...state,
                status: "failed",
                error: "サーバー再起動により送信が中断されました"
              };
              recovered += 1;
            }
          }
        }
        return data;
      });
      return recovered;
    },

    async deleteImage(imageId) {
      let removed = null;
      await store.update((data) => {
        for (let index = 0; index < data.generations.length; index += 1) {
          const generation = data.generations[index];
          const imageIndex = generation.images.findIndex((item) => item.id === imageId);
          if (imageIndex < 0) continue;
          removed = { ...generation.images[imageIndex] };
          generation.images.splice(imageIndex, 1);
          // 世代の最後の1枚を消したら世代ごと削除する。
          if (!generation.images.length) data.generations.splice(index, 1);
          break;
        }
        if (!removed) throw new Error("指定された画像が履歴にありません");
        return data;
      });
      return removed;
    },

    // 実験IDに属する世代だけを取り出す（実験カード・比較画面用）。
    async listByExperiment(experimentId) {
      const data = await store.read();
      return data.generations
        .map(normalizeStoredGeneration)
        .filter((generation) => generation.experimentId === experimentId);
    },

    async deleteGeneration(generationId) {
      let removed = null;
      await store.update((data) => {
        const index = data.generations.findIndex((item) => item.id === generationId);
        if (index < 0) throw new Error("指定された世代が履歴にありません");
        removed = data.generations.splice(index, 1)[0];
        return data;
      });
      return removed;
    },

    // A/B比較の投票結果を画像へ記録する。将来の好み分析に使う。
    async setImageVote(imageId, vote) {
      let matched = null;
      await store.update((data) => {
        for (const generation of data.generations) {
          const image = generation.images.find((item) => item.id === imageId);
          if (!image) continue;
          image.vote = vote;
          image.votedAt = new Date().toISOString();
          matched = { generationId: generation.id, ...image };
          break;
        }
        if (!matched) throw new Error("指定された画像が履歴にありません");
        return data;
      });
      return matched;
    },

    async getRecipe(imageId) {
      const data = await store.read();
      for (const generation of data.generations) {
        const image = generation.images.find((item) => item.id === imageId);
        if (image) return { ...normalizeStoredGeneration(generation), selectedImage: image };
      }
      throw new Error("指定された画像が履歴にありません");
    },

    async getPreferences() {
      const data = await store.read();
      return analyzePreferences(data.generations);
    },

    // ---- 画像内容SHA-256での照合（stable-diffusion-manager 連携） ----

    // 同じ内容の画像が複数の世代にある場合は、**最新の世代**を代表とする。
    // 履歴は新しい順に積まれているので、先頭から探せば最新が見つかる。
    async getRecipeByContentSha256(sha256) {
      const key = normalizeContentSha256(sha256);
      if (!key) return null;
      const data = await store.read();
      const found = findImageByContentSha256(data, key);
      if (!found) return null;
      return { ...normalizeStoredGeneration(found.generation), selectedImage: structuredClone(found.image) };
    },

    async getFavoriteStateByContentSha256(sha256) {
      const key = normalizeContentSha256(sha256);
      if (!key) return null;
      const data = await store.read();
      const found = findImageByContentSha256(data, key);
      if (!found) return null;
      return {
        imageId: found.image.id,
        generationId: found.generation.id,
        favorite: Boolean(found.image.favorite),
        discord: normalizeDiscordState(found.image.discord)
      };
    },

    // Favorite は同じ内容の画像すべてへ反映する（表示のずれを作らないため）。
    // 返すのは最新世代の代表 1 件。
    async setFavoriteByContentSha256(sha256, favorite) {
      const key = normalizeContentSha256(sha256);
      if (!key) return null;
      const next = Boolean(favorite);
      let result = null;

      await store.update((data) => {
        const matches = collectImagesByContentSha256(data, key);
        if (!matches.length) return data;

        const representative = matches[0];
        const changed = Boolean(representative.image.favorite) !== next;
        for (const match of matches) {
          match.image.favorite = next;
        }
        result = {
          imageId: representative.image.id,
          generationId: representative.generation.id,
          filename: representative.image.filename,
          favorite: next,
          changed,
          matchedCount: matches.length,
          discord: normalizeDiscordState(representative.image.discord)
        };
        return data;
      });

      return result;
    },

    // 起動時のバックフィル用。ファイルが読める画像だけハッシュを補完する。
    // hashFile は filename を受け取り、SHA-256 か null を返す関数。
    async backfillContentHashes(hashFile) {
      const summary = { checked: 0, added: 0, existing: 0, failed: 0 };
      const data = await store.read();

      // 先に計算だけ済ませる（store.update の中で await を挟まないため）。
      const computed = new Map();
      for (const generation of data.generations) {
        for (const image of generation.images) {
          summary.checked += 1;
          if (normalizeContentSha256(image.contentSha256)) {
            summary.existing += 1;
            continue;
          }
          // 1 件の失敗で全体を止めない。
          let hash = null;
          try {
            hash = normalizeContentSha256(await hashFile(image.filename));
          } catch {
            hash = null;
          }
          if (hash) computed.set(image.id, hash);
          else summary.failed += 1;
        }
      }

      if (!computed.size) return summary;

      await store.update((current) => {
        for (const generation of current.generations) {
          for (const image of generation.images) {
            const hash = computed.get(image.id);
            // 計算中に他の経路で埋まっていたら、そちらを優先する。
            if (!hash || normalizeContentSha256(image.contentSha256)) continue;
            image.contentSha256 = hash;
            summary.added += 1;
          }
        }
        return current;
      });

      return summary;
    }
  };
}

function normalizeStoredGeneration(generation) {
  if (!generation || typeof generation !== "object") return generation;
  const runtime = normalizeRuntimeMetadata(generation.runtime);
  const { runtime: _unsafeRuntime, ...rest } = generation;
  return {
    ...rest,
    contentRating: normalizeStoredContentRating(generation.contentRating),
    ...(runtime ? { runtime } : {}),
    ipAdapter: normalizeIpAdapter(generation.ipAdapter),
    images: Array.isArray(generation.images) ? generation.images : []
  };
}

// 履歴の並び順（新しい順）のまま、最初に一致した画像を返す。
function findImageByContentSha256(data, sha256) {
  for (const generation of data.generations) {
    const image = generation.images.find(
      (item) => normalizeContentSha256(item.contentSha256) === sha256
    );
    if (image) return { generation, image };
  }
  return null;
}

// 同じ内容の画像をすべて集める（先頭が最新）。
function collectImagesByContentSha256(data, sha256) {
  const matches = [];
  for (const generation of data.generations) {
    for (const image of generation.images) {
      if (normalizeContentSha256(image.contentSha256) === sha256) {
        matches.push({ generation, image });
      }
    }
  }
  return matches;
}

function findImage(data, imageId) {
  for (const generation of data.generations) {
    const image = generation.images.find((item) => item.id === imageId);
    if (image) return { generation, image };
  }
  return null;
}

function parseCursor(value) {
  if (value === undefined || value === null || value === "" || value === 0) return null;
  const cursor = String(value);
  if (!/^[a-z0-9-]{8,80}$/i.test(cursor)) throw new Error("履歴カーソルが不正です");
  return cursor;
}

async function updateDiscordState(store, imageId, mutate, channel = "favorite") {
  const stateKey = discordStateKey(channel);
  let next = null;
  await store.update((data) => {
    const found = findImage(data, imageId);
    if (!found) throw new Error("指定された画像が履歴にありません");
    next = normalizeDiscordState(mutate(normalizeDiscordState(found.image[stateKey])));
    found.image[stateKey] = next;
    return data;
  });
  return next;
}

export function analyzePreferences(generations) {
  const tagCounts = new Map();
  const loraCounts = new Map();
  const settingCounts = new Map();
  let favoriteCount = 0;

  for (const generation of generations) {
    const likes = generation.images.filter((image) => image.favorite).length;
    if (!likes) continue;
    favoriteCount += likes;

    for (const tag of splitTags(generation.prompt)) {
      const normalized = normalizeTag(tag);
      if (!normalized || IGNORED_TAGS.has(normalized) || normalized.startsWith("<lora:")) continue;
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + likes);
    }

    for (const lora of generation.loras ?? []) {
      loraCounts.set(lora.name, (loraCounts.get(lora.name) ?? 0) + likes);
    }

    const settings = generation.settings ?? {};
    const settingKey = `${settings.width ?? "?"}×${settings.height ?? "?"} / ${settings.samplerName ?? "?"} / ${settings.steps ?? "?"} steps`;
    settingCounts.set(settingKey, (settingCounts.get(settingKey) ?? 0) + likes);
  }

  return {
    favoriteCount,
    topTags: topEntries(tagCounts, 16).map(([name, count]) => ({ name, count })),
    topLoras: topEntries(loraCounts, 8).map(([name, count]) => ({ name, count })),
    topSettings: topEntries(settingCounts, 5).map(([name, count]) => ({ name, count }))
  };
}

function normalizeGeneration(input) {
  const id = input.id ?? crypto.randomUUID();
  const mode = ["img2img", "inpaint"].includes(input.mode) ? input.mode : "txt2img";
  const runtime = normalizeRuntimeMetadata(input.runtime);
  return {
    id,
    createdAt: input.createdAt ?? new Date().toISOString(),
    kind: input.kind === "hires" ? "hires" : "candidates",
    contentRating: normalizeNewContentRating(input.contentRating),
    mode,
    parentImageId: input.parentImageId ?? null,
    // 実験グループ・派生生成のメタデータ（未使用時はnull）
    experimentId: input.experimentId ?? null,
    experimentName: input.experimentName ?? null,
    experimentType: input.experimentType ?? null,
    comparedParameter: input.comparedParameter ?? null,
    comparedValue: input.comparedValue ?? null,
    baseSeed: input.baseSeed ?? null,
    parentGenerationId: input.parentGenerationId ?? null,
    derivationType: input.derivationType ?? null,
    derivationInstruction: input.derivationInstruction ?? null,
    retryInfo: input.retryInfo ?? null,
    sourceImageId: input.sourceImageId ?? null,
    sourceImageUrl: input.sourceImageUrl ?? null,
    maskImageUrl: input.maskImageUrl ?? null,
    ipAdapter: normalizeIpAdapter(input.ipAdapter),
    // titleは生成時にサーバーで確定する。空でもdescriptionを削除せず旧履歴互換を保つ。
    title: normalizeManualTitle(input.title),
    // 日本語の説明文はPrompt生成・履歴復元用に残し、無い場合は従来どおり「無題」で保存する。
    description: String(input.description ?? "").trim().slice(0, 4000) || UNTITLED_DESCRIPTION,
    prompt: String(input.prompt ?? "").slice(0, 12000),
    negativePrompt: String(input.negativePrompt ?? "").slice(0, 12000),
    effectivePrompt: String(input.effectivePrompt ?? "").slice(0, 16000),
    effectiveNegativePrompt: String(input.effectiveNegativePrompt ?? "").slice(0, 16000),
    // 用途別プロンプトとトリガーワード（v2.14以降）。
    // 古い履歴には無いので、読み出し側はnull / falseをRaw Promptとして扱う。
    structuredPrompt: normalizeStructuredPrompt(input.structuredPrompt),
    rawPromptOverride: input.rawPromptOverride === true,
    rawPrompt: String(input.rawPrompt ?? "").slice(0, 16000),
    appliedTriggerWords: normalizeAppliedTriggerWords(input.appliedTriggerWords),
    ...(runtime ? { runtime } : {}),
    settings: structuredClone(input.settings ?? {}),
    // 実効LoRA一覧（Weightは実際に生成へ送った値、sourceは選択元）。
    loras: normalizeLoras(input.loras),
    // LoRAタグ同期の警告（重複・未インストールなど）。無ければ空配列。
    loraNotices: Array.isArray(input.loraNotices) ? structuredClone(input.loraNotices).slice(0, 20) : [],
    images: (input.images ?? []).map((image) => ({
      id: image.id ?? crypto.randomUUID(),
      imageUrl: image.imageUrl,
      filename: image.filename,
      seed: image.seed,
      width: image.width ?? input.settings?.width ?? null,
      height: image.height ?? input.settings?.height ?? null,
      favorite: Boolean(image.favorite),
      vote: image.vote ?? null,
      // 画像内容のSHA-256（v2.20以降）。stable-diffusion-manager との共通キー。
      // 古い履歴やハッシュ計算に失敗した画像はnullのままで、後から補完する。
      contentSha256: normalizeContentSha256(image.contentSha256),
      // Discord送信状態（v2.15以降）。古い履歴は not_sent として読む。
      discord: normalizeDiscordState(image.discord),
      // 生成完了通知はFavorite送信と別契機・別状態で管理する。
      discordGeneration: normalizeDiscordState(image.discordGeneration)
    }))
  };
}

export function normalizeNewContentRating(value) {
  return CONTENT_RATINGS.includes(value) ? value : "general";
}

export function normalizeStoredContentRating(value) {
  return CONTENT_RATINGS.includes(value) ? value : "unrated";
}

export function requireNewContentRating(value) {
  if (!CONTENT_RATINGS.includes(value)) throw new Error("contentRatingが不正です");
  return value;
}

export function requireHistoryContentRatingFilter(value = "all") {
  const normalized = value === undefined || value === null || value === "" ? "all" : String(value);
  if (normalized !== "all" && !HISTORY_CONTENT_RATINGS.includes(normalized)) {
    throw new Error("ratingが不正です");
  }
  return normalized;
}

export function normalizeRuntimeMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const provider = typeof value.provider === "string" ? value.provider.trim() : "";
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(id)
    || !/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(provider)) return null;
  return { id, provider };
}

// 古い履歴にはsourceが無い。UI選択だけで使っていた時代のものなので "ui" として読む。
function normalizeLoras(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((lora) => lora && typeof lora === "object")
    .map((lora) => ({
      ...structuredClone(lora),
      source: ["ui", "prompt", "both"].includes(lora.source) ? lora.source : "ui"
    }));
}

const STRUCTURED_PROMPT_FIELDS = ["character", "appearance", "composition", "situation", "style", "extra"];

// 6項目すべてを文字列として保存する。全部空なら「構造化プロンプト無し」としてnull。
function normalizeStructuredPrompt(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const sections = {};
  let filled = false;
  for (const field of STRUCTURED_PROMPT_FIELDS) {
    const value = typeof input[field] === "string" ? input[field].slice(0, 4000) : "";
    sections[field] = value;
    if (value.trim()) filled = true;
  }
  return filled ? sections : null;
}

function normalizeAppliedTriggerWords(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((item) => item && typeof item === "object" && typeof item.text === "string" && item.text.trim())
    .slice(0, 60)
    .map((item) => {
      const text = item.text.trim().slice(0, 200);
      const sourceLoraIds = Array.isArray(item.sourceLoraIds)
        ? item.sourceLoraIds.filter((value) => typeof value === "string" && value).slice(0, 8)
        : [];
      const sourceLoraId = typeof item.sourceLoraId === "string" ? item.sourceLoraId : sourceLoraIds[0] ?? "";
      const weight = Number(item.weight);
      return {
        id: typeof item.id === "string" && item.id ? item.id.slice(0, 200) : `trigger:${text.toLowerCase()}`,
        sourceLoraId,
        sourceLoraIds: sourceLoraIds.length ? sourceLoraIds : (sourceLoraId ? [sourceLoraId] : []),
        text,
        weight: Number.isFinite(weight) ? Number(Math.min(2, Math.max(0.05, weight)).toFixed(2)) : 1,
        targetField: STRUCTURED_PROMPT_FIELDS.includes(item.targetField) ? item.targetField : "extra",
        enabled: item.enabled !== false
      };
    });
}

function splitTags(value) {
  return String(value ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function normalizeTag(value) {
  return value.toLowerCase().replaceAll(/\s+/g, " ").trim();
}

function topEntries(counts, limit) {
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "ja"))
    .slice(0, limit);
}
