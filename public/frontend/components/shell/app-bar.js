import { element, icon } from "../primitives.js";
export function createAppBar({ onPreviewState, previewMode = false, onRuntime, production = false }) {
  const runtimeLabel = element("span", { text: "Connecting…" });
  const select = element("select", { "aria-label": "Canvas preview state", class: "preview-select" },
    [["empty", "Empty"], ["ready", "Ready"], ["image", "Image displayed"], ["generating", "Generating"], ["error", "Error"]]
      .map(([value, text]) => element("option", { value, text })));
  select.value = "image";
  select.addEventListener("change", () => onPreviewState(select.value));
  const status = element("span", { class: "runtime-indicator", role: "status" }, [element("i"), runtimeLabel]);
  const liveStatus = element("span", { class: "generation-status", role: "status" });
  select.hidden = !previewMode;
  liveStatus.hidden = previewMode;
  const root = element("header", { class: "app-bar" }, [
    element("a", { class: "brand", href: production ? "/" : "/studio-next/", "aria-label": "LIC Studio home" }, [icon("layers"), element("span", { text: "LIC" }), element("span", { class: "brand-sub", text: "STUDIO" })]),
    element("span", { class: "app-divider", "aria-hidden": "true" }),
    element("div", { class: "app-bar-actions" }, [element("span", { class: "preview-badge", text: production ? "LOCAL" : previewMode ? "R2 · FIXTURE" : "DEVELOPMENT" }), select, liveStatus, status])
  ]);
  return { root, render(snapshot, state, view) {
    runtimeLabel.textContent = snapshot?.ready ? snapshot.runtime.activeRuntime?.label ?? "Connected" : "Connecting…";
    status.dataset.connected = String(snapshot?.ready === true);
    select.value = state;
    liveStatus.textContent = view?.label ?? "Connecting";
    if (!previewMode && snapshot?.runtime.activeRuntime?.available === false) runtimeLabel.textContent = "Runtime unavailable";
  } };
}
