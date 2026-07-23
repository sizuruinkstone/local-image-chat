import crypto from "node:crypto";

export function createJobManager(execute, { retentionMs = 60 * 60 * 1000 } = {}) {
  const jobs = new Map();
  const queue = [];
  let processing = false;

  function create(payload) {
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
    // img2imgのData URLなど大きな入力は完了後すぐ解放する。
    job.payload = null;
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

  return { create, get, list, cancel };
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
    error: job.error
  };
}
