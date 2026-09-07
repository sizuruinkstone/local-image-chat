// Shared by legacy and headless entry points. Reader order is a contract.
export function buildGenerationRequest(form, description, count) {
    return {
      ...form.readRuntimePayload(),
      mode: form.readMode(),
      contentRating: form.readContentRating(),
      description,
      ...form.readTitlePayload(),
      ...form.readPromptPayload(),
      loras: form.readSelectedLoras(),
      promptBoosts: form.readPromptBoosts(),
      ...form.readInitImagePayload(),
      ...form.readInpaintPayload(),
      ...form.readIpAdapterPayload(),
      ...form.readDerivationPayload(),
      settings: form.readSettings({ candidateCount: count, hiresEnabled: false })
    };
}
