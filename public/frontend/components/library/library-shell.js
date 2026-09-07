import { element, button } from "../primitives.js";
export function createLibraryShell({ artwork, onOpen }) {
  const entries = element("div", { class: "library-grid" });
  const root = element("section", { class: "library-shell", "aria-label": "Library preview", hidden: "" }, [
    element("div", { class: "library-heading" }, [element("div", {}, [element("p", { class: "eyebrow", text: "YOUR CREATIVE TRAIL" }), element("h1", { text: "Library" })]), element("span", { class: "library-scope", text: "Sample collection · R2 preview" })]),
    element("p", { class: "library-description", text: "Good ideas rarely happen in a straight line. Keep the ones worth coming back to." }), entries
  ]);
  ["Light, held in form", "An exercise in balance", "The quiet hour", "A softer geometry", "Room for interpretation", "Another point of view"].forEach((title, index) => {
    const item = button("", { className: "library-artwork", onClick: onOpen, "aria-label": `Open demo study: ${title}` });
    item.append(element("div", { class: `library-thumbnail variation-${index}` }, [element("img", { src: artwork, alt: "", loading: "lazy", decoding: "async" })]),
      element("span", { class: "library-item-title", text: title }), element("small", { text: `Study ${String(index + 1).padStart(3, "0")} · Demo artwork` }));
    entries.append(item);
  });
  return { root };
}
