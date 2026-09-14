import { buildLoraCatalog, buildLoraFolderTree, filterItemsByFolder, formatLoraRelativeLocation } from "../../preset-catalog.js";
import { resolveLoraPreviewUrl } from "../../lora-preview.js";

// Browsing position only; favorites/catalog and Active Composition remain in R1.
// Like the legacy picker, folder position survives close/reopen within this app session.
export function createLoraBrowserState() {
  let catalog = [], tree = buildLoraFolderTree([]);
  let folder = "", query = "", favorites = false, selected = "", limit = 60;
  function nodeAt(path, node = tree) {
    if (node.value === path) return node;
    for (const child of node.children) { const found = nodeAt(path, child); if (found) return found; }
  }
  return {
    setCatalog(items) {
      const mapped = buildLoraCatalog(items, { resolveThumbnail: resolveLoraPreviewUrl });
      const originals = new Map(items.filter(item => item?.name).map(item => [item.name, item]));
      catalog = mapped.map(item => ({ ...item, path: formatLoraRelativeLocation(originals.get(item.id)), registry: originals.get(item.id)?.registry ?? {},
        searchText: `${item.name} ${item.loraName} ${formatLoraRelativeLocation(originals.get(item.id))} ${item.triggerWords} ${item.baseModel}`.toLocaleLowerCase() }));
      tree = buildLoraFolderTree(catalog);
      if (!nodeAt(folder)) folder = "";
      if (!catalog.some((item) => item.id === selected)) selected = "";
    },
    navigate(path) { if (!nodeAt(path)) throw new Error("Unknown LoRA folder"); folder = path; query = ""; favorites = false; limit = 60; },
    back() { folder = folder.split("/").slice(0, -1).join("/"); query = ""; limit = 60; },
    search(value) { query = value; limit = 60; },
    favorites(value) { favorites = value; limit = 60; },
    select(id) { if (!catalog.some((item) => item.id === id)) throw new Error("Unknown LoRA"); selected = id; },
    more() { limit += 60; },
    getView() {
      const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
      const scoped = terms.length || favorites ? catalog : filterItemsByFolder(catalog, folder);
      const results = scoped.filter((item) => (!favorites || item.favorite) && terms.every((term) => item.searchText.includes(term)));
      return { folder, query, favorites, selected: catalog.find((item) => item.id === selected) ?? null,
        total: results.length, catalogCount: catalog.length, items: results.slice(0, limit),
        children: nodeAt(folder)?.children ?? [], rootChildren: tree.children, breadcrumbs: folder.split("/").filter(Boolean).map((label, index, parts) => ({label,value:parts.slice(0,index+1).join("/")})) };
    }
  };
}
