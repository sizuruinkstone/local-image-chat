import { element, button } from "../primitives.js";
import { PROMPT_FIELDS, PROMPT_FIELD_LABELS } from "../../../structured-prompt.js";

export function createPromptWorkspace({ onPrompt }) {
  let snapshot;
  let returnFocus;
  const fields = new Map();
  const sections = element("div", { class: "prompt-sections" });
  for (const key of PROMPT_FIELDS) {
    const input = element("textarea", { id: `prompt-section-${key}`, rows: "3", spellcheck: "false" });
    input.addEventListener("input", () => onPrompt({ sections: { ...snapshot.prompt.structuredPrompt, [key]: input.value } }));
    fields.set(key, input);
    sections.append(element("label", { class: "prompt-section", for: input.id }, [
      element("span", { text: PROMPT_FIELD_LABELS[key] }), input
    ]));
  }
  const raw = element("textarea", { id: "prompt-raw", "aria-label": "Raw Prompt", rows: "12", spellcheck: "false" });
  raw.addEventListener("input", () => onPrompt({ positive: raw.value }));
  const rawArea = element("label", { class: "prompt-raw-area", for: raw.id }, [element("span", { text: "Raw Prompt" }), raw,
    element("small", { text: "送信するPositive Promptを直接編集。LoRA処理後の正確な内容はFinal Promptで確認できます。" })]);
  const negative = element("textarea", { id: "prompt-negative", rows: "3", spellcheck: "false" });
  negative.addEventListener("input", () => onPrompt({ negative: negative.value }));
  const final = element("textarea", { id: "prompt-final", readonly: "", rows: "12" });
  const finalNegative = element("textarea", { id: "prompt-final-negative", readonly: "", rows: "3" });
  const structuredButton = button("Structured", { onClick: () => onPrompt({ mode: "structured" }) });
  const rawButton = button("Raw", { onClick: () => onPrompt({ mode: "raw" }) });
  const modeNote = element("p", { class: "prompt-mode-note" });
  const close = button("Canvasへ戻る", { glyph: "close", onClick: () => root.close() });
  const root = element("dialog", { class: "prompt-workspace", "aria-labelledby": "prompt-workspace-title" }, [
    element("header", { class: "prompt-workspace-heading" }, [element("div", {}, [element("small", { text: "COMPOSE / PROMPT WORKSPACE" }), element("h1", { id: "prompt-workspace-title", text: "構造プロンプト" })]), close]),
    element("div", { class: "prompt-mode-controls", "aria-label": "Prompt mode" }, [structuredButton, rawButton, modeNote]),
    element("div", { class: "prompt-workspace-body" }, [
      element("div", { class: "prompt-editors" }, [sections, rawArea,
        element("label", { class: "prompt-negative-area", for: negative.id }, [element("span", { text: "Negative Prompt" }), negative])]),
      element("aside", { class: "prompt-final-preview", "aria-label": "送信内容のプレビュー" }, [
        element("h2", { text: "Final Prompt" }), element("p", { text: "生成requestのPositive / Negative。現在のmodeとLoRA処理を反映した値です。" }),
        element("label", { for: final.id, text: "Final Positive Prompt" }), final,
        element("label", { for: finalNegative.id, text: "Final Negative Prompt" }), finalNegative,
        element("small", { text: "この内容をGenerateで送信します。編集・previewだけでは生成を開始しません。" })])])
  ]);
  root.addEventListener("close", () => { if (returnFocus?.isConnected) returnFocus.focus(); });
  return { root, open(key) {
    returnFocus = document.activeElement;
    if (!root.open) root.showModal();
    (key === "negative" ? negative : key === "final" ? final : snapshot.prompt.rawPromptOverride ? raw : fields.get(key) ?? fields.get(PROMPT_FIELDS[0])).focus();
  }, render(value) {
    snapshot = value;
    const locked = !value.ready || value.generation.busy || value.selectingModel || value.runtime.switching || value.reusing;
    for (const input of [...fields.values(), raw, negative, structuredButton, rawButton]) input.disabled = locked;
    const prompt = value.prompt;
    const isRaw = prompt.rawPromptOverride;
    sections.hidden = isRaw; rawArea.hidden = !isRaw;
    structuredButton.setAttribute("aria-pressed", String(!isRaw)); rawButton.setAttribute("aria-pressed", String(isRaw));
    modeNote.textContent = isRaw ? "Rawが生成に使用されます。Structuredの各sectionは保持されています。" : "6つのsectionからFinal Promptを組み立てます。Rawの編集内容は切替後も保持します。";
    for (const [key, input] of fields) if (input.value !== prompt.structuredPrompt[key]) input.value = prompt.structuredPrompt[key];
    for (const [input, text] of [[raw, prompt.rawPrompt], [negative, prompt.negativePrompt], [final, prompt.prompt], [finalNegative, prompt.negativePrompt]]) {
      if (input.value !== text) input.value = text;
    }
  } };
}
