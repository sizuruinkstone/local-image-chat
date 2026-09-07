import { element, button } from "../primitives.js";
import { createLoraBrowserState } from "../../app/lora-browser-state.js";
import { createAssetThumbnail } from "./asset-thumbnail.js";
import { createLoraDetails } from "./lora-details.js";
import { createActiveComposition } from "./active-composition.js";

export function createLoraBrowser({ workspace }) {
  const state = createLoraBrowserState();
  let snapshot, view, previousFocus, epoch = 0, catalogKey = "", error = "", panel = "grid";
  const cards = new Map();
  const search = element("input", { type: "search", placeholder: "名前・path・triggerで探す", "aria-label": "Search LoRA", autocomplete: "off" });
  const close = button("閉じる", { glyph: "close", onClick: () => root.close(), "aria-label": "Close LoRA Browser" });
  const notice = element("p", { role: "status", class: "lora-browser-notice", hidden: "" });
  const breadcrumbs = element("p", { class: "lora-breadcrumbs", "aria-label": "Current LoRA folder" });
  const folders = element("nav", { class: "lora-folders", "aria-label": "LoRA folders" });
  const expandedFolders = new Set();
  let foldersOpen = false;
  const folderToggle = button("Folders", { glyph: "library", className: "control lora-folder-toggle", "aria-expanded": "false", onClick: () => {
    foldersOpen = !foldersOpen; if (foldersOpen) panel = "grid"; render();
    if (foldersOpen) folders.querySelector('[aria-current="location"]')?.focus();
  } });
  const count = element("span", { class: "lora-result-count", "aria-live": "polite" });
  const grid = element("div", { class: "lora-asset-grid", "aria-label": "LoRA assets" });
  const empty = element("p", { class: "lora-grid-empty", text: "一致する素材がありません。検索・Favoriteを変更してください。" });
  const more = button("さらに表示", { onClick: () => { state.more(); render(); } });
  const favoriteFilter = button("☆ Favorites", { onClick: () => { state.favorites(!state.getView().favorites); render(); } });
  const browseTab = button("Browse", { onClick: () => showPanel("grid") });
  const compositionTab = button("Composition · 0", { onClick: () => showPanel("composition") });
  function showPanel(value) { panel = value; render(); if (value === "grid") search.focus(); }
  async function act(action) {
    const started = epoch; error = "";
    try { await action(); } catch (failure) { if (started === epoch) error = failure.message; }
    finally { if (started === epoch) render(); }
  }
  const weight = (name, value) => act(() => workspace.setLoraWeight(name, value));
  const details = createLoraDetails({
    onAdd: name => act(() => workspace.addLora(name, undefined, { includeTriggers: false })),
    onFavorite: (name, value) => act(() => workspace.setLoraFavorite(name, value)),
    onWeight: weight, onInsert: (name, field, choice) => act(() => workspace.insertLoraTrigger(name, field, choice)),
    getPromptChoices: name => workspace.loraPromptChoices(name),
    onClose: () => showPanel("grid")
  });
  const composition = createActiveComposition({ onWeight: weight,
    onToggle: name => act(() => workspace.toggleLora(name)), onRemove: name => act(() => workspace.removeLora(name)),
    onMove: (name, delta) => act(() => {
      const names = snapshot.loras.map(item => item.name), index = names.indexOf(name), next = index + delta;
      if (next < 0 || next >= names.length) return;
      [names[index], names[next]] = [names[next], names[index]];
      workspace.reorderLoras(names);
    })
  });
  const root = element("dialog", { class: "lora-browser", "aria-label": "LoRA Library" }, [
    element("header", { class: "lora-browser-header" }, [element("div", {}, [element("small", { text: "CREATIVE ASSETS" }), element("h1", { text: "LoRA Library" })]), search, close]),
    element("div", { class: "lora-browser-tools" }, [folderToggle, breadcrumbs, favoriteFilter, button("更新", { onClick: () => act(() => workspace.refreshLoras()) }), count]),
    notice,
    element("div", { class: "lora-browser-body" }, [folders, element("section", { class: "lora-browse-area", "aria-label": "Browse assets" }, [grid, empty, more]), details.root]),
    composition.root,
    element("nav", { class: "lora-mobile-tabs", "aria-label": "LoRA browser views" }, [browseTab, compositionTab])
  ]);
  search.addEventListener("input", () => { state.search(search.value); render(); });
  root.addEventListener("close", () => { epoch++; if (previousFocus?.isConnected) previousFocus.focus(); });
  root.addEventListener("cancel", event => {
    if (foldersOpen) { event.preventDefault(); foldersOpen = false; render(); folderToggle.focus(); }
  });
  function navigate(path) {
    state.navigate(path); panel = "grid";
    path.split("/").forEach((_, index, parts) => expandedFolders.add(parts.slice(0, index + 1).join("/")));
    const wasOpen = foldersOpen; foldersOpen = false; render();
    if (wasOpen) folderToggle.focus();
    else folders.querySelector('[aria-current="location"]')?.focus();
  }
  let navigationKey = "";
  function render() {
    if (!root.open || !snapshot) return;
    const key = `${snapshot.runtime.activeRuntimeId}:${snapshot.catalogState?.version}:${snapshot.catalogState?.loading}`;
    if (key !== catalogKey) { state.setCatalog(snapshot.catalogs.loras); catalogKey = key; }
    const browsing = state.getView();
    root.dataset.panel = panel;
    root.dataset.foldersOpen = String(foldersOpen);
    folderToggle.setAttribute("aria-expanded", String(foldersOpen));
    const drawerOpen = foldersOpen && matchMedia("(max-width: 1000px)").matches;
    root.querySelector(".lora-browse-area").inert = drawerOpen;
    details.root.inert = drawerOpen;
    if (search.value !== browsing.query) search.value = browsing.query;
    favoriteFilter.setAttribute("aria-pressed", String(browsing.favorites));
    count.textContent = `${browsing.total} assets${browsing.query.trim() || browsing.favorites ? " · 全folder" : ""}`;
    notice.textContent = error || snapshot.catalogState?.error || (snapshot.catalogState?.loading ? "Catalogを読み込み中…" : "");
    notice.hidden = !notice.textContent;
    const nextNavigationKey = `${key}:${browsing.folder}`;
    if (nextNavigationKey !== navigationKey) {
      breadcrumbs.textContent = ["All LoRA", ...browsing.breadcrumbs.map(item => item.label)].join(" / ");
      const back = button("戻る", { glyph: "back", onClick: () => navigate(browsing.folder.split("/").slice(0, -1).join("/")) }); back.disabled = !browsing.folder;
      function branch(item) {
        const select = button(item.label, { className: "control folder-select", title: item.value, "aria-label": item.value,
          "aria-current": browsing.folder === item.value ? "location" : "false", onClick: () => navigate(item.value) });
        const row = element("div", { class: "folder-row" });
        const nested = element("ul", { class: "folder-branches" }, item.children.map(branch));
        const toggle = button("", { className: "control folder-disclosure", onClick: () => {
          if (expandedFolders.has(item.value)) expandedFolders.delete(item.value); else expandedFolders.add(item.value);
          syncExpansion();
        } });
        function syncExpansion() {
          const expanded = expandedFolders.has(item.value); nested.hidden = !expanded;
          toggle.setAttribute("aria-expanded", String(expanded));
          toggle.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} ${item.value}`);
          toggle.querySelector("span").textContent = expanded ? "▾" : "▸";
        }
        syncExpansion();
        if (item.children.length) row.append(toggle); else row.append(element("span", { class: "folder-disclosure-spacer" }));
        row.append(select);
        return element("li", {}, [row, ...(item.children.length ? [nested] : [])]);
      }
      folders.replaceChildren(element("h2", { text: "Folders" }), back,
        button("All LoRA", { "aria-current": browsing.folder === "" ? "location" : "false", onClick: () => navigate("") }),
        element("ul", { class: "folder-tree" }, browsing.rootChildren.map(branch)));
      navigationKey = nextNavigationKey;
    }
    const active = new Map(snapshot.loras.map(item => [item.name, item]));
    const keep = new Set(browsing.items.map(item => item.id));
    for (const [id, card] of cards) if (!keep.has(id)) { card.root.remove(); cards.delete(id); }
    browsing.items.forEach((item, index) => {
      let card = cards.get(item.id);
      if (!card) {
        const thumb = createAssetThumbnail();
        const name = element("strong"), status = element("span", { class: "lora-asset-status" });
        const node = element("button", { type: "button", class: "lora-asset", "aria-label": item.name }, [thumb.root, element("div", { class: "lora-asset-label" }, [name, status])]);
        node.addEventListener("click", () => { state.select(item.id); panel = "details"; render(); if (matchMedia("(max-width: 700px)").matches) details.root.querySelector("button").focus(); });
        card = { root: node, thumb, name, status }; cards.set(item.id, card);
      }
      if (grid.children[index] !== card.root) grid.insertBefore(card.root, grid.children[index] ?? null);
      card.thumb.setSource(item.thumbnailUrl); card.name.textContent = item.name; card.root.title = item.path;
      card.root.setAttribute("aria-pressed", String(browsing.selected?.id === item.id));
      card.root.dataset.active = String(active.has(item.id));
      card.status.textContent = [active.has(item.id) ? active.get(item.id).enabled === false ? "Disabled" : "Active" : "", item.favorite ? "★" : ""].filter(Boolean).join(" · ");
      card.root.setAttribute("aria-label", `${item.name}${card.status.textContent ? ` · ${card.status.textContent}` : ""}`);
    });
    empty.hidden = Boolean(browsing.total) || snapshot.catalogState?.loading;
    more.hidden = browsing.items.length >= browsing.total;
    details.render(browsing.selected, snapshot, view?.locked);
    composition.render(snapshot.loras, view?.locked);
    compositionTab.querySelector("span").textContent = `Composition · ${snapshot.loras.length}`;
    browseTab.setAttribute("aria-current", panel !== "composition" ? "page" : "false");
    compositionTab.setAttribute("aria-current", panel === "composition" ? "page" : "false");
  }
  return { root, render(value, generationView) { snapshot = value; view = generationView; render(); },
    open() { if (root.open) return; previousFocus = document.activeElement; epoch++; error = ""; panel = "grid"; foldersOpen = false; root.showModal(); render(); search.focus(); act(() => workspace.refreshLoras()); }
  };
}
