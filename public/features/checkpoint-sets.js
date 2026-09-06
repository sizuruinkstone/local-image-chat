const SETTING_KEYS = [
  "samplerName", "scheduler", "noiseSchedule", "steps", "cfgScale", "width", "height",
  "hiresScale", "hiresSteps", "hiresDenoising", "hiresUpscaler"
];

export function checkpointSetIdentity(value) {
  return String(value ?? "")
    .replaceAll("\\", "/")
    .split("/")
    .at(-1)
    .replace(/\s*\[[a-f0-9]+\]\s*$/i, "")
    .replace(/\.(?:safetensors|ckpt|pt)$/i, "")
    .trim()
    .toLowerCase();
}

export function createCheckpointSetController({
  elements,
  document,
  createOption = (text, value) => new Option(text, value),
  getJson,
  postJson,
  patchJson,
  deleteJson,
  confirmModal,
  promptModal,
  toast,
  withBusy,
  formatCheckpointBadge,
  shorten,
  runtime,
  settings,
  loras,
  prompt
}) {
  let checkpointSets = [];
  let appliedSettingsFingerprint = null;
  let initialized = false;
  let lifecycle = 0;

  function snapshot() {
    return {
      checkpointSets,
      appliedSettingsFingerprint
    };
  }

  function settingsFingerprint() {
    return JSON.stringify({
      settings: settings.read(),
      loras: [...loras.fingerprintEntries()].sort()
    });
  }

  function markSettingsApplied() {
    appliedSettingsFingerprint = settingsFingerprint();
  }

  function hasUnsavedSettingChanges() {
    return appliedSettingsFingerprint !== null
      && appliedSettingsFingerprint !== settingsFingerprint();
  }

  function setsForCheckpoint(checkpoint = runtime.getState().selectedCheckpoint) {
    const identity = checkpointSetIdentity(checkpoint?.title ?? checkpoint);
    return checkpointSets.filter((set) => checkpointSetIdentity(set.checkpoint) === identity);
  }

  function selectedCheckpointSet() {
    return checkpointSets.find((set) => set.id === elements.checkpointSetSelect.value) ?? null;
  }

  function describeSetSettings(value = {}) {
    return [
      value.width && value.height ? `${value.width}×${value.height}` : null,
      value.steps ? `${value.steps} Steps` : null,
      value.cfgScale ? `CFG ${value.cfgScale}` : null,
      value.samplerName,
      value.scheduler
    ].filter(Boolean).join("・") || "設定なし";
  }

  function syncControls() {
    const set = selectedCheckpointSet();
    const disabled = !set;
    for (const key of [
      "applyCheckpointSetButton", "renameCheckpointSetButton",
      "duplicateCheckpointSetButton", "deleteCheckpointSetButton"
    ]) elements[key].disabled = disabled;
    elements.checkpointSetAutoApply.checked = set?.autoApply === true;
    elements.checkpointSetAutoApply.disabled = disabled;
    elements.checkpointSetStatus.textContent = set
      ? `${set.name}: LoRA ${set.loras.length}個・${describeSetSettings(set.settings)}`
      : setsForCheckpoint().length
        ? "セットを選ぶと内容を表示します。"
        : "現在のCheckpoint用のセットはまだありません。";
  }

  function render() {
    const select = elements.checkpointSetSelect;
    const current = select.value;
    select.replaceChildren();
    const own = setsForCheckpoint();
    const ownIds = new Set(own.map((set) => set.id));
    const others = checkpointSets.filter((set) => !ownIds.has(set.id));
    select.append(createOption("セットを選択", ""));
    if (own.length) {
      const group = document.createElement("optgroup");
      group.label = "このCheckpoint";
      for (const set of own) {
        group.append(createOption(`${set.name}${set.autoApply ? "（自動適用）" : ""}`, set.id));
      }
      select.append(group);
    }
    if (others.length) {
      const group = document.createElement("optgroup");
      group.label = "他のCheckpoint";
      for (const set of others) {
        group.append(createOption(`${set.name} / ${shorten(set.checkpoint, 22)}`, set.id));
      }
      select.append(group);
    }
    if ([...select.options].some((option) => option.value === current)) select.value = current;
    syncControls();
  }

  async function load() {
    try {
      const data = await getJson("/api/checkpoint-lora-sets");
      checkpointSets = Array.isArray(data?.sets) ? data.sets : [];
    } catch {
      checkpointSets = [];
    }
    render();
    return checkpointSets;
  }

  function currentSetPayload(name) {
    const { selectedCheckpoint } = runtime.getState();
    const currentSettings = settings.read();
    const currentPrompt = prompt.read();
    return {
      name,
      checkpoint: selectedCheckpoint?.title ?? "",
      autoApply: elements.checkpointSetAutoApply.checked,
      loras: loras.readForSet(),
      settings: Object.fromEntries(
        SETTING_KEYS.map((key) => [key, currentSettings[key]])
      ),
      prompt: currentPrompt.prompt,
      negativePrompt: currentPrompt.negativePrompt,
      promptBoosts: currentPrompt.promptBoosts
    };
  }

  async function saveCurrent() {
    const { selectedCheckpoint } = runtime.getState();
    if (!selectedCheckpoint?.title) {
      toast.warning("Checkpointを選択してから保存してください");
      return false;
    }
    const name = await promptModal(
      "LoRAセットの名前",
      `${formatCheckpointBadge(selectedCheckpoint.title)} 基本セット`,
      { placeholder: "例: NoobAI 基本セット", confirmText: "保存" }
    );
    if (!name) return false;
    await withBusy(elements.saveCheckpointSetButton, "保存中…", async () => {
      try {
        const { set } = await postJson("/api/checkpoint-lora-sets", currentSetPayload(name));
        await load();
        elements.checkpointSetSelect.value = set.id;
        syncControls();
        markSettingsApplied();
        toast.success(`${set.name} を保存しました`);
      } catch (error) {
        toast.error(error.message);
      }
    });
    return true;
  }

  function createRuntimeGuard(state, context, isCurrent) {
    const currentLifecycle = lifecycle;
    const runtimeId = state?.activeRuntimeId;
    const checkpoint = checkpointSetIdentity(state?.selectedCheckpoint?.title);
    return () => {
      if (!initialized || lifecycle !== currentLifecycle || !isCurrent()
        || !runtime.isCurrent(context)) return false;
      const current = runtime.getState();
      return current.activeRuntimeId === runtimeId
        && checkpointSetIdentity(current.selectedCheckpoint?.title) === checkpoint;
    };
  }

  async function apply(set, {
    silent = false,
    state = runtime.getState(),
    context = runtime.getContext(),
    isCurrent = () => runtime.isCurrent(context)
  } = {}) {
    if (!set) return false;
    const guard = createRuntimeGuard(state, context, isCurrent);
    if (!guard()) return false;
    if (!silent && hasUnsavedSettingChanges()) {
      if (!guard()) return false;
      const confirmed = await confirmModal(
        `現在の設定を「${set.name}」で上書きします。編集中の内容は失われます。`,
        { title: "LoRAセットの適用", confirmText: "適用する" }
      );
      if (!guard()) return false;
      if (!confirmed) return false;
    }
    if (!guard()) return false;

    settings.apply(set.settings ?? {});
    const missing = loras.restore(set.loras ?? []);
    if (set.prompt || set.negativePrompt) {
      prompt.apply(set.prompt ?? "", set.negativePrompt ?? "");
    }
    loras.render();
    markSettingsApplied();
    toast.success(`${set.name}を適用しました${missing.length ? `（未導入のLoRA: ${missing.join(", ")}）` : ""}`);
    if (missing.length) toast.warning(`未導入のLoRAはスキップしました: ${missing.join(", ")}`);
    return true;
  }

  async function rename() {
    const set = selectedCheckpointSet();
    if (!set) return false;
    const name = await promptModal("セット名を変更", set.name);
    if (!name) return false;
    try {
      await patchJson(`/api/checkpoint-lora-sets/${set.id}`, { name });
      await load();
      elements.checkpointSetSelect.value = set.id;
      syncControls();
      toast.success("セット名を変更しました");
      return true;
    } catch (error) {
      toast.error(error.message);
      return false;
    }
  }

  async function duplicate() {
    const set = selectedCheckpointSet();
    if (!set) return false;
    try {
      const { set: created } = await patchJson(`/api/checkpoint-lora-sets/${set.id}`, { duplicate: true });
      await load();
      elements.checkpointSetSelect.value = created.id;
      syncControls();
      toast.success(`${created.name} を作成しました`);
      return true;
    } catch (error) {
      toast.error(error.message);
      return false;
    }
  }

  async function remove() {
    const set = selectedCheckpointSet();
    if (!set) return false;
    const confirmed = await confirmModal(`LoRAセット「${set.name}」を削除しますか？`, {
      title: "LoRAセットの削除",
      confirmText: "削除する",
      danger: true
    });
    if (!confirmed) return false;
    try {
      await deleteJson(`/api/checkpoint-lora-sets/${set.id}`);
      await load();
      toast.success("LoRAセットを削除しました");
      return true;
    } catch (error) {
      toast.error(error.message);
      return false;
    }
  }

  async function toggleAutoApply() {
    const set = selectedCheckpointSet();
    if (!set) return false;
    try {
      await patchJson(`/api/checkpoint-lora-sets/${set.id}`, {
        autoApply: elements.checkpointSetAutoApply.checked
      });
      await load();
      elements.checkpointSetSelect.value = set.id;
      syncControls();
      return true;
    } catch (error) {
      toast.error(error.message);
      return false;
    }
  }

  async function applyAuto(state, context, isCurrent) {
    const guard = createRuntimeGuard(state, context, isCurrent);
    if (!guard()) return false;
    const identity = checkpointSetIdentity(state?.selectedCheckpoint?.title);
    const set = checkpointSets.find((item) => item.autoApply
      && checkpointSetIdentity(item.checkpoint) === identity);
    if (!set || !guard()) return false;
    elements.checkpointSetSelect.value = set.id;
    syncControls();
    return apply(set, { state, context, isCurrent });
  }

  const onSelectChange = () => syncControls();
  const onAutoApplyChange = () => void toggleAutoApply();
  const onSave = () => void saveCurrent();
  const onApply = () => void apply(selectedCheckpointSet());
  const onRename = () => void rename();
  const onDuplicate = () => void duplicate();
  const onDelete = () => void remove();

  function init() {
    if (initialized) return;
    initialized = true;
    lifecycle += 1;
    elements.checkpointSetSelect.addEventListener("change", onSelectChange);
    elements.checkpointSetAutoApply.addEventListener("change", onAutoApplyChange);
    elements.saveCheckpointSetButton.addEventListener("click", onSave);
    elements.applyCheckpointSetButton.addEventListener("click", onApply);
    elements.renameCheckpointSetButton.addEventListener("click", onRename);
    elements.duplicateCheckpointSetButton.addEventListener("click", onDuplicate);
    elements.deleteCheckpointSetButton.addEventListener("click", onDelete);
  }

  function dispose() {
    if (!initialized) return;
    initialized = false;
    lifecycle += 1;
    elements.checkpointSetSelect.removeEventListener("change", onSelectChange);
    elements.checkpointSetAutoApply.removeEventListener("change", onAutoApplyChange);
    elements.saveCheckpointSetButton.removeEventListener("click", onSave);
    elements.applyCheckpointSetButton.removeEventListener("click", onApply);
    elements.renameCheckpointSetButton.removeEventListener("click", onRename);
    elements.duplicateCheckpointSetButton.removeEventListener("click", onDuplicate);
    elements.deleteCheckpointSetButton.removeEventListener("click", onDelete);
  }

  return {
    init,
    dispose,
    load,
    render,
    syncControls,
    selectedCheckpointSet,
    setsForCheckpoint,
    currentSetPayload,
    saveCurrent,
    apply,
    rename,
    duplicate,
    remove,
    toggleAutoApply,
    applyAuto,
    settingsFingerprint,
    markSettingsApplied,
    hasUnsavedSettingChanges,
    getState: snapshot
  };
}
