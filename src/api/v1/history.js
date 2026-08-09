export function registerHistoryRoutes(router, { service, wrap }) {
  router.get("/history", wrap(async (request, response) => {
    const page = await service.listHistory(request.query);
    response.json({
      ...page,
      generations: page.generations.map(serializeHistoryGeneration)
    });
  }));
}

export function serializeHistoryGeneration(generation) {
  const settings = generation?.settings ?? {};
  return {
    id: safeString(generation?.id),
    createdAt: safeString(generation?.createdAt),
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

function finiteNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}
