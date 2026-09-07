import {element, button} from "../primitives.js";
import {createStudioDialog} from "../settings/dialog.js";
import {originalImageUrl, thumbnailImageUrl} from "../../../image-delivery.js";
import {createLibraryService} from "../../../core/library-service.js";
import {getJson} from "../../../core/http-client.js";

export function createImageLibrary({workspace, onReuse, onCompare = () => {}, onEdit = () => {}}) {
  let data, selected, zoom = 1, completedKey = "", searchTimer, disposed = false;
  const search = element("input", {type: "search", "aria-label": "Search all history", placeholder: "全履歴を検索…"});
  const sort = element("select", {"aria-label": "History sort"}, [element("option", {value: "newest", text: "Newest"}), element("option", {value: "oldest", text: "Oldest"})]);
  const favorite = button("Favorites", {onClick: () => service.setQuery({favorites: !data.favorites})});
  const status = element("p", {role: "status", class: "library-status"});
  const grid = element("div", {class: "image-library-grid"});
  const more = button("さらに読み込む", {onClick: () => service.more()});
  const root = element("section", {class: "image-library", "aria-label": "Image Library"}, [
    element("header", {class: "image-library-tools"}, [element("h1", {text: "Library"}), search, sort, favorite, button("更新", {onClick: () => service.load()})]), status, grid, more]);
  const viewer = createStudioDialog("Image Viewer"); viewer.root.classList.add("library-viewer");
  const image = element("img", {alt: "Selected historical image", class: "viewer-image"});
  const imageArea = element("div", {class: "viewer-image-area"}, [image]);
  const metadata = element("pre", {class: "viewer-metadata"});
  const position = element("span"); const error = element("p", {role: "alert"});
  const previous = button("Previous", {onClick: () => move(-1)}), next = button("Next", {onClick: () => move(1)});
  const reuse = button("Reuse settings → Studio", {onClick: async () => {
    if (!selected) return; error.textContent = ""; reuse.disabled = true;
    try { const result = await workspace.reuseImage(selected.image.id); if (result?.applied) { viewer.close(); onReuse(); } else error.textContent = "設定を適用できませんでした。"; }
    catch (cause) { error.textContent = cause.message; } finally { reuse.disabled = false; }
  }});
  viewer.body.append(element("div", {class: "viewer-controls"}, [previous, position, next,
    button("Fit", {onClick: () => setZoom(1)}), button("Zoom −", {onClick: () => setZoom(Math.max(1, zoom - .5))}), button("Zoom +", {onClick: () => setZoom(Math.min(4, zoom + .5))}),
    button("Compare", {onClick: () => { if (selected) onCompare(selected); }}), button("Edit / Inpaint", {onClick: () => { if (selected) { viewer.close(); onEdit(selected); } }})]),
    element("div", {class: "viewer-content"}, [imageArea, element("aside", {}, [element("h3", {text: "Result Metadata"}), metadata, reuse, error]) ]));
  const recent = createStudioDialog("Recent generations"); recent.root.classList.add("recent-viewer");
  let recentItems = [];
  function thumbnail(item) {
    const img = element("img", {src: thumbnailImageUrl(item.image) || originalImageUrl(item.image), alt: "", loading: "lazy", decoding: "async"});
    img.addEventListener("error", () => { if (!img.dataset.fallback) { img.dataset.fallback = "true"; img.src = "/image-placeholder.svg"; } });
    const node = element("button", {type: "button", class: "library-image", "aria-label": `View image ${item.image.id}`}, [img,
      element("span", {text: item.record.title || item.record.description || `Seed ${item.image.seed}`})]);
    node.addEventListener("click", () => { recent.close(); open(item); }); return node;
  }
  function setZoom(value) { zoom = value; imageArea.dataset.zoom = String(zoom); image.style.width = zoom === 1 ? "" : `${zoom * 100}%`; }
  function open(item) {
    selected = item; setZoom(1); error.textContent = ""; image.src = originalImageUrl(item.image);
    const r = item.record;
    metadata.textContent = JSON.stringify({title: r.title, runtime: r.runtime?.label, seed: item.image.seed, settings: r.settings, prompt: r.prompt, negativePrompt: r.negativePrompt, loras: r.loras}, null, 2);
    updateNavigation(); viewer.open();
  }
  function updateNavigation() {
    const index = data.items.findIndex(item => item.image.id === selected?.image.id);
    previous.disabled = index <= 0; next.disabled = index < 0 || index === data.items.length - 1 && !data.hasMore;
    position.textContent = index < 0 ? "Recent" : `${index + 1} / ${data.total}`;
  }
  async function move(delta) {
    const id = selected?.image.id, index = data.items.findIndex(item => item.image.id === id);
    if (delta > 0 && index === data.items.length - 1 && data.hasMore) await service.more();
    if (selected?.image.id !== id) return;
    const item = data.items[index + delta]; if (item) open(item);
  }
  const nodes = new Map();
  const service = createLibraryService({getJson, storage: globalThis.localStorage, onChange(value) {
    data = value; status.textContent = value.error || `${value.total} images · 全履歴${value.loading ? " · 読み込み中…" : ""}`;
    favorite.setAttribute("aria-pressed", String(value.favorites)); more.disabled = value.loading; more.hidden = !value.hasMore;
    const keep = new Set(value.items.map(item => item.image.id));
    for (const [id, node] of nodes) if (!keep.has(id)) { node.remove(); nodes.delete(id); }
    value.items.forEach((item, index) => { let node = nodes.get(item.image.id); if (!node) { node = thumbnail(item); nodes.set(item.image.id, node); }
      if (grid.children[index] !== node) grid.insertBefore(node, grid.children[index] ?? null); });
    updateNavigation();
  }}); data = service.getSnapshot(); search.value=data.search;sort.value=data.sort;
  search.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { if (!disposed) service.setQuery({search: search.value}); }, 180); });
  sort.addEventListener("change", () => service.setQuery({sort: sort.value}));
  return {root, viewer: viewer.root, recent: recent.root,
    show() { if (!data.items.length && !data.loading) service.load(); },
    async openExperiment(id) { const result=await getJson(`/api/experiments/${encodeURIComponent(id)}/history`); if(disposed)return;recent.root.querySelector("h2").textContent="Experiment images";recent.body.replaceChildren(element("div", {class:"recent-image-grid"}, (result.generations??[]).flatMap(record=>record.images.map(image=>thumbnail({record,image})))));recent.open(); },
    openRecent() { recent.root.querySelector("h2").textContent="Recent generations";recent.body.replaceChildren(element("div", {class: "recent-image-grid"}, recentItems.map(thumbnail))); recent.open(); },
    render(snapshot) {
      recentItems = (snapshot.recent?.generations ?? []).flatMap(record => record.images.map(image => ({record, image})));
      const key = snapshot.completed?.images?.[0]?.id;
      if (key && key !== completedKey) { completedKey = key; service.load(); }
      reuse.disabled = snapshot.generation.busy || snapshot.reusing;
    },
    dispose() { disposed = true; clearTimeout(searchTimer); service.dispose(); }
  };
}
