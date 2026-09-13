import { element, icon, button } from "../primitives.js";
export const CANVAS_STATES = Object.freeze(["empty", "ready", "image", "generating", "error"]);
export function createCanvasStage({ artwork, onReady, onRetry, onCandidate = () => {}, onOpenImage }) {
  const image = element("img", { class: "artwork", ...(artwork ? { src: artwork } : {}), alt: "", decoding: "async" });
  if(onOpenImage){
    image.setAttribute("role","button");image.tabIndex=0;
    image.setAttribute("aria-label","画像を拡大");image.title="クリックして拡大";
    image.addEventListener("click",()=>onOpenImage());
    image.addEventListener("keydown",event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();onOpenImage();}});
  }
  const media = element("div", { class: "canvas-artwork" }, [image]);
  const headline = element("h1");
  const description = element("p");
  const action = button("Start a study", { className: "control canvas-state-action", glyph: "arrow", onClick: onReady });
  const statePanel = element("div", { class: "canvas-state-panel" }, [icon("spark"), headline, description, action]);
  const progressLabel = element("span", { text: "Composing light and form…" });
  const progress = element("div", { class: "canvas-progress", role: "status" }, [element("span", { class: "progress-orbit", "aria-hidden": "true" }), progressLabel, element("small", { text: "SIMULATED PREVIEW" })]);
  const retry = button("Return to canvas", { className: "control canvas-state-action", onClick: onRetry });
  const errorPanel = element("div", { class: "canvas-error", role: "alert", hidden: "" }, [element("strong", { text: "The preview paused." }), element("p", { text: "Your prompt is still here. This is the error-state preview." }), retry]);
  const stateLabel = element("span", { text: "Demo artwork" });
  const root = element("section", { class: "canvas-stage", "aria-label": "Image canvas", "data-state": "image" }, [
    element("div", { class: "canvas-topline" }, [element("span", { text: "STUDY 001" }), stateLabel]),
    element("div", { class: "canvas-viewport" }, [media, statePanel]), progress, errorPanel,
    element("div", { class: "canvas-caption" }, [element("span", { text: "Light, held in form" }), element("span", { text: "Demo artwork · 1440 × 1024" })])
  ]);
  let zoom = 1;
  const candidateLabel = element("span");
  const candidates = element("div", { class: "canvas-candidates", "aria-label": "Generation candidates", hidden: "" }, [
    button("‹", { "aria-label": "Previous candidate", onClick: () => onCandidate(-1) }), candidateLabel,
    button("›", { "aria-label": "Next candidate", onClick: () => onCandidate(1) })
  ]);
  root.querySelector(".canvas-caption").append(candidates);
  return { root,
    renderGeneration(view) {
      root.dataset.state = view.phase;
      const source = view.image?.imageUrl || view.image?.url;
      if (source && image.getAttribute("src") !== source) { image.src = source; zoom = 1; image.style.transform = "scale(1)"; }
      if (!source) image.removeAttribute("src");
      image.alt = view.image ? `Generated candidate ${view.index + 1}, seed ${view.image.seed}` : "";
      media.hidden = !source; statePanel.hidden = Boolean(source) || view.phase === "error";
      headline.textContent = view.phase === "cancelled" ? "生成を中止しました。" : view.busy ? "制作中です。" : "Your next image starts here.";
      description.textContent = view.busy ? "Backendからの進行情報を待っています。" : "Structured Promptを編集してGenerateを実行してください。";
      action.hidden = view.busy;
      progress.hidden = !view.busy;
      progressLabel.textContent = view.label;
      progress.querySelector("small").textContent = Number.isFinite(view.progress) ? `Backend ${view.progress}%` : "";
      progress.title = view.message;
      errorPanel.hidden = view.phase !== "error";
      errorPanel.querySelector("strong").textContent = "生成できませんでした。";
      errorPanel.querySelector("p").textContent = view.error || "Backendとの接続を確認してください。";
      retry.querySelector("span").textContent = "設定を確認する";
      stateLabel.textContent = view.label;
      const caption = root.querySelector(".canvas-caption");
      caption.children[0].textContent = view.image ? `Seed ${view.image.seed}` : "Current study";
      caption.children[1].textContent = view.image ? `${view.phase === "completed" ? "Result" : "Previous result"}` : "";
      candidates.hidden = view.images.length < 2;
      candidateLabel.textContent = `${view.index + 1} / ${view.images.length}`;
    },
    render(state) {
      root.dataset.state = state;
      const blank = state === "empty" || state === "ready";
      media.hidden = blank;
      statePanel.hidden = !blank;
      progress.hidden = state !== "generating";
      errorPanel.hidden = state !== "error";
      headline.textContent = state === "empty" ? "A little space for a new idea." : "Your next image starts here.";
      description.textContent = state === "empty" ? "Write a prompt. Find a direction. Make it yours." : "The workspace is ready. Shape your idea in the prompt below.";
      action.hidden = state !== "empty";
      stateLabel.textContent = { empty: "Empty canvas", ready: "Ready to explore", image: "Demo artwork", generating: "Generating · simulated", error: "Preview error" }[state];
    },
    zoom(delta) { zoom = delta === 0 ? 1 : Math.max(0.6, Math.min(1.5, zoom + delta)); image.style.transform = `scale(${zoom})`; }
  };
}
