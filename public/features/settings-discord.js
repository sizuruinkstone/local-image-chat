export function createDiscordSettings({ elements, getJson, patchJson, postJson, withBusy,
  toast, confirmModal, onSummaryChanged }) {
  let initialized = false;

  async function load() {
    try {
      const { settings } = await getJson("/api/discord/settings");
      elements.discordAutoSend.checked = settings.autoSend;
      elements.discordIncludePrompt.checked = settings.includePrompt;
      elements.discordIncludeMetadata.checked = settings.includeMetadata;
      elements.discordGenerationAutoSend.checked = settings.generationAutoSend;
      elements.discordGenerationIncludeImage.checked = settings.generationIncludeImage;
      elements.discordGenerationIncludeTitle.checked = settings.generationIncludeTitle;
      elements.discordGenerationIncludeModel.checked = settings.generationIncludeModel;
      elements.discordGenerationIncludeSeed.checked = settings.generationIncludeSeed;
      elements.discordGenerationIncludeDuration.checked = settings.generationIncludeDuration;
      render(settings);
    } catch (error) {
      elements.discordSettingsStatus.textContent = `Discord設定を取得できません: ${error.message}`;
    } finally {
      onSummaryChanged();
    }
  }

  function render(settings) {
    // Webhook URL自体は返ってこない。設定済みかどうかと、伏せ字の目印だけ出す。
    const source = { env: "環境変数", config: "config.local.json", stored: "この画面で保存" }[settings.webhookSource];
    elements.discordSettingsStatus.textContent = settings.webhookConfigured
      ? `送信先: ${settings.webhookHint}（${source}）Favorite ${settings.autoSend ? "ON" : "OFF"}・生成通知 ${settings.generationAutoSend ? "ON" : "OFF"}`
      : "送信先が未設定のため、Favorite・生成完了通知ともに送信しません";
    elements.discordWebhook.disabled = !settings.webhookEditable;
    elements.discordWebhook.placeholder = settings.webhookEditable
      ? "https://discord.com/api/webhooks/…"
      : `${source}の設定を使用中`;
    elements.clearDiscordWebhookButton.disabled = !settings.storedWebhookConfigured;
    onSummaryChanged();
  }

  async function save() {
    await withBusy(elements.saveDiscordSettingsButton, "保存中…", async () => {
      try {
        const { settings } = await patchJson("/api/discord/settings", {
          autoSend: elements.discordAutoSend.checked,
          includePrompt: elements.discordIncludePrompt.checked,
          includeMetadata: elements.discordIncludeMetadata.checked,
          generationAutoSend: elements.discordGenerationAutoSend.checked,
          generationIncludeImage: elements.discordGenerationIncludeImage.checked,
          generationIncludeTitle: elements.discordGenerationIncludeTitle.checked,
          generationIncludeModel: elements.discordGenerationIncludeModel.checked,
          generationIncludeSeed: elements.discordGenerationIncludeSeed.checked,
          generationIncludeDuration: elements.discordGenerationIncludeDuration.checked,
          webhookUrl: elements.discordWebhook.value
        });
        // 入力欄には残さない（画面・sessionStorageへ秘密情報を置かない）。
        elements.discordWebhook.value = "";
        render(settings);
        toast.success("Discord設定を保存しました");
      } catch (error) {
        toast.error(error.message);
      }
    });
  }

  async function sendTest() {
    await withBusy(elements.sendDiscordTestButton, "送信中…", async () => {
      try {
        await postJson("/api/discord/test", {});
        toast.success("Discordへテスト通知を送信しました");
      } catch (error) {
        toast.error(`Discordテスト通知に失敗しました: ${error.message}`);
      }
    });
  }

  async function clear() {
    const confirmed = await confirmModal("保存済みのDiscord送信先を削除します。よろしいですか？", {
      title: "送信先の削除",
      confirmText: "削除する"
    });
    if (!confirmed) return;
    try {
      const { settings } = await patchJson("/api/discord/settings", { clearWebhook: true });
      elements.discordWebhook.value = "";
      render(settings);
      toast.info("Discordの送信先を削除しました");
    } catch (error) {
      toast.error(error.message);
    }
  }

  const onSaveClick = () => void save();
  const onClearClick = () => void clear();
  const onTestClick = () => void sendTest();
  function init() {
    if (initialized) return;
    initialized = true;
    elements.saveDiscordSettingsButton.addEventListener("click", onSaveClick);
    elements.clearDiscordWebhookButton.addEventListener("click", onClearClick);
    elements.sendDiscordTestButton.addEventListener("click", onTestClick);
  }
  function dispose() {
    if (!initialized) return;
    initialized = false;
    elements.saveDiscordSettingsButton.removeEventListener("click", onSaveClick);
    elements.clearDiscordWebhookButton.removeEventListener("click", onClearClick);
    elements.sendDiscordTestButton.removeEventListener("click", onTestClick);
  }
  return { init, dispose, load, render, save, sendTest, clear };
}
