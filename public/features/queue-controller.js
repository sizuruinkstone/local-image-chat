import { buildQueuePanel, summarizeQueue } from "../queue-view.js";

const QUEUE_POLL_INTERVAL = 1200;
const QUEUE_IDLE_TICKS = 8;
const QUEUE_TERMINAL_STATUSES = ["done", "completed", "failed", "cancelled"];

export function createQueueController({ elements, getJson, postJson, deleteJson, toast, openModal,
  loadHistory, loadExperiments, openComparisonResult, isGalleryVisible, sleep }) {
  let snapshot = { generation: [], comparison: [], summary: { activeCount: 0 } };
  let polling = false;
  let panel = null;
  let seenTerminal = null;
  let initialized = false;

  const handlers = {
    onCancelGeneration: async (entry) => {
      try { await deleteJson(`/api/jobs/${entry.id}`); toast.info("生成を中止しました"); }
      catch (error) { toast.error(error.message); }
      await refresh();
    },
    onCancelComparison: async (entry) => {
      try { await postJson(`/api/experiments/${entry.id}/cancel`, {}); toast.warning("比較実験を中断しました"); }
      catch (error) { toast.error(error.message); }
      await refresh();
      await loadExperiments();
    },
    onOpenComparisonResult: (entry) => void openComparisonResult(entry.id)
  };

  function init() {
    if (initialized) return;
    initialized = true;
    elements.queueIndicator.addEventListener("click", openPanel);
  }
  function dispose() {
    if (!initialized) return;
    initialized = false;
    elements.queueIndicator.removeEventListener("click", openPanel);
  }
  async function refresh() {
    try { snapshot = await getJson("/api/queue"); }
    catch { return null; }
    renderIndicator();
    notifyChanges(snapshot);
    panel?.render(snapshot);
    return snapshot;
  }
  function startPolling() {
    if (polling) return;
    polling = true;
    void (async () => {
      let idle = 0;
      try {
        while (idle < QUEUE_IDLE_TICKS) {
          const current = await refresh();
          const active = Number(current?.summary?.activeCount) || 0;
          idle = active || panel ? 0 : idle + 1;
          await sleep(QUEUE_POLL_INTERVAL);
        }
      } finally {
        polling = false;
        hideIdleIndicator();
      }
    })();
  }
  function hideIdleIndicator() {
    if (panel) return;
    if (Number(snapshot?.summary?.activeCount) || 0) return;
    if (summarizeQueue(snapshot).tone === "error") return;
    elements.queueIndicator.classList.add("hidden");
  }
  function renderIndicator() {
    const summary = summarizeQueue(snapshot);
    elements.queueIndicator.classList.toggle("hidden", !summary.visible);
    elements.queueIndicator.dataset.tone = summary.tone;
    elements.queueIndicatorText.textContent = summary.text;
    elements.queueIndicator.title = summary.visible ? `${summary.text} / クリックで詳細` : "生成キューの詳細を表示";
  }
  function notifyChanges(current) {
    const terminal = new Set();
    const fresh = [];
    for (const entry of [...(current.generation ?? []), ...(current.comparison ?? [])]) {
      if (!QUEUE_TERMINAL_STATUSES.includes(entry.status)) continue;
      const key = `${entry.type}:${entry.id}:${entry.status}`;
      terminal.add(key);
      if (seenTerminal && !seenTerminal.has(key)) fresh.push(entry);
    }
    const firstLoad = seenTerminal === null;
    seenTerminal = terminal;
    if (firstLoad || !fresh.length) return;
    let refreshGallery = false;
    for (const entry of fresh) {
      if (entry.status === "cancelled") continue;
      if (entry.status === "failed") {
        toast.error(entry.type === "comparison"
          ? `比較実験が失敗しました: ${friendlyError(entry.errorMessage)}`
          : `生成に失敗しました: ${friendlyError(entry.errorMessage)}`);
        continue;
      }
      refreshGallery = true;
      if (entry.type === "comparison") {
        const failed = Number(entry.failedCases) || 0;
        toast.success(failed
          ? `比較実験が終了しました（${entry.completedCases}/${entry.totalCases}完了・${failed}件失敗）`
          : "比較実験が完了しました", {
          action: { label: "結果を見る", onSelect: () => void openComparisonResult(entry.id) }
        });
        continue;
      }
      if (isGalleryVisible()) toast.success("生成が完了しました");
    }
    if (refreshGallery) void loadHistory();
  }
  function friendlyError(message) {
    const text = String(message ?? "").split("\n")[0].trim();
    if (!text) return "詳細不明のエラーです";
    return text.length > 160 ? `${text.slice(0, 160)}…` : text;
  }
  function openPanel() {
    if (panel) return;
    let panelBody = null;
    const modal = openModal({
      title: "生成キュー", subtitle: "画像生成と比較実験の実行状況", size: "medium",
      build: (body) => { panelBody = body; body.append(buildQueuePanel(snapshot, handlers)); },
      actions: [{ label: "閉じる", primary: true }]
    });
    panel = {
      close: () => modal.close(),
      render: (current) => {
        if (!panelBody?.isConnected) return;
        panelBody.replaceChildren(buildQueuePanel(current, handlers));
      }
    };
    void modal.promise.then(() => { panel = null; });
    startPolling();
  }
  function closePanel() { panel?.close(); }

  return { init, dispose, refresh, startPolling, openPanel, closePanel };
}
