export function element(tag, attributes = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else node.setAttribute(key, String(value));
  }
  node.append(...children);
  return node;
}

const paths = {
  studio: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m3 16 5-5 4 4 4-6 5 7"/><circle cx="8" cy="7" r="1"/>',
  library: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  inspector: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16m3-11h1m-1 4h1"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',
  layers: '<path d="m12 3 10 6-10 6L2 9Zm-9 11 9 5 9-5M3 18l9 5 9-5"/>',
  settings: '<path d="M4 7h16M4 17h16M8 4v6m8 4v6"/>',
  back: '<path d="m14 6-6 6 6 6"/>'
};
export function icon(name) {
  const span = element("span", { class: "glyph", "aria-hidden": "true" });
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paths[name] ?? paths.studio}</svg>`;
  return span;
}
export function button(label, { glyph, className = "control", onClick, ...attrs } = {}) {
  const node = element("button", { type: "button", class: className, ...attrs }, [
    ...(glyph ? [icon(glyph)] : []), element("span", { text: label })
  ]);
  if (onClick) node.addEventListener("click", onClick);
  return node;
}
export function iconButton(label, glyph, onClick, attrs = {}) {
  return button(label, { glyph, onClick, className: "icon-control", "aria-label": label, title: label, ...attrs });
}
