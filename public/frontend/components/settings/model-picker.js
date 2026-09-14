import { element, button } from "../primitives.js";
import { createStudioDialog, field, syncValue } from "./dialog.js";
export function createModelPicker({ onSelect, onRetry, onRuntime }) {
  const dialog = createStudioDialog("Model Picker");
  let snapshot;
  let projection;
  const current = element("p", { class: "model-current" });
  const status = element("p", { role: "status" });
  const search = element("input", { type: "search", placeholder: "モデルを検索", "aria-label": "Model search" });
  const runtimes = element("select", { "aria-label": "Runtime" });
  runtimes.addEventListener("change", () => onRuntime(runtimes.value));
  const list = element("div", { class: "model-results" });
  const retry = button("接続を再確認", { onClick: onRetry });
  function renderList() {
    if (!snapshot) return;
    const query = search.value.toLocaleLowerCase();
    const models = snapshot.runtime.installedCheckpoints.filter((model) => `${model.title} ${model.modelName}`.toLocaleLowerCase().includes(query));
    list.replaceChildren(...models.map((model) => button(model.modelName || model.title, {
      className: "model-choice", "aria-pressed": String(model.title === snapshot.runtime.selectedCheckpoint?.title),
      onClick: () => onSelect(model.title)
    })));
    for (const control of list.querySelectorAll("button")) control.disabled = snapshot.selectingModel || snapshot.generation.busy || snapshot.runtime.switching || snapshot.reusing;
    if (!models.length) list.append(element("p", { text: snapshot.ready ? "一致するモデルがありません" : projection?.error ? "モデル一覧を取得できません。接続を再確認してください。" : "Catalogを読み込み中…" }));
  }
  search.addEventListener("input", renderList);
  dialog.body.append(field("Runtime", runtimes), current, search, status, retry, list);
  return { ...dialog, render(value, view) {
    snapshot = value;
    projection = view;
    current.textContent = `Current model · ${value.runtime.selectedCheckpoint?.modelName || value.runtime.selectedCheckpoint?.title || "未選択"}`;
    const options = value.runtime.runtimeOptions ?? [];
    const key = JSON.stringify(options.map((runtime) => [runtime.id, runtime.label, runtime.available]));
    if (runtimes.dataset.options !== key) {
      runtimes.replaceChildren(...options.map((runtime) => element("option", { value: runtime.id, text: `${runtime.label}${runtime.available === false ? " · unavailable" : ""}` })));
      runtimes.dataset.options = key;
    }
    syncValue(runtimes, value.runtime.activeRuntimeId);
    runtimes.disabled = value.generation.busy || value.selectingModel || value.runtime.switching || value.reusing;
    status.textContent = value.selectingModel ? "モデル選択を確認中…" : value.runtime.switching ? "Runtimeを切替中…" : !view.available ? "Runtime unavailable" : view.error || value.generation.error || "";
    retry.disabled = value.generation.busy || value.selectingModel || value.runtime.switching;
    renderList();
  } };
}
