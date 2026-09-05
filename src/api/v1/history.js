export function registerHistoryRoutes(router, { service, wrap }) {
  router.get("/history", wrap(async (request, response) => {
    const page = await service.listHistory(request.query);
    response.json({
      ...page,
      generations: page.generations.map(serializeHistoryGeneration)
    });
  }));

  router.get("/history/:id", wrap(async (request, response) => {
    const generation = await service.getHistoryItem(request.params.id);
    response.json(serializeHistoryGeneration(generation, { includeDerivation: true }));
  }));

  router.post("/history/:id/regenerations", wrap(async (request, response) => {
    const job = await service.createV1Regeneration(request.params.id, request.body ?? {});
    response.status(202).json({ id: job.id, status: "queued" });
  }));
}

export function serializeHistoryGeneration(generation, { includeDerivation = false } = {}) {
  const settings = generation?.settings ?? {};
  const dto = {
    id: safeString(generation?.id),
    createdAt: safeString(generation?.createdAt),
    contentRating: serializeContentRating(generation?.contentRating),
    title: safeString(generation?.title || generation?.description),
    kind: safeString(generation?.kind),
    mode: safeString(generation?.mode),
    experimentId: safeIdentifier(generation?.experimentId),
    prompt: {
      structured: serializeStructuredPrompt(generation?.structuredPrompt),
      rawPromptOverride: Boolean(generation?.rawPromptOverride),
      rawPrompt: safeString(generation?.rawPrompt),
      effectivePrompt: safeString(generation?.effectivePrompt ?? generation?.prompt),
      negativePrompt: safeString(generation?.negativePrompt ?? generation?.effectiveNegativePrompt)
    },
    settings: {
      checkpoint: safeIdentifier(settings.checkpoint),
      width: finiteNumber(settings.width),
      height: finiteNumber(settings.height),
      steps: finiteNumber(settings.steps),
      cfgScale: finiteNumber(settings.cfgScale),
      sampler: safeString(settings.samplerName),
      scheduler: safeString(settings.scheduler),
      seed: finiteNumber(settings.seed),
      hires: {
        enabled: Boolean(settings.hiresEnabled),
        scale: finiteNumber(settings.hiresScale),
        steps: finiteNumber(settings.hiresSteps),
        denoising: finiteNumber(settings.hiresDenoising),
        upscaler: safeString(settings.hiresUpscaler)
      }
    },
    loras: Array.isArray(generation?.loras)
      ? generation.loras.map(serializeLora).filter(Boolean)
      : [],
    images: Array.isArray(generation?.images)
      ? generation.images.map(serializeHistoryImage).filter(Boolean)
      : []
  };
  if (includeDerivation) {
    dto.settings.noiseSchedule = safeString(settings.noiseSchedule);
    dto.settings.candidateCount = finiteNumber(settings.candidateCount);
    dto.parentGenerationId = safeIdentifier(generation?.parentGenerationId);
    dto.parentImageId = safeIdentifier(generation?.parentImageId);
    dto.derivation = serializeDerivation(generation);
    dto.ipAdapter = serializeIpAdapter(generation?.ipAdapter);
    dto.runtime = serializeRuntime(generation?.runtime);
  }
  return dto;
}

function serializeContentRating(value) {
  return ["general", "nsfw", "unrated"].includes(value) ? value : "unrated";
}

function serializeRuntime(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = safeIdentifier(value.id);
  const provider = safeIdentifier(value.provider);
  if (!id || !provider || !/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(id)
    || !/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(provider)) return null;
  return { id, provider };
}

function serializeDerivation(generation) {
  const type = safeIdentifier(generation?.derivationType);
  if (!type) return null;
  return {
    type,
    instruction: safeString(generation?.derivationInstruction).slice(0, 500)
  };
}

function serializeStructuredPrompt(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    character: safeString(value.character),
    appearance: safeString(value.appearance),
    composition: safeString(value.composition),
    situation: safeString(value.situation),
    style: safeString(value.style),
    extra: safeString(value.extra)
  };
}

function serializeLora(item) {
  if (!item || typeof item.name !== "string" || !item.name.trim()) return null;
  return {
    name: safeIdentifier(item.name),
    weight: finiteNumber(item.weight),
    enabled: item.enabled !== false
  };
}

function serializeHistoryImage(image) {
  const id = safeIdentifier(image?.id);
  if (!id) return null;
  return {
    id,
    seed: finiteNumber(image.seed),
    width: finiteNumber(image.width),
    height: finiteNumber(image.height),
    favorite: Boolean(image.favorite),
    vote: safeString(image.vote),
    thumbnailUrl: `/api/images/${encodeURIComponent(id)}/thumbnail`,
    originalUrl: `/api/images/${encodeURIComponent(id)}/original`
  };
}

function serializeIpAdapter(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.enabled !== true) return null;
  const referenceImageId = safePublicId(value.referenceImageId);
  const weight = publicFiniteNumber(value.weight);
  const guidanceStart = publicFiniteNumber(value.guidanceStart);
  const guidanceEnd = publicFiniteNumber(value.guidanceEnd);
  if (!referenceImageId || weight === null || guidanceStart === null || guidanceEnd === null
    || weight < 0 || weight > 2 || guidanceStart < 0 || guidanceStart > 1
    || guidanceEnd < 0 || guidanceEnd > 1 || guidanceStart >= guidanceEnd) {
    return null;
  }
  return { referenceImageId, weight, guidanceStart, guidanceEnd };
}

function safeString(value) {
  return typeof value === "string" ? value.slice(0, 12000) : "";
}

function safeIdentifier(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || /^[a-z]:[\\/]/i.test(normalized) || normalized.startsWith("/")
    || normalized.startsWith("\\") || normalized.split(/[\\/]/).includes("..")) return null;
  return normalized.slice(0, 400);
}

function safePublicId(value) {
  return typeof value === "string" && /^[a-z0-9-]{8,80}$/i.test(value) ? value : null;
}

function finiteNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function publicFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
