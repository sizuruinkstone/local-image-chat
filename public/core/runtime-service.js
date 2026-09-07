const FALLBACK_RUNTIME = {
  id: "reforge",
  label: "ReForge",
  provider: "reforge",
  available: true,
  supportedModes: ["txt2img", "img2img", "inpaint"],
  features: { txt2img: true, img2img: true, inpaint: true, hires: true, ipAdapter: true }
};

export function createRuntimeService({
  presentation = {},
  storage = globalThis.localStorage,
  getJson,
  postJson,
  getGenerationBusy = () => false,
  showError = () => {},
  captureExternalSnapshot = () => null,
  restoreExternalSnapshot = () => {},
  finalizeExternalRestore = () => {},
  loadExternalResources = async () => [],
  onRuntimeUiChange = () => {},
  onCheckpointCatalogChange = () => {},
  onCheckpointSelectionSync = () => {},
  onCheckpointSelectionChange = async () => {},
  onCheckpointSelectionFailure = () => {}
}) {
  let runtimeOptions = [];
  let activeRuntimeId = "reforge";
  let activeRuntime = null;
  let configuredDefaultRuntimeId = "reforge";
  let selectionToken = 0;
  let lifecycle = 0;
  let initialized = false;
  let switching = false;
  let switchPromise = Promise.resolve(true);
  let switchSnapshot = null;
  let refreshToken = 0;
  let catalogToken = 0;
  let healthToken = 0;
  let checkpointSelectionToken = 0;
  let refreshInFlight = false;
  let installedCheckpoints = [];
  let activeCheckpoint = null;
  let selectedCheckpoint = null;

  const safeRuntimeId = (value) => typeof value === "string"
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value.trim()) ? value.trim() : "";
  const isRuntimeSelectable = (runtime) => Boolean(runtime)
    && runtime.available !== false && (runtime.ok === undefined || runtime.ok === true);
  const runtimeSupports = (feature, runtime = activeRuntime) => !runtime
    ? feature === "txt2img"
    : runtime.features?.[feature] === true
      || (feature === "txt2img" && runtime.supportedModes?.includes("txt2img"));
  const isForgeNeoRuntime = () => activeRuntime?.provider === "forge-neo"
    || activeRuntime?.id === "forge-neo-anima";
  const runtimePayloadFor = (runtime) => ({ runtimeId: safeRuntimeId(runtime?.id) || "reforge" });
  const runtimePayload = () => activeRuntimeId ? { runtimeId: activeRuntimeId } : {};
  const runtimeApiUrl = (pathname) => {
    if (!activeRuntimeId) return pathname;
    return `${pathname}${pathname.includes("?") ? "&" : "?"}runtimeId=${encodeURIComponent(activeRuntimeId)}`;
  };
  const runtimeRequestContext = () => ({
    token: selectionToken,
    lifecycle,
    runtimeId: activeRuntimeId
  });
  const isRuntimeContextCurrent = (context) => initialized
    && context?.token === selectionToken
    && context.lifecycle === lifecycle
    && context.runtimeId === activeRuntimeId;
  const checkpointIdentity = (value) => String(value ?? "")
    .replaceAll("\\", "/")
    .split("/")
    .at(-1)
    .replace(/\s*\[[a-f0-9]+\]\s*$/i, "")
    .replace(/\.(?:safetensors|ckpt|pt)$/i, "")
    .trim()
    .toLowerCase();
  const findCheckpoint = (name) => {
    const identity = checkpointIdentity(name);
    return installedCheckpoints.find((checkpoint) =>
      [checkpoint.title, checkpoint.modelName, checkpoint.filename]
        .some((value) => checkpointIdentity(value) === identity)
    ) ?? installedCheckpoints.find((checkpoint) => {
      const candidate = checkpointIdentity(checkpoint.title);
      return identity && candidate && (identity.includes(candidate) || candidate.includes(identity));
    });
  };

  function snapshot() {
    return {
      runtimeOptions,
      activeRuntimeId,
      activeRuntime,
      switching,
      refreshInFlight,
      installedCheckpoints,
      activeCheckpoint,
      selectedCheckpoint
    };
  }

  function notifyRuntimeUi() {
    onRuntimeUiChange(snapshot());
  }

  function runtimeOptionLabel(runtime) {
    const label = String(runtime?.label ?? runtime?.id ?? "Runtime");
    if (runtime?.ok === false) return `${label}（未接続）`;
    if (runtime?.available === false) return `${label}（無効）`;
    return label;
  }

  function renderRuntimeOptions() {
    presentation.renderRuntimes?.(runtimeOptions.map((runtime) => ({
      ...runtime, optionLabel: runtimeOptionLabel(runtime), selectable: isRuntimeSelectable(runtime)
    })));
  }

  function configure(options, defaultRuntimeId) {
    runtimeOptions = Array.isArray(options)
      ? options.filter((item) => item && typeof item.id === "string" && typeof item.label === "string")
      : [];
    if (!runtimeOptions.some((item) => item.id === "reforge")) runtimeOptions.unshift({ ...FALLBACK_RUNTIME });
    configuredDefaultRuntimeId = safeRuntimeId(defaultRuntimeId) || "reforge";
    const saved = storage.getItem("localImageChat.runtimeId");
    const preferred = saved || configuredDefaultRuntimeId || "reforge";
    const selected = runtimeOptions.find((item) => item.id === preferred && isRuntimeSelectable(item))
      ?? runtimeOptions.find((item) => item.id === configuredDefaultRuntimeId && isRuntimeSelectable(item))
      ?? runtimeOptions.find((item) => isRuntimeSelectable(item))
      ?? runtimeOptions.find((item) => item.id === preferred)
      ?? runtimeOptions[0];
    activeRuntimeId = selected?.id ?? "reforge";
    activeRuntime = selected ?? null;
    if (activeRuntimeId) storage.setItem("localImageChat.runtimeId", activeRuntimeId);
    selectionToken += 1;
    renderRuntimeOptions();
    presentation.selectRuntime?.(activeRuntimeId);
    notifyRuntimeUi();
  }

  async function applyHealth(health, request = { token: ++healthToken, context: runtimeRequestContext() }) {
    if (request.token !== healthToken || !isRuntimeContextCurrent(request.context)) return false;
    if (!health || typeof health !== "object" || Array.isArray(health)) return false;
    runtimeOptions = runtimeOptions.map((runtime) => {
      const live = health[runtime.id];
      if (!live || typeof live !== "object" || Array.isArray(live)) return runtime;
      return {
        ...runtime,
        available: live.ok === true && live.available !== false,
        ok: live.ok === true,
        ...(typeof live.error === "string" && live.error.trim()
          ? { error: live.error.trim().slice(0, 200) } : {})
      };
    });
    activeRuntime = runtimeOptions.find((runtime) => runtime.id === activeRuntimeId) ?? activeRuntime;
    renderRuntimeOptions();
    const fallback = runtimeOptions.find((runtime) => runtime.id === configuredDefaultRuntimeId && isRuntimeSelectable(runtime))
      ?? runtimeOptions.find((runtime) => isRuntimeSelectable(runtime));
    if (activeRuntime && !isRuntimeSelectable(activeRuntime) && fallback
      && fallback.id !== activeRuntimeId && !getGenerationBusy() && !switching) {
      presentation.selectRuntime?.(fallback.id);
      if (!await selectRuntime(fallback.id) || request.token !== healthToken || !initialized) return false;
      request.context = runtimeRequestContext();
      request.catalogToken = catalogToken;
    } else {
      presentation.selectRuntime?.(activeRuntimeId);
      notifyRuntimeUi();
    }
    return true;
  }

  function captureState() {
    return {
      activeRuntimeId,
      activeRuntime,
      installedCheckpoints,
      activeCheckpoint,
      selectedCheckpoint,
      lastCheckpoint: storage.getItem("localImageChat.lastCheckpoint"),
      external: captureExternalSnapshot()
    };
  }

  function restoreState(saved) {
    if (!saved) return;
    activeRuntimeId = saved.activeRuntimeId;
    activeRuntime = saved.activeRuntime;
    installedCheckpoints = saved.installedCheckpoints;
    activeCheckpoint = saved.activeCheckpoint;
    selectedCheckpoint = saved.selectedCheckpoint;
    storage.setItem("localImageChat.runtimeId", activeRuntimeId);
    if (saved.lastCheckpoint === null) storage.removeItem("localImageChat.lastCheckpoint");
    else storage.setItem("localImageChat.lastCheckpoint", saved.lastCheckpoint);
    presentation.selectRuntime?.(activeRuntimeId);
    renderCheckpointControls();
    restoreExternalSnapshot(saved.external);
    onCheckpointCatalogChange(snapshot());
    notifyRuntimeUi();
    finalizeExternalRestore(saved.external);
  }

  async function selectRuntime(requestedRuntimeId) {
    const selected = runtimeOptions.find((item) => item.id === requestedRuntimeId);
    if (!selected || !isRuntimeSelectable(selected)) {
      presentation.selectRuntime?.(activeRuntimeId);
      return false;
    }
    if (getGenerationBusy()) {
      presentation.selectRuntime?.(activeRuntimeId);
      showError("生成中はRuntimeを切り替えられません");
      return false;
    }
    if (selected.id === activeRuntimeId) {
      presentation.selectRuntime?.(activeRuntimeId);
      return switching ? switchPromise : true;
    }
    if (!switching) switchSnapshot = captureState();
    activeRuntimeId = selected.id;
    activeRuntime = selected;
    selectionToken += 1;
    refreshToken += 1;
    catalogToken += 1;
    refreshInFlight = false;
    const context = runtimeRequestContext();
    switching = true;
    storage.setItem("localImageChat.runtimeId", activeRuntimeId);
    notifyRuntimeUi();
    const pending = (async () => {
      if (!runtimeSupports("txt2img")) return rollback(context);
      let results;
      try {
        results = await Promise.all([
          loadCheckpoints(context),
          ...await Promise.resolve(loadExternalResources(context))
        ]);
      } catch {
        return rollback(context);
      }
      if (!isRuntimeContextCurrent(context)) return false;
      if (!results.every(Boolean)) return rollback(context);
      switching = false;
      switchSnapshot = null;
      notifyRuntimeUi();
      return true;
    })();
    switchPromise = pending;
    return pending;
  }

  function rollback(context) {
    if (!isRuntimeContextCurrent(context)) return false;
    const saved = switchSnapshot;
    switching = false;
    restoreState(saved);
    selectionToken += 1;
    switchSnapshot = null;
    return false;
  }

  function renderCheckpointStatus(prefix = "") {
    if (activeCheckpoint && selectedCheckpoint && activeCheckpoint.title !== selectedCheckpoint.title) {
      presentation.checkpointStatus?.(`${prefix}使用中: ${activeCheckpoint.title}（次回生成で切替: ${selectedCheckpoint.title}）`);
    } else if (activeCheckpoint) {
      presentation.checkpointStatus?.(`${prefix}使用中: ${activeCheckpoint.title}`);
    } else if (selectedCheckpoint) {
      presentation.checkpointStatus?.(`${prefix}次回生成で切替: ${selectedCheckpoint.title}（使用中のCheckpointを確認できません）`);
    } else {
      presentation.checkpointStatus?.(`${prefix}使用中のCheckpointを判定できません`);
    }
  }

  function renderCheckpointControls() {
    const options = [...installedCheckpoints];
    for (const checkpoint of [selectedCheckpoint, activeCheckpoint]) {
      if (checkpoint && !options.some((item) => item.title === checkpoint.title)) options.push(checkpoint);
    }
    presentation.renderCheckpoints?.(options, selectedCheckpoint?.title ?? "");
  }

  function applyCheckpointCatalog(data, prefix = "") {
    installedCheckpoints = data.checkpoints ?? [];
    activeCheckpoint = findCheckpoint(data.activeCheckpoint) ?? (data.activeCheckpoint
      ? { title: data.activeCheckpoint, modelName: data.activeCheckpoint, filename: "" } : null);
    const remembered = selectedCheckpoint?.title || storage.getItem("localImageChat.lastCheckpoint") || "";
    selectedCheckpoint = findCheckpoint(remembered) ?? activeCheckpoint;
    renderCheckpointControls();
    storage.setItem("localImageChat.lastCheckpoint", selectedCheckpoint?.title ?? "");
    renderCheckpointStatus(prefix);
    onCheckpointCatalogChange(snapshot());
  }

  async function loadCheckpoints(context = runtimeRequestContext()) {
    refreshToken += 1;
    refreshInFlight = false;
    const requestToken = ++catalogToken;
    presentation.checkpointStatus?.(`${activeRuntime?.label ?? "Runtime"}からCheckpointを取得中…`);
    presentation.checkpointDisabled?.(true);
    presentation.refreshDisabled?.(true);
    try {
      const data = await getJson(runtimeApiUrl("/api/checkpoints"));
      if (requestToken !== catalogToken || !isRuntimeContextCurrent(context)) return false;
      applyCheckpointCatalog(data);
      return true;
    } catch (error) {
      if (requestToken !== catalogToken || !isRuntimeContextCurrent(context)) return false;
      presentation.checkpointFailure?.();
      presentation.checkpointStatus?.(`Checkpoint一覧を取得できません: ${error.message}`);
      onCheckpointCatalogChange(snapshot());
      return false;
    } finally {
      if (requestToken === catalogToken && isRuntimeContextCurrent(context)) {
        presentation.checkpointDisabled?.(!installedCheckpoints.length);
        presentation.refreshDisabled?.(getGenerationBusy() || switching || refreshInFlight);
      }
    }
  }

  async function refreshCheckpoints() {
    if (getGenerationBusy() || switching) return false;
    const context = runtimeRequestContext();
    const requestToken = ++refreshToken;
    const requestCatalogToken = ++catalogToken;
    refreshInFlight = true;
    presentation.checkpointDisabled?.(true);
    presentation.refreshDisabled?.(true);
    presentation.checkpointStatus?.(`${activeRuntime?.label ?? "Runtime"}でCheckpointを再走査中…`);
    try {
      const data = await postJson(runtimeApiUrl("/api/checkpoints/refresh"), {});
      if (requestToken !== refreshToken || requestCatalogToken !== catalogToken || !isRuntimeContextCurrent(context)) return false;
      applyCheckpointCatalog(data, "Checkpoint一覧を更新しました。 ");
      return true;
    } catch (error) {
      if (requestToken !== refreshToken || requestCatalogToken !== catalogToken || !isRuntimeContextCurrent(context)) return false;
      presentation.checkpointStatus?.(`Checkpoint一覧の更新に失敗: ${error.message}`);
      return false;
    } finally {
      if (requestToken === refreshToken) refreshInFlight = false;
      if (requestToken === refreshToken && requestCatalogToken === catalogToken
        && isRuntimeContextCurrent(context)) {
        presentation.checkpointDisabled?.(!installedCheckpoints.length);
        presentation.refreshDisabled?.(getGenerationBusy() || switching);
      }
      if (requestToken === refreshToken && requestCatalogToken === catalogToken
        && isRuntimeContextCurrent(context)) notifyRuntimeUi();
    }
  }

  async function selectCheckpoint(selectedTitle) {
    if (!selectedTitle || selectedTitle === selectedCheckpoint?.title) return false;
    const context = runtimeRequestContext();
    const requestToken = ++checkpointSelectionToken;
    const previousSelected = selectedCheckpoint;
    const selected = installedCheckpoints.find((checkpoint) => checkpoint.title === selectedTitle);
    const neoSelection = isForgeNeoRuntime();
    presentation.checkpointDisabled?.(true);
    presentation.refreshDisabled?.(true);
    presentation.checkpointStatus?.(neoSelection
      ? `次回生成用のCheckpointを確認中: ${selectedTitle}`
      : `切替中: ${selectedTitle}（モデル読込に時間がかかる場合があります）`);
    try {
      const data = await postJson("/api/checkpoints/select", { checkpoint: selectedTitle, ...runtimePayload() });
      if (requestToken !== checkpointSelectionToken || !isRuntimeContextCurrent(context)) return false;
      const nextCheckpoint = selected ?? findCheckpoint(data.checkpoint) ?? {
        title: data.checkpoint || selectedTitle,
        modelName: data.checkpoint || selectedTitle,
        filename: ""
      };
      selectedCheckpoint = nextCheckpoint;
      if (!neoSelection) activeCheckpoint = nextCheckpoint;
      storage.setItem("localImageChat.lastCheckpoint", selectedCheckpoint.title);
      renderCheckpointControls();
      onCheckpointSelectionSync(snapshot());
      presentation.checkpointStatus?.(neoSelection
        ? `次回生成で切替: ${selectedCheckpoint.title}${activeCheckpoint ? `（現在の使用中: ${activeCheckpoint.title}）` : ""}`
        : `切替完了: ${selectedCheckpoint.title}`);
      const isCurrent = () => requestToken === checkpointSelectionToken && isRuntimeContextCurrent(context);
      await onCheckpointSelectionChange(snapshot(), context, isCurrent);
      if (requestToken !== checkpointSelectionToken || !isRuntimeContextCurrent(context)) return false;
      return true;
    } catch (error) {
      if (requestToken !== checkpointSelectionToken || !isRuntimeContextCurrent(context)) return false;
      selectedCheckpoint = previousSelected;
      presentation.selectCheckpoint?.(selectedCheckpoint?.title ?? "");
      presentation.checkpointStatus?.(`Checkpoint切替に失敗: ${error.message}`);
      onCheckpointSelectionFailure(error, snapshot());
      return false;
    } finally {
      if (requestToken === checkpointSelectionToken && isRuntimeContextCurrent(context)) {
        presentation.checkpointDisabled?.(false);
        presentation.refreshDisabled?.(getGenerationBusy() || switching || refreshInFlight);
      }
    }
  }

  function updateActiveCheckpoint(name, request = null) {
    if (request && (request.token !== healthToken || request.catalogToken !== catalogToken
      || !isRuntimeContextCurrent(request.context))) return false;
    activeCheckpoint = name ? findCheckpoint(name) ?? { title: name, modelName: name, filename: "" } : null;
    renderCheckpointControls();
    renderCheckpointStatus();
    onCheckpointCatalogChange(snapshot());
    return true;
  }

  function init() {
    if (initialized) return;
    initialized = true;
    lifecycle += 1;
  }
  function dispose() {
    if (!initialized) return;
    initialized = false;
    lifecycle += 1;
    selectionToken += 1;
    refreshToken += 1;
    catalogToken += 1;
    healthToken += 1;
    checkpointSelectionToken += 1;
    refreshInFlight = false;
    switching = false;
    switchSnapshot = null;
  }

  return {
    init, dispose, configure, applyHealth, selectRuntime, loadCheckpoints, refreshCheckpoints,
    selectCheckpoint, updateActiveCheckpoint, renderCheckpointControls, renderCheckpointStatus,
    runtimeSupports, isRuntimeSelectable, isForgeNeoRuntime, runtimePayload, runtimePayloadFor,
    runtimeApiUrl, runtimeRequestContext, isRuntimeContextCurrent, safeRuntimeId, findCheckpoint,
    getState: snapshot,
    runtimeForGeneration(generation) {
      const id = safeRuntimeId(generation?.runtime?.id) || "reforge";
      return runtimeOptions.find((item) => item.id === id && isRuntimeSelectable(item)) ?? null;
    },
    waitForSwitch: () => switching ? switchPromise : Promise.resolve(true),
    beginHealthRequest: () => ({
      token: ++healthToken,
      catalogToken,
      context: runtimeRequestContext()
    }),
    isHealthRequestCurrent: (request) => request?.token === healthToken
      && request.context?.lifecycle === lifecycle
      && isRuntimeContextCurrent(request.context)
  };
}
