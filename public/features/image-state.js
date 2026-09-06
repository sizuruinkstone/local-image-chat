const DISCORD_STATUS_LABELS = {
  sending: "★ Discord送信中…",
  sent: "★ Discord送信済み",
  failed: "★ Favorite済み・Discord送信失敗"
};

const DISCORD_GENERATION_STATUS_LABELS = {
  sending: "★ 生成通知送信中…",
  sent: "★ 生成通知送信済み",
  failed: "★ 生成通知送信失敗"
};

export function createImageState({ document, CSS, getJson, postJson, patchJson, sleep, showError, toast,
  onPreferencesChanged, reloadHistory, reloadStudioRecent, getFinalImage, favoriteFinalButton,
  finalDiscordStatus, finalDiscordGenerationStatus }) {
  const imageFavorites = new Map();
  const discordStates = new Map();
  const discordGenerationStates = new Map();
  const discordWatchers = new Set();
  const discordGenerationWatchers = new Set();
  let initialized = false;

  async function toggleFavorite(image, button) {
    const next = !image.favorite;
    button.disabled = true;
    try {
      // 確認ダイアログは出さない。Discord送信はサーバー側で非同期に始まる。
      const data = await patchJson(`/api/history/${image.id}/favorite`, { favorite: next });
      image.favorite = data.image.favorite;
      button.classList.toggle("active", image.favorite);
      // どこから操作しても、開いている全ての表示へ即時反映する。
      applyImageFavorite(image.id, image.favorite);
      onPreferencesChanged(data.preferences);
      applyDiscordState(image.id, data.image.discord);
      await reloadHistory();
      await reloadStudioRecent();
    } catch (error) {
      showError(error.message);
    } finally {
      button.disabled = false;
    }
  }

  function getFavorite(imageId, fallback = false) {
    return imageFavorites.has(imageId) ? imageFavorites.get(imageId) === true : Boolean(fallback);
  }

  function resolveImageFavorite(image) {
    const favorite = getFavorite(image.id, image.favorite);
    image.favorite = favorite;
    imageFavorites.set(image.id, favorite);
    return favorite;
  }

  function rememberImageFavorites(generations) {
    for (const generation of generations ?? []) {
      for (const image of generation.images ?? []) {
        if (image?.id) imageFavorites.set(image.id, Boolean(image.favorite));
      }
    }
  }

  function applyImageFavorite(imageId, favorite) {
    imageFavorites.set(imageId, Boolean(favorite));
    refreshFavoriteButtons(imageId);
  }

  // data-favorite-image を持つボタン（一覧・詳細・最新結果）をまとめて更新する。
  function refreshFavoriteButtons(imageId) {
    const favorite = imageFavorites.get(imageId) === true;
    const selector = `[data-favorite-image="${CSS.escape(String(imageId))}"]`;
    for (const button of document.querySelectorAll(selector)) renderFavoriteButton(button, favorite);
  }

  function renderFavoriteButton(button, favorite) {
    const accessibleLabel = favorite ? "お気に入りから削除" : "お気に入りに追加";
    button.classList.toggle("active", favorite);
    button.setAttribute("aria-pressed", String(favorite));
    button.setAttribute("aria-label", accessibleLabel);
    button.textContent = button.dataset.favoriteStyle === "label"
      ? (favorite ? "★ Favorite" : "☆ Favorite")
      : (favorite ? "★" : "☆");
    button.title = accessibleLabel;
  }

  // 画像用のFavoriteボタン（星）。表示場所ごとにスタイルだけ変える。
  function createFavoriteButton(image, { style = "star", className = "favoriteButton" } = {}) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.dataset.favoriteImage = image.id;
    button.dataset.favoriteStyle = style;
    imageFavorites.set(image.id, Boolean(image.favorite));
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      void toggleFavorite(image, button);
    });
    // まだDOMへ入っていないので、この場で初期表示を作る。
    renderFavoriteButton(button, Boolean(image.favorite));
    return button;
  }

  function applyDiscordState(imageId, state) {
    if (!imageId || !state) return;
    discordStates.set(imageId, state);
    refreshDiscordBadges(imageId);
    if (state.status === "sending") void watchDiscordSend(imageId);
  }

  function applyDiscordGenerationState(imageId, state) {
    if (!imageId || !state) return;
    discordGenerationStates.set(imageId, state);
    refreshDiscordBadges(imageId);
    if (state.status === "sending") void watchDiscordGenerationSend(imageId);
  }

  function rememberDiscordStates(generations) {
    for (const generation of generations ?? []) {
      for (const image of generation.images ?? []) {
        if (!image?.id) continue;
        if (image.discord) {
          discordStates.set(image.id, image.discord);
          if (image.discord.status === "sending") void watchDiscordSend(image.id);
        }
        if (image.discordGeneration) {
          discordGenerationStates.set(image.id, image.discordGeneration);
          if (image.discordGeneration.status === "sending") void watchDiscordGenerationSend(image.id);
        }
      }
    }
  }

  function createDiscordStatusNode(image) {
    const node = document.createElement("span");
    node.className = "discordStatus";
    node.dataset.discordImage = image.id;
    if (image.discord) discordStates.set(image.id, image.discord);
    renderDiscordStatusNode(node, image.id);
    return node;
  }

  function createDiscordGenerationStatusNode(image) {
    const node = document.createElement("span");
    node.className = "discordStatus";
    node.dataset.discordGenerationImage = image.id;
    if (image.discordGeneration) discordGenerationStates.set(image.id, image.discordGeneration);
    renderDiscordGenerationStatusNode(node, image.id);
    return node;
  }

  function renderDiscordStatusNode(node, imageId) {
    const state = discordStates.get(imageId) ?? { status: "not_sent", error: "" };
    node.replaceChildren();
    node.className = `discordStatus status-${state.status}`;
    node.title = state.error || "";
    if (state.status === "not_sent") {
      node.classList.add("hidden");
      return;
    }
    const label = document.createElement("span");
    label.textContent = DISCORD_STATUS_LABELS[state.status] ?? "";
    node.append(label);
    // 失敗した画像だけ再送できる（sent / sendingは再送しない）。
    if (state.status === "failed") {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "discordRetryButton";
      retry.textContent = "再送";
      retry.title = state.error || "Discordへ再送する";
      retry.addEventListener("click", () => void resendToDiscord(imageId, retry));
      node.append(retry);
    }
  }

  function renderDiscordGenerationStatusNode(node, imageId) {
    const state = discordGenerationStates.get(imageId) ?? { status: "not_sent", error: "" };
    node.replaceChildren();
    node.className = `discordStatus status-${state.status}`;
    node.title = state.error || "";
    if (state.status === "not_sent") {
      node.classList.add("hidden");
      return;
    }
    const label = document.createElement("span");
    label.textContent = DISCORD_GENERATION_STATUS_LABELS[state.status] ?? "";
    node.append(label);
    if (state.status === "failed") {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "discordRetryButton";
      retry.textContent = "再送";
      retry.title = state.error || "生成完了通知を再送する";
      retry.addEventListener("click", () => void resendDiscordGeneration(imageId, retry));
      node.append(retry);
    }
  }

  function refreshDiscordBadges(imageId) {
    const selector = `[data-discord-image="${CSS.escape(String(imageId))}"]`;
    for (const node of document.querySelectorAll(selector)) renderDiscordStatusNode(node, imageId);
    const generationSelector = `[data-discord-generation-image="${CSS.escape(String(imageId))}"]`;
    for (const node of document.querySelectorAll(generationSelector)) {
      renderDiscordGenerationStatusNode(node, imageId);
    }
    // 生成結果パネルのバッジはIDが固定なので、対象画像のときだけ更新する。
    if (getFinalImage()?.id === imageId) {
      finalDiscordStatus.dataset.discordImage = imageId;
      renderDiscordStatusNode(finalDiscordStatus, imageId);
      finalDiscordGenerationStatus.dataset.discordGenerationImage = imageId;
      renderDiscordGenerationStatusNode(finalDiscordGenerationStatus, imageId);
    }
  }

  // 送信は非同期なので、終わるまで状態だけ見に行く。
  async function watchDiscordSend(imageId) {
    if (discordWatchers.has(imageId)) return;
    discordWatchers.add(imageId);
    try {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        await sleep(1200);
        const { discord } = await getJson(`/api/history/${imageId}/discord`);
        discordStates.set(imageId, discord);
        refreshDiscordBadges(imageId);
        if (discord.status === "sending") continue;
        // 成功時は静かに。失敗時だけ知らせて再送できるようにする。
        if (discord.status === "failed") notifyDiscordFailure(imageId, discord);
        return;
      }
    } catch {
      // 状態取得に失敗しても、Favoriteと画面表示は維持する。
    } finally {
      discordWatchers.delete(imageId);
    }
  }

  // 生成完了通知もFavorite通知と同じ状態監視を別チャンネルで行う。
  async function watchDiscordGenerationSend(imageId) {
    if (discordGenerationWatchers.has(imageId)) return;
    discordGenerationWatchers.add(imageId);
    try {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        await sleep(1200);
        const { discord } = await getJson(`/api/history/${imageId}/discord/generation`);
        discordGenerationStates.set(imageId, discord);
        refreshDiscordBadges(imageId);
        if (discord.status === "sending") continue;
        if (discord.status === "failed") notifyDiscordGenerationFailure(imageId, discord);
        return;
      }
    } catch {
      // 状態取得に失敗しても、生成結果と履歴の表示は維持する。
    } finally {
      discordGenerationWatchers.delete(imageId);
    }
  }

  function notifyDiscordFailure(imageId, state) {
    toast.error(`Discordへ送信できませんでした: ${state.error || "原因不明"}`, {
      action: { label: "再送", onSelect: () => void resendToDiscord(imageId) }
    });
  }

  function notifyDiscordGenerationFailure(imageId, state) {
    toast.error(`生成完了通知をDiscordへ送信できませんでした: ${state.error || "原因不明"}`, {
      action: { label: "再送", onSelect: () => void resendDiscordGeneration(imageId) }
    });
  }

  async function resendToDiscord(imageId, button = null) {
    if (button) button.disabled = true;
    try {
      const { discord } = await postJson(`/api/history/${imageId}/discord/send`, {});
      applyDiscordState(imageId, discord);
    } catch (error) {
      toast.error(error.message);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function resendDiscordGeneration(imageId, button = null) {
    if (button) button.disabled = true;
    try {
      const { discord } = await postJson(`/api/history/${imageId}/discord/generation/send`, {});
      applyDiscordGenerationState(imageId, discord);
    } catch (error) {
      toast.error(error.message);
    } finally {
      if (button) button.disabled = false;
    }
  }

  function bindPresentation(image) {
    favoriteFinalButton.dataset.favoriteImage = image.id;
    favoriteFinalButton.dataset.favoriteStyle = "label";
    imageFavorites.set(image.id, Boolean(image.favorite));
    renderFavoriteButton(favoriteFinalButton, Boolean(image.favorite));
    if (image.discord) discordStates.set(image.id, image.discord);
    finalDiscordStatus.dataset.discordImage = image.id;
    renderDiscordStatusNode(finalDiscordStatus, image.id);
    if (image.discordGeneration) discordGenerationStates.set(image.id, image.discordGeneration);
    finalDiscordGenerationStatus.dataset.discordGenerationImage = image.id;
    renderDiscordGenerationStatusNode(finalDiscordGenerationStatus, image.id);
  }

  const onFinalFavoriteClick = () => {
    const image = getFinalImage();
    if (image) void toggleFavorite(image, favoriteFinalButton);
  };
  function init() {
    if (initialized) return;
    initialized = true;
    favoriteFinalButton.addEventListener("click", onFinalFavoriteClick);
  }
  function dispose() {
    if (!initialized) return;
    initialized = false;
    favoriteFinalButton.removeEventListener("click", onFinalFavoriteClick);
  }

  return {
    init, dispose, toggleFavorite, getFavorite, resolveImageFavorite, rememberImageFavorites,
    applyImageFavorite, renderFavoriteButton, createFavoriteButton, applyDiscordState,
    applyDiscordGenerationState, rememberDiscordStates, createDiscordStatusNode,
    createDiscordGenerationStatusNode, renderDiscordStatusNode, renderDiscordGenerationStatusNode,
    bindPresentation
  };
}
