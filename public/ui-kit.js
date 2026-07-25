// 共通UI部品: トースト通知と、フォーカストラップ付きの汎用モーダル。
// 外部ライブラリを使わず、既存の配色（style.css）に合わせる。

const FOCUSABLE = [
  "a[href]", "button:not([disabled])", "input:not([disabled])", "select:not([disabled])",
  "textarea:not([disabled])", "[tabindex]:not([tabindex='-1'])"
].join(",");

let toastHost = null;

function ensureToastHost() {
  if (toastHost?.isConnected) return toastHost;
  toastHost = document.createElement("div");
  toastHost.className = "toastHost";
  toastHost.setAttribute("aria-live", "polite");
  toastHost.setAttribute("role", "status");
  document.body.append(toastHost);
  return toastHost;
}

// type: success | info | warning | error
export function showToast(message, { type = "info", timeout = 5000 } = {}) {
  if (!message) return () => {};
  const host = ensureToastHost();
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  const icon = document.createElement("span");
  icon.className = "toastIcon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = { success: "✓", info: "i", warning: "!", error: "×" }[type] ?? "i";
  const text = document.createElement("span");
  text.className = "toastText";
  text.textContent = String(message);
  const close = document.createElement("button");
  close.type = "button";
  close.className = "toastClose";
  close.setAttribute("aria-label", "通知を閉じる");
  close.textContent = "×";
  const dismiss = () => {
    if (!toast.isConnected) return;
    toast.classList.add("leaving");
    setTimeout(() => toast.remove(), 180);
  };
  close.addEventListener("click", dismiss);
  toast.append(icon, text, close);
  host.append(toast);
  // 通知が溜まりすぎないよう、古いものから捨てる。
  while (host.children.length > 4) host.firstElementChild.remove();
  if (timeout > 0) setTimeout(dismiss, timeout);
  return dismiss;
}

export const toast = {
  success: (message, options) => showToast(message, { ...options, type: "success" }),
  info: (message, options) => showToast(message, { ...options, type: "info" }),
  warning: (message, options) => showToast(message, { ...options, type: "warning", timeout: 7000 }),
  error: (message, options) => showToast(message, { ...options, type: "error", timeout: 9000 })
};

// 汎用モーダル。build(body, close) の中で本文を組み立てる。
// actions は [{ label, value, variant, primary }] 形式で、Enterでprimaryが動く。
export function openModal({
  title = "",
  subtitle = "",
  size = "medium",
  build,
  actions = [],
  dismissValue = null,
  closeOnBackdrop = true
} = {}) {
  const previousFocus = document.activeElement;
  const overlay = document.createElement("div");
  overlay.className = `uiModal uiModal-${size}`;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  if (title) overlay.setAttribute("aria-label", title);

  const box = document.createElement("div");
  box.className = "uiModalBox";

  const header = document.createElement("div");
  header.className = "uiModalHeader";
  const headings = document.createElement("div");
  const heading = document.createElement("strong");
  heading.className = "uiModalTitle";
  heading.textContent = title;
  headings.append(heading);
  if (subtitle) {
    const sub = document.createElement("span");
    sub.className = "uiModalSubtitle";
    sub.textContent = subtitle;
    headings.append(sub);
  }
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "uiModalClose";
  closeButton.setAttribute("aria-label", "閉じる");
  closeButton.textContent = "×";
  header.append(headings, closeButton);

  const body = document.createElement("div");
  body.className = "uiModalBody";

  const footer = document.createElement("div");
  footer.className = "uiModalActions";

  let settle = () => {};
  const promise = new Promise((resolve) => { settle = resolve; });
  let closed = false;

  const close = (value = dismissValue) => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
    if (previousFocus?.isConnected && typeof previousFocus.focus === "function") previousFocus.focus();
    settle(value);
  };

  let primaryButton = null;
  for (const action of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = action.variant ?? (action.primary ? "primary" : "secondary");
    button.textContent = action.label;
    button.addEventListener("click", async () => {
      if (typeof action.onSelect === "function") {
        button.disabled = true;
        try {
          const result = await action.onSelect(close);
          if (result === false) return;
        } finally {
          button.disabled = false;
        }
      }
      if (!action.keepOpen) close(action.value);
    });
    if (action.primary) primaryButton = button;
    footer.append(button);
  }

  closeButton.addEventListener("click", () => close());
  if (closeOnBackdrop) {
    overlay.addEventListener("click", (event) => { if (event.target === overlay) close(); });
  }

  function onKey(event) {
    if (!overlay.isConnected) return;
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "Tab") {
      const focusable = [...box.querySelectorAll(FOCUSABLE)].filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      // 背面へフォーカスが抜けないよう、先頭・末尾で循環させる。
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!box.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    if (event.key === "Enter" && primaryButton && !isTextEntry(event.target)) {
      event.preventDefault();
      primaryButton.click();
    }
  }

  box.append(header, body);
  if (actions.length) box.append(footer);
  overlay.append(box);
  document.body.append(overlay);
  document.addEventListener("keydown", onKey, true);

  if (typeof build === "function") build(body, close);

  const initial = box.querySelector("[data-autofocus]")
    ?? primaryButton
    ?? box.querySelector(FOCUSABLE)
    ?? closeButton;
  initial.focus?.();

  return { element: overlay, body, close, promise };
}

function isTextEntry(target) {
  return target instanceof HTMLTextAreaElement
    || (target instanceof HTMLInputElement && !["button", "checkbox", "radio", "submit"].includes(target.type));
}

// はい/いいえの確認。Promise<boolean> を返す。
export function confirmModal(message, {
  title = "確認",
  confirmText = "OK",
  cancelText = "キャンセル",
  danger = false,
  detail = ""
} = {}) {
  return openModal({
    title,
    size: "small",
    dismissValue: false,
    build: (body) => {
      const text = document.createElement("p");
      text.className = "uiModalMessage";
      text.textContent = message;
      body.append(text);
      if (detail) {
        const extra = document.createElement("p");
        extra.className = "uiModalDetail";
        extra.textContent = detail;
        body.append(extra);
      }
    },
    actions: [
      { label: cancelText, value: false, variant: "secondary" },
      { label: confirmText, value: true, primary: true, variant: danger ? "dangerButton" : "primary" }
    ]
  }).promise;
}

// 二重押し防止。処理中はボタンを無効化し、ラベルを差し替える。
export async function withBusy(button, label, task) {
  if (!button) return task();
  const originalText = button.textContent;
  const wasDisabled = button.disabled;
  button.disabled = true;
  if (label) button.textContent = label;
  try {
    return await task();
  } finally {
    button.disabled = wasDisabled;
    button.textContent = originalText;
  }
}
