import { createRuntimeService } from "../core/runtime-service.js";

// The only runtime layer that knows the production controls. New entries use
// createRuntimeService directly; no synthetic/hidden form is required.
export function createRuntimeController({ elements, ...options }) {
  const service = createRuntimeService({
    ...options,
    presentation: {
      renderRuntimes(runtimes) {
        elements.runtimeSelect.replaceChildren();
        for (const runtime of runtimes) {
          const option = new Option(runtime.optionLabel, runtime.id);
          option.disabled = !runtime.selectable;
          if (runtime.error) option.title = String(runtime.error);
          elements.runtimeSelect.append(option);
        }
      },
      selectRuntime(value) { elements.runtimeSelect.value = value; },
      renderCheckpoints(checkpoints, selected) {
        elements.checkpointSelect.replaceChildren();
        for (const checkpoint of checkpoints) {
          elements.checkpointSelect.append(new Option(checkpoint.title, checkpoint.title));
        }
        elements.checkpointSelect.value = selected;
      },
      selectCheckpoint(value) { elements.checkpointSelect.value = value; },
      checkpointStatus(value) { elements.checkpointStatus.textContent = value; },
      checkpointDisabled(value) { elements.checkpointSelect.disabled = value; },
      refreshDisabled(value) { elements.refreshCheckpointsButton.disabled = value; },
      checkpointFailure() { elements.checkpointSelect.replaceChildren(new Option("取得失敗", "")); }
    }
  });
  let initialized = false;
  const selectRuntime = (id = elements.runtimeSelect.value) => service.selectRuntime(id);
  const selectCheckpoint = (title = elements.checkpointSelect.value) => service.selectCheckpoint(title);
  const onRuntimeChange = () => void selectRuntime();
  const onRefresh = () => void service.refreshCheckpoints();
  const onCheckpointChange = () => void selectCheckpoint();
  return {
    ...service, selectRuntime, selectCheckpoint,
    init() {
      if (initialized) return;
      initialized = true;
      service.init();
      elements.runtimeSelect.addEventListener("change", onRuntimeChange);
      elements.refreshCheckpointsButton.addEventListener("click", onRefresh);
      elements.checkpointSelect.addEventListener("change", onCheckpointChange);
    },
    dispose() {
      if (!initialized) return;
      initialized = false;
      service.dispose();
      elements.runtimeSelect.removeEventListener("change", onRuntimeChange);
      elements.refreshCheckpointsButton.removeEventListener("click", onRefresh);
      elements.checkpointSelect.removeEventListener("change", onCheckpointChange);
    }
  };
}
