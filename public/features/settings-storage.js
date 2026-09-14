export function createStorageSettings({ elements, getJson, postJson, patchJson, confirmModal }) {
  let storageSettingsState = null;
  let storageMigrationPlan = null;
  let storageMigrationBusy = false;
  let initialized = false;

  async function load() {
    try {
      storageSettingsState = await getJson("/api/storage/settings");
      const pending = storageSettingsState.pendingOutputDir ?? "";
      if (!elements.storageTargetOutputDir.value || storageSettingsState.pendingStatus === "pending") {
        elements.storageTargetOutputDir.value = pending;
      }
      render();
      if (storageSettingsState.source !== "env") {
        setStatus(storageSettingsState.pendingStatus === "pending"
          ? "移行を予約しています。サーバーを通常終了して再起動するとコピーが始まります。"
          : storageSettingsState.pendingStatus === "failed"
            ? "前回の移行に失敗しました。内容を確認して再予約するか、予約を解除してください。"
            : "保存先を確認しました。");
      }
    } catch (error) {
      // 保存先設定の取得失敗で、他の設定画面の初期化を止めない。
      setStatus(`保存先設定を取得できません: ${error.message}`);
      elements.storageTargetOutputDir.disabled = true;
      elements.storagePlanButton.disabled = true;
      elements.storageReserveButton.disabled = true;
      elements.storageCancelButton.disabled = true;
    }
  }

  function render() {
    const settings = storageSettingsState;
    if (!settings) return;
    setPathText(elements.storageCurrentOutputDir, settings.currentOutputDir, "未確認");
    setPathText(elements.storagePendingOutputDir, settings.pendingOutputDir, settings.pendingStatus
      ? settings.pendingStatus === "failed" ? "前回予約（失敗）" : "次回起動時に適用"
      : "なし");
    elements.storageOutputSource.textContent = settings.source === "env"
      ? "環境変数 LOCAL_IMAGE_CHAT_OUTPUT_DIR"
      : settings.source === "stored" ? "この画面で保存した設定" : "既定の outputs/";
    elements.storageFavoritesFollow.textContent = settings.favorites?.followsOutputDir
      ? "追従する（output/favorite）"
      : "追従しない（LOCAL_IMAGE_CHAT_FAVORITES_DIR）";
    if (settings.source === "env") {
      elements.storageTargetOutputDir.disabled = true;
      elements.storageTargetOutputDir.title = "LOCAL_IMAGE_CHAT_OUTPUT_DIRを変更して再起動してください";
      setStatus("環境変数で固定されています。LOCAL_IMAGE_CHAT_OUTPUT_DIRを変更して再起動してください。");
    }
    if (settings.lastMigration) {
      const last = settings.lastMigration;
      elements.storageLastMigration.textContent = last.status === "completed"
        ? `前回の移行: 完了（${Number(last.copiedFiles ?? 0).toLocaleString("ja-JP")}ファイル / ${formatStorageBytes(last.copiedBytes)}）。旧保存先は手動確認まで残っています。`
        : `前回の移行: 失敗（${last.reason ?? "原因を確認できませんでした"}）。部分コピーは自動削除していません。`;
    } else {
      elements.storageLastMigration.textContent = "前回の移行結果: なし";
    }
    updateButtons();
  }

  function setPathText(element, value, fallback) {
    if (!element) return;
    const text = value || fallback;
    element.textContent = text;
    element.title = value || "";
  }

  function setStatus(message) {
    if (elements.storageStatus) elements.storageStatus.textContent = String(message ?? "");
  }

  function updateButtons() {
    if (!elements.storageTargetOutputDir || !elements.storagePlanButton) return;
    const editable = storageSettingsState?.editable === true;
    const pending = storageSettingsState?.pendingStatus;
    const hasTarget = Boolean(elements.storageTargetOutputDir.value.trim());
    elements.storageTargetOutputDir.disabled = !editable || storageMigrationBusy || pending === "pending";
    elements.storagePlanButton.disabled = !editable || storageMigrationBusy || pending === "pending" || !hasTarget;
    elements.storageReserveButton.disabled = !editable
      || storageMigrationBusy
      || !storageMigrationPlan?.valid
      || !storageMigrationPlan?.restartRequired;
    elements.storageCancelButton.disabled = !editable || storageMigrationBusy || !pending;
  }

  function invalidate() {
    storageMigrationPlan = null;
    if (elements.storagePlanSummary) elements.storagePlanSummary.textContent = "入力を変更しました。もう一度「変更内容を確認」してください。";
    updateButtons();
  }

  async function planMigration() {
    if (storageMigrationBusy || !storageSettingsState?.editable) return;
    const targetOutputDir = elements.storageTargetOutputDir.value.trim();
    if (!targetOutputDir) return;
    storageMigrationBusy = true;
    storageMigrationPlan = null;
    updateButtons();
    setStatus("保存先の安全性・件数・容量・空き容量を確認中…");
    try {
      const nextPlan = await postJson("/api/storage/plan", { targetOutputDir });
      storageMigrationPlan = nextPlan;
      elements.storagePlanSummary.textContent = describePlan(nextPlan);
      setStatus("内容を確認しました。予約する場合は、次回起動時にコピーが行われます。");
    } catch (error) {
      elements.storagePlanSummary.textContent = "この保存先は利用できません。空のフォルダまたは専用marker付きフォルダを指定してください。";
      setStatus(error.message);
    } finally {
      storageMigrationBusy = false;
      updateButtons();
    }
  }

  function describePlan(plan) {
    if (!plan?.valid) return plan?.error ?? "保存先を確認できませんでした。";
    const freeSpace = plan.availableBytesKnown && plan.availableBytes !== null
      ? `空き容量 ${formatStorageBytes(plan.availableBytes)}`
      : "空き容量は確認できませんでした";
    const targetFiles = plan.existingTargetFiles > 0
      ? `移行先の既存ファイル ${Number(plan.existingTargetFiles).toLocaleString("ja-JP")}件`
      : "移行先は空です";
    if (!plan.restartRequired) return "現在と同じ保存先です。変更はありません。";
    return `コピー対象 ${Number(plan.sourceFiles).toLocaleString("ja-JP")}ファイル / ${formatStorageBytes(plan.sourceBytes)}。${freeSpace}。${targetFiles}。旧保存先は削除せず残します。次回サーバー起動時に適用します。`;
  }

  async function reserve() {
    if (storageMigrationBusy || !storageMigrationPlan?.valid || !storageSettingsState?.editable) return;
    const confirmed = await confirmModal(
      "次回サーバー起動時に、既存の保存先から新しい保存先へコピーします。",
      {
        title: "画像の保存先を変更",
        confirmText: "移行を予約する",
        detail: `${describePlan(storageMigrationPlan)} 起動完了まで時間がかかる場合があります。自動で旧保存先を削除することはありません。`
      }
    );
    if (!confirmed) return;
    storageMigrationBusy = true;
    updateButtons();
    try {
      await patchJson("/api/storage/settings", {
        targetOutputDir: storageMigrationPlan.targetOutputDir,
        confirmMigration: true
      });
      storageMigrationPlan = null;
      await load();
      setStatus("移行を予約しました。生成中でないことを確認し、サーバーを終了して再起動してください。");
    } catch (error) {
      setStatus(error.message);
    } finally {
      storageMigrationBusy = false;
      updateButtons();
    }
  }

  async function cancel() {
    if (storageMigrationBusy || !storageSettingsState?.editable || !storageSettingsState.pendingOutputDir) return;
    const confirmed = await confirmModal("次回起動時の画像保存先移行の予約を解除しますか？", {
      title: "移行予約を解除",
      confirmText: "解除する"
    });
    if (!confirmed) return;
    storageMigrationBusy = true;
    updateButtons();
    try {
      await patchJson("/api/storage/settings", { cancelPending: true });
      storageMigrationPlan = null;
      await load();
      setStatus("移行予約を解除しました。現在の保存先は変更していません。");
    } catch (error) {
      setStatus(error.message);
    } finally {
      storageMigrationBusy = false;
      updateButtons();
    }
  }

  const onInput = () => invalidate();
  const onPlanClick = () => void planMigration();
  const onReserveClick = () => void reserve();
  const onCancelClick = () => void cancel();
  function init() {
    if (initialized) return;
    initialized = true;
    elements.storageTargetOutputDir.addEventListener("input", onInput);
    elements.storagePlanButton.addEventListener("click", onPlanClick);
    elements.storageReserveButton.addEventListener("click", onReserveClick);
    elements.storageCancelButton.addEventListener("click", onCancelClick);
  }
  function dispose() {
    if (!initialized) return;
    initialized = false;
    elements.storageTargetOutputDir.removeEventListener("input", onInput);
    elements.storagePlanButton.removeEventListener("click", onPlanClick);
    elements.storageReserveButton.removeEventListener("click", onReserveClick);
    elements.storageCancelButton.removeEventListener("click", onCancelClick);
  }

  return { init, dispose, load, render, invalidate, plan: planMigration, describe: describePlan, reserve, cancel };
}

function formatStorageBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "容量不明";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${Math.round(bytes)} B`;
}
