import crypto from "node:crypto";
import path from "node:path";
import { JsonStore } from "./json-store.js";

// パラメータ一括比較（実験）の管理。生成そのものは既存のジョブキューへ委ね、
// キューが直列処理であることを利用してGPU負荷を抑える。

export const MAX_EXPERIMENT_IMAGES = 8;
export const MAX_EXPERIMENT_IMAGES_LIMIT = 12;

export const COMPARABLE_PARAMETERS = {
  loraWeight: { label: "LoRA weight", kind: "number", min: 0.05, max: 2, step: 0.01, needsTarget: true },
  cfgScale: { label: "CFG", kind: "number", min: 1, max: 20, step: 0.1 },
  steps: { label: "Steps", kind: "integer", min: 1, max: 80 },
  seed: { label: "Seed", kind: "integer", min: -1, max: 4294967295 },
  denoising: { label: "Denoising", kind: "number", min: 0.05, max: 0.95, step: 0.01 },
  samplerName: { label: "Sampler", kind: "text" },
  scheduler: { label: "Scheduler", kind: "text" },
  hiresScale: { label: "Hires倍率", kind: "number", min: 1, max: 2, step: 0.05 },
  hiresDenoising: { label: "Hires Denoising", kind: "number", min: 0.1, max: 0.8, step: 0.01 }
};

export function isComparableParameter(value) {
  return Object.hasOwn(COMPARABLE_PARAMETERS, String(value));
}

// 「試す値」を検証・正規化する。重複と枚数上限をここで弾く。
export function validateExperimentValues(parameter, values, { maxImages = MAX_EXPERIMENT_IMAGES } = {}) {
  const definition = COMPARABLE_PARAMETERS[parameter];
  if (!definition) throw new Error("比較できないパラメータです");
  const limit = Math.min(Math.max(1, Number(maxImages) || MAX_EXPERIMENT_IMAGES), MAX_EXPERIMENT_IMAGES_LIMIT);
  const list = Array.isArray(values) ? values : String(values ?? "").split(",");
  const normalized = [];
  const seen = new Set();

  for (const raw of list) {
    if (normalized.length >= limit + 1) break;
    let value;
    if (definition.kind === "text") {
      value = String(raw ?? "").trim().slice(0, 100);
      if (!value) continue;
    } else {
      const number = definition.kind === "integer" ? Number.parseInt(raw, 10) : Number(raw);
      if (!Number.isFinite(number)) continue;
      if (number < definition.min || number > definition.max) {
        throw new Error(`${definition.label}は${definition.min}〜${definition.max}の範囲で指定してください`);
      }
      value = definition.kind === "integer" ? number : Number(number.toFixed(4));
    }
    const key = String(value).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(value);
  }

  if (normalized.length < 2) throw new Error("比較には2つ以上の値が必要です");
  if (normalized.length > limit) throw new Error(`比較生成は最大${limit}枚までです`);
  return normalized;
}

// 1回分の生成リクエストを作る。元のリクエストは変更しない。
export function applyExperimentValue(baseRequest, { parameter, target, value, fixedSeed = null }) {
  const request = structuredClone(baseRequest ?? {});
  const settings = { ...(request.settings ?? {}) };
  settings.candidateCount = 1;
  settings.hiresEnabled = settings.hiresEnabled === true;
  if (Number.isFinite(Number(fixedSeed)) && Number(fixedSeed) >= 0) settings.seed = Number(fixedSeed);

  switch (parameter) {
    case "loraWeight": {
      const loras = Array.isArray(request.loras) ? request.loras : [];
      const matched = loras.filter((lora) => lora?.name === target);
      if (!matched.length) throw new Error("対象のLoRAが選択されていません");
      request.loras = loras.map((lora) => (lora?.name === target ? { ...lora, weight: Number(value) } : lora));
      break;
    }
    case "seed":
      settings.seed = Number(value);
      break;
    case "denoising":
      if (request.mode === "inpaint") settings.inpaintDenoising = Number(value);
      else settings.img2imgDenoising = Number(value);
      break;
    case "cfgScale":
    case "steps":
    case "hiresScale":
    case "hiresDenoising":
      settings[parameter] = Number(value);
      break;
    case "samplerName":
    case "scheduler":
      settings[parameter] = String(value);
      break;
    default:
      throw new Error("比較できないパラメータです");
  }

  request.settings = settings;
  return request;
}

export function describeExperimentValue(parameter, target, value) {
  const label = COMPARABLE_PARAMETERS[parameter]?.label ?? parameter;
  return target ? `${target} ${label}: ${value}` : `${label}: ${value}`;
}

export function createExperimentService(dataDir, { jobs, maxImages = MAX_EXPERIMENT_IMAGES } = {}) {
  const store = new JsonStore(path.join(dataDir, "experiments.json"), {
    schemaVersion: 1,
    experiments: [],
    comparisons: []
  });

  function decorate(experiment) {
    if (!experiment) return experiment;
    const runs = experiment.runs.map((run) => {
      const job = run.jobId && jobs ? safeJob(run.jobId) : null;
      return {
        ...run,
        status: run.status === "done" ? "done" : job?.status ?? run.status,
        progress: job?.progress ?? (run.status === "done" ? 100 : 0),
        message: job?.message ?? "",
        error: run.error ?? job?.error ?? null
      };
    });
    const completed = runs.filter((run) => run.status === "done").length;
    const failed = runs.filter((run) => ["failed", "cancelled"].includes(run.status)).length;
    return {
      ...experiment,
      runs,
      completed,
      failed,
      total: runs.length,
      status: completed + failed >= runs.length ? (experiment.status === "cancelled" ? "cancelled" : "done") : "running"
    };
  }

  function safeJob(id) {
    try {
      return jobs.get(id);
    } catch {
      return null;
    }
  }

  return {
    limits: () => ({ maxImages, hardLimit: MAX_EXPERIMENT_IMAGES_LIMIT }),

    async create({ baseRequest, parameter, target = "", values, fixedSeed = null, name = "" }) {
      if (!isComparableParameter(parameter)) throw new Error("比較できないパラメータです");
      const normalizedValues = validateExperimentValues(parameter, values, { maxImages });
      const id = crypto.randomUUID();
      const definition = COMPARABLE_PARAMETERS[parameter];
      const experiment = {
        id,
        name: String(name || defaultName(definition.label, target)).slice(0, 120),
        type: "parameter",
        parameter,
        target: String(target ?? "").slice(0, 200),
        values: normalizedValues,
        fixedSeed: Number.isFinite(Number(fixedSeed)) && Number(fixedSeed) >= 0 ? Number(fixedSeed) : null,
        baseSeed: Number(baseRequest?.settings?.seed ?? -1),
        createdAt: new Date().toISOString(),
        status: "running",
        bestImageId: null,
        note: "",
        runs: []
      };

      // 生成は並列にせず、既存キューへ順番に積む（キューは直列処理）。
      for (const [index, value] of normalizedValues.entries()) {
        const payload = applyExperimentValue(baseRequest, {
          parameter,
          target,
          value,
          fixedSeed: experiment.fixedSeed
        });
        payload.experiment = {
          id,
          name: experiment.name,
          type: "parameter",
          parameter,
          target: experiment.target,
          value,
          index: index + 1,
          total: normalizedValues.length,
          baseSeed: experiment.fixedSeed ?? experiment.baseSeed
        };
        const job = jobs.create(payload);
        experiment.runs.push({
          value,
          index: index + 1,
          jobId: job.id,
          generationId: null,
          imageIds: [],
          status: "queued",
          error: null
        });
      }

      await store.update((data) => {
        data.experiments.unshift(experiment);
        data.experiments = data.experiments.slice(0, 200);
        return data;
      });
      return decorate(experiment);
    },

    // 生成完了時に、どの画像がどの値に対応するかを記録する。
    async recordRun(experimentId, value, { generationId, imageIds }) {
      await store.update((data) => {
        const experiment = data.experiments.find((item) => item.id === experimentId);
        if (!experiment) return data;
        const run = experiment.runs.find((item) => String(item.value) === String(value));
        if (!run) return data;
        run.generationId = generationId;
        run.imageIds = imageIds;
        run.status = "done";
        return data;
      });
    },

    async list({ limit = 50 } = {}) {
      const data = await store.read();
      return data.experiments.slice(0, Math.max(1, Math.min(Number(limit) || 50, 200))).map(decorate);
    },

    async get(id) {
      const data = await store.read();
      const experiment = data.experiments.find((item) => item.id === id);
      if (!experiment) throw new Error("指定された実験が見つかりません");
      return decorate(experiment);
    },

    async patch(id, { name, bestImageId, note }) {
      let updated = null;
      await store.update((data) => {
        const experiment = data.experiments.find((item) => item.id === id);
        if (!experiment) throw new Error("指定された実験が見つかりません");
        if (typeof name === "string" && name.trim()) experiment.name = name.trim().slice(0, 120);
        if (bestImageId !== undefined) experiment.bestImageId = bestImageId ? String(bestImageId).slice(0, 80) : null;
        if (typeof note === "string") experiment.note = note.slice(0, 1000);
        updated = experiment;
        return data;
      });
      return decorate(updated);
    },

    // 実行中・待機中のジョブを止める。完了済みの画像は履歴に残す。
    async cancel(id) {
      const experiment = await this.get(id);
      for (const run of experiment.runs) {
        if (!run.jobId || run.status === "done") continue;
        try {
          jobs.cancel(run.jobId);
        } catch {
          // 既に消えたジョブは無視する
        }
      }
      await store.update((data) => {
        const target = data.experiments.find((item) => item.id === id);
        if (target) target.status = "cancelled";
        return data;
      });
      return this.get(id);
    },

    async remove(id) {
      let removed = null;
      await store.update((data) => {
        const index = data.experiments.findIndex((item) => item.id === id);
        if (index < 0) throw new Error("指定された実験が見つかりません");
        removed = data.experiments.splice(index, 1)[0];
        return data;
      });
      return removed;
    },

    // A/B比較の投票結果。将来の好み分析へ使えるよう素の形で残す。
    async addComparison({ imageIds, winnerImageId, result, parameter = "", note = "" }) {
      const comparison = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        imageIds: imageIds.slice(0, 4),
        winnerImageId: winnerImageId ? String(winnerImageId).slice(0, 80) : null,
        result: ["a", "b", "draw"].includes(result) ? result : "draw",
        parameter: String(parameter ?? "").slice(0, 60),
        note: String(note ?? "").slice(0, 500)
      };
      await store.update((data) => {
        data.comparisons.unshift(comparison);
        data.comparisons = data.comparisons.slice(0, 500);
        return data;
      });
      return comparison;
    },

    async listComparisons({ limit = 100 } = {}) {
      const data = await store.read();
      return data.comparisons.slice(0, Math.max(1, Math.min(Number(limit) || 100, 500)));
    }
  };
}

function defaultName(label, target) {
  const prefix = target ? `${target} ` : "";
  return `${prefix}${label} test`;
}
