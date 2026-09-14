import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { createStudioDevServer } from "../dev/studio/server.mjs";
import { createPreviewTransport } from "../dev/studio/fixture-transport.js";
import { createGenerateWorkspace } from "../public/features/generate-workspace.js";
import { reduceShellState } from "../public/frontend/app/shell-state.js";

test("shell navigation, inspector and five Canvas states remain independent", () => {
  let state = { view: "studio", canvas: "image", inspector: false };
  state = reduceShellState(state, { type: "inspector", open: true });
  state = reduceShellState(state, { type: "navigate", view: "library" });
  for (const value of ["empty", "ready", "image", "generating", "error"]) {
    state = reduceShellState(state, { type: "canvas", state: value });
    assert.deepEqual(state, { view: "library", canvas: value, inspector: true });
  }
  assert.throws(() => reduceShellState(state, { type: "canvas", state: "unknown" }), /Unknown/);
  assert.throws(() => reduceShellState(state, { type: "navigate", view: "legacy" }), /Unknown/);
});

test("development entry is separate, root is byte-identical to production, APIs cannot write", async (t) => {
  const server = createStudioDevServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(await (await fetch(base)).text(), await readFile("public/index.html", "utf8"));
  const entry = await (await fetch(`${base}/studio-next/`)).text();
  assert.match(entry, /\/frontend\/styles\/shell.css/);
  assert.doesNotMatch(entry, /\/app\.js|href="\/style\.css"|iframe/);
  assert.equal((await fetch(`${base}/__studio-dev__/server.mjs`)).status, 404);
  assert.equal((await fetch(`${base}/api/jobs`, { method: "POST", body: "{}" })).status, 405);
  assert.equal((await fetch(`${base}/..%2F..%2Fpackage.json`)).status, 404);
  assert.equal((await fetch(`${base}/%FF`)).status, 400);
});

test("preview initializes actual R1 owner and receives subscription updates without backend submission", async (t) => {
  const transport = createPreviewTransport();
  const workspace = createGenerateWorkspace({ transport, storage: { getItem: () => null, setItem() {}, removeItem() {} } });
  t.after(() => workspace.dispose());
  const updates = [];
  const unsubscribe = workspace.subscribe((value) => updates.push(value));
  assert.equal(await workspace.initialize(), true);
  workspace.setPrompt({ positive: "a new study" });
  workspace.addLora("Soft light", 0.65);
  assert.equal(updates.at(-1).prompt.prompt, "a new study");
  assert.equal(updates.at(-1).loras[0].weight, 0.65);
  assert.equal(workspace.getSnapshot().runtime.selectedCheckpoint.modelName, "Anima Studio");
  const before = updates.length;
  unsubscribe(); workspace.setPrompt({ positive: "after unsubscribe" });
  assert.equal(updates.length, before);
  await assert.rejects(transport.postJson("/api/jobs", {}), /never submits/);
});

test("shell dependency graph never imports legacy views or legacy styles", async () => {
  const visited = new Set();
  async function visit(url) {
    if (visited.has(url.href)) return;
    visited.add(url.href);
    const source = await readFile(url, "utf8");
    assert.doesNotMatch(source, /from\s+["'][^"']*(?:ui-kit|runtime-controller|history-controller|app)\.js["']/);
    for (const match of source.matchAll(/from\s+["'](\.[^"']+)["']/g)) await visit(new URL(match[1], url));
  }
  await visit(new URL("../public/frontend/app/app-shell.js", import.meta.url));
  assert.ok(visited.size >= 8);
  const styleRoot = new URL("../public/frontend/styles/", import.meta.url);
  const styles = new Set();
  async function visitStyle(url) {
    assert.ok(url.href.startsWith(styleRoot.href), "Studio styles must stay within its independent design system");
    if (styles.has(url.href)) return;
    styles.add(url.href);
    const css = await readFile(url, "utf8");
    for (const match of css.matchAll(/@import\s+["']([^"']+)["']/g)) await visitStyle(new URL(match[1], url));
  }
  await visitStyle(new URL("shell.css", styleRoot));
});
