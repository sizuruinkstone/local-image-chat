import { buildGenerationRequest } from "../core/generation-request.js";

const GALLERY_HIRES_DEFAULTS = { scale: 1.5, steps: 12, denoising: 0.28 };

// Owns only the active frontend operation. Feature state and the global queue
// stay behind their ports; navigation has no influence on this lifetime.
export function createGenerationController({ form, owners, ui, transport, timing = {} }) {
  const sleep = timing.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const defer = timing.setTimeout ?? setTimeout;
  let activeOperation = null;
  let activeJobId = null;
  let operationVersion = 0;

  const state = () => ({ activeJobId, busy: Boolean(activeOperation) });
  const isCurrent = (operation) => activeOperation === operation;
  const notify = (message = "") => ui.onStateChange?.({ ...state(), message });

  function reserve() {
    if (activeOperation) throw new Error("生成中です。完了または中止してから実行してください");
    const operation = { version: ++operationVersion };
    activeOperation = operation;
    return operation;
  }

  function release(operation) {
    if (!isCurrent(operation)) return;
    activeOperation = null;
    activeJobId = null;
    notify();
    ui.setCancelDisabled(true);
  }

  async function submit(payload, operation) {
    let request = payload;
    let mayRecover = true;
    while (true) {
      if (!isCurrent(operation)) throw new Error("生成処理が置き換えられました");
      const postedRequest = { ...request, autoRetry: form.readAutoRetry() };
      const { job } = await transport.postJson("/api/jobs", postedRequest);
      if (!isCurrent(operation)) throw new Error("生成処理が置き換えられました");
      activeJobId = job.id;
      ui.setJobProgress(job);
      notify();
      ui.showJob(job.id);
      owners.startQueuePolling();

      while (true) {
        await sleep(850);
        if (!isCurrent(operation)) throw new Error("生成処理が置き換えられました");
        const current = (await transport.getJson(`/api/jobs/${job.id}`)).job;
        if (!isCurrent(operation) || activeJobId !== job.id) throw new Error("生成処理が置き換えられました");
        ui.setJobProgress(current);
        if (current.status === "done") return current.result;
        if (current.status === "cancelled") throw new Error("生成を中止しました");
        if (current.status !== "failed") continue;
        const accepted = mayRecover && current.recovery
          ? await ui.confirmRecovery(current.recovery)
          : false;
        if (!accepted) throw new Error(current.error ?? current.message);
        ui.onRecoveryAccepted(current.recovery);
        request = {
          ...postedRequest,
          settings: { ...postedRequest.settings, ...current.recovery.settings },
          retryInfo: {
            retryReason: current.recovery.kind,
            retryReasonLabel: current.recovery.label,
            retryCount: 1,
            retriedAt: new Date().toISOString(),
            originalSettings: postedRequest.settings,
            retrySettings: current.recovery.settings
          }
        };
        mayRecover = false;
        activeJobId = null;
        notify();
        break;
      }
    }
  }

  function generationRecord(data, description, fallbackRuntime = form.getActiveRuntime()) {
    return {
      runtime: data.runtime ?? fallbackRuntime,
      mode: data.mode,
      sourceImageId: data.sourceImageId,
      sourceImageUrl: data.sourceImageUrl,
      maskImageUrl: data.maskImageUrl,
      ipAdapter: data.ipAdapter ?? null,
      contentRating: data.contentRating ?? form.readContentRating(),
      title: data.title ?? "",
      description,
      prompt: data.prompt,
      negativePrompt: data.negativePrompt,
      userNegativePrompt: data.userNegativePrompt,
      effectiveNegativePrompt: data.effectiveNegativePrompt,
      structuredPrompt: data.structuredPrompt ?? null,
      rawPromptOverride: data.rawPromptOverride === true,
      rawPrompt: data.rawPrompt ?? "",
      appliedTriggerWords: data.appliedTriggerWords ?? [],
      sectionProfiles: data.sectionProfiles ?? {},
      settings: data.settings,
      loras: data.loras,
      images: data.images
    };
  }

  function carryStructuredPrompt(source) {
    if (!source?.structuredPrompt) return {};
    return {
      structuredPrompt: source.structuredPrompt,
      rawPromptOverride: source.rawPromptOverride === true,
      rawPrompt: source.rawPrompt ?? "",
      sectionProfiles: source.sectionProfiles ?? {},
      appliedTriggerWords: source.appliedTriggerWords ?? []
    };
  }

  async function run(message, work, { emptyOnFailure = false, publishBusy = true } = {}) {
    let operation;
    try {
      operation = reserve();
    } catch (error) {
      ui.showError(error.message);
      return;
    }
    try {
      if (publishBusy) notify(message);
      return await work(operation);
    } catch (error) {
      ui.showError(error.message);
      if (emptyOnFailure && !owners.getLastGeneration()) ui.showEmpty();
    } finally {
      release(operation);
      // Even a cancelled preparation supersedes the previous hide timer.
      // Its own timer must still retire any previously displayed terminal bar.
      defer(() => {
        if (operationVersion === operation.version && !activeOperation && !activeJobId) ui.hideJob();
      }, 1800);
    }
  }

  function buildPrompt() {
    ui.clearError();
    const description = form.readDescription();
    if (!description) return ui.showError("生成したい画像を日本語で入力してくれ");
    return run("日本語からプロンプトを作成中…", async () => {
      const data = await owners.requestPrompt(description);
      ui.presentBuiltPrompt(data);
    });
  }

  function generateCandidates() {
    const fallbackRuntime = form.getActiveRuntime();
    ui.clearError();
    const description = form.readDescription();
    if (!description && !form.readCurrentPositivePrompt().trim()) return ui.showError("生成したい画像を日本語で入力するか、Promptを入力してくれ");
    const mode = form.readMode();
    if (mode !== "txt2img" && !owners.hasReference()) {
      ui.restoreMode(mode);
      return ui.showError(`${mode === "inpaint" ? "部分修正" : "img2img"}の参照画像を選択してください`);
    }
    if (mode === "inpaint" && !owners.hasMask()) return ui.showError("修正したい範囲を白く塗ってください");
    return run("", async (operation) => {
      owners.syncLorasFromPrompt();
      ui.prepareCandidates();
      const count = Number(form.readCandidateCount());
      const liveMode = form.readMode();
      const modeLabel = liveMode === "inpaint" ? "部分修正候補" : liveMode === "img2img" ? "img2img候補" : "候補";
      notify(`${count}枚の${modeLabel}を1枚ずつ生成します…`);
      if (form.shouldRequestPrompt(description)) {
        ui.setLoadingText("日本語からプロンプトを作成中…");
        await owners.requestPrompt(description);
      }
      ui.setLoadingText(`${count}枚の${modeLabel}を1枚ずつ生成中…`);
      const request = prepareGeneration(description, count);
      const data = await submit(request, operation);
      const generation = generationRecord(data, description, fallbackRuntime);
      owners.applyIpMetadata(data.ipAdapter);
      owners.applyGeneratedPrompt(data, description);
      ui.setExplanation(data.explanation);
      owners.setCandidates(generation, data.images);
      ui.showResults();
      await owners.loadHistory();
    }, { emptyOnFailure: true, publishBusy: false });
  }

  // This preparation is intentionally NOT transactional. The one-shot reader
  // consumes at its historical position: after IP, before settings and POST.
  // Failures before that read preserve pending metadata; later ones do not.
  function prepareGeneration(description, count) {
    return buildGenerationRequest(form, description, count);
  }

  function finishSelected() {
    const selected = owners.getSelectedCandidate();
    const source = owners.getLastGeneration();
    if (!selected || !source) return;
    const runtime = form.runtimeForGeneration(source);
    if (!runtime || !form.runtimeSupportsHires(runtime)) return ui.showError(`${runtime?.label ?? "生成元Runtime"}ではHires仕上げを利用できません`);
    ui.clearError();
    const usesSource = source.mode === "img2img" || source.mode === "inpaint";
    const label = source.mode === "inpaint" ? "部分修正の高解像度仕上げ中" : source.mode === "img2img" ? "img2img高解像度仕上げ中" : "Hires.fix中";
    return run(`Seed ${selected.seed} を${label}…`, async (operation) => {
      const data = await submit({
        ...form.readRuntimePayloadFor(runtime),
        mode: usesSource ? source.mode : "txt2img",
        contentRating: source.contentRating ?? form.readContentRating(),
        description: source.description,
        ...form.readTitlePayload(),
        prompt: source.prompt,
        negativePrompt: source.negativePrompt,
        userNegativePrompt: source.userNegativePrompt ?? source.negativePrompt ?? "",
        ...carryStructuredPrompt(source),
        loras: source.loras,
        promptBoosts: [],
        parentImageId: selected.id,
        ...(usesSource ? { initImageId: selected.id } : {}),
        ...form.readIpAdapterPayload(),
        settings: {
          ...source.settings,
          candidateCount: 1,
          seed: selected.seed,
          hiresEnabled: true,
          ...form.readCurrentHiresSettings()
        }
      }, operation);
      presentHires(
        data,
        source.description,
        source.mode === "inpaint" ? "INPAINT REFINE COMPLETE" : source.mode === "img2img" ? "IMG2IMG REFINE COMPLETE" : "HIRES.FIX COMPLETE",
        source.mode === "inpaint" ? "部分修正・高解像度版" : source.mode === "img2img" ? "img2img高解像度版" : "高解像度版"
      );
      await owners.loadHistory();
    });
  }

  function presentHires(data, description, eyebrow, title) {
    const generation = generationRecord(data, description);
    owners.applyIpMetadata(data.ipAdapter);
    owners.presentFinal(generation, data.images[0], { eyebrow, title });
  }

  function hiresFromGallery(generation, image) {
    const runtime = form.runtimeForGeneration(generation);
    if (!runtime || !form.runtimeSupportsHires(runtime)) return ui.showError(`${runtime?.label ?? "生成元Runtime"}ではHires仕上げを利用できません`);
    return run("高解像度仕上げを準備中…", async (operation) => {
      const { scale, steps, denoising } = GALLERY_HIRES_DEFAULTS;
      const confirmed = await ui.confirmGalleryHires(scale, steps, denoising);
      if (!confirmed) return;
      ui.clearError();
      ui.prepareGalleryHires();
      notify(`Seed ${image.seed} を高解像度仕上げ中…`);
      const settings = generation.settings ?? {};
      const data = await submit({
        ...form.readRuntimePayloadFor(runtime),
        mode: "img2img",
        contentRating: generation.contentRating === "nsfw" ? "nsfw" : "general",
        description: generation.description ?? "",
        ...form.readTitlePayload(),
        prompt: generation.prompt ?? "",
        negativePrompt: generation.negativePrompt ?? "",
        userNegativePrompt: generation.userNegativePrompt ?? generation.negativePrompt ?? "",
        ...carryStructuredPrompt(generation),
        loras: generation.loras ?? [],
        promptBoosts: [],
        parentImageId: image.id,
        initImageId: image.id,
        ipAdapter: generation.ipAdapter ?? null,
        settings: {
          ...settings,
          candidateCount: 1,
          seed: image.seed,
          hiresEnabled: true,
          hiresScale: scale,
          hiresSteps: steps,
          hiresDenoising: denoising,
          hiresUpscaler: settings.hiresUpscaler || form.readHiresUpscaler()
        }
      }, operation);
      presentHires(data, generation.description ?? "", "GALLERY HIRES COMPLETE", "高解像度版");
      await owners.loadHistory();
    });
  }

  async function cancel() {
    const jobId = activeJobId;
    const operation = activeOperation;
    if (!jobId || !operation) return;
    ui.setCancelDisabled(true);
    try {
      const response = await transport.fetch(`/api/jobs/${jobId}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
      if (isCurrent(operation) && activeJobId === jobId) ui.setJobProgress(data.job);
    } catch (error) {
      if (isCurrent(operation) && activeJobId === jobId) ui.showError(error.message);
    }
  }

  // Reattach only to an explicitly saved job. This path never POSTs or retries it.
  function reattach(jobId) {
    return run("進行中の生成へ再接続しています…", async operation => {
      activeJobId = jobId; notify();
      while (isCurrent(operation)) {
        const {job} = await transport.getJson(`/api/jobs/${encodeURIComponent(jobId)}`);
        if (!isCurrent(operation)) return;
        ui.setJobProgress(job);
        if (job.status === "done") {
          const record = generationRecord(job.result, job.result.description ?? "");
          owners.setCandidates(record, job.result.images); ui.showResults(); await owners.loadHistory(); return;
        }
        if (job.status === "cancelled") throw new Error("生成を中止しました");
        if (job.status === "failed") throw new Error(job.error || job.message || "生成に失敗しました");
        await sleep(850);
      }
    });
  }

  return {
    buildPrompt, generateCandidates, finishSelected, hiresFromGallery, cancel, reattach,
    getState: state, isBusy: () => Boolean(activeOperation),
    // Detach an app entry without cancelling the backend Job. Late transport
    // responses cannot commit results into an entry that no longer exists.
    dispose() { operationVersion += 1; activeOperation = null; activeJobId = null; }
  };
}
