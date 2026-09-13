import {element, button} from "../primitives.js";
import {createStudioDialog} from "../settings/dialog.js";
import {originalImageUrl, thumbnailImageUrl} from "../../../image-delivery.js";
import {createLibraryService} from "../../../core/library-service.js";
import {createResultMetadata} from "./result-metadata.js";
import {getJson, patchJson} from "../../../core/http-client.js";

function createRatingButtons(label, choices, onSelect) {
  let value = choices[0].value;
  const root = element("div", {class: "content-rating-picker", role: "group", "aria-label": label});
  const controls = choices.map(choice => {
    const control = button(choice.label, {className: "content-rating-option", onClick: () => onSelect(choice.value)});
    control.dataset.contentRating = choice.value; root.append(control); return control;
  });
  return {root, get value() { return value; }, setValue(next) {
    value = choices.some(choice => choice.value === next) ? next : "";
    for (const control of controls) {
      const active = control.dataset.contentRating === value;
      control.setAttribute("aria-pressed", String(active)); control.classList.toggle("active", active);
    }
  }, setDisabled(disabled) { for (const control of controls) control.disabled = disabled; }};
}

export function createImageLibrary({workspace, onReuse, onSelectRecent = () => {}, onCompare = () => {}, onEdit = () => {}, onSaveScene = () => {}}) {
  let data, selected, zoom = 1, completedKey = "", searchTimer, disposed = false;
  const search = element("input", {type: "search", "aria-label": "Search all history", placeholder: "全履歴を検索…"});
  const sort = element("select", {"aria-label": "History sort"}, [element("option", {value: "newest", text: "Newest"}), element("option", {value: "oldest", text: "Oldest"})]);
  const rating = createRatingButtons("コンテンツ分類", [
    {value: "general", label: "一般"}, {value: "nsfw", label: "NSFW"}
  ], value => service.setQuery({rating: value}));
  rating.root.classList.add("library-rating-filter");
  const favorite = button("Favorites", {onClick: () => service.setQuery({favorites: !data.favorites})});
  const status = element("p", {role: "status", class: "library-status"});
  const grid = element("div", {class: "image-library-grid"});
  const more = button("さらに読み込む", {onClick: () => service.more()});
  const root = element("section", {class: "image-library", "aria-label": "Image Library"}, [
    element("header", {class: "image-library-tools"}, [element("h1", {text: "Library"}), search, rating.root, sort, favorite, button("更新", {onClick: () => service.load()})]), status, grid, more]);
  const viewer = createStudioDialog("Image Viewer"); viewer.root.classList.add("library-viewer");
  const image = element("img", {alt: "Selected historical image", class: "viewer-image"});
  const imageArea = element("div", {class: "viewer-image-area"}, [image]);
  const metadata = createResultMetadata();
  const position = element("span"); const error = element("p", {role: "alert"});
  const selectedRating = createRatingButtons("選択画像のコンテンツ分類", [
    {value: "general", label: "一般"}, {value: "nsfw", label: "NSFW"}
  ], updateSelectedRating);
  selectedRating.root.classList.add("library-rating-editor");
  async function updateSelectedRating(contentRating) {
    if (!selected) return;
    const target = selected;
    if (target.record.contentRating === contentRating) return;
    const imageId = target.image.id;
    error.textContent = ""; selectedRating.setValue(contentRating); selectedRating.setDisabled(true);
    try {
      await patchJson(`/api/history/${encodeURIComponent(imageId)}/content-rating`, {contentRating});
      target.record.contentRating = contentRating;
      await service.load();
    } catch (cause) { if (selected?.image.id === imageId) { selectedRating.setValue(["general","nsfw"].includes(target.record.contentRating) ? target.record.contentRating : ""); error.textContent = `分類を変更できませんでした: ${cause.message}`; } }
    finally { selectedRating.setDisabled(false); }
  }
  const previous = button("Previous", {onClick: () => move(-1)}), next = button("Next", {onClick: () => move(1)});
  const reuse = button("Studioで再利用", {className:"control reuse-primary", onClick: async () => {
    if (!selected) return; error.textContent = ""; reuse.disabled = true;
    try { const result = await workspace.reuseImage(selected.image.id); if (result?.applied) { viewer.close(); onReuse(); } else error.textContent = "設定を適用できませんでした。"; }
    catch (cause) { error.textContent = cause.message; } finally { reuse.disabled = false; }
  }});
  viewer.body.append(element("div", {class: "viewer-controls"}, [previous, position, next, selectedRating.root,
    button("Fit", {onClick: () => setZoom(1)}), button("Zoom −", {onClick: () => setZoom(Math.max(1, zoom - .5))}), button("Zoom +", {onClick: () => setZoom(Math.min(4, zoom + .5))}),
    reuse, button('場面として保存', {onClick:()=>{if(selected)onSaveScene({imageId:selected.image.id});}}), button("Compare", {onClick: () => { if (selected) onCompare(selected); }}), button("Edit / Inpaint", {onClick: () => { if (selected) { viewer.close(); onEdit(selected); } }})]),
    element("div", {class: "viewer-content"}, [imageArea, element("aside", {}, [element("h3", {text: "生成情報"}), element("p",{class:"reuse-scope",text:"再利用: Prompt・Negative・LoRA・生成設定・Seed。Checkpointは現在の選択を保持します。"}), metadata.root, error]) ]));
  const recent = createStudioDialog("Recent generations"); recent.root.classList.add("recent-viewer");
  let recentItems = [], stripKey = "";
  const stripImages = element("div",{class:"studio-recent-images"});
  const strip = element("section",{class:"studio-recent-strip","aria-label":"Recent generations"},[element("span",{text:"Recent"}),stripImages]);
  function thumbnail(item, recentSelection = false) {
    const img = element("img", {src: thumbnailImageUrl(item.image) || originalImageUrl(item.image), alt: "", loading: "lazy", decoding: "async"});
    img.addEventListener("error", () => { if (!img.dataset.fallback) { img.dataset.fallback = "true"; img.src = "/image-placeholder.svg"; } });
    const classification = item.record.contentRating === "nsfw" ? "nsfw" : item.record.contentRating === "general" ? "general" : "unrated";
    const badge = element("span", {class: "library-rating-badge", text: classification === "nsfw" ? "NSFW" : classification === "unrated" ? "未分類" : ""});
    badge.dataset.rating = classification;
    const node = element("button", {type: "button", class: "library-image", "aria-label": `View image ${item.image.id}`}, [img, badge,
      element("span", {class: "library-image-title", text: item.record.title || item.record.description || `Seed ${item.image.seed}`})]);
    node.dataset.contentRating = classification;
    node.addEventListener("click", () => { recent.close(); if (recentSelection) onSelectRecent(item); else open(item); }); return node;
  }
  function setZoom(value) { zoom = value; imageArea.dataset.zoom = String(zoom); image.style.width = zoom === 1 ? "" : `${zoom * 100}%`; }
  function open(item) {
    selected = item; setZoom(1); error.textContent = ""; image.src = originalImageUrl(item.image);
    const r = item.record;
    selectedRating.setValue(["general","nsfw"].includes(r.contentRating) ? r.contentRating : "");
    metadata.render(r, item.image);
    updateNavigation(); viewer.open();
  }
  function updateNavigation() {
    const index = data.items.findIndex(item => item.image.id === selected?.image.id);
    previous.disabled = index <= 0; next.disabled = index < 0 || index === data.items.length - 1 && !data.hasMore;
    position.textContent = index < 0 ? "Selected image" : `${index + 1} / ${data.total}`;
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
    rating.setValue(value.rating);
    favorite.setAttribute("aria-pressed", String(value.favorites)); more.disabled = value.loading; more.hidden = !value.hasMore;
    const keep = new Set(value.items.map(item => item.image.id));
    for (const [id, node] of nodes) if (!keep.has(id)) { node.remove(); nodes.delete(id); }
    value.items.forEach((item, index) => { let node = nodes.get(item.image.id); const classification = item.record.contentRating === "nsfw" ? "nsfw" : item.record.contentRating === "general" ? "general" : "unrated";
      if (node?.dataset.contentRating !== classification) { node?.remove(); node = null; }
      if (!node) { node = thumbnail(item); nodes.set(item.image.id, node); }
      if (grid.children[index] !== node) grid.insertBefore(node, grid.children[index] ?? null); });
    updateNavigation();
  }}); data = service.getSnapshot(); search.value=data.search;sort.value=data.sort;rating.setValue(data.rating);
  search.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { if (!disposed) service.setQuery({search: search.value}); }, 180); });
  sort.addEventListener("change", () => service.setQuery({sort: sort.value}));
  return {root, strip, openImage(image,record){open({image,record});}, viewer: viewer.root, recent: recent.root,
    sceneSaved(scene){if(scene&&viewer.root.open)error.textContent=`場面「${scene.name}」を保存しました。Scenesから使用できます。`;},
    show() { if (!data.items.length && !data.loading) service.load(); },
    async openExperiment(id) { const result=await getJson(`/api/experiments/${encodeURIComponent(id)}/history`); if(disposed)return;recent.root.querySelector("h2").textContent="Experiment images";recent.body.replaceChildren(element("div", {class:"recent-image-grid"}, (result.generations??[]).flatMap(record=>record.images.map(image=>thumbnail({record,image})))));recent.open(); },
    openRecent() { recent.root.querySelector("h2").textContent="Recent generations";recent.body.replaceChildren(element("div", {class: "recent-image-grid"}, recentItems.map(item=>thumbnail(item,true)))); recent.open(); },
    render(snapshot) {
      recentItems = (snapshot.recent?.generations ?? []).flatMap(record => record.images.map(image => ({record, image})));
      const nextStripKey = JSON.stringify(recentItems.slice(0,12).map(item=>[item.image.id,item.record.title]));
      if (nextStripKey !== stripKey) { stripKey=nextStripKey;stripImages.replaceChildren(...recentItems.slice(0,12).map(item=>thumbnail(item,true))); }
      const key = snapshot.completed?.images?.[0]?.id;
      if (key && key !== completedKey) { completedKey = key; service.load(); }
      reuse.disabled = snapshot.generation.busy || snapshot.reusing;
    },
    dispose() { disposed = true; clearTimeout(searchTimer); service.dispose(); }
  };
}
