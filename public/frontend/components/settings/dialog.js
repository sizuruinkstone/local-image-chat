import { element, button } from "../primitives.js";
export function createStudioDialog(title) {
  let previous;
  const body = element("div", { class: "studio-dialog-body" });
  const close = button("閉じる", { glyph: "close", onClick: () => root.close() });
  const root = element("dialog", { class: "studio-dialog", "aria-label": title }, [
    element("header", { class: "panel-heading" }, [element("h2", { text: title }), close]), body
  ]);
  root.addEventListener("close", () => { if (previous?.isConnected) previous.focus(); });
  return { root, body, open() { if (!root.open) { previous = document.activeElement; root.showModal(); } }, close() { root.close(); } };
}
export function field(label, input) {
  input.setAttribute("aria-label", label);
  return element("label", { class: "setting-field" }, [element("span", { text: label }), input]);
}
export function syncValue(input, value) { if (input.value !== String(value ?? "")) input.value = value ?? ""; }
export function syncOptions(input, items, current) {
  const values = [...new Set([current, ...items.map((item) => typeof item === "string" ? item : item.name)].filter(Boolean))];
  const key = JSON.stringify(values);
  if (input.dataset.options !== key) { input.replaceChildren(...values.map((value) => element("option", { value, text: value }))); input.dataset.options = key; }
  syncValue(input, current);
}
