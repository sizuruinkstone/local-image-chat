import { element, button, iconButton } from "../primitives.js";
export function createCanvasToolbar({ onInspector, onZoom }) {
  const inspector = button("Inspector", { glyph: "inspector", className: "control inspector-trigger", "aria-expanded": "false", onClick: onInspector });
  const root = element("div", { class: "canvas-toolbar", "aria-label": "Canvas controls" }, [
    element("div", { class: "canvas-breadcrumb" }, [element("span", { text: "Studio" }), element("span", { text: "/", "aria-hidden": "true" }), element("strong", { text: "Untitled study" })]),
    element("div", { class: "canvas-view-controls" }, [iconButton("Zoom out", "minus", () => onZoom(-0.1)), button("Fit", { onClick: () => onZoom(0), className: "control fit-control" }), iconButton("Zoom in", "plus", () => onZoom(0.1)), inspector])
  ]);
  return { root, setInspector(open) { inspector.setAttribute("aria-expanded", String(open)); }, focusInspector() { inspector.focus(); } };
}
