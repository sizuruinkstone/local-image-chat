import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { createRuntimeController } from "../public/features/runtime-controller.js";
import { createRecipeWorkflow } from "../public/features/recipe-workflow.js";

class FakeOption {
  constructor(text, value) {
    this.text = text;
    this.value = value;
    this.disabled = false;
    this.title = "";
  }
}

class FakeControl {
  constructor() {
    this.value = "";
    this.textContent = "";
    this.disabled = false;
    this.options = [];
    this.listeners = new Map();
  }
  replaceChildren(...children) { this.options = children; }
  append(child) { this.options.push(child); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }
}

const runtimes = [
  { id: "reforge", label: "ReForge", available: true, features: { txt2img: true } },
  { id: "forge-neo-anima", label: "Forge Neo", available: true, features: { txt2img: true } }
];

function createFixture(overrides = {}) {
  const values = new Map();
  const elements = {
    runtimeSelect: new FakeControl(),
    checkpointSelect: new FakeControl(),
    refreshCheckpointsButton: new FakeControl(),
    checkpointStatus: new FakeControl()
  };
  const controller = createRuntimeController({
    elements,
    storage: {
      getItem: (key) => values.has(key) ? values.get(key) : null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key)
    },
    getJson: async () => ({ checkpoints: [], activeCheckpoint: "" }),
    postJson: async () => ({ checkpoints: [], activeCheckpoint: "" }),
    ...overrides
  });
  controller.init();
  controller.configure(runtimes, "reforge");
  return { controller, elements };
}

function extractTopLevelFunction(source, name) {
  const pattern = new RegExp(`async function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^\\}\\r?$`, "m");
  const match = source.match(pattern);
  assert.ok(match, `expected ${name} in public/app.js`);
  return match[0];
}

test.before(() => { globalThis.Option = FakeOption; });

test("a completed runtime switch remains committed and becomes the next failed switch baseline", async () => {
  let externalState = "reforge-state";
  let switchCount = 0;
  const restored = [];
  const { controller } = createFixture({
    captureExternalSnapshot: () => externalState,
    restoreExternalSnapshot: (snapshot) => {
      restored.push(snapshot);
      externalState = snapshot;
    },
    loadExternalResources: () => [Promise.resolve(++switchCount === 1)]
  });

  assert.equal(await controller.selectRuntime("forge-neo-anima"), true);
  externalState = "neo-state-after-recipe-start";

  assert.throws(() => { throw new Error("later recipe failure"); }, /later recipe failure/);
  assert.equal(controller.getState().activeRuntimeId, "forge-neo-anima");
  assert.deepEqual(restored, []);

  assert.equal(await controller.selectRuntime("reforge"), false);
  assert.equal(controller.getState().activeRuntimeId, "forge-neo-anima");
  assert.equal(externalState, "neo-state-after-recipe-start");
  assert.deepEqual(restored, ["neo-state-after-recipe-start"]);
});

test("instruction cancellation retains the successfully ensured runtime without loading recipe state", async () => {
  const appSource = await fs.readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const initialDerivation = { type: "existing", instruction: "keep", parentGenerationId: "old" };
  let modalCalls = 0;
  let recipeLoads = 0;
  const { controller, elements } = createFixture({
    loadExternalResources: () => [Promise.resolve(true)]
  });
  const recipeWorkflow = createRecipeWorkflow({
    runtime: {
      getActiveId: () => controller.getState().activeRuntimeId,
      ensure: async (recipe) => {
        const target = controller.runtimeForGeneration(recipe);
        if (!target) return false;
        return target.id === controller.getState().activeRuntimeId
          ? controller.waitForSwitch()
          : controller.selectRuntime(target.id);
      },
      select: (runtimeId) => controller.selectRuntime(runtimeId)
    },
    form: {},
    promptLora: {},
    ipAdapter: {},
    referenceImage: {},
    inpaint: {},
    reportError: () => {}
  });
  const context = vm.createContext({
    elements,
    ensureRuntimeForRecipe: recipeWorkflow.ensureRuntime,
    promptModal: async () => { modalCalls += 1; return null; },
    loadRecipeFields: async () => { recipeLoads += 1; return true; },
    initialDerivation
  });
  const program = `
    const DERIVATION_LABELS = {
      outfit: { title: "outfit", placeholder: "", prefix: "" }
    };
    let pendingDerivation = initialDerivation;
    ${extractTopLevelFunction(appSource, "deriveWithInstruction")}
    globalThis.runDerive = deriveWithInstruction;
    globalThis.readPendingDerivation = () => pendingDerivation;
  `;
  vm.runInContext(program, context, { filename: "public/app.js" });

  await context.runDerive({
    id: "generation-1",
    runtime: { id: "forge-neo-anima" }
  }, { seed: 123 }, "outfit");

  assert.equal(controller.getState().activeRuntimeId, "forge-neo-anima");
  assert.equal(modalCalls, 1);
  assert.equal(recipeLoads, 0);
  assert.equal(context.readPendingDerivation(), initialDerivation);
});
