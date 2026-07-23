import crypto from "node:crypto";
import path from "node:path";
import { JsonStore } from "./json-store.js";

const IGNORED_TAGS = new Set([
  "masterpiece", "best quality", "amazing quality", "newest", "absurdres", "highres",
  "1girl", "solo", "detailed face", "detailed eyes", "anime coloring"
]);

export function createHistoryService(dataDir, { limit = 500 } = {}) {
  const store = new JsonStore(path.join(dataDir, "history.json"), {
    schemaVersion: 1,
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

    async list({ favoritesOnly = false, limit: requestedLimit = 80 } = {}) {
      const data = await store.read();
      const maximum = Math.max(1, Math.min(Number(requestedLimit) || 80, 500));
      return data.generations
        .map((generation) => ({
          ...generation,
          images: favoritesOnly
            ? generation.images.filter((image) => image.favorite)
            : generation.images
        }))
        .filter((generation) => generation.images.length)
        .slice(0, maximum);
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

    async getRecipe(imageId) {
      const data = await store.read();
      for (const generation of data.generations) {
        const image = generation.images.find((item) => item.id === imageId);
        if (image) return { ...generation, selectedImage: image };
      }
      throw new Error("指定された画像が履歴にありません");
    },

    async getPreferences() {
      const data = await store.read();
      return analyzePreferences(data.generations);
    }
  };
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
  return {
    id,
    createdAt: input.createdAt ?? new Date().toISOString(),
    kind: input.kind === "hires" ? "hires" : "candidates",
    mode,
    parentImageId: input.parentImageId ?? null,
    sourceImageId: input.sourceImageId ?? null,
    sourceImageUrl: input.sourceImageUrl ?? null,
    maskImageUrl: input.maskImageUrl ?? null,
    description: String(input.description ?? "").slice(0, 4000),
    prompt: String(input.prompt ?? "").slice(0, 12000),
    negativePrompt: String(input.negativePrompt ?? "").slice(0, 12000),
    effectivePrompt: String(input.effectivePrompt ?? "").slice(0, 16000),
    effectiveNegativePrompt: String(input.effectiveNegativePrompt ?? "").slice(0, 16000),
    settings: structuredClone(input.settings ?? {}),
    loras: structuredClone(input.loras ?? []),
    images: (input.images ?? []).map((image) => ({
      id: image.id ?? crypto.randomUUID(),
      imageUrl: image.imageUrl,
      filename: image.filename,
      seed: image.seed,
      width: image.width ?? input.settings?.width ?? null,
      height: image.height ?? input.settings?.height ?? null,
      favorite: Boolean(image.favorite)
    }))
  };
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
