export class RecipePersistenceError extends Error {
  constructor(cause) {
    super(cause?.message || "Recipe settings could not be saved", { cause });
    this.name = "RecipePersistenceError";
  }
}

export function runRecipePersistence(callback) {
  try {
    return callback();
  } catch (error) {
    throw new RecipePersistenceError(error);
  }
}

// Coordinates one short-lived Recipe transaction. State remains in its owner;
// this module only orders owner ports and guards asynchronous Runtime switches.
export function createRecipeWorkflow({ runtime, form, promptLora, ipAdapter, referenceImage, inpaint, reportError }) {
  let requestVersion = 0;
  let queue = Promise.resolve();
  const notifyError = (error, details) => {
    try { reportError(error, details); } catch {}
  };

  async function restoreOwnerSnapshots(snapshots, operation) {
    const failures = [];
    const restore = async (label, callback) => {
      if (!runtime.isCurrent(operation.runtimeContext)) {
        failures.push(`${label}: restore skipped after Runtime changed`);
        return;
      }
      try {
        if (await callback() === false) failures.push(`${label}: restore returned false`);
      } catch (error) {
        failures.push(`${label}: ${error?.message || error}`);
      }
    };

    // Selection precedes form rendering. Form restore also restores its nested
    // Reference snapshot and changes mode, which can reset Inpaint's source.
    await restore("Prompt/LoRA", () => promptLora.restoreState(snapshots.promptLora));
    await restore("IP-Adapter", () => ipAdapter.restoreState(snapshots.ipAdapter));
    await restore("Reference", () => referenceImage.restoreSnapshot(snapshots.referenceImage));
    await restore("Form", () => form.restoreState(snapshots.form));
    // Always last so the form's mode/source callbacks cannot erase this restore.
    await restore("Inpaint", () => inpaint.restoreState(snapshots.inpaint, {
      isCurrent: () => runtime.isCurrent(operation.runtimeContext)
    }));
    return failures;
  }

  async function rollback(operation, error) {
    const failures = [];
    // A newer request or external Runtime selection owns the current state.
    // Never let an older failure switch it back or overwrite its owner state.
    if (!runtime.isCurrent(operation.runtimeContext)) {
      notifyError(error, { rollback: "skipped-stale" });
      return false;
    }
    failures.push(...await restoreOwnerSnapshots(operation.snapshots, operation));
    notifyError(error, { rollback: failures.length ? "incomplete" : "complete", failures });
    return false;
  }

  async function execute(version, recipe, image) {
    if (version !== requestVersion) return false;
    try {
      if (!await runtime.ensure(recipe)) return false;
    } catch (error) {
      notifyError(error, { rollback: "not-started" });
      return false;
    }
    if (version !== requestVersion) return false;
    if (!runtime.isReadyFor(recipe)) return false;
    const runtimeContext = runtime.captureContext();
    if (!runtime.isCurrent(runtimeContext) || !runtime.isReadyFor(recipe)) return false;
    let snapshots;
    try {
      // Runtime resource loading may replace each owner, so capture only after
      // ensure() has settled successfully.
      snapshots = {
        promptLora: promptLora.captureState(),
        ipAdapter: ipAdapter.captureState(),
        referenceImage: referenceImage.captureSnapshot(),
        form: form.captureState(),
        inpaint: inpaint.captureState()
      };
    } catch (error) {
      notifyError(error, { rollback: "unavailable" });
      return false;
    }

    const operation = { version, runtimeContext, snapshots };
    let applyOpen = false;
    const closeApply = () => {
      if (!applyOpen) return;
      applyOpen = false;
      form.endApply?.();
    };
    try {
      form.beginApply?.();
      applyOpen = true;
      // Keep this sequence aligned with the legacy loadRecipeFields path.
      const steps = [
        () => form.applyHeader(recipe),
        () => promptLora.restorePromptSnapshot(recipe),
        () => ipAdapter.restoreRecipe(recipe), // false means clear/unsupported, not failure
        () => form.applySettings(recipe, image),
        () => promptLora.restoreRecipeSelection(recipe?.loras ?? []),
        () => form.applyLoraDetails(recipe),
        () => form.persistAndRender(),
        () => promptLora.syncFromPrompt()
      ];
      for (const step of steps) {
        const result = step();
        if (result && typeof result.then === "function") {
          await result;
        }
        if (!runtime.isCurrent(runtimeContext)) throw new Error("Runtime changed while loading Recipe");
        if (version !== requestVersion) throw new Error("Recipe load was superseded");
      }
      closeApply();
      return true;
    } catch (error) {
      try { closeApply(); } catch (closeError) {
        return rollback(operation, new AggregateError([error, closeError], "Recipe apply cleanup failed"));
      }
      if (error instanceof RecipePersistenceError) {
        notifyError(error, { rollback: "preserved-prefix", persistence: true });
        return false;
      }
      return rollback(operation, error);
    }
  }

  function load(recipe, image) {
    const version = ++requestVersion;
    const pending = queue.then(() => execute(version, recipe, image));
    queue = pending.catch(() => false);
    return pending;
  }

  return {
    ensureRuntime: (recipe) => runtime.ensure(recipe),
    load
  };
}
