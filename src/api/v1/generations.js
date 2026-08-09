export function registerGenerationRoutes(router, { service, wrap }) {
  router.post("/generations", wrap(async (request, response) => {
    const job = await service.createV1Job(request.body ?? {});
    response.status(202).json({ id: job.id, status: "queued" });
  }));

  router.get("/generations/:id", wrap(async (request, response) => {
    response.json(serializeV1Job(service.getV1Job(request.params.id)));
  }));

  router.post("/generations/:id/cancel", wrap(async (request, response) => {
    response.json(serializeV1Job(service.cancelV1Job(request.params.id)));
  }));
}

export function serializeV1Job(job) {
  const result = job.status === "done" && job.result
    ? {
        historyId: typeof job.result.generationId === "string" ? job.result.generationId : null,
        images: Array.isArray(job.result.images)
          ? job.result.images.map(serializeV1Image).filter(Boolean)
          : []
      }
    : undefined;
  const dto = {
    id: job.id,
    status: job.status,
    progress: Math.max(0, Math.min(1, Number(job.progress ?? 0) / 100)),
    message: typeof job.message === "string" ? job.message.slice(0, 200) : ""
  };
  if (job.createdAt) dto.createdAt = job.createdAt;
  if (job.startedAt) dto.startedAt = job.startedAt;
  if (job.finishedAt) dto.finishedAt = job.finishedAt;
  if (result) dto.result = result;
  if (job.status === "failed") {
    dto.error = {
      code: "GENERATION_FAILED",
      message: "画像生成に失敗しました。サーバーログを確認してください"
    };
  }
  return dto;
}

function serializeV1Image(image) {
  const id = typeof image?.id === "string" ? image.id : "";
  if (!id) return null;
  return {
    id,
    seed: Number.isFinite(Number(image.seed)) ? Number(image.seed) : null,
    width: Number.isFinite(Number(image.width)) ? Number(image.width) : null,
    height: Number.isFinite(Number(image.height)) ? Number(image.height) : null,
    favorite: Boolean(image.favorite),
    thumbnailUrl: `/api/images/${encodeURIComponent(id)}/thumbnail`,
    originalUrl: `/api/images/${encodeURIComponent(id)}/original`
  };
}
