import { element, button, icon } from "../primitives.js";
import { PROMPT_FIELDS, PROMPT_FIELD_LABELS } from "../../../structured-prompt.js";
export function createPromptDock({ onOpenPrompt, onImportPrompt, onGenerate, onContentRating = () => {}, onInspector, onModel = onInspector, onPrimary = onInspector, onBrowseLoras = onPrimary, onCancel, previewMode = false }) {
  const summaries = new Map();
  const summaryGrid = element("div", { class: "prompt-summary-grid" });
  for (const key of PROMPT_FIELDS) {
    const value = element("span", { class: "section-summary-value" });
    const control = button(PROMPT_FIELD_LABELS[key], { className: "section-summary", onClick: () => onOpenPrompt(key) });
    control.append(value); summaryGrid.append(control); summaries.set(key, value);
  }
  const rawSummary = button("", { className: "raw-summary", onClick: () => onOpenPrompt("raw") });
  const mode = button("Structured · 編集", { className: "prompt-open control", onClick: () => onOpenPrompt() });
  const model = element("span", { text: "Loading model" });
  const size = element("span", { text: "—" });
  const loras = element("span", { text: "No active LoRA" });
  const ratingControls = element("div", { class: "content-rating-picker", role: "group", "aria-label": "生成コンテンツ分類" }, [
    button("一般", { className: "content-rating-option", onClick: () => onContentRating("general") }),
    button("NSFW", { className: "content-rating-option", onClick: () => onContentRating("nsfw") })
  ]);
  ratingControls.children[0].dataset.contentRating = "general";
  ratingControls.children[1].dataset.contentRating = "nsfw";
  let currentView;
  const generate = button("Generate", { glyph: "arrow", className: "generate-action", onClick: () => currentView?.busy ? onCancel?.() : onGenerate(), disabled: "" });
  const generationActions = element("div", { class: "prompt-generation-actions" }, [ratingControls, generate]);
  const root = element("section", { class: "prompt-dock", "aria-label": "Prompt Dock" }, [
    element("div", { class: "prompt-heading" }, [mode, button("Import Prompt", { className: "context-control", onClick: onImportPrompt })]),
    element("div", { class: "prompt-compose" }, [summaryGrid, rawSummary]),
    element("div", { class: "prompt-context" }, [
      button("", { className: "context-control model-summary", glyph: "layers", onClick: onModel }),
      button("", { className: "context-control resolution-summary", glyph: "expand", onClick: onPrimary }),
      button("", { className: "context-control seed-summary", onClick: onPrimary }),
      element("button", { type: "button", class: "context-control lora-summary", "aria-label": "Active LoRA" }, [icon("spark"), loras]),
      element("span", { class: "simulation-note", text: previewMode ? "Preview only · no image job is submitted" : "" })
    ]),
    generationActions
  ]);
  root.querySelector(".model-summary").append(model);
  root.querySelector(".resolution-summary").append(size);
  root.querySelector(".lora-summary").addEventListener("click", onBrowseLoras);
  root.querySelector(".lora-summary").title = "Browse LoRA";
  root.querySelector(".seed-summary").hidden = previewMode;
  return { root, focus() { mode.focus(); }, render(snapshot, canvasState, view) {
    currentView = previewMode ? null : view;
    for (const control of root.querySelectorAll("button")) control.disabled = !snapshot?.ready;
    if (snapshot?.ready) {
      const prompt = snapshot.prompt;
      mode.querySelector("span").textContent = `${prompt.rawPromptOverride ? "Raw" : "Structured"} · 編集`;
      summaryGrid.hidden = prompt.rawPromptOverride; rawSummary.hidden = !prompt.rawPromptOverride;
      rawSummary.querySelector("span").textContent = prompt.prompt || "Raw Promptを編集";
      for (const [key, value] of summaries) { value.textContent = prompt.structuredPrompt[key] || "追加する"; value.parentElement.title = `${PROMPT_FIELD_LABELS[key]}: ${value.textContent}`; }
      model.textContent = snapshot.runtime.selectedCheckpoint?.modelName || snapshot.runtime.selectedCheckpoint?.title || "Default model";
      size.textContent = `${snapshot.parameters.width} × ${snapshot.parameters.height}`;
      root.querySelector(".seed-summary span").textContent = `Seed ${snapshot.parameters.seed === -1 ? "Random" : snapshot.parameters.seed} · ${snapshot.parameters.candidateCount ?? 1}枚`;
      loras.textContent = snapshot.loras.length ? `${snapshot.loras.length} LoRA · Browse LoRA` : "Browse LoRA";
      root.querySelector(".lora-summary").title = snapshot.loras.map(item => `${item.name} ${item.weight}${item.enabled === false ? " (disabled)" : ""}`).join(" · ") || "Browse LoRA";
      for (const control of ratingControls.children) {
        const active = control.dataset.contentRating === snapshot.contentRating;
        control.setAttribute("aria-pressed", String(active));
        control.classList.toggle("active", active);
      }
    }
    generate.disabled = !snapshot?.ready || canvasState === "generating";
    generate.querySelector("span:last-child").textContent = canvasState === "generating" ? "Previewing…" : "Preview generation";
    if (!previewMode && view) {
      for (const control of root.querySelectorAll("button")) control.disabled = view.locked;
      // Connection failures must remain recoverable through the model/runtime picker.
      root.querySelector(".model-summary").disabled = view.busy || snapshot.selectingModel || snapshot.runtime.switching;
      const label = view.busy ? view.canCancel ? "Cancel" : view.label : "Generate";
      generate.querySelector("span:last-child").textContent = label;
      generate.setAttribute("aria-label", label);
      generate.disabled = view.busy ? !view.canCancel : !view.canGenerate;
    }
  } };
}
