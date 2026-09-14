import { element, button } from "../primitives.js";
export function createCanvasToolbar({ onInspector, onImageView }) {
  const inspector = button("制作設定", { glyph: "inspector", className: "control inspector-trigger", "aria-expanded": "false", onClick: onInspector });
  const root = element("div", { class: "canvas-toolbar", "aria-label": "Canvas controls" }, [
    element("div", { class: "canvas-breadcrumb" }, [element("span", { text: "Studio" }), element("span", { text: "/", "aria-hidden": "true" }), element("strong", { text: "Preview" })]),
    element("div", { class: "canvas-view-controls" }, [button("Image Viewer", { className: "control image-viewer-trigger", onClick: onImageView }), inspector])
  ]);
  return { root, setImageAvailable(available) { root.querySelector(".image-viewer-trigger").disabled = !available; }, setInspector(open) { inspector.setAttribute("aria-expanded", String(open)); }, focusInspector() { inspector.focus(); } };
}
