import { describeRetryInfo } from "../compare-view.js";
import { toGalleryEntries } from "../gallery-filter.js";
import { configureThumbnailImage, originalImageUrl } from "../image-delivery.js";

export function createExperimentController({
  document,
  elements,
  getJson,
  postJson,
  patchJson,
  deleteJson,
  toast,
  openModal,
  confirmModal,
  promptModal,
  withBusy,
  clearError,
  getFormSnapshot,
  setSeed,
  getSelectedLoraOptions,
  syncLorasFromPrompt,
  shouldRequestPrompt,
  requestPrompt,
  getRuntimePayload,
  getContentRating,
  getTitlePayload,
  getPromptPayload,
  getSelectedLoras,
  getPromptBoosts,
  getInitImagePayload,
  getInpaintPayload,
  getIpAdapterPayload,
  getSettings,
  onQueuePolling,
  getHistoryEntries,
  loadHistory,
  openComparison,
  openImageModal,
  toggleFavorite,
  onShowExperiments,
  onShowExperimentResult = onShowExperiments,
  onCloseQueuePanel = () => {},
  random = Math.random,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
}) {
  let experiments = [];
  let parameters = {};
  let limits = { maxImages: 8, hardLimit: 12 };
  let activeExperimentId = null;
  let polling = false;
  let lifecycleGeneration = 0;
  let disposed = false;
  const entryCache = new Map();
  let initialized = false;
  const listeners = [];

  const bind = (element, type, listener) => {
    element.addEventListener(type, listener);
    listeners.push([element, type, listener]);
  };

  function init() {
    if (initialized) return;
    disposed = false;
    initialized = true;
    bind(elements.experimentParameter, "change", syncTargetVisibility);
    bind(elements.runExperimentButton, "click", run);
    bind(elements.cancelExperimentButton, "click", cancel);
    bind(elements.openExperimentsButton, "click", openGallery);
    bind(elements.refreshExperimentsButton, "click", openGallery);
  }

  function dispose() {
    lifecycleGeneration += 1;
    polling = false;
    activeExperimentId = null;
    disposed = true;
    if (!initialized) return;
    for (const [element, type, listener] of listeners.splice(0)) element.removeEventListener(type, listener);
    initialized = false;
  }

  const isLifecycleStale = (generation) => disposed || generation !== lifecycleGeneration;

  async function load({ monitorGeneration = null } = {}) {
    const monitorIsStale = () => monitorGeneration !== null && isLifecycleStale(monitorGeneration);
    try {
      const data = await getJson("/api/experiments?limit=50");
      if (monitorIsStale()) return;
      parameters = data.parameters ?? {};
      limits = data.limits ?? limits;
      experiments = data.experiments ?? [];
    } catch {
      if (monitorIsStale()) return;
      experiments = [];
    }
    renderParameterSelect();
    renderBadge();
    if (!disposed) restoreMonitoring();
  }

  function restoreMonitoring() {
    if (polling) return;
    const running = experiments.find((item) => item.status === "running");
    if (running) {
      activeExperimentId = running.id;
      void poll(running.id);
    }
    syncControls();
  }

  function syncControls() {
    const running = Boolean(activeExperimentId);
    elements.runExperimentButton.disabled = running;
    elements.cancelExperimentButton.disabled = !running;
  }

  function renderParameterSelect() {
    const select = elements.experimentParameter;
    const current = select.value;
    select.replaceChildren();
    for (const [key, definition] of Object.entries(parameters)) appendOption(select, definition.label, key);
    if (!select.options.length) appendOption(select, "LoRA weight", "loraWeight");
    if ([...select.options].some((option) => option.value === current)) select.value = current;
    syncTargetVisibility();
  }

  function syncTargetVisibility() {
    const parameter = elements.experimentParameter.value;
    const needsTarget = parameters[parameter]?.needsTarget === true || parameter === "loraWeight";
    elements.experimentTargetRow.classList.toggle("hidden", !needsTarget);
    if (!needsTarget) return;
    const select = elements.experimentTarget;
    const current = select.value;
    select.replaceChildren();
    for (const item of getSelectedLoraOptions()) appendOption(select, item.label, item.value);
    if (!select.options.length) appendOption(select, "LoRAを選択してください", "");
    if ([...select.options].some((option) => option.value === current)) select.value = current;
  }

  function appendOption(select, label, value) {
    const option = document.createElement("option");
    option.textContent = label;
    option.value = value;
    select.append(option);
  }

  function renderBadge() {
    const running = experiments.find((item) => item.status === "running");
    elements.experimentBadge.textContent = running
      ? `${running.completed}/${running.total} 生成中`
      : experiments.length ? `${experiments.length}件の実験` : "未実行";
  }

  async function run() {
    clearError();
    if (activeExperimentId) {
      return toast.warning("別の比較実験が実行中です。完了または中断してから開始してください");
    }
    const form = getFormSnapshot();
    const parameter = form.parameter;
    const definition = parameters[parameter];
    const needsTarget = definition?.needsTarget === true || parameter === "loraWeight";
    const target = needsTarget ? form.target : "";
    if (needsTarget && !target) return toast.warning("比較する対象LoRAを選択してください");
    const values = String(form.values ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    if (values.length < 2) return toast.warning("試す値をカンマ区切りで2つ以上入力してください");
    if (values.length > limits.maxImages) return toast.warning(`比較生成は最大${limits.maxImages}枚までです`);
    if (values.length > 4) {
      const confirmed = await openConfirmation(values.length);
      if (!confirmed) return;
    }
    if (!form.description && !String(form.positivePrompt ?? "").trim()) {
      return toast.warning("生成したい画像を日本語で入力するか、Promptを入力してください");
    }
    if (form.mode !== "txt2img" && !form.hasInitImage) {
      return toast.warning(`${form.mode === "inpaint" ? "部分修正" : "img2img"}の参照画像を選択してください`);
    }
    let fixedSeed = null;
    if (form.fixSeed && parameter !== "seed") {
      let seed = Number(form.seed);
      if (!Number.isFinite(seed) || seed < 0) {
        seed = Math.floor(random() * 4294967295);
        setSeed(seed);
      }
      fixedSeed = seed;
    }
    syncLorasFromPrompt();
    await withBusy(elements.runExperimentButton, "開始中…", async () => {
      try {
        if (shouldRequestPrompt(form.description)) {
          elements.experimentStatus.textContent = "日本語からプロンプトを作成中…";
          await requestPrompt(form.description);
        }
        const baseRequest = {
          ...getRuntimePayload(),
          mode: form.mode,
          contentRating: getContentRating(),
          description: form.description,
          ...getTitlePayload(),
          ...getPromptPayload(),
          loras: getSelectedLoras(),
          promptBoosts: getPromptBoosts(),
          ...getInitImagePayload(),
          ...getInpaintPayload(),
          ...getIpAdapterPayload(),
          settings: getSettings({ candidateCount: 1, hiresEnabled: false })
        };
        const { experiment } = await postJson("/api/experiments", { baseRequest, parameter, target, values, fixedSeed });
        activeExperimentId = experiment.id;
        toast.info(`比較生成を開始しました（${experiment.total}枚）`);
        onQueuePolling();
        void poll(experiment.id);
      } catch (error) {
        elements.experimentStatus.textContent = error.message;
        toast.error(error.message);
      }
    });
    syncControls();
  }

  function openConfirmation(count) {
    return confirmModal(
      `${count}枚を1枚ずつ順番に生成します。時間がかかりますがよろしいですか？`,
      { title: "比較生成の確認", confirmText: "生成する" }
    );
  }

  async function poll(experimentId) {
    if (polling || disposed) return;
    const generation = lifecycleGeneration;
    polling = true;
    activeExperimentId = experimentId;
    syncControls();
    elements.experimentProgress.classList.remove("hidden");
    try {
      while (true) {
        if (isLifecycleStale(generation)) return;
        const { experiment } = await getJson(`/api/experiments/${experimentId}`);
        if (isLifecycleStale(generation)) return;
        renderProgress(experiment);
        if (experiment.status !== "running") {
          elements.experimentStatus.textContent = experiment.status === "cancelled"
            ? `中断しました（完了 ${experiment.completed}/${experiment.total} 枚は履歴に残ります）`
            : `完了: ${experiment.completed}/${experiment.total} 枚`;
          if (experiment.status === "cancelled") toast.warning("比較生成を中断しました");
          else toast.success(`比較生成が完了しました（${experiment.completed}枚）`);
          await loadHistory();
          if (isLifecycleStale(generation)) return;
          await load({ monitorGeneration: generation });
          return;
        }
        await sleep(1000);
        if (isLifecycleStale(generation)) return;
      }
    } catch (error) {
      if (isLifecycleStale(generation)) return;
      elements.experimentStatus.textContent = `実験の状態を取得できません: ${error.message}`;
    } finally {
      if (generation !== lifecycleGeneration) return;
      polling = false;
      activeExperimentId = null;
      syncControls();
    }
  }

  function renderProgress(experiment) {
    elements.experimentProgress.replaceChildren();
    const heading = document.createElement("strong");
    heading.textContent = `${experiment.name}（${experiment.completed}/${experiment.total}）`;
    elements.experimentProgress.append(heading);
    for (const run of experiment.runs) {
      const row = document.createElement("div");
      row.className = `experimentRun status-${run.status}`;
      const label = document.createElement("span");
      label.textContent = `${run.index}. ${experiment.target ? `${experiment.target} ` : ""}${run.value}`;
      const state = document.createElement("span");
      state.textContent = {
        queued: "待機中", running: run.message || "生成中", done: "完了",
        failed: run.error || "失敗", cancelled: "中止"
      }[run.status] ?? run.status;
      if (run.error) state.title = run.error;
      row.append(label, state);
      if (run.recovered) row.append(recoveredBadge(run.retryInfo));
      elements.experimentProgress.append(row);
    }
    const running = experiment.runs.find((run) => run.status === "running");
    elements.experimentStatus.textContent = running
      ? `${running.index} / ${experiment.total} 生成中・${experiment.target ? `${experiment.target}: ` : ""}${running.value}`
      : `${experiment.completed} / ${experiment.total} 完了`;
    renderBadge();
  }

  function recoveredBadge(retryInfo) {
    const badge = document.createElement("span");
    badge.className = "experimentRecovered";
    badge.textContent = "設定を下げて再試行";
    badge.title = describeRetryInfo(retryInfo) || "自動リカバリのため設定を下げて再試行しました";
    return badge;
  }

  async function cancel() {
    if (!activeExperimentId) return;
    await withBusy(elements.cancelExperimentButton, "中断中…", async () => {
      try {
        await postJson(`/api/experiments/${activeExperimentId}/cancel`, {});
      } catch (error) {
        toast.error(error.message);
      }
    });
    syncControls();
  }

  async function openGallery() {
    onShowExperimentResult();
    await load();
    renderCards();
  }

  function renderCards() {
    elements.experimentGrid.replaceChildren();
    if (!experiments.length) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "「パラメータ比較」で比較生成すると、ここへ実験としてまとまります。";
      elements.experimentGrid.append(empty);
      return;
    }
    for (const experiment of experiments) elements.experimentGrid.append(createCard(experiment));
  }

  function entriesFor(experiment) {
    const imageIds = new Set(experiment.runs.flatMap((run) => run.imageIds ?? []));
    const combined = [...getHistoryEntries(), ...(entryCache.get(experiment.id) ?? [])];
    const seen = new Set();
    return combined.filter((entry) => {
      const imageId = String(entry.image.id);
      if (seen.has(imageId)) return false;
      if (entry.generation.experimentId !== experiment.id && !imageIds.has(entry.image.id)) return false;
      seen.add(imageId);
      return true;
    });
  }

  async function ensureEntries(experiment) {
    const expected = new Set(experiment.runs.flatMap((run) => run.imageIds ?? []));
    const current = entriesFor(experiment);
    if ([...expected].every((id) => current.some((entry) => entry.image.id === id))) return current;
    const data = await getJson(`/api/experiments/${experiment.id}/history`);
    entryCache.set(experiment.id, toGalleryEntries(data.generations ?? []));
    return entriesFor(experiment);
  }

  function createCard(experiment) {
    const card = document.createElement("article");
    card.className = "experimentCard";
    const header = document.createElement("div");
    header.className = "experimentCardHeader";
    const title = document.createElement("strong");
    title.textContent = experiment.name;
    const status = document.createElement("span");
    status.className = `experimentCardStatus ${experiment.status}`;
    status.textContent = { running: "生成中", done: "完了", cancelled: "中断" }[experiment.status] ?? experiment.status;
    header.append(title, status);
    const meta = document.createElement("div");
    meta.className = "experimentCardMeta";
    meta.append(line(`${experiment.total}枚（完了 ${experiment.completed}）`),
      line(experiment.fixedSeed != null ? `Seed ${experiment.fixedSeed}` : "Seed 未固定"),
      line(experiment.values.join(" / ")));
    const thumbs = document.createElement("div");
    thumbs.className = "experimentCardThumbs";
    for (const entry of entriesFor(experiment).slice(0, 4)) {
      const image = document.createElement("img");
      configureThumbnailImage(image, entry.image);
      image.alt = `${experiment.name} ${entry.generation.comparedValue ?? ""}`;
      image.title = "クリックで拡大";
      image.addEventListener("click", () => openImageModal(originalImageUrl(entry.image), experiment.name));
      thumbs.append(image);
    }
    const actions = document.createElement("div");
    actions.className = "experimentCardActions";
    actions.append(
      actionButton("開く", "secondary", () => void openDetail(experiment)),
      actionButton("比較", "secondary", () => void compare(experiment)),
      actionButton("名前変更", "ghost", () => void rename(experiment)),
      actionButton("削除", "historyDelete", () => void remove(experiment))
    );
    card.append(header, meta, thumbs, actions);
    return card;
  }

  function line(text) {
    const span = document.createElement("span");
    span.textContent = text;
    return span;
  }

  function actionButton(label, className, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", handler);
    return button;
  }

  async function compare(experiment) {
    try {
      const selected = (await ensureEntries(experiment)).slice(0, 4);
      if (selected.length < 2) return toast.warning("比較できる画像が2枚以上ありません");
      await openComparison(selected, { experimentId: experiment.id, parameter: experiment.parameter });
    } catch (error) {
      toast.error(`比較画像を取得できません: ${error.message}`);
    }
  }

  async function openDetail(experiment) {
    let entries;
    try {
      entries = await ensureEntries(experiment);
    } catch (error) {
      toast.error(`実験画像を取得できません: ${error.message}`);
      return;
    }
    openModal({
      title: experiment.name,
      subtitle: `${experiment.parameter}${experiment.target ? ` / ${experiment.target}` : ""}・${experiment.total}枚`,
      size: "large",
      build: (body, close) => {
        const grid = document.createElement("div");
        grid.className = "experimentDetailGrid";
        for (const run of experiment.runs) {
          const entry = entries.find((item) => (run.imageIds ?? []).includes(item.image.id));
          const cell = document.createElement("figure");
          cell.className = "experimentDetailCell";
          if (entry) {
            const image = document.createElement("img");
            configureThumbnailImage(image, entry.image);
            image.alt = `${run.value}`;
            image.addEventListener("click", () => openImageModal(originalImageUrl(entry.image), `${experiment.name} ${run.value}`));
            cell.append(image);
          } else {
            const placeholder = document.createElement("div");
            placeholder.className = "experimentDetailPlaceholder";
            placeholder.textContent = { queued: "待機中", running: "生成中", failed: "失敗", cancelled: "中止" }[run.status] ?? "—";
            if (run.error) placeholder.title = run.error;
            cell.append(placeholder);
          }
          const caption = document.createElement("figcaption");
          caption.textContent = `${run.value}`;
          if (run.recovered || entry?.generation?.retryInfo) caption.append(recoveredBadge(run.retryInfo ?? entry?.generation?.retryInfo));
          if (entry?.image.vote) {
            const vote = document.createElement("span");
            vote.className = `experimentVote vote-${entry.image.vote}`;
            vote.textContent = { win: "A/B勝ち", lose: "A/B負け", draw: "引き分け" }[entry.image.vote] ?? entry.image.vote;
            caption.append(vote);
          }
          if (entry) {
            const favorite = document.createElement("button");
            favorite.type = "button";
            favorite.className = `iconButton${entry.image.favorite ? " active" : ""}`;
            favorite.textContent = "👍";
            favorite.title = "お気に入り";
            favorite.addEventListener("click", () => void toggleFavorite(entry.image, favorite));
            caption.append(favorite);
            const best = document.createElement("button");
            best.type = "button";
            best.className = experiment.bestImageId === entry.image.id ? "primary smallButton" : "ghost smallButton";
            best.textContent = experiment.bestImageId === entry.image.id ? "最良" : "最良にする";
            best.addEventListener("click", async () => {
              await patchJson(`/api/experiments/${experiment.id}`, { bestImageId: entry.image.id });
              toast.success("最良画像を記録しました");
              await load();
              close();
            });
            caption.append(best);
          }
          cell.append(caption);
          grid.append(cell);
        }
        body.append(grid);
        if (experiment.bestImageId) {
          const note = document.createElement("p");
          note.className = "uiFieldNote";
          note.textContent = `最良画像: ${experiment.bestImageId}`;
          body.append(note);
        }
      },
      actions: [
        {
          label: "比較する",
          variant: "secondary",
          keepOpen: true,
          onSelect: (close) => {
            const selected = entries.slice(0, 4);
            if (selected.length < 2) {
              toast.warning("比較できる画像が2枚以上ありません");
              return false;
            }
            close();
            void openComparison(selected, { experimentId: experiment.id, parameter: experiment.parameter });
          }
        },
        { label: "閉じる", primary: true }
      ]
    });
  }

  async function rename(experiment) {
    const name = await promptModal("実験名を変更", experiment.name);
    if (!name) return;
    try {
      await patchJson(`/api/experiments/${experiment.id}`, { name });
      toast.success("実験名を変更しました");
      await load();
      renderCards();
    } catch (error) {
      toast.error(error.message);
    }
  }

  async function remove(experiment) {
    const choice = await openModal({
      title: "実験の一括削除",
      subtitle: experiment.name,
      size: "small",
      dismissValue: null,
      build: (body) => {
        const message = document.createElement("p");
        message.className = "uiModalMessage";
        message.textContent = `${experiment.total}枚分の実験「${experiment.name}」を削除します。この操作は取り消せません。`;
        body.append(message);
      },
      actions: [
        { label: "キャンセル", value: null, variant: "secondary" },
        { label: "履歴だけ削除", value: "history", variant: "secondary" },
        { label: "履歴と画像を削除", value: "all", variant: "dangerButton", primary: true }
      ]
    }).promise;
    if (!choice) return;
    try {
      const query = choice === "all" ? "?deleteImages=1" : "";
      const result = await deleteJson(`/api/experiments/${experiment.id}${query}`);
      entryCache.delete(experiment.id);
      toast.success(`実験を削除しました（履歴${result.removedGenerations}件・画像${result.removedImages}枚）`);
      await loadHistory();
      await load();
      renderCards();
    } catch (error) {
      toast.error(error.message);
    }
  }

  async function openResult(experimentId) {
    onCloseQueuePanel();
    await loadHistory();
    await load();
    const experiment = experiments.find((item) => item.id === experimentId);
    if (!experiment) return toast.warning("実験が見つかりません");
    onShowExperiments();
    renderCards();
    await openDetail(experiment);
  }

  return {
    init,
    dispose,
    load,
    run,
    poll,
    cancel,
    openGallery,
    openResult,
    renderCards,
    renderProgress,
    syncTargetVisibility,
    syncControls,
    entriesFor,
    ensureEntries,
    compare,
    openDetail,
    rename,
    remove,
    getExperiments: () => experiments,
    getActiveExperimentId: () => activeExperimentId,
    isPolling: () => polling,
    getEntryCacheSize: () => entryCache.size
  };
}
