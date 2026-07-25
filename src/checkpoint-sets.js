import crypto from "node:crypto";
import path from "node:path";
import { JsonStore } from "./json-store.js";

// Checkpointごとの「よく使うLoRA + 生成設定」をまとめたセット。
// 既存のCheckpointプロフィール（public/checkpoint-profiles.js）とは独立で、
// data/checkpoint-lora-sets.json へ保存する。

const NUMERIC_SETTINGS = {
  steps: [1, 80],
  cfgScale: [1, 20],
  width: [256, 1536],
  height: [256, 1536],
  hiresScale: [1, 2],
  hiresSteps: [1, 50],
  hiresDenoising: [0.1, 0.8]
};

const TEXT_SETTINGS = ["samplerName", "scheduler", "noiseSchedule", "hiresUpscaler"];

export function normalizeSetInput(input = {}) {
  const name = String(input.name ?? "").trim().slice(0, 120);
  if (!name) throw new Error("セット名を入力してください");
  const checkpoint = String(input.checkpoint ?? "").trim().slice(0, 400);
  if (!checkpoint) throw new Error("Checkpointを選択してください");

  const loras = (Array.isArray(input.loras) ? input.loras : [])
    .filter((lora) => lora && typeof lora.name === "string" && lora.name.trim())
    .slice(0, 8)
    .map((lora) => ({
      name: lora.name.trim().slice(0, 200),
      weight: bounded(lora.weight, 0.7, 0.05, 2),
      triggerWords: text(lora.triggerWords, 500),
      negativeWords: text(lora.negativeWords, 500)
    }));

  const source = input.settings && typeof input.settings === "object" ? input.settings : {};
  const settings = {};
  for (const [key, [min, max]] of Object.entries(NUMERIC_SETTINGS)) {
    if (source[key] === undefined || source[key] === "" || source[key] === null) continue;
    settings[key] = bounded(source[key], min, min, max);
  }
  for (const key of TEXT_SETTINGS) {
    if (typeof source[key] !== "string" || !source[key].trim()) continue;
    settings[key] = source[key].trim().slice(0, 100);
  }
  if (source.hiresEnabled !== undefined) settings.hiresEnabled = source.hiresEnabled === true;

  return {
    name,
    checkpoint,
    autoApply: input.autoApply === true,
    loras,
    settings,
    prompt: text(input.prompt, 4000),
    negativePrompt: text(input.negativePrompt, 4000),
    promptBoosts: (Array.isArray(input.promptBoosts) ? input.promptBoosts : [])
      .filter((value) => typeof value === "string" && value.trim())
      .slice(0, 20)
      .map((value) => value.trim().slice(0, 200))
  };
}

export function createCheckpointSetService(dataDir) {
  const store = new JsonStore(path.join(dataDir, "checkpoint-lora-sets.json"), {
    schemaVersion: 1,
    sets: []
  });

  return {
    async list() {
      return (await store.read()).sets;
    },

    async create(input) {
      const normalized = normalizeSetInput(input);
      const set = {
        id: crypto.randomUUID(),
        ...normalized,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await store.update((data) => {
        // 同じCheckpointで自動適用は1つだけにする。
        if (set.autoApply) {
          for (const item of data.sets) {
            if (sameCheckpoint(item.checkpoint, set.checkpoint)) item.autoApply = false;
          }
        }
        data.sets.unshift(set);
        data.sets = data.sets.slice(0, 200);
        return data;
      });
      return set;
    },

    async patch(id, input) {
      let updated = null;
      await store.update((data) => {
        const target = data.sets.find((item) => item.id === id);
        if (!target) throw new Error("指定されたLoRAセットが見つかりません");
        const merged = normalizeSetInput({
          ...target,
          ...input,
          settings: input.settings ?? target.settings,
          loras: input.loras ?? target.loras,
          promptBoosts: input.promptBoosts ?? target.promptBoosts
        });
        Object.assign(target, merged, { updatedAt: new Date().toISOString() });
        if (target.autoApply) {
          for (const item of data.sets) {
            if (item !== target && sameCheckpoint(item.checkpoint, target.checkpoint)) item.autoApply = false;
          }
        }
        updated = target;
        return data;
      });
      return updated;
    },

    async duplicate(id) {
      const data = await store.read();
      const source = data.sets.find((item) => item.id === id);
      if (!source) throw new Error("指定されたLoRAセットが見つかりません");
      return this.create({ ...source, name: `${source.name} のコピー`, autoApply: false });
    },

    async remove(id) {
      let removed = null;
      await store.update((data) => {
        const index = data.sets.findIndex((item) => item.id === id);
        if (index < 0) throw new Error("指定されたLoRAセットが見つかりません");
        removed = data.sets.splice(index, 1)[0];
        return data;
      });
      return removed;
    },

    // Checkpoint切替時に自動適用するセットを探す。
    async findAutoApply(checkpoint) {
      const data = await store.read();
      return data.sets.find((item) => item.autoApply && sameCheckpoint(item.checkpoint, checkpoint)) ?? null;
    }
  };
}

export function sameCheckpoint(left, right) {
  return checkpointIdentity(left) === checkpointIdentity(right) && checkpointIdentity(left) !== "";
}

export function checkpointIdentity(value) {
  return String(value ?? "")
    .replaceAll("\\", "/")
    .split("/")
    .at(-1)
    .replace(/\s*\[[a-f0-9]+\]\s*$/i, "")
    .replace(/\.(?:safetensors|ckpt|pt)$/i, "")
    .trim()
    .toLowerCase();
}

function bounded(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Number(Math.min(max, Math.max(min, number)).toFixed(3));
}

function text(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}
