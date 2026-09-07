import { PREFERENCE_KEYS } from "../core/preferences.js";

export function createSettingsUpdate({
  elements,
  document,
  preferences,
  postJson,
  fetchImpl = globalThis.fetch,
  describeRuntime,
  onStatusChanged = () => {},
  onOpenSettings = () => {}
}) {
  let initialized = false;
  let updateInfo = null;
  const listeners = [];

  function listen(target, type, handler) {
    target?.addEventListener(type, handler);
    if (target) listeners.push([target, type, handler]);
  }

  function restoreSessionSecret() {
    elements.githubToken.value = preferences.getSession(PREFERENCE_KEYS.githubToken, "");
  }

  function rememberSessionSecret() {
    preferences.setSession(PREFERENCE_KEYS.githubToken, elements.githubToken.value);
  }

  async function loadVersionContract(serverVersion, runtime) {
    if (!elements.versionContractStatus) return;
    try {
      const response = await fetchImpl("/version.json", { cache: "no-cache" });
      if (!response.ok) throw new Error(`version.json: ${response.status}`);
      const { version: staticVersion } = await response.json();
      const diskVersion = String(staticVersion ?? "").trim();
      const runtimeVersion = String(serverVersion ?? "").trim();
      if (!diskVersion || !runtimeVersion) {
        renderVersionContractStatus("バージョン情報を確認できません。", runtime);
        return;
      }
      renderVersionContractStatus(
        diskVersion === runtimeVersion
          ? `Version ${diskVersion}　最新ファイルを使用中`
          : `画面 ${diskVersion} / サーバー ${runtimeVersion}　更新を反映するにはサーバーを再起動してください`,
        runtime
      );
    } catch {
      renderVersionContractStatus("画面バージョンを確認できません。", runtime);
    }
  }

  function renderVersionContractStatus(message, runtime) {
    const status = elements.versionContractStatus;
    status.replaceChildren(document.createTextNode(message));
    const runtimeSummary = describeRuntime(runtime);
    if (!runtimeSummary) return;
    status.append(document.createElement("br"), document.createTextNode(runtimeSummary));
  }

  async function checkForUpdate() {
    rememberSessionSecret();
    elements.checkUpdateButton.disabled = true;
    elements.applyUpdateButton.disabled = true;
    elements.updateStatus.textContent = "GitHubの最新版を確認中…";
    onStatusChanged();
    try {
      updateInfo = await postJson("/api/update/check", {
        token: elements.githubToken.value
      });
      if (updateInfo.updateAvailable) {
        elements.updateStatus.textContent = `v${updateInfo.currentVersion} → v${updateInfo.latestVersion}へ更新できます。`;
        elements.applyUpdateButton.disabled = false;
      } else {
        elements.updateStatus.textContent = `v${updateInfo.currentVersion}が最新版です。`;
      }
    } catch (error) {
      updateInfo = null;
      elements.updateStatus.textContent = error.message;
    } finally {
      elements.checkUpdateButton.disabled = false;
      onStatusChanged();
    }
  }

  async function applyUpdate() {
    if (!updateInfo?.updateAvailable) return;
    rememberSessionSecret();
    elements.checkUpdateButton.disabled = true;
    elements.applyUpdateButton.disabled = true;
    elements.updateStatus.textContent = "バックアップを作成して更新中…";
    try {
      const data = await postJson("/api/update/apply", {
        token: elements.githubToken.value
      });
      elements.updateStatus.textContent = data.applied
        ? `v${data.latestVersion}へ更新しました。start.batを閉じて再起動してください。`
        : "すでに最新版です。";
    } catch (error) {
      elements.updateStatus.textContent = error.message;
      elements.applyUpdateButton.disabled = false;
    } finally {
      elements.checkUpdateButton.disabled = false;
    }
  }

  function init() {
    if (initialized) return;
    initialized = true;
    listen(elements.checkUpdateButton, "click", () => void checkForUpdate());
    listen(elements.applyUpdateButton, "click", () => void applyUpdate());
    listen(elements.updateStatusButton, "click", () => {
      onOpenSettings();
      void checkForUpdate();
    });
  }

  function dispose() {
    if (!initialized) return;
    initialized = false;
    for (const [target, type, handler] of listeners.splice(0)) {
      target.removeEventListener(type, handler);
    }
  }

  function getConnectionStatus() {
    const updateText = elements.updateStatus.textContent ?? "";
    if (updateInfo?.updateAvailable || updateText.includes("更新できます")) return "更新あり";
    if (updateInfo && updateText.includes("最新版")) return "最新";
    return "未確認";
  }

  return {
    init,
    dispose,
    restoreSessionSecret,
    rememberSessionSecret,
    loadVersionContract,
    checkForUpdate,
    applyUpdate,
    getConnectionStatus,
    getUpdateInfo: () => updateInfo
  };
}
