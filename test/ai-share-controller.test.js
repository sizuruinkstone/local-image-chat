import assert from "node:assert/strict";
import test from "node:test";
import { createAiShare } from "../public/features/ai-share.js";

const NAMES = ["copyGrokShareButton", "updateShareCsvButton", "shareBarStatus", "grokInstructions", "grokSetupDoc",
  "grokLoraCsv", "copyGrokTemplateButton", "saveGrokTemplateButton", "generateLoraCsvButton", "resetGrokInstructionsButton", "grokTemplateStatus"];
class Node {
  constructor() { this.value = ""; this.textContent = ""; this.title = ""; this.listeners = new Map(); }
  addEventListener(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== fn)); }
  listenerCount(type) { return this.listeners.get(type)?.length ?? 0; }
}

function make(overrides = {}) {
  const elements = Object.fromEntries(NAMES.map((name) => [name, new Node()]));
  const calls = { get: [], post: [], patch: [], order: [], toast: [], timers: [], clears: [], warnings: [], modals: [] };
  let triggerWords = { A: "old" };
  const dependencies = {
    elements,
    document: { createElement: () => ({ className: "", textContent: "" }) },
    getJson: async (url) => { calls.get.push(url); if (overrides.getError) throw overrides.getError; return overrides.getResult; },
    postJson: async (url, body) => { calls.post.push([url, body]); calls.order.push("post"); if (overrides.postError) throw overrides.postError; return overrides.postResult; },
    patchJson: async (url, body) => { calls.patch.push([url, body]); calls.order.push("patch"); if (overrides.patchError) throw overrides.patchError; return overrides.patchResult; },
    withBusy: async (_button, label, action) => { calls.order.push(`busy:${label}`); return action(); },
    copyToClipboard: async () => { calls.order.push("copy"); if (overrides.copyError) throw overrides.copyError; },
    flashLabel: () => calls.order.push("flash"),
    toast: Object.fromEntries(["success", "error", "warning", "info"].map((kind) => [kind, (message, options) => { calls.toast.push([kind, message, options]); calls.order.push(`toast:${kind}`); }])),
    openModal: (options) => calls.modals.push(options),
    confirmModal: async () => overrides.confirmed ?? false,
    formatDate: (value) => `DATE(${value})`,
    getManualTriggerWords: () => ({ ...triggerWords }),
    nowIso: () => "NOW",
    setTimer: (fn, delay) => { const id = calls.timers.length + 1; calls.timers.push({ id, fn, delay }); return id; },
    clearTimer: (id) => calls.clears.push(id),
    warn: (message) => calls.warnings.push(message)
  };
  return { elements, calls, controller: createAiShare(dependencies), setTriggerWords: (value) => { triggerWords = value; } };
}

const csv = { csv: "new,csv", rowCount: 2, triggerWordCount: 1, generatedAt: "g", path: "p" };

test("debounce cancels the prior timer and reads latest manual Trigger Words when request fires", async () => {
  const f = make({ postResult: csv });
  f.controller.scheduleShareCsvSync(); f.setTriggerWords({ A: "latest" }); f.controller.scheduleShareCsvSync();
  assert.deepEqual(f.calls.timers.map(({ delay }) => delay), [1500, 1500]);
  assert.deepEqual(f.calls.clears, [null, 1]);
  await f.controller.syncShareCsvQuietly();
  assert.deepEqual(f.calls.post, [["/api/ai-share/csv", { triggerWords: { A: "latest" } }]]);
  assert.deepEqual(f.calls.clears, [null, 1, 2]);
});

test("quiet sync failure only warns and does not retry", async () => {
  const f = make({ postError: new Error("offline") });
  f.controller.scheduleShareCsvSync(); await f.controller.syncShareCsvQuietly();
  assert.deepEqual(f.calls.warnings, ["[AI共有] CSVの自動更新に失敗しました: offline"]);
  assert.equal(f.calls.post.length, 1); assert.equal(f.calls.toast.length, 0); assert.equal(f.calls.timers.length, 1);
});

test("CSV update patches template only for changed CSV and ignores patch failure", async () => {
  const changed = make({ postResult: csv, patchError: new Error("best effort") }); changed.elements.grokLoraCsv.value = "old";
  await changed.controller.updateShareCsv();
  assert.deepEqual(changed.calls.order, ["busy:更新中…", "post", "patch", "toast:success"]);
  assert.equal(changed.elements.grokLoraCsv.value, "new,csv");
  const same = make({ postResult: csv }); same.elements.grokLoraCsv.value = "new,csv"; await same.controller.updateShareCsv();
  assert.equal(same.calls.patch.length, 0);
});

test("template load/save preserves fields and clipboard completes before silent save", async () => {
  const template = { instructions: "i", setupDoc: "s", loraCsv: "c", updatedAt: "u", loraCsvUpdatedAt: "l" };
  const f = make({ getResult: { template }, patchResult: { template } });
  await f.controller.loadPromptTemplate();
  assert.deepEqual([f.elements.grokInstructions.value, f.elements.grokSetupDoc.value, f.elements.grokLoraCsv.value], ["i", "s", "c"]);
  f.calls.order.length = 0; await f.controller.copyGrokTemplate();
  assert.deepEqual(f.calls.order.slice(0, 3), ["copy", "flash", "patch"]);
  assert.deepEqual(f.calls.patch[0], ["/api/prompt-template", { instructions: "i", setupDoc: "s", loraCsv: "c" }]);
});

test("reset cancellation leaves instructions unchanged and sends no request", async () => {
  const f = make({ confirmed: false }); f.elements.grokInstructions.value = "keep";
  await f.controller.resetGrokInstructions();
  assert.equal(f.elements.grokInstructions.value, "keep"); assert.equal(f.calls.patch.length, 0);
});

test("share copy keeps request, clipboard, label, status, and preview action order", async () => {
  const f = make({ postResult: { markdown: "md", rowCount: 3, triggerWordCount: 2, path: "p" } });
  await f.controller.copyGrokShare();
  assert.deepEqual(f.calls.order, ["busy:作成中…", "post", "copy", "flash", "toast:success"]);
  assert.match(f.elements.shareBarStatus.textContent, /DATE\(NOW\)/);
  f.calls.toast[0][2].action.onSelect(); const body = { children: [], append(node) { this.children.push(node); } };
  f.calls.modals[0].build(body); assert.equal(body.children[0].textContent, "md");
});

test("controller owns exactly six listeners, reinitializes safely, and dispose cancels pending sync", () => {
  const f = make(); f.controller.init(); f.controller.init();
  for (const name of ["copyGrokShareButton", "updateShareCsvButton", "copyGrokTemplateButton", "saveGrokTemplateButton", "generateLoraCsvButton", "resetGrokInstructionsButton"]) {
    assert.equal(f.elements[name].listenerCount("click"), 1);
  }
  f.controller.scheduleShareCsvSync(); f.controller.dispose();
  for (const name of ["copyGrokShareButton", "updateShareCsvButton", "copyGrokTemplateButton", "saveGrokTemplateButton", "generateLoraCsvButton", "resetGrokInstructionsButton"]) {
    assert.equal(f.elements[name].listenerCount("click"), 0);
  }
  assert.deepEqual(f.calls.clears, [null, 1]);
});
