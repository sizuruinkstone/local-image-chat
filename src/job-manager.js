import crypto from "node:crypto";

export function createJobManager(execute, { retentionMs = 60 * 60 * 1000 } = {}) {
  const jobs = new Map();
  const queue = [];
  // ジョブの状態遷移を外部（実験サービスなど）へ通知するための購読者。
  const listeners = new Set();
  let processing = false;

  // metaはキュー表示用の短い説明だけを持つ。payloadと違い完了後も保持するため、
  // 秘密情報や絶対パスを入れないこと（呼び出し側が明示的に組み立てる）。
  function normalizeMeta(meta) {
    const source = meta ?? {};
    const text = (value, max) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);
    const count = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
    const normalized = {
      kind: source.kind === "comparison" ? "comparison" : "generation",
      label: text(source.label, 120) ?? "",
      experimentId: text(source.experimentId, 80),
      experimentName: text(source.experimentName, 120),
      index: count(source.index),
      total: count(source.total)
    };
    const client = text(source.client, 40);
    if (client) normalized.client = client;
    return normalized;
  }

  function create(payload, meta = {}) {
    cleanup();
    const id = crypto.randomUUID();
    const job = {
      id,
      status: "queued",
      progress: 0,
      message: `待機中（${queue.length + 1}番目）`,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      result: null,
      error: null,
      // 失敗時の自動リカバリ提案（設定を下げた再試行案）
      recovery: null,
      meta: normalizeMeta(meta),
      payload,
      controller: new AbortController()
    };
    jobs.set(id, job);
    queue.push(job);
    void processQueue();
    return publicJob(job);
  }

  function get(id) {
    const job = jobs.get(id);
    if (!job) throw new Error("生成ジョブが見つかりません");
    return publicJob(job);
  }

  function list() {
    return [...jobs.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(publicJob);
  }

  // running / done / failed / cancelled への遷移だけを通知する。
  // 購読側の例外でキュー処理を止めないよう、必ず握りつぶさずログへ出す。
  function subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function notify(job) {
    const snapshot = publicJob(job);
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        console.warn(`[Job] 状態通知に失敗しました: ${error?.message ?? error}`);
      }
    }
  }

  function cancel(id) {
    const job = jobs.get(id);
    if (!job) throw new Error("生成ジョブが見つかりません");
    if (["done", "failed", "cancelled"].includes(job.status)) return publicJob(job);
    job.controller.abort(new Error("ユーザーが生成を中止しました"));
    if (job.status === "queued") {
      const index = queue.indexOf(job);
      if (index >= 0) queue.splice(index, 1);
      finish(job, "cancelled", "生成を中止しました");
      updateQueuePositions();
    }
    return publicJob(job);
  }

  async function processQueue() {
    if (processing) return;
    processing = true;
    try {
      while (queue.length) {
        const job = queue.shift();
        updateQueuePositions();
        if (job.status === "cancelled") continue;
        job.status = "running";
        job.startedAt = new Date().toISOString();
        update(job, { progress: 1, message: "生成を開始します" });
        notify(job);
        try {
          job.result = await execute(job.payload, {
            signal: job.controller.signal,
            report: (progress, message) => update(job, { progress, message })
          });
          finish(job, "done", "生成が完了しました");
        } catch (error) {
          if (job.controller.signal.aborted) {
            finish(job, "cancelled", "生成を中止しました");
          } else {
            job.error = error?.message ?? "生成に失敗しました";
            job.recovery = error?.recovery ?? null;
            finish(job, "failed", job.error);
          }
        }
      }
    } finally {
      processing = false;
    }
  }

  function update(job, patch) {
    if (Number.isFinite(patch.progress)) {
      job.progress = Math.max(job.progress, Math.min(99, Math.round(patch.progress)));
    }
    if (patch.message) job.message = patch.message;
  }

  function finish(job, status, message) {
    job.status = status;
    job.progress = status === "done" ? 100 : job.progress;
    job.message = message;
    job.finishedAt = new Date().toISOString();
    // img2imgの元画像やInpaintマスクなど、大きなData URLは完了後すぐ解放する。
    job.payload = null;
    notify(job);
  }

  function updateQueuePositions() {
    queue.forEach((job, index) => {
      job.message = `待機中（${index + 1}番目）`;
    });
  }

  function cleanup() {
    const threshold = Date.now() - retentionMs;
    for (const [id, job] of jobs) {
      if (!job.finishedAt) continue;
      if (new Date(job.finishedAt).getTime() < threshold) jobs.delete(id);
    }
  }

  return { create, get, list, cancel, subscribe };
}

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    message: job.message,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    result: job.result,
    error: job.error,
    recovery: job.recovery,
    meta: job.meta
  };
}
