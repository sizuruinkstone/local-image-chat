import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  RecipePersistenceError,
  createRecipeWorkflow,
  runRecipePersistence
} from "../public/features/recipe-workflow.js";

const appSource = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture(overrides = {}) {
  const events = [];
  const reports = [];
  let activeRuntimeId = "reforge";
  let runtimeToken = 0;
  const runtime = {
    getActiveId: () => activeRuntimeId,
    ensure: async (recipe) => {
      events.push(`runtime:${recipe.runtime?.id ?? "reforge"}`);
      activeRuntimeId = recipe.runtime?.id ?? "reforge";
      runtimeToken += 1;
      return true;
    },
    select: async (id) => { events.push(`runtime-restore:${id}`); activeRuntimeId = id; return true; },
    captureContext: () => ({ runtimeToken }),
    isCurrent: (context) => context.runtimeToken === runtimeToken,
    isReadyFor: (recipe) => activeRuntimeId === (recipe.runtime?.id ?? "reforge"),
    ...overrides.runtime
  };
  const workflow = createRecipeWorkflow({
    runtime,
    form: {
      captureState: () => (events.push("capture:form"), { form: true }),
      restoreState: () => { events.push("restore:form"); return true; },
      applyHeader: () => events.push("header"),
      applySettings: () => events.push("settings"),
      applyLoraDetails: () => events.push("lora-details"),
      persistAndRender: () => events.push("persist-render"),
      ...overrides.form
    },
    promptLora: {
      captureState: () => (events.push("capture:prompt"), {}),
      restoreState: () => { events.push("restore:prompt"); return true; },
      restorePromptSnapshot: () => events.push("prompt"),
      restoreRecipeSelection: () => events.push("selection"),
      syncFromPrompt: () => events.push("sync"),
      ...overrides.promptLora
    },
    ipAdapter: {
      captureState: () => (events.push("capture:ip"), {}),
      restoreState: () => { events.push("restore:ip"); return true; },
      restoreRecipe: () => { events.push("ip"); return false; },
      ...overrides.ipAdapter
    },
    referenceImage: {
      captureSnapshot: () => (events.push("capture:reference"), null),
      restoreSnapshot: () => { events.push("restore:reference"); return true; },
      ...overrides.referenceImage
    },
    inpaint: {
      captureState: () => (events.push("capture:inpaint"), {}),
      restoreState: async () => { events.push("restore:inpaint"); return true; },
      ...overrides.inpaint
    },
    reportError: (error, details) => reports.push({ error, details })
  });
  return { workflow, events, reports, runtime, active: () => activeRuntimeId };
}

test("applies the legacy Prompt, IP, settings, selection, LoRA and final sync order", async () => {
  const { workflow, events } = fixture();
  assert.equal(await workflow.load({ runtime: { id: "neo" }, loras: [] }, { seed: 7 }), true);
  assert.deepEqual(events, [
    "runtime:neo", "capture:prompt", "capture:ip", "capture:reference", "capture:form", "capture:inpaint",
    "header", "prompt", "ip", "settings", "selection", "lora-details", "persist-render", "sync"
  ]);
});

test("Runtime failure performs no Recipe capture or mutation", async () => {
  const { workflow, events } = fixture({ runtime: { ensure: async () => (events.push("runtime-failed"), false) } });
  assert.equal(await workflow.load({}, {}), false);
  assert.deepEqual(events, ["runtime-failed"]);
});

test("successful switch followed by critical failure keeps the successful Runtime baseline", async () => {
  const { workflow, events, active, reports } = fixture({ form: { applySettings: () => { throw new Error("bad settings"); } } });
  assert.equal(await workflow.load({ runtime: { id: "neo" } }, {}), false);
  assert.equal(active(), "neo");
  assert.deepEqual(events.slice(-5), [
    "restore:prompt", "restore:ip", "restore:reference", "restore:form", "restore:inpaint"
  ]);
  assert.equal(reports[0].details.rollback, "complete");
});

test("selection restores before form and Inpaint restores last; false/rejection are observable", async () => {
  const { workflow, events, reports } = fixture({
    form: { applySettings: () => { throw new Error("apply failed"); }, restoreState: () => (events.push("restore:form"), false) },
    inpaint: { restoreState: async () => { events.push("restore:inpaint"); throw new Error("decode failed"); } }
  });
  assert.equal(await workflow.load({}, {}), false);
  assert.ok(events.indexOf("restore:prompt") < events.indexOf("restore:form"));
  assert.equal(events.at(-1), "restore:inpaint");
  assert.equal(reports[0].details.rollback, "incomplete");
  assert.match(reports[0].details.failures.join(" "), /Form.*false.*Inpaint.*decode failed/);
});

test("known persistence boundary preserves the applied prefix without rollback", async () => {
  const quota = Object.assign(new Error("quota"), { name: "QuotaExceededError" });
  const { workflow, events, reports } = fixture({
    form: { persistAndRender: () => runRecipePersistence(() => { throw quota; }) }
  });
  assert.equal(await workflow.load({}, {}), false);
  assert.ok(events.includes("lora-details"));
  assert.equal(events.some((value) => value.startsWith("restore:")), false);
  assert.equal(reports[0].error instanceof RecipePersistenceError, true);
  assert.equal(reports[0].details.rollback, "preserved-prefix");
});

test("latest queued request supersedes an older load waiting for Runtime", async () => {
  const gate = deferred();
  let calls = 0;
  const { workflow, events } = fixture({
    runtime: {
      ensure: async (recipe) => {
        events.push(`runtime:${recipe.name}`);
        if (++calls === 1) await gate.promise;
        return true;
      }
    },
    form: { applyHeader: (recipe) => events.push(`header:${recipe.name}`) }
  });
  const first = workflow.load({ name: "old" }, {});
  await Promise.resolve();
  const second = workflow.load({ name: "new" }, {});
  gate.resolve();
  assert.equal(await first, false);
  assert.equal(await second, true);
  assert.equal(events.includes("header:old"), false);
  assert.equal(events.includes("header:new"), true);
});

test("an external Runtime change at ensure settlement prevents snapshot capture", async () => {
  let active = "reforge";
  let token = 0;
  const { workflow, events } = fixture({ runtime: {
    getActiveId: () => active,
    ensure: async () => {
      active = "neo";
      token += 1;
      queueMicrotask(() => { active = "external"; token += 1; });
      return true;
    },
    isReadyFor: () => active === "neo",
    captureContext: () => ({ token }),
    isCurrent: (context) => context.token === token
  } });
  assert.equal(await workflow.load({ runtime: { id: "neo" } }, {}), false);
  assert.equal(events.some((value) => value.startsWith("capture:")), false);
});

test("a stale rejected apply cannot overwrite owners after an external Runtime change", async () => {
  let active = "reforge";
  let token = 0;
  const gate = deferred();
  const { workflow, events, reports } = fixture({
    runtime: {
      getActiveId: () => active,
      ensure: async () => { active = "neo"; token += 1; return true; },
      captureContext: () => ({ token }),
      isCurrent: (context) => context.token === token,
      isReadyFor: () => active === "neo",
    },
    form: { applySettings: async () => { await gate.promise; throw new Error("late failure"); } }
  });
  // Async form ports are outside the app adapter, but this verifies the stale
  // rollback guard against an external Runtime change during a rejected port.
  const pending = workflow.load({}, {});
  await Promise.resolve();
  await Promise.resolve();
  active = "external";
  token += 1;
  gate.resolve();
  assert.equal(await pending, false);
  assert.equal(reports[0].details.rollback, "skipped-stale");
  assert.equal(events.some((value) => value.startsWith("restore:")), false);
});

test("app delegates Recipe loading while one-shot callers remain outside the workflow", () => {
  assert.match(appSource, /function loadRecipeFields\(recipe, image\) \{\s*return recipeWorkflow\.load\(recipe, image\);\s*\}/);
  assert.match(appSource, /async function regenerateWithSameSeed[\s\S]*?activateCompositionLock[\s\S]*?pendingDerivation = \{ type: "same-seed"/);
  assert.match(appSource, /async function duplicateRecipe[\s\S]*?loadRecipeFields[\s\S]*?elements\.seed\.value = RANDOM_SEED[\s\S]*?type: "duplicate"/);
  assert.match(appSource, /async function deriveWithInstruction[\s\S]*?ensureRuntimeForRecipe\(generation\)[\s\S]*?promptModal[\s\S]*?loadRecipeFields/);
  assert.doesNotMatch(appSource.match(/function loadRecipeFields[^]*?^}/m)?.[0] ?? "", /pendingDerivation|compositionLock/);
});

test("Recipe adapter preserves nonapplication of checkpoint, Reference source and mask metadata", () => {
  const settings = appSource.match(/function applyRecipeSettings[^]*?^}/m)?.[0] ?? "";
  const load = appSource.match(/function loadRecipeFields[^]*?^}/m)?.[0] ?? "";
  assert.doesNotMatch(settings, /checkpoint|sourceImage|maskImage|restoreSnapshot|restoreState/);
  assert.doesNotMatch(load, /checkpoint|sourceImage|maskImage/);
});

test("app forwards the Inpaint context guard and refreshes derived Studio stats after form rollback", () => {
  assert.match(appSource, /restoreState: \(snapshot, options\) => inpaintEditor\.restoreState\(snapshot, options\)/);
  assert.match(appSource, /restoreState: \(snapshot\) => \{[\s\S]*?restoreFormState\(snapshot\)[\s\S]*?studioController\.syncOutputStats\(\)/);
});
