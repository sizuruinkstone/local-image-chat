import { element, button } from "../primitives.js";
export function createWorkspaceNav({ onNavigate }) {
  const items = ["studio", "library"].map((name) => button(name === "studio" ? "Studio" : "Library", {
    glyph: name, className: "workspace-nav-item", "aria-current": name === "studio" ? "page" : "false",
    onClick: () => onNavigate(name)
  }));
  const root = element("nav", { class: "workspace-nav", "aria-label": "Workspace" }, [
    ...items, element("span", { class: "nav-footnote", text: "LOCAL\nSTUDIO" })
  ]);
  return { root, render(view) { items.forEach((item, index) => item.setAttribute("aria-current", view === ["studio", "library"][index] ? "page" : "false")); } };
}
