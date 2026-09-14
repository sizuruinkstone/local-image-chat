// The subset restored by legacy Recipe; checkpoint/source/mask are deliberately
// absent. Candidate count and the selected image's seed have separate rules.
export const RECIPE_PARAMETER_KEYS = Object.freeze([
  "width", "height", "steps", "cfgScale", "samplerName", "scheduler", "noiseSchedule",
  "img2imgDenoising", "img2imgResizeMode", "inpaintDenoising", "maskBlur", "inpaintFill",
  "inpaintFullResPadding", "hiresScale", "hiresSteps", "hiresDenoising", "hiresUpscaler"
]);

export function recipeParameterPatch(recipe, image) {
  const settings = recipe.settings ?? {};
  const patch = Object.fromEntries(RECIPE_PARAMETER_KEYS
    .filter((key) => settings[key] !== undefined).map((key) => [key, settings[key]]));
  if (settings.inpaintFullRes !== undefined) patch.inpaintFullRes = settings.inpaintFullRes === true;
  return { ...patch, seed: image.seed, candidateCount: 1 };
}

export function settingsWithCheckpoint(parameters, selectedCheckpoint, overrides = {}) {
  return {
    ...parameters,
    checkpoint: selectedCheckpoint?.title ?? "",
    checkpointHash: selectedCheckpoint?.hash ?? "",
    checkpointModelName: selectedCheckpoint?.modelName ?? "",
    checkpointFilename: selectedCheckpoint?.filename ?? "",
    hiresEnabled: false,
    ...overrides
  };
}
