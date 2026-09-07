import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createGenerationController } from "../public/features/generation-controller.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function result(overrides = {}) {
  return {
    runtime: { id: "reforge", label: "ReForge" },
    mode: "txt2img",
    contentRating: "general",
    prompt: "effective prompt",
    negativePrompt: "bad",
    settings: { seed: 44, candidateCount: 1 },
    loras: [{ name: "detail", weight: 0.8 }],
    images: [{ id: "image-1", seed: 44 }],
    explanation: "explanation",
    ...overrides
  };
}

function fixture(overrides = {}) {
  const calls = [];
  const pendingTimers = [];
  const runtime = { id: "reforge", label: "ReForge" };
  let derivation = overrides.derivation ?? null;
  let nextJob = 0;
  const statuses = [...(overrides.statuses ?? [{ status: "done", result: result() }])];
  const record = (name, value) => {
    calls.push(value === undefined ? [name] : [name, value]);
    return value;
  };
  const form = {
    readAutoRetry: () => record("readAutoRetry", true),
    getActiveRuntime: () => runtime,
    readContentRating: () => record("readContentRating", "general"),
    readDescription: () => record("readDescription", "a description"),
    readCurrentPositivePrompt: () => "already composed",
    readMode: () => record("readMode", "txt2img"),
    readCandidateCount: () => record("readCandidateCount", 2),
    shouldRequestPrompt: () => false,
    readDerivationPayload: () => {
      record("readDerivationPayload");
      const value = derivation ? structuredClone(derivation) : {};
      derivation = null;
      return value;
    },
    readRuntimePayload: () => record("readRuntimePayload", { runtime: "reforge" }),
    readTitlePayload: () => record("readTitlePayload", { title: "title", titleMode: "manual" }),
    readPromptPayload: () => record("readPromptPayload", { prompt: "effective prompt", negativePrompt: "bad" }),
    readSelectedLoras: () => record("readSelectedLoras", [{ name: "detail", weight: 0.8 }]),
    readPromptBoosts: () => record("readPromptBoosts", ["quality"]),
    readInitImagePayload: () => record("readInitImagePayload", {}),
    readInpaintPayload: () => record("readInpaintPayload", {}),
    readIpAdapterPayload: () => record("readIpAdapterPayload", {}),
    readSettings: (values) => record("readSettings", { steps: 18, seed: 44, ...values }),
    runtimeForGeneration: (generation) => generation.runtime,
    runtimeSupportsHires: (sourceRuntime) => sourceRuntime?.id === "reforge",
    readRuntimePayloadFor: (sourceRuntime) => record("readRuntimePayloadFor", { runtime: sourceRuntime.id }),
    readCurrentHiresSettings: () => ({ hiresScale: 2, hiresSteps: 15, hiresDenoising: 0.3, hiresUpscaler: "Latent" }),
    readHiresUpscaler: () => "R-ESRGAN"
  };
  const owners = {
    startQueuePolling: () => record("startQueuePolling"),
    requestPrompt: async (description) => record("requestPrompt", description),
    getLastGeneration: () => overrides.lastGeneration ?? null,
    hasReference: () => overrides.hasReference ?? true,
    hasMask: () => overrides.hasMask ?? true,
    syncLorasFromPrompt: () => record("syncLorasFromPrompt"),
    applyIpMetadata: (value) => record("applyIpMetadata", value),
    applyGeneratedPrompt: (data, description) => record("applyGeneratedPrompt", { data, description }),
    setCandidates: (generation, images) => record("setCandidates", { generation, images }),
    loadHistory: async () => record("loadHistory"),
    getSelectedCandidate: () => overrides.selectedCandidate ?? null,
    presentFinal: (generation, image, labels) => record("presentFinal", { generation, image, labels })
  };
  const ui = {
    onStateChange: (state) => record("state", state),
    setJobProgress: (job) => record("setJobProgress", job),
    showJob: (id) => record("showJob", id),
    confirmRecovery: async (recovery) => record("confirmRecovery", recovery),
    onRecoveryAccepted: (recovery) => record("onRecoveryAccepted", recovery),
    hideJob: () => record("hideJob"),
    showError: (message) => record("showError", message),
    showEmpty: () => record("showEmpty"),
    presentBuiltPrompt: (data) => record("presentBuiltPrompt", data),
    clearError: () => record("clearError"),
    restoreMode: (mode) => record("restoreMode", mode),
    prepareCandidates: () => record("prepareCandidates"),
    setLoadingText: (message) => record("setLoadingText", message),
    setExplanation: (value) => record("setExplanation", value),
    showResults: () => record("showResults"),
    confirmGalleryHires: async (...args) => record("confirmGalleryHires", args),
    prepareGalleryHires: () => record("prepareGalleryHires"),
    setCancelDisabled: (value) => record("setCancelDisabled", value)
  };
  const transport = {
    postJson: async (url, body) => {
      record("postJson", { url, body: structuredClone(body) });
      return { job: { id: `job-${++nextJob}`, status: "queued" } };
    },
    getJson: async (url) => record("getJson", { url }) && { job: statuses.shift() ?? { status: "done", result: result() } },
    fetch: async (url, options) => {
      record("fetch", { url, options });
      return { ok: true, json: async () => ({ job: { status: "cancelling" } }) };
    }
  };
  const timing = {
    sleep: async () => record("sleep"),
    setTimeout: (callback, ms) => {
      record("setTimeout", ms);
      pendingTimers.push(callback);
    }
  };
  Object.assign(form, overrides.form);
  Object.assign(owners, overrides.owners);
  Object.assign(ui, overrides.ui);
  Object.assign(transport, overrides.transport);
  Object.assign(timing, overrides.timing);
  const controller = createGenerationController({ form, owners, ui, transport, timing });
  return { controller, calls, form, owners, ui, transport, pendingTimers, getDerivation: () => derivation };
}

const names = (calls) => calls.map(([name]) => name);

test("txt2img request preserves payload and the observable preparation/submit/result order", async () => {
  const f = fixture();
  await f.controller.generateCandidates();

  const posted = f.calls.find(([name]) => name === "postJson")[1];
  assert.equal(posted.url, "/api/jobs");
  assert.deepEqual(posted.body, {
    runtime: "reforge", mode: "txt2img", contentRating: "general", description: "a description",
    title: "title", titleMode: "manual", prompt: "effective prompt", negativePrompt: "bad",
    loras: [{ name: "detail", weight: 0.8 }], promptBoosts: ["quality"],
    settings: { steps: 18, seed: 44, candidateCount: 2, hiresEnabled: false }, autoRetry: true
  });
  const order = names(f.calls);
  const readerOrder = order.filter((name) => name.startsWith("read") && name !== "readDescription");
  assert.deepEqual(readerOrder, [
    "readMode", "readCandidateCount", "readMode", "readRuntimePayload", "readMode",
    "readContentRating", "readTitlePayload", "readPromptPayload", "readSelectedLoras",
    "readPromptBoosts", "readInitImagePayload", "readInpaintPayload", "readIpAdapterPayload",
    "readDerivationPayload", "readSettings", "readAutoRetry"
  ]);
  for (const [before, after] of [
    ["syncLorasFromPrompt", "prepareCandidates"], ["prepareCandidates", "readDerivationPayload"],
    ["readIpAdapterPayload", "readDerivationPayload"], ["readDerivationPayload", "readSettings"],
    ["readSettings", "postJson"], ["postJson", "showJob"], ["showJob", "startQueuePolling"],
    ["applyIpMetadata", "setCandidates"], ["setCandidates", "showResults"], ["showResults", "loadHistory"]
  ]) assert.ok(order.indexOf(before) < order.indexOf(after), `${before} must precede ${after}`);
  assert.deepEqual(f.controller.getState(), { activeJobId: null, busy: false });
  const terminalIndex = f.calls.findLastIndex(([name, value]) => name === "setJobProgress" && value?.status === "done");
  const disabledIndex = f.calls.findLastIndex(([name, value]) => name === "setCancelDisabled" && value === true);
  assert.ok(disabledIndex > terminalIndex, "terminal release must disable Cancel after observing the terminal job");
});

test("a throwing busy-state publication releases the reservation and permits a clean retry", async () => {
  let publicationCount = 0;
  const f = fixture({
    ui: {
      onStateChange: () => {
        publicationCount += 1;
        if (publicationCount === 1) throw new Error("render failed");
      }
    }
  });
  await f.controller.buildPrompt();
  assert.equal(f.controller.isBusy(), false);
  assert.equal(names(f.calls).filter((name) => name === "requestPrompt").length, 0);
  assert.equal(f.calls.find(([name]) => name === "showError")[1], "render failed");

  await f.controller.buildPrompt();
  assert.equal(names(f.calls).filter((name) => name === "requestPrompt").length, 1);
  assert.equal(f.controller.isBusy(), false);
});

test("app generation action rendering combines busy, runtime, and candidate-count gates", () => {
  const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const source = app.match(/function renderGenerateActions\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(source, "renderGenerateActions must remain directly extractable");

  function render({ busy = false, switching = false, runtime = { id: "reforge" }, selectable = true, validCount = true } = {}) {
    const elements = {
      generateProgress: { classList: { toggle: (_name, hidden) => { elements.progressHidden = hidden; } } },
      generateButton: { disabled: false },
      compareShortcutButton: { disabled: false },
      candidateCount: { value: validCount ? "2" : "0" }
    };
    const context = {
      generationController: { isBusy: () => busy },
      runtimeController: { getState: () => ({ switching, activeRuntime: runtime }) },
      isRuntimeSelectable: () => selectable,
      isValidCandidateCount: () => validCount,
      elements
    };
    vm.runInNewContext(`${source}; renderGenerateActions();`, context);
    return elements;
  }

  assert.equal(render().generateButton.disabled, false);
  for (const scenario of [
    { busy: true }, { switching: true }, { selectable: false }, { validCount: false }
  ]) assert.equal(render(scenario).generateButton.disabled, true);
  assert.equal(render({ runtime: null }).generateButton.disabled, false, "no active runtime keeps the legacy startup gate behavior");
  assert.equal(render({ busy: true }).compareShortcutButton.disabled, true);
  assert.equal(render({ switching: true }).compareShortcutButton.disabled, false);
  assert.equal(render({ busy: true }).progressHidden, false);
  assert.equal(render({ busy: false }).progressHidden, true);
});

test("img2img, inpaint, IP-Adapter, unsupported prevalidation, and multiple candidates keep their contracts", async (t) => {
  await t.test("img2img carries the reference payload", async () => {
    const f = fixture({ form: { readMode: () => "img2img", readInitImagePayload: () => ({ initImageId: "source-1" }) } });
    await f.controller.generateCandidates();
    assert.equal(f.calls.find(([n]) => n === "postJson")[1].body.initImageId, "source-1");
  });
  await t.test("inpaint carries source and mask", async () => {
    const f = fixture({ form: { readMode: () => "inpaint", readInitImagePayload: () => ({ initImageId: "source-1" }), readInpaintPayload: () => ({ maskDataUrl: "data:mask" }) } });
    await f.controller.generateCandidates();
    const body = f.calls.find(([n]) => n === "postJson")[1].body;
    assert.equal(body.mode, "inpaint"); assert.equal(body.maskDataUrl, "data:mask");
  });
  await t.test("enabled IP data is sent, while no-reference omission is empty", async () => {
    for (const ipAdapter of [{ ipAdapter: { referenceImageId: "ip-1", weight: 0.7 } }, {}]) {
      const f = fixture({ form: { readIpAdapterPayload: () => ipAdapter } });
      await f.controller.generateCandidates();
      assert.deepEqual(f.calls.find(([n]) => n === "postJson")[1].body.ipAdapter, ipAdapter.ipAdapter);
    }
  });
  await t.test("unsupported/missing source and mask stop before consuming or posting", async () => {
    for (const [mode, hasReference, hasMask] of [["img2img", false, true], ["inpaint", true, false]]) {
      const f = fixture({ derivation: { parentGenerationId: "parent" }, hasReference, hasMask, form: { readMode: () => mode } });
      await f.controller.generateCandidates();
      assert.ok(!names(f.calls).includes("postJson"));
      assert.ok(!names(f.calls).includes("readDerivationPayload"));
      assert.ok(f.getDerivation());
    }
  });
  await t.test("candidateCount is normalized once into settings", async () => {
    const f = fixture({ form: { readCandidateCount: () => "4" } });
    await f.controller.generateCandidates();
    assert.equal(f.calls.find(([n]) => n === "postJson")[1].body.settings.candidateCount, 4);
  });
});

test("one-shot derivation survives failures before consumption and is consumed at settings/POST boundary", async (t) => {
  const marker = { derivation: { type: "instruction", instruction: "smile" }, parentGenerationId: "parent-7" };
  await t.test("prompt preparation failure retains it", async () => {
    const f = fixture({ derivation: marker, form: { shouldRequestPrompt: () => true }, owners: { requestPrompt: async () => { throw new Error("prompt failed"); } } });
    await f.controller.generateCandidates();
    assert.deepEqual(f.getDerivation(), marker);
  });
  await t.test("IP payload build failure retains it", async () => {
    const f = fixture({ derivation: marker, form: { readIpAdapterPayload: () => { throw new Error("IP failed"); } } });
    await f.controller.generateCandidates();
    assert.deepEqual(f.getDerivation(), marker);
  });
  await t.test("settings failure consumes it", async () => {
    const f = fixture({ derivation: marker, form: { readSettings: () => { throw new Error("settings failed"); } } });
    await f.controller.generateCandidates();
    assert.equal(f.getDerivation(), null);
  });
  await t.test("POST failure consumes it", async () => {
    const f = fixture({ derivation: marker, transport: { postJson: async () => { throw new Error("POST failed"); } } });
    await f.controller.generateCandidates();
    assert.equal(f.getDerivation(), null);
  });
});

test("same-seed and duplicate metadata pass through the one-shot consume port exactly once", async () => {
  for (const marker of [
    { derivation: { type: "same-seed", instruction: "same seed" }, parentGenerationId: "generation-1" },
    { derivation: { type: "duplicate", instruction: "duplicate" }, parentGenerationId: "generation-2" }
  ]) {
    const f = fixture({ derivation: marker });
    await f.controller.generateCandidates();
    const body = f.calls.find(([name]) => name === "postJson")[1].body;
    assert.deepEqual(body.derivation, marker.derivation);
    assert.equal(body.parentGenerationId, marker.parentGenerationId);
    assert.equal(names(f.calls).filter((name) => name === "readDerivationPayload").length, 1);
    assert.equal(f.getDerivation(), null);
  }
});

test("prompt and POST await points reserve the shared lifecycle before any second action", async (t) => {
  await t.test("prompt build", async () => {
    const gate = deferred();
    const f = fixture({ owners: { requestPrompt: () => gate.promise } });
    const building = f.controller.buildPrompt();
    assert.equal(f.controller.isBusy(), true);
    await f.controller.generateCandidates();
    assert.equal(names(f.calls).filter((name) => name === "postJson").length, 0);
    assert.equal(names(f.calls).filter((name) => name === "readDerivationPayload").length, 0);
    gate.resolve({ explanation_ja: "built" });
    await building;
    assert.deepEqual(f.calls.find(([name]) => name === "presentBuiltPrompt")[1], { explanation_ja: "built" });
  });
  await t.test("job POST", async () => {
    const gate = deferred();
    let postCount = 0;
    const f = fixture({ transport: { postJson: () => { postCount += 1; return gate.promise; } } });
    const first = f.controller.generateCandidates();
    await Promise.resolve();
    await f.controller.generateCandidates();
    assert.equal(postCount, 1);
    assert.equal(names(f.calls).filter((name) => name === "readDerivationPayload").length, 1);
    gate.resolve({ job: { id: "post-gated", status: "queued" } });
    await first;
  });
});

test("recovery is offered once and accepted retry reuses the exact request except settings and retry metadata", async () => {
  const recovery = { kind: "oom", label: "VRAM不足", changes: [], settings: { steps: 9, candidateCount: 1 } };
  const f = fixture({
    derivation: { derivation: { type: "same-seed", instruction: "again" }, parentGenerationId: "parent-2" },
    statuses: [{ status: "failed", error: "first", recovery }, { status: "failed", error: "second", recovery }],
    form: { readInitImagePayload: () => ({ initImageId: "ref-1" }), readIpAdapterPayload: () => ({ ipAdapter: { referenceImageId: "ip-1" } }) },
    ui: { confirmRecovery: async () => true }
  });
  await f.controller.generateCandidates();
  const posts = f.calls.filter(([name]) => name === "postJson").map(([, value]) => value.body);
  assert.equal(posts.length, 2);
  const { settings: firstSettings, autoRetry: _firstAuto, ...firstStable } = posts[0];
  const { settings: secondSettings, retryInfo, autoRetry: _secondAuto, ...secondStable } = posts[1];
  assert.deepEqual(secondStable, firstStable);
  assert.deepEqual(secondSettings, { ...firstSettings, steps: 9, candidateCount: 1 });
  assert.deepEqual(retryInfo.originalSettings, firstSettings);
  assert.deepEqual(retryInfo.retrySettings, recovery.settings);
  assert.equal(retryInfo.retryCount, 1);
  assert.equal(posts[1].parentGenerationId, "parent-2");
  assert.equal(posts[1].settings.seed, 44);
  assert.equal(names(f.calls).filter((name) => name === "onRecoveryAccepted").length, 1);
  assert.match(f.calls.findLast(([name]) => name === "showError")[1], /second/);
});

test("declined recovery does not repost", async () => {
  let confirmationCount = 0;
  const f = fixture({
    statuses: [{ status: "failed", error: "declined", recovery: { kind: "oom", settings: { steps: 8 } } }],
    ui: { confirmRecovery: async () => { confirmationCount += 1; return false; } }
  });
  await f.controller.generateCandidates();
  assert.equal(confirmationCount, 1);
  assert.equal(names(f.calls).filter((name) => name === "postJson").length, 1);
  assert.equal(f.calls.findLast(([name]) => name === "showError")[1], "declined");
});

test("busy reservation rejects overlapping generation, prompt build, finish, and gallery modal work", async () => {
  const gate = deferred();
  const source = { runtime: { id: "reforge", label: "ReForge" }, mode: "txt2img", prompt: "p", negativePrompt: "n", settings: {}, loras: [] };
  const selected = { id: "selected", seed: 1 };
  const f = fixture({
    derivation: { derivation: { type: "duplicate", instruction: "copy" }, parentGenerationId: "parent-busy" },
    lastGeneration: source, selectedCandidate: selected,
    ui: { confirmGalleryHires: () => gate.promise }
  });
  const gallery = f.controller.hiresFromGallery(source, selected);
  assert.equal(f.controller.isBusy(), true);
  await f.controller.generateCandidates();
  await f.controller.buildPrompt();
  await f.controller.finishSelected();
  assert.equal(names(f.calls).filter((name) => name === "showError").length, 3);
  assert.equal(names(f.calls).filter((name) => name === "postJson").length, 0);
  assert.ok(f.getDerivation(), "rejected overlapping work must not consume the pending derivation");
  gate.resolve(false);
  await gallery;
  assert.equal(f.controller.isBusy(), false);
});

test("cancel targets the active backend job and a stale delayed cancel response cannot update its successor", async () => {
  const firstPoll = deferred();
  const cancelResponse = deferred();
  let postCount = 0;
  const deletes = [];
  const f = fixture({
    transport: {
      postJson: async (_url, body) => ({ job: { id: `job-${++postCount}`, body } }),
      getJson: async () => firstPoll.promise,
      fetch: async (url, options) => {
        deletes.push({ url, options });
        return { ok: true, json: () => cancelResponse.promise };
      }
    }
  });
  const generating = f.controller.generateCandidates();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(f.controller.getState().activeJobId, "job-1");
  const cancelling = f.controller.cancel();
  assert.deepEqual(deletes, [{ url: "/api/jobs/job-1", options: { method: "DELETE" } }]);
  firstPoll.resolve({ job: { status: "cancelled" } });
  await generating;
  const successorPoll = deferred();
  f.transport.getJson = async () => successorPoll.promise;
  const successor = f.controller.generateCandidates();
  await Promise.resolve(); await Promise.resolve();
  cancelResponse.resolve({ job: { status: "cancelling" } });
  await cancelling;
  assert.equal(f.controller.getState().activeJobId, "job-2");
  const cancellingUpdates = f.calls.filter(([name, value]) => name === "setJobProgress" && value?.status === "cancelling");
  assert.equal(cancellingUpdates.length, 0);
  successorPoll.resolve({ job: { status: "done", result: result() } });
  await successor;
});

test("stale hide timer cannot hide a newer terminal job early", async () => {
  const f = fixture();
  await f.controller.generateCandidates();
  assert.equal(f.pendingTimers.length, 1);
  const secondPoll = deferred();
  f.transport.getJson = async () => secondPoll.promise;
  const second = f.controller.generateCandidates();
  await Promise.resolve(); await Promise.resolve();
  secondPoll.resolve({ job: { status: "done", result: result() } });
  await second;
  assert.equal(f.pendingTimers.length, 2);
  f.pendingTimers[0]();
  assert.equal(names(f.calls).filter((name) => name === "hideJob").length, 0, "old timer must not hide job-2's terminal bar");
  f.pendingTimers[1]();
  assert.equal(names(f.calls).filter((name) => name === "hideJob").length, 1);
});

test("cancelled Gallery preparation retires the previous job bar after superseding its timer", async () => {
  const f = fixture({ ui: { confirmGalleryHires: async () => false } });
  await f.controller.generateCandidates();
  await f.controller.hiresFromGallery({ runtime: { id: "reforge" } }, { id: "image", seed: 1 });
  assert.equal(f.pendingTimers.length, 2);
  f.pendingTimers[0]();
  assert.equal(names(f.calls).filter((name) => name === "hideJob").length, 0);
  f.pendingTimers[1]();
  assert.equal(names(f.calls).filter((name) => name === "hideJob").length, 1);
  assert.equal(f.controller.isBusy(), false);
});

test("finish and gallery Hires bind payloads to the source runtime and source image semantics", async (t) => {
  const runtime = { id: "reforge", label: "ReForge" };
  const selected = { id: "candidate-9", seed: 909 };
  await t.test("selected inpaint refine retains its mode and selected image as parent/init", async () => {
    const source = { runtime, mode: "inpaint", contentRating: "nsfw", description: "edit", prompt: "p", negativePrompt: "n", structuredPrompt: { subject: "x" }, rawPromptOverride: true, rawPrompt: "p", appliedTriggerWords: ["x"], settings: { steps: 20 }, loras: [] };
    const f = fixture({ lastGeneration: source, selectedCandidate: selected });
    await f.controller.finishSelected();
    const body = f.calls.find(([name]) => name === "postJson")[1].body;
    assert.equal(body.runtime, "reforge"); assert.equal(body.mode, "inpaint");
    assert.equal(body.parentImageId, selected.id); assert.equal(body.initImageId, selected.id);
    assert.equal(body.settings.seed, selected.seed); assert.equal(body.settings.hiresEnabled, true);
    assert.equal(f.calls.find(([name]) => name === "presentFinal")[1].labels.eyebrow, "INPAINT REFINE COMPLETE");
  });
  await t.test("gallery uses fixed safe Hires values, stored upscaler/IP, and gallery image as parent/init", async () => {
    const source = { runtime, mode: "txt2img", contentRating: "nsfw", description: "gallery", prompt: "p", negativePrompt: "n", settings: { steps: 30, hiresUpscaler: "Stored" }, loras: [], ipAdapter: { referenceImageId: "historic-ip" } };
    const f = fixture({ ui: { confirmGalleryHires: async () => true } });
    await f.controller.hiresFromGallery(source, selected);
    const body = f.calls.find(([name]) => name === "postJson")[1].body;
    assert.deepEqual([body.settings.hiresScale, body.settings.hiresSteps, body.settings.hiresDenoising], [1.5, 12, 0.28]);
    assert.equal(body.settings.hiresUpscaler, "Stored");
    assert.equal(body.mode, "img2img"); assert.equal(body.parentImageId, selected.id); assert.equal(body.initImageId, selected.id);
    assert.deepEqual(body.ipAdapter, source.ipAdapter);
  });
  await t.test("unsupported source runtime is rejected before modal or POST", async () => {
    const source = { runtime: { id: "forge-neo-anima", label: "Neo" }, settings: {} };
    const f = fixture();
    await f.controller.hiresFromGallery(source, selected);
    assert.ok(!names(f.calls).includes("confirmGalleryHires")); assert.ok(!names(f.calls).includes("postJson"));
    assert.match(f.calls.find(([name]) => name === "showError")[1], /Neo/);
  });
});
