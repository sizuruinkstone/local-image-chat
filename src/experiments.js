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

// キュー表示用の「何を比べているか」。内部IDではなく人が読める形にする。
export function describeExperimentSubject(experiment) {
  const label = COMPARABLE_PARAMETERS[experiment?.parameter]?.label ?? experiment?.parameter ?? "比較";
  const values = Array.isArray(experiment?.values) ? experiment.values : [];
  const listed = values.slice(0, 6).join(" / ");
  const suffix = values.length > 6 ? ` ほか${values.length - 6}件` : "";
  const prefix = experiment?.target ? `${experiment.target} ` : "";
  return values.length ? `${prefix}${label} ${listed}${suffix}` : `${prefix}${label}`;
}

// runの状態は experiments.json を正とする。JobManagerのメモリ状態は
// 進捗表示の補助にだけ使い、終端状態（done/failed/cancelled）は上書きしない。
export const RUN_STATUSES = ["queued", "running", "done", "failed", "cancelled"];
export const TERMINAL_RUN_STATUSES = ["done", "failed", "cancelled"];
export const INTERRUPTED_RUN_MESSAGE = "サーバー再起動またはジョブ消失により中断されました";
export const EXPERIMENT_RUNNING_MESSAGE = "別の比較実験が実行中です。完了または中断してから開始してください";

export function isTerminalRunStatus(status) {
  return TERMINAL_RUN_STATUSES.includes(status);
}

// 既存データにフィールドが無くても読めるようにする（後方互換のための既定値）。
export function normalizeRun(run) {
  const source = run ?? {};
  return {
    value: source.value,
    index: Number.isFinite(Number(source.index)) ? Number(source.index) : 0,
    jobId: source.jobId ?? null,
    generationId: source.generationId ?? null,
    imageIds: Array.isArray(source.imageIds) ? source.imageIds : [],
    status: RUN_STATUSES.includes(source.status) ? source.status : "queued",
    error: source.error ?? null,
    // 自動リカバリで設定を下げて生成し直したrunは、公平な比較対象ではないと分かるようにする。
    recovered: source.recovered === true,
    retryInfo: source.retryInfo ?? null,
    startedAt: source.startedAt ?? null,
    finishedAt: source.finishedAt ?? null
  };
}

// 実験全体の状態は、常にrunの永続状態から導出する。
export function deriveExperimentStatus(experiment) {
  const runs = (experiment?.runs ?? []).map(normalizeRun);
  const cancelledExperiment = experiment?.status === "cancelled";
  if (runs.some((run) => !isTerminalRunStatus(run.status))) return cancelledExperiment ? "cancelled" : "running";
  if (cancelledExperiment || runs.some((run) => run.status === "cancelled")) return "cancelled";
  return "done";
}

// 未完了のrunが残っている実験は「実行中」とみなす（同時実行の判定に使う）。
export function isActiveExperiment(experiment) {
  if (!experiment) return false;
  const runs = (experiment.runs ?? []).map(normalizeRun);
  if (runs.length) return runs.some((run) => !isTerminalRunStatus(run.status));
  return experiment.status === "running";
}

export function createExperimentService(dataDir, { jobs, maxImages = MAX_EXPERIMENT_IMAGES, stopTimeoutMs = 3000 } = {}) {
  const store = new JsonStore(path.join(dataDir, "experiments.json"), {
    schemaVersion: 1,
    experiments: [],
    comparisons: []
  });
  // jobIdはプロセス内メモリにしか存在しないため、実験との対応も同じ寿命で持つ。
  const jobIndex = new Map();

  if (jobs && typeof jobs.subscribe === "function") {
    jobs.subscribe((job) => {
      const experimentId = jobIndex.get(job.id);
      if (!experimentId) return;
      if (isTerminalRunStatus(job.status)) jobIndex.delete(job.id);
      void applyJobEvent(experimentId, job)
        .catch((error) => console.warn(`[Experiment] run状態の保存に失敗: ${error?.message ?? error}`));
    });
  }

  function safeJob(id) {
    if (!jobs || !id) return null;
    try {
      return jobs.get(id);
    } catch {
      return null;
    }
  }

  // JobManagerの状態をrunへ反映する。終端状態は絶対に巻き戻さない。
  function applyLiveJob(run, job) {
    if (isTerminalRunStatus(run.status)) return false;
    if (job.status === "running") {
      if (run.status === "running") return false;
      run.status = "running";
      run.startedAt = run.startedAt ?? job.startedAt ?? new Date().toISOString();
      return true;
    }
    if (!isTerminalRunStatus(job.status)) return false;
    run.status = job.status;
    run.finishedAt = job.finishedAt ?? new Date().toISOString();
    if (job.status === "failed") run.error = job.error ?? "生成に失敗しました";
    return true;
  }

  // 実ジョブが存在しない未完了run（サーバー再起動・保持期間切れ）を終端状態へ正規化する。
  function reconcileData(data) {
    if (!jobs) return false;
    let changed = false;
    for (const experiment of data.experiments ?? []) {
      const runs = (experiment.runs ?? []).map(normalizeRun);
      let touched = false;
      for (const run of runs) {
        if (isTerminalRunStatus(run.status)) continue;
        const job = safeJob(run.jobId);
        if (!job) {
          run.status = "cancelled";
          run.error = INTERRUPTED_RUN_MESSAGE;
          run.finishedAt = run.finishedAt ?? new Date().toISOString();
          touched = true;
          continue;
        }
        if (applyLiveJob(run, job)) touched = true;
      }
      if (!touched) continue;
      experiment.runs = runs;
      experiment.status = deriveExperimentStatus(experiment);
      changed = true;
    }
    return changed;
  }

  // 読み込み時に正規化し、変化があった場合だけ書き戻す（毎回の書き込みを避ける）。
  async function readReconciled() {
    const data = await store.read();
    if (!reconcileData(data)) return data;
    return store.update((current) => {
      reconcileData(current);
      return current;
    });
  }

  async function applyJobEvent(experimentId, job) {
    await store.update((data) => {
      const experiment = data.experiments.find((item) => item.id === experimentId);
      if (!experiment) return data;
      const runs = (experiment.runs ?? []).map(normalizeRun);
      const run = runs.find((item) => item.jobId === job.id);
      if (!run || !applyLiveJob(run, job)) return data;
      experiment.runs = runs;
      experiment.status = deriveExperimentStatus(experiment);
      return data;
    });
  }

  // run単位の状態遷移はすべてここを通す。
  // 既定では永続化済みの終端状態を上書きしない（guardで条件を変えられる）。
  const notTerminal = (run) => !isTerminalRunStatus(run.status);

  async function mutateRun(experimentId, matcher, mutate, guard = notTerminal) {
    let touched = false;
    await store.update((data) => {
      const experiment = data.experiments.find((item) => item.id === experimentId);
      if (!experiment) return data;
      const runs = (experiment.runs ?? []).map(normalizeRun);
      const run = runs.find(matcher);
      if (!run || !guard(run)) return data;
      mutate(run);
      experiment.runs = runs;
      experiment.status = deriveExperimentStatus(experiment);
      touched = true;
      return data;
    });
    return touched;
  }

  const byValue = (value) => (run) => String(run.value) === String(value);

  function conflictError() {
    const error = new Error(EXPERIMENT_RUNNING_MESSAGE);
    error.statusCode = 409;
    error.code = "EXPERIMENT_ALREADY_RUNNING";
    return error;
  }

  async function waitForJobsSettled(jobIds, timeoutMs) {
    if (!jobIds.length) return;
    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (Date.now() < deadline) {
      const pending = jobIds.filter((jobId) => {
        const job = safeJob(jobId);
        return job !== null && !isTerminalRunStatus(job.status);
      });
      if (!pending.length) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  // 実験に紐づく実行中・待機中ジョブを止める。停止の責務はサービス側だけが持つ。
  async function stopJobs(id, { wait = true } = {}) {
    const data = await store.read();
    const experiment = data.experiments.find((item) => item.id === id);
    if (!experiment) return [];
    const cancelledJobIds = [];
    for (const run of (experiment.runs ?? []).map(normalizeRun)) {
      // runの記録ではなく実ジョブの状態で判断する（記録済みでも走っている場合がある）。
      const job = safeJob(run.jobId);
      if (!job || isTerminalRunStatus(job.status)) continue;
      jobIndex.delete(run.jobId);
      try {
        jobs.cancel(run.jobId);
        cancelledJobIds.push(run.jobId);
      } catch {
        // 既に消えたジョブは無視する
      }
    }
    if (wait) await waitForJobsSettled(cancelledJobIds, stopTimeoutMs);

    await store.update((current) => {
      const target = current.experiments.find((item) => item.id === id);
      if (!target) return current;
      const runs = (target.runs ?? []).map(normalizeRun);
      for (const run of runs) {
        if (isTerminalRunStatus(run.status)) continue;
        const job = safeJob(run.jobId);
        // 停止処理中に完了していたジョブは、その結果を優先する。
        if (job && isTerminalRunStatus(job.status)) applyLiveJob(run, job);
        else {
          run.status = "cancelled";
          run.finishedAt = run.finishedAt ?? new Date().toISOString();
        }
      }
      target.runs = runs;
      target.status = deriveExperimentStatus(target);
      return current;
    });
    return cancelledJobIds;
  }

  function decorate(experiment) {
    if (!experiment) return experiment;
    const runs = (experiment.runs ?? []).map(normalizeRun).map((run) => {
      // 終端状態のrunはJobManagerを見ない（保持期間切れで状態が消えるため）。
      const job = isTerminalRunStatus(run.status) ? null : safeJob(run.jobId);
      const status = isTerminalRunStatus(run.status) ? run.status : job?.status ?? run.status;
      return {
        ...run,
        status,
        progress: status === "done" ? 100 : job?.progress ?? 0,
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
      status: deriveExperimentStatus({ ...experiment, runs })
    };
  }

  return {
    limits: () => ({ maxImages, hardLimit: MAX_EXPERIMENT_IMAGES_LIMIT }),

    // 未完了の実験があるか（GPUキューが直列なので比較実験は同時に1本だけ）。
    async findActive() {
      const data = await readReconciled();
      const active = data.experiments.find(isActiveExperiment);
      return active ? decorate(active) : null;
    },

    async create({ baseRequest, parameter, target = "", values, fixedSeed = null, name = "" }) {
      if (!isComparableParameter(parameter)) throw new Error("比較できないパラメータです");
      const normalizedValues = validateExperimentValues(parameter, values, { maxImages });
      if (await this.findActive()) throw conflictError();

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

      const createdJobIds = [];
      try {
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
          // キュー表示で通常生成と区別できるよう、実験の情報をjobへ添える。
          const job = jobs.create(payload, {
            kind: "comparison",
            label: describeExperimentValue(parameter, experiment.target, value),
            experimentId: id,
            experimentName: experiment.name,
            index: index + 1,
            total: normalizedValues.length
          });
          createdJobIds.push(job.id);
          jobIndex.set(job.id, id);
          experiment.runs.push(normalizeRun({ value, index: index + 1, jobId: job.id }));
        }

        // 1枚目はキュー投入と同時に走り始めるため、保存前に実状態を取り込む。
        for (const run of experiment.runs) {
          const job = safeJob(run.jobId);
          if (job) applyLiveJob(run, job);
        }

        await store.update((data) => {
          // 保存直前にもう一度だけ排他を確認する。
          if ((data.experiments ?? []).some(isActiveExperiment)) throw conflictError();
          data.experiments.unshift(experiment);
          data.experiments = data.experiments.slice(0, 200);
          return data;
        });
      } catch (error) {
        // 実験データを保存できなかったジョブは孤児になるため、必ず止める。
        for (const jobId of createdJobIds) {
          jobIndex.delete(jobId);
          try {
            jobs.cancel(jobId);
          } catch {
            // 既に終わったジョブは無視する
          }
        }
        throw error;
      }
      return decorate(experiment);
    },

    async recordRunStarted(experimentId, value) {
      return mutateRun(experimentId, byValue(value), (run) => {
        run.status = "running";
        run.startedAt = run.startedAt ?? new Date().toISOString();
      });
    },

    // 生成完了時に、どの画像がどの値に対応するかを記録する。
    // ジョブ完了通知が先に届いてdoneになっていても結果は書き込むが、
    // failed / cancelled として確定したrunは成功へ戻さない。
    async recordRunCompleted(experimentId, value, { generationId, imageIds, retryInfo = null } = {}) {
      return mutateRun(experimentId, byValue(value), (run) => {
        run.generationId = generationId ?? null;
        run.imageIds = Array.isArray(imageIds) ? imageIds : [];
        run.status = "done";
        run.finishedAt = new Date().toISOString();
        run.retryInfo = retryInfo ?? null;
        run.recovered = Boolean(retryInfo);
      }, (run) => !["failed", "cancelled"].includes(run.status));
    },

    async recordRunFailed(experimentId, value, error) {
      return mutateRun(experimentId, byValue(value), (run) => {
        run.status = "failed";
        run.error = String(error?.message ?? error ?? "生成に失敗しました").slice(0, 500);
        run.finishedAt = new Date().toISOString();
      });
    },

    async recordRunCancelled(experimentId, value) {
      return mutateRun(experimentId, byValue(value), (run) => {
        run.status = "cancelled";
        run.finishedAt = new Date().toISOString();
      });
    },

    // v2.12.0の呼び出し名。互換のため残す。
    async recordRun(experimentId, value, payload) {
      return this.recordRunCompleted(experimentId, value, payload ?? {});
    },

    async list({ limit = 50 } = {}) {
      const data = await readReconciled();
      return data.experiments.slice(0, Math.max(1, Math.min(Number(limit) || 50, 200))).map(decorate);
    },

    async get(id) {
      const data = await readReconciled();
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

    // 実験に紐づくジョブだけを止める（削除前など、データを消す前に呼ぶ）。
    async stopJobs(id, options = {}) {
      return stopJobs(id, options);
    },

    // 実行中・待機中のジョブを止める。完了済みの画像は履歴に残す。
    async cancel(id) {
      await this.get(id);
      // UIの応答性を優先し、ジョブの終了は待たずに中断状態を確定させる。
      await stopJobs(id, { wait: false });
      await store.update((data) => {
        const target = data.experiments.find((item) => item.id === id);
        if (target) target.status = "cancelled";
        return data;
      });
      return this.get(id);
    },

    async remove(id) {
      // 削除前に必ずジョブを止める（止めないと削除後に履歴が増える）。
      await stopJobs(id);
      let removed = null;
      await store.update((data) => {
        const index = data.experiments.findIndex((item) => item.id === id);
        if (index < 0) throw new Error("指定された実験が見つかりません");
        removed = data.experiments.splice(index, 1)[0];
        return data;
      });
      for (const run of (removed?.runs ?? [])) {
        if (run?.jobId) jobIndex.delete(run.jobId);
      }
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
