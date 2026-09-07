import { element, button } from "../components/primitives.js";
import { createAppBar } from "../components/shell/app-bar.js";
import { createWorkspaceNav } from "../components/shell/workspace-nav.js";
import { createCanvasToolbar } from "../components/canvas/canvas-toolbar.js";
import { createCanvasStage } from "../components/canvas/canvas-stage.js";
import { createPromptWorkspace } from "../components/prompt/prompt-workspace.js";
import { createPromptDock } from "../components/prompt/prompt-dock.js";
import { createInspectorPanel } from "../components/inspector/inspector-panel.js";
import { createLibraryShell } from "../components/library/library-shell.js";
import { createImageLibrary } from "../components/library/image-library.js";
import { reduceShellState } from "./shell-state.js";

import { generationView } from "./generation-view.js";
import { createModelPicker } from "../components/settings/model-picker.js";
import { createPrimarySettings } from "../components/settings/primary-settings.js";
import { createLoraBrowser } from "../components/lora/lora-browser.js";
import { createCanvasEditor } from "../components/canvas/canvas-editor.js";
import { createCompareDialog } from "../components/canvas/compare-dialog.js";
import { createAdvancedDialog } from "../components/inspector/advanced-dialog.js";
// View/session state only. R1 remains the sole owner of the generation draft.
export function mountStudioShell({ root, workspace, artwork, previewMode = false, recoveryDialog, production = false }) {
  let state = { view: "studio", canvas: "image", inspector: false };
  if (production) { try { if (localStorage.getItem("localImageChat.studioView.v1") === "library") state.view = "library"; } catch { /* optional view preference */ } }
  let snapshot = workspace.getSnapshot();
  let timer;
  let localError = "";
  let dismissedError = "";
  let disposed = false;
  let returnFocus;
  const mobile = matchMedia("(max-width: 900px)");
  const compactNavigation = matchMedia("(max-width: 600px)");
  const dispatch = (event) => { state = reduceShellState(state, event); render(); };
  function preview(value) { clearTimeout(timer); dispatch({ type: "canvas", state: value }); }
  function inspector(open) {
    if (open && !state.inspector) returnFocus = document.activeElement;
    dispatch({ type: "inspector", open });
    if (open) panel.focus();
    else if (returnFocus?.isConnected) returnFocus.focus();
  }
  async function perform(action) {
    localError = ""; dismissedError = snapshot.generation.error || "";
    try { return await action(); } catch (error) { if (!disposed) localError = error.message; }
    finally { if (!disposed) render(); }
  }
  const parameters = (patch) => perform(() => workspace.setParameters(patch));
  const resultSeed = () => { if (snapshot.currentImage) parameters({ seed: snapshot.currentImage.seed }); };
  const models = createModelPicker({ onSelect: (title) => perform(() => workspace.selectModel(title)), onRetry: () => perform(() => workspace.refreshCatalogs()), onRuntime: (id) => perform(() => workspace.selectRuntime(id)) });
  const primary = createPrimarySettings({ onParameters: parameters, onWeight: (name, weight) => perform(() => workspace.setLoraWeight(name, weight)), onToggle: (name) => perform(() => workspace.toggleLora(name)), onRemove: (name) => perform(() => workspace.removeLora(name)), onResultSeed: resultSeed });
  const bar = createAppBar({ onPreviewState: preview, previewMode, production });
  const loraBrowser = createLoraBrowser({ workspace });
  const comparison = createCompareDialog();
  function editImage(item) {
    return perform(() => {
      const selected = item ?? (snapshot.currentImage ? {image: snapshot.currentImage, record: snapshot.completed} : null);
      workspace.setCreation({mode:"inpaint",source:selected ? {imageId:selected.image.id,imageUrl:selected.image.originalUrl||selected.image.imageUrl||`/api/images/${selected.image.id}/original`} : snapshot.creation.source,mask:null});
      inspector(false); state.view="studio"; render();
    });
  }
  const editor = createCanvasEditor({workspace,onExit:()=>render()});
  const advanced = createAdvancedDialog({workspace,onEdit:()=>editImage(),onHistory:(id)=>perform(()=>library.openExperiment(id))});
  const nav = createWorkspaceNav({ onNavigate: (view) => dispatch({ type: "navigate", view }) });
  const toolbar = createCanvasToolbar({ onInspector: () => inspector(!state.inspector), onZoom: (delta) => canvas.zoom(delta) });
  const canvas = createCanvasStage({ artwork: previewMode ? artwork : undefined,
    onReady: () => { if (previewMode) preview("ready"); else promptWorkspace.open(); },
    onRetry: () => previewMode ? preview("ready") : inspector(true),
    onCandidate: (delta) => { const view = generationView(snapshot); const next = view.images[(view.index + delta + view.images.length) % view.images.length]; if (next) perform(() => workspace.selectImage(next.id)); }
  });
  const promptWorkspace = createPromptWorkspace({ onPrompt: (patch) => perform(() => workspace.setPrompt(patch)) });
  const dock = createPromptDock({
    previewMode, onCancel: () => perform(() => workspace.cancel()),
    onModel: () => { inspector(false); models.open(); }, onPrimary: () => { inspector(false); primary.open(); },
    onBrowseLoras: () => { inspector(false); loraBrowser.open(); },
    onOpenPrompt: (key) => promptWorkspace.open(key),
    onInspector: () => inspector(true),
    onGenerate() {
      if (!previewMode) { state.view = "studio"; return perform(() => workspace.generate()); }
      preview("generating");
      timer = setTimeout(() => { if (!disposed) preview("image"); }, 1800);
    }
  });
  const panel = createInspectorPanel({ onClose: () => inspector(false), onParameters: parameters, onResultSeed: resultSeed,
    onReuse: () => perform(() => workspace.reuseMetadata(snapshot.completed, snapshot.currentImage)) });
  const library = previewMode ? createLibraryShell({ artwork, onOpen() {
    state = { ...state, view: "studio", canvas: "image" }; render();
  } }) : createImageLibrary({workspace, onReuse: () => dispatch({type: "navigate", view: "studio"}), onEdit:editImage,
    onCompare:item=>comparison.open(item,snapshot.currentImage?{image:snapshot.currentImage,record:snapshot.completed}:null)});
  if (!previewMode) toolbar.root.querySelector(".canvas-view-controls").prepend(button("Recent", {onClick: () => library.openRecent()}));
  if (!previewMode) {
    panel.root.querySelector(".inspector-draft").append(button("Advanced creation…",{onClick:()=>{inspector(false);advanced.open();}}));
    toolbar.root.querySelector(".canvas-view-controls").prepend(button("Tools",{onClick:()=>{inspector(false);advanced.open("presets");}}));
  }
  const content = element("div", { class: "workspace-content" }, [canvas.root, editor.root, library.root]);
  const scrim = element("button", { type: "button", class: "inspector-scrim", "aria-label": "Dismiss inspector", tabindex: "-1", hidden: "" });
  scrim.addEventListener("click", () => inspector(false));
  const main = element("main", { class: "studio-workspace" }, [toolbar.root, content, dock.root, scrim, panel.root]);
  const shell = element("div", { class: "studio-shell" }, [bar.root, nav.root, main]);
  const status = element("div", { class: "connection-error", role: "alert", hidden: "" });
  const errorText = element("span");
  status.append(errorText, button("接続を再確認", { onClick: () => perform(() => workspace.refreshCatalogs()) }), button("閉じる", { onClick: () => { localError = ""; dismissedError = snapshot.generation.error || ""; render(); } }));
  shell.append(status, promptWorkspace.root, models.root, primary.root, loraBrowser.root);
  if (!previewMode) shell.append(library.viewer, library.recent);
  shell.append(advanced.root,comparison.root);
  if (recoveryDialog) shell.append(recoveryDialog.root);
  root.replaceChildren(shell);
  const background = [bar.root, nav.root, toolbar.root, content, dock.root];
  function render() {
    if (disposed) return;
    if (production) { try { localStorage.setItem("localImageChat.studioView.v1", state.view); } catch { /* draft persistence reports storage failures */ } }
    if (compactNavigation.matches && nav.root.parentElement !== shell) shell.append(nav.root);
    else if (!compactNavigation.matches && nav.root.parentElement !== bar.root) bar.root.insertBefore(nav.root, bar.root.querySelector(".workspace-title"));
    shell.dataset.inspector = String(state.inspector);
    shell.dataset.view = state.view;
    const overlay = state.inspector && mobile.matches;
    for (const item of background) item.inert = overlay;
    panel.root.setAttribute("role", overlay ? "dialog" : "complementary");
    if (overlay) panel.root.setAttribute("aria-modal", "true");
    else panel.root.removeAttribute("aria-modal");
    scrim.hidden = !overlay;
    const view = generationView(snapshot);
    const message = localError || snapshot.persistenceError || (snapshot.generation.error !== dismissedError ? snapshot.generation.error : "");
    errorText.textContent = message || "";
    status.hidden = !message || state.inspector || snapshot.generation.phase === "cancelled";
    bar.render(snapshot, state.canvas, view);
    models.render(snapshot, { ...view, error: localError || snapshot.generation.error }); primary.render(snapshot, view);
    nav.render(state.view);
    toolbar.setInspector(state.inspector);
    panel.render(snapshot, state.inspector, view);
    dock.render(snapshot, state.canvas, view);
    promptWorkspace.render(snapshot);
    loraBrowser.render(snapshot, view);
    if (previewMode) canvas.render(state.canvas); else canvas.renderGeneration(view);
    editor.render(snapshot); advanced.render(snapshot);
    canvas.root.hidden = state.view !== "studio" || snapshot.creation.mode !== "txt2img";
    editor.root.hidden = state.view !== "studio" || snapshot.creation.mode === "txt2img";
    library.root.hidden = state.view !== "library";
    if (!previewMode) { library.render(snapshot); if (state.view === "library") library.show(); }
  }
  function keydown(event) {
    if (promptWorkspace.root.open || models.root.open || primary.root.open || loraBrowser.root.open || advanced.root.open || comparison.root.open || library.viewer?.open || library.recent?.open || recoveryDialog?.root.open || !state.inspector) return;
    if (event.key === "Escape") { event.preventDefault(); inspector(false); }
    if (event.key === "Tab" && mobile.matches) {
      const controls = [...panel.root.querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled)")].filter((node) => node.checkVisibility());
      const index = controls.indexOf(document.activeElement);
      if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1)?.focus(); }
      else if (!event.shiftKey && index === controls.length - 1) { event.preventDefault(); controls[0]?.focus(); }
    }
  }
  shell.addEventListener("keydown", keydown);
  const resize = () => render();
  mobile.addEventListener("change", resize);
  compactNavigation.addEventListener("change", resize);
  const unsubscribe = workspace.subscribe((value) => { snapshot = value; render(); });
  render();
  const ready = workspace.initialize().then((initialized) => {
    if (disposed) return false;
    snapshot = workspace.getSnapshot();
    render();
    if (!initialized) throw new Error("Runtime / catalogに接続できません。接続を再確認してください。");
    return true;
  }).catch((error) => {
    if (!disposed) { localError = error.message; render(); }
    return false;
  });
  return { ready, dispose() {
    disposed = true; clearTimeout(timer); unsubscribe();
    mobile.removeEventListener("change", resize);
    compactNavigation.removeEventListener("change", resize);
    shell.removeEventListener("keydown", keydown);
    editor.dispose();advanced.dispose();library.dispose?.(); recoveryDialog?.dispose(); workspace.dispose(); shell.remove();
  } };
}
