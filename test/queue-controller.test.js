import test from "node:test";
import assert from "node:assert/strict";
import { createQueueController } from "../public/features/queue-controller.js";

class Element {
  constructor() {
    this.children = []; this.listeners = new Map(); this.dataset = {}; this.isConnected = true;
    this.classList = { values: new Set(), add: (x) => this.classList.values.add(x),
      toggle: (x, on) => on ? this.classList.values.add(x) : this.classList.values.delete(x) };
  }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  removeEventListener(type, fn) { if (this.listeners.get(type) === fn) this.listeners.delete(type); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
}
globalThis.document = { createElement: () => new Element() };

const snap = (entries = [], activeCount = 0) => ({
  generation: entries.filter((x) => x.type !== "comparison"),
  comparison: entries.filter((x) => x.type === "comparison"), summary: { activeCount }
});

function fixture() {
  const calls = { gets: 0, post: [], del: [], sleep: [], toast: [], history: 0, experiments: 0, result: [] };
  const responses = [];
  const indicator = new Element(); const text = new Element();
  let gallery = false; let body;
  const controller = createQueueController({
    elements: { queueIndicator: indicator, queueIndicatorText: text },
    getJson: async () => { calls.gets++; const x = responses.shift(); if (x instanceof Error) throw x; return x ?? snap(); },
    postJson: async (...args) => calls.post.push(args), deleteJson: async (...args) => calls.del.push(args),
    toast: Object.fromEntries(["info", "warning", "error", "success"].map((level) => [level, (...args) => calls.toast.push([level, ...args])])),
    openModal: ({ build }) => { body = new Element(); build(body); return { close() {}, promise: new Promise(() => {}) }; },
    loadHistory: async () => { calls.history++; }, loadExperiments: async () => { calls.experiments++; },
    openComparisonResult: (id) => calls.result.push(id), isGalleryVisible: () => gallery,
    sleep: (ms) => new Promise((resolve) => calls.sleep.push({ ms, resolve }))
  });
  return { controller, calls, responses, indicator, text, setGallery: (x) => { gallery = x; }, getBody: () => body };
}
async function waitFor(fn) {
  for (let i = 0; i < 30 && !fn(); i++) await new Promise((r) => setImmediate(r));
  assert.ok(fn());
}
function buttons(root) {
  const found = [];
  const walk = (node) => { if (node?.listeners?.has("click")) found.push(node); for (const child of node?.children ?? []) walk(child); };
  walk(root); return found;
}

test("init and dispose own only one indicator listener", () => {
  const f = fixture(); f.controller.init(); f.controller.init(); assert.equal(f.indicator.listeners.size, 1);
  f.controller.dispose(); f.controller.dispose(); assert.equal(f.indicator.listeners.size, 0);
});

test("failed refresh retains the rendered snapshot", async () => {
  const f = fixture(); f.responses.push(snap([{ type: "generation", id: "g", status: "running", progress: 42 }], 1));
  await f.controller.refresh(); assert.equal(f.text.textContent, "生成中 42%");
  f.responses.push(new Error("offline")); assert.equal(await f.controller.refresh(), null); assert.equal(f.text.textContent, "生成中 42%");
});

test("polling consumes eight failed idle ticks at 1200ms", async () => {
  const f = fixture(); f.responses.push(...Array.from({ length: 8 }, () => new Error("offline"))); f.controller.startPolling();
  for (let i = 0; i < 8; i++) { await waitFor(() => f.calls.sleep.length > i); assert.equal(f.calls.sleep[i].ms, 1200); f.calls.sleep[i].resolve(); }
  await waitFor(() => f.indicator.classList.values.has("hidden")); assert.equal(f.calls.gets, 8);
});

test("an open panel keeps idle polling alive", async () => {
  const f = fixture();
  f.controller.openPanel();
  for (let i = 0; i < 9; i++) {
    await waitFor(() => f.calls.sleep.length > i);
    f.calls.sleep[i].resolve();
  }
  await waitFor(() => f.calls.gets >= 10);
  assert.ok(f.calls.gets >= 10, "polling continues beyond eight idle snapshots while the panel is open");
});

test("terminal keys notify once until disappearance and generation toast is gallery-only", async () => {
  const f = fixture(); const done = { type: "generation", id: "g", status: "done" };
  f.responses.push(snap([done]), snap(), snap([done]), snap([done]), snap(), snap([done]));
  await f.controller.refresh(); await f.controller.refresh(); await f.controller.refresh(); await f.controller.refresh();
  assert.equal(f.calls.history, 1); assert.equal(f.calls.toast.length, 0);
  await f.controller.refresh(); f.setGallery(true); await f.controller.refresh();
  assert.equal(f.calls.history, 2); assert.equal(f.calls.toast.at(-1)[1], "生成が完了しました");
});

test("failure and cancellation do not refresh history", async () => {
  const f = fixture(); f.responses.push(snap(), snap([{ type: "generation", id: "f", status: "failed", errorMessage: "boom\nprivate" }]), snap(), snap([{ type: "comparison", id: "c", status: "cancelled" }]));
  for (let i = 0; i < 4; i++) await f.controller.refresh();
  assert.equal(f.calls.history, 0); assert.deepEqual(f.calls.toast, [["error", "生成に失敗しました: boom"]]);
});

test("comparison completion refreshes history and keeps the result action", async () => {
  const f = fixture();
  const done = { type: "comparison", id: "c", status: "completed", completedCases: 2, totalCases: 2 };
  f.responses.push(snap(), snap([done]));
  await f.controller.refresh(); await f.controller.refresh();
  assert.equal(f.calls.history, 1);
  f.calls.toast[0][2].action.onSelect();
  assert.deepEqual(f.calls.result, ["c"]);
});

test("panel actions preserve cancel endpoints and comparison refresh", async () => {
  const f = fixture(); f.responses.push(snap([{ type: "generation", id: "g", status: "running" }, { type: "comparison", id: "c", status: "running" }], 2));
  await f.controller.refresh(); f.controller.openPanel();
  const [cancelGeneration, cancelComparison] = buttons(f.getBody());
  await cancelGeneration.listeners.get("click")(); await cancelComparison.listeners.get("click")();
  await waitFor(() => f.calls.experiments === 1);
  assert.deepEqual(f.calls.del, [["/api/jobs/g"]]);
  assert.equal(JSON.stringify(f.calls.post), JSON.stringify([["/api/experiments/c/cancel", {}]]));
  assert.equal(f.calls.gets, 4);
});
