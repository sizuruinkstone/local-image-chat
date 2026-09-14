import { DEFAULT_GROK_INSTRUCTIONS, buildGrokRequestText } from "../prompt-import.js";
// AI共有CSVの自動更新も、続けて走らせない。
const SHARE_SYNC_DEBOUNCE = 1500;

export function createAiShare({ elements, document, getJson, postJson, patchJson, withBusy, copyToClipboard,
  flashLabel, toast, openModal, confirmModal, formatDate, getManualTriggerWords,
  nowIso = () => new Date().toISOString(), setTimer = setTimeout, clearTimer = clearTimeout,
  warn = (message) => console.warn(message) }) {
  let shareSyncTimer = null;
  let initialized = false;
  function renderShareStatus(state) {
    if (!state?.generatedAt) {
      elements.shareBarStatus.textContent = "AI共有CSVは未作成です。「AI共有CSVを更新」で作成できます。";
      return;
    }
    const text = `AI共有CSV: ${state.rowCount}件（Trigger Words ${state.triggerWordCount}件）・${formatDate(state.generatedAt)}・${state.path}`;
    elements.shareBarStatus.textContent = text;
    // スマホでは2行に切り詰めて表示するため、全文はtitleでも見られるようにする。
    elements.shareBarStatus.title = text;
  }
  async function loadShareState() {
    try {
      const { state } = await getJson("/api/ai-share");
      renderShareStatus(state);
    } catch (error) {
      elements.shareBarStatus.textContent = `AI共有CSVの状態を取得できません: ${error.message}`;
    }
  }
  async function updateShareCsv() {
    await withBusy(elements.updateShareCsvButton, "更新中…", async () => {
      try {
        const result = await postJson("/api/ai-share/csv", { triggerWords: getManualTriggerWords() });
        renderShareStatus(result);
        // 指示テンプレート側のlora_list.csvも同じ内容へ合わせる。
        if (elements.grokLoraCsv.value !== result.csv) {
          elements.grokLoraCsv.value = result.csv;
          await patchJson("/api/prompt-template", { loraCsv: result.csv }).catch(() => {});
        }
        toast.success(`AI共有CSVを更新しました: ${result.rowCount}件（Trigger Words ${result.triggerWordCount}件）\n${result.path}`);
      } catch (error) {
        toast.error(`AI共有CSVを更新できませんでした: ${error.message}`);
      }
    });
  }
  async function copyGrokShare() {
    await withBusy(elements.copyGrokShareButton, "作成中…", async () => {
      try {
        const result = await postJson("/api/ai-share/grok", { triggerWords: getManualTriggerWords() });
        await copyToClipboard(result.markdown);
        flashLabel(elements.copyGrokShareButton, "Copied!");
        renderShareStatus({ ...result, generatedAt: nowIso() });
        toast.success(`Grok用データをコピーしました（LoRA ${result.rowCount}件）`, { action: { label: "内容を確認", onSelect: () => openSharePreview(result.markdown) } });
      } catch (error) {
        toast.error(`Grok用データをコピーできませんでした: ${error.message}`);
      }
    });
  }
  function openSharePreview(markdown) {
    openModal({
      title: "Grok用データ",
      subtitle: "クリップボードへコピーした内容です",
      size: "large",
      build: (body) => {
        const preview = document.createElement("pre");
        preview.className = "sharePreview";
        preview.textContent = markdown;
        body.append(preview);
      },
      actions: [{ label: "閉じる", value: true, primary: true }]
    });
  }
  // LoRA一覧やTrigger Wordsが変わったときの自動同期。
  // 失敗しても通常の操作を止めない（best-effort）。
  function scheduleShareCsvSync() {
    clearTimer(shareSyncTimer);
    shareSyncTimer = setTimer(() => void syncShareCsvQuietly(), SHARE_SYNC_DEBOUNCE);
  }
  async function syncShareCsvQuietly() {
    clearTimer(shareSyncTimer);
    try {
      const result = await postJson("/api/ai-share/csv", { triggerWords: getManualTriggerWords() });
      renderShareStatus(result);
    } catch (error) {
      warn(`[AI共有] CSVの自動更新に失敗しました: ${error.message}`);
    }
  }
  async function loadPromptTemplate() {
    try {
      const { template } = await getJson("/api/prompt-template");
      elements.grokInstructions.value = template.instructions || DEFAULT_GROK_INSTRUCTIONS;
      elements.grokSetupDoc.value = template.setupDoc;
      elements.grokLoraCsv.value = template.loraCsv;
      renderPromptTemplateStatus(template);
    } catch (error) {
      elements.grokTemplateStatus.textContent = `指示テンプレートを取得できません: ${error.message}`;
    }
  }
  function renderPromptTemplateStatus(template) {
    const parts = [template.updatedAt ? `保存: ${formatDate(template.updatedAt)}` : "未保存"];
    if (template.loraCsvUpdatedAt) parts.push(`lora_list.csv更新: ${formatDate(template.loraCsvUpdatedAt)}`);
    elements.grokTemplateStatus.textContent = parts.join("・");
  }
  async function savePromptTemplate({ silent = false } = {}) {
    const { template } = await patchJson("/api/prompt-template", { instructions: elements.grokInstructions.value, setupDoc: elements.grokSetupDoc.value, loraCsv: elements.grokLoraCsv.value });
    renderPromptTemplateStatus(template);
    if (!silent) toast.success("指示テンプレートを保存しました");
    return template;
  }
  async function copyGrokTemplate() {
    const text = buildGrokRequestText({ instructions: elements.grokInstructions.value, setupDoc: elements.grokSetupDoc.value, loraCsv: elements.grokLoraCsv.value });
    if (!text.trim()) return toast.warning("コピーできる内容がありません");
    try {
      await copyToClipboard(text);
      flashLabel(elements.copyGrokTemplateButton, "Copied!");
      // コピーした内容をそのまま次回も使えるよう、保存も済ませておく。
      await savePromptTemplate({ silent: true });
    } catch (error) {
      toast.error(`コピーできませんでした: ${error.message}`);
    }
  }
  async function updateLoraCsvFromInstalled() {
    await withBusy(elements.generateLoraCsvButton, "更新中…", async () => {
      try {
        const result = await postJson("/api/ai-share/csv", { triggerWords: getManualTriggerWords() });
        elements.grokLoraCsv.value = result.csv;
        renderShareStatus(result);
        await savePromptTemplate({ silent: true });
        toast.success(`lora_list.csvを${result.rowCount}件で更新しました（Trigger Words ${result.triggerWordCount}件）`);
      } catch (error) {
        toast.error(`lora_list.csvを更新できませんでした: ${error.message}`);
      }
    });
  }
  async function resetGrokInstructions() {
    const confirmed = await confirmModal("指示テンプレートを既定の内容へ戻します。よろしいですか？", { title: "指示テンプレートの初期化", confirmText: "戻す" });
    if (!confirmed) return;
    elements.grokInstructions.value = DEFAULT_GROK_INSTRUCTIONS;
    await savePromptTemplate({ silent: true });
    toast.info("既定の指示文へ戻しました");
  }
  const listeners = [
    [elements.copyGrokShareButton, "click", () => void copyGrokShare()], [elements.updateShareCsvButton, "click", () => void updateShareCsv()],
    [elements.copyGrokTemplateButton, "click", () => void copyGrokTemplate()], [elements.saveGrokTemplateButton, "click", () => void savePromptTemplate()],
    [elements.generateLoraCsvButton, "click", () => void updateLoraCsvFromInstalled()], [elements.resetGrokInstructionsButton, "click", () => void resetGrokInstructions()]
  ];
  function init() {
    if (initialized) return;
    initialized = true;
    for (const [node, type, fn] of listeners) node.addEventListener(type, fn);
  }
  function dispose() {
    if (!initialized) return;
    initialized = false;
    for (const [node, type, fn] of listeners) node.removeEventListener(type, fn);
    // Controller破棄後に保留中の同期を発火させない。
    clearTimer(shareSyncTimer);
  }
  return { init, dispose, loadShareState, loadPromptTemplate, scheduleShareCsvSync, syncShareCsvQuietly, updateShareCsv,
    copyGrokShare, openSharePreview, savePromptTemplate, copyGrokTemplate, updateLoraCsvFromInstalled, resetGrokInstructions };
}
