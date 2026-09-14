import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createStudioDevServer } from "./server.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.LIC_PLAYWRIGHT_MODULE || path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const output = path.resolve("workbench/r2");
await mkdir(output, { recursive: true });
const server = createStudioDevServer();
server.listen(0, "127.0.0.1");
await once(server, "listening");
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const errors = [], failures = [], external = [], requests = [], measurements = [];
try {
  browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext();
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin || ["blob:", "data:"].includes(url.protocol)) return route.continue();
    external.push(url.href); return route.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  page.on("response", (response) => { if (response.status() >= 400) failures.push(response.url()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/studio-next/?fixture=r2`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector(".lora-summary").title.includes("0.65"));
  assert.equal(await page.locator(".prompt-context").textContent().then((text) => text.includes("Anima Studio")), true);
  const statePicker = page.getByRole("combobox", { name: "Canvas preview state" });
  async function overflow(label) {
    const result = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, height: innerHeight, scrollHeight: document.documentElement.scrollHeight,
      canvas: (() => { const r = document.querySelector(".canvas-stage").getBoundingClientRect(); return { width: r.width, height: r.height }; })(),
      dock: document.querySelector(".prompt-dock").getBoundingClientRect().height }));
    assert.ok(result.scrollWidth <= result.width + 1, `${label} horizontal overflow: ${JSON.stringify(result)}`);
    assert.ok(result.scrollHeight <= result.height + 1, `${label} vertical page overflow: ${JSON.stringify(result)}`);
    measurements.push({ label, ...result });
  }
  for (const [width, height] of [[1280, 900], [1440, 900], [1920, 1080], [390, 844], [430, 932]]) {
    await page.setViewportSize({ width, height });
    await statePicker.selectOption("image");
    await overflow(`${width}-image`);
    assert.ok((await page.locator(".canvas-stage").boundingBox()).height > 300);
    await page.screenshot({ animations: "disabled", path: path.join(output, `studio-${width}.png`) });
    if(page.viewportSize().width<=900) await page.getByRole("button", { name: "制作設定", exact: true }).click();
    await page.locator(".inspector-panel").waitFor();
    await overflow(`${width}-inspector`);
    if ([1440, 390].includes(width)) await page.screenshot({ animations: "disabled", path: path.join(output, `inspector-${width}.png`) });
    if (width < 600) {
      await page.keyboard.press("Tab");
      assert.equal(await page.locator(".inspector-panel").evaluate((node) => node.contains(document.activeElement)), true);
    }
    await page.keyboard.press("Escape");
    if(width<=900) assert.equal(await page.getByRole("button", { name: "制作設定", exact: true }).getAttribute("aria-expanded"), "false");
    await page.getByRole("button", { name: "Library", exact: true }).click();
    await overflow(`${width}-library`);
    if ([1440, 430].includes(width)) await page.screenshot({ animations: "disabled", path: path.join(output, `library-${width}.png`) });
    await page.getByRole("button", { name: "Open demo study: Light, held in form", exact: true }).click();
    for (const state of ["empty", "ready", "generating", "error"]) {
      await statePicker.selectOption(state);
      assert.equal(await page.locator(".canvas-stage").getAttribute("data-state"), state);
      if (["empty", "ready"].includes(state)) assert.equal(await page.locator(".canvas-state-panel").isVisible(), true);
      if (state === "generating") assert.equal(await page.locator(".canvas-progress").isVisible(), true);
      if (state === "error") assert.equal(await page.locator(".canvas-error").isVisible(), true);
      await overflow(`${width}-${state}`);
      if (width === 1440) await page.screenshot({ animations: "disabled", path: path.join(output, `canvas-${state}-1440.png`) });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await statePicker.selectOption("image");
  await page.getByRole("button", { name: "Structured · 編集", exact: true }).click();
  await page.getByRole("textbox", { name: "キャラクター", exact: true }).fill("R2 subscription draft — 日差しと静かな空間");
  assert.ok((await page.getByRole("textbox", { name: "Final Positive Prompt", exact: true }).inputValue()).includes("日差し"));
  await page.getByRole("button", { name: "Canvasへ戻る", exact: true }).click();
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await page.getByRole("button", { name: "Studio", exact: true }).click();
  await page.getByRole("button", { name: "Structured · 編集", exact: true }).click();
  assert.equal(await page.getByRole("textbox", { name: "キャラクター", exact: true }).inputValue(), "R2 subscription draft — 日差しと静かな空間");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Preview generation", exact: true }).click();
  assert.equal(await page.locator(".canvas-stage").getAttribute("data-state"), "generating");
  await page.waitForFunction(() => document.querySelector(".canvas-stage").dataset.state === "image");
  if(page.viewportSize().width<=900) await page.getByRole("button", { name: "制作設定", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  if(await page.locator(".inspector-trigger").getAttribute("aria-expanded")!=="true") await page.getByRole("button", { name: "制作設定", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".inspector-panel").getAttribute("aria-modal") === "true");
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForFunction(() => !document.querySelector(".inspector-panel").hasAttribute("aria-modal"));
  await page.keyboard.press("Escape");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await statePicker.selectOption("generating");
  assert.equal(await page.locator(".progress-orbit").evaluate((node) => getComputedStyle(node).animationName), "none");
  // Primary prompt workflow: every schema section, both modes, Negative and final preview.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await statePicker.selectOption("image");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Structured · 編集", exact: true }).click();
  const sectionLabels = ["キャラクター", "容姿・衣装", "ポーズ・構図", "シチュエーション・背景", "画風・品質", "追加プロンプト"];
  const sectionValues = ["a sculptural arch, a terracotta sphere", "warm ivory, matte ceramic", "balanced composition, eye level", "quiet space, afternoon light", "minimal still life, fine texture", "soft shadows"];
  for (let i = 0; i < sectionLabels.length; i++) await page.getByRole("textbox", { name: sectionLabels[i], exact: true }).fill(sectionValues[i]);
  await page.getByRole("textbox", { name: "Negative Prompt", exact: true }).fill("text, watermark, blur");
  const finalPositive = page.getByRole("textbox", { name: "Final Positive Prompt", exact: true });
  const structuredFinal = await finalPositive.inputValue();
  for (const value of sectionValues) assert.ok(structuredFinal.includes(value));
  assert.equal(await page.getByRole("textbox", { name: "Final Negative Prompt", exact: true }).inputValue(), "text, watermark, blur");
  await page.screenshot({ animations: "disabled", path: path.join(output, "prompt-workspace-1440.png") });
  await page.getByRole("button", { name: "Raw", exact: true }).click();
  assert.equal(await page.getByRole("textbox", { name: "Raw Prompt", exact: true }).inputValue(), structuredFinal);
  await page.getByRole("textbox", { name: "Raw Prompt", exact: true }).fill("a quiet sculpture, warm ivory, (soft light:1.1)");
  assert.equal(await finalPositive.inputValue(), "a quiet sculpture, warm ivory, (soft light:1.1)");
  await page.screenshot({ animations: "disabled", path: path.join(output, "prompt-raw-1440.png") });
  await page.getByRole("button", { name: "Structured", exact: true }).click();
  assert.equal(await finalPositive.inputValue(), structuredFinal);
  await page.getByRole("button", { name: "Raw", exact: true }).click();
  assert.equal(await finalPositive.inputValue(), "a quiet sculpture, warm ivory, (soft light:1.1)");
  await page.getByRole("button", { name: "Structured", exact: true }).click();
  for (const [width, height] of [[1440, 900], [1920, 1080], [390, 844], [430, 932]]) {
    await page.setViewportSize({ width, height });
    await page.locator(".prompt-workspace").evaluate((node) => { node.scrollTop = 0; });
    assert.equal(await page.locator(".prompt-workspace").evaluate((node) => node.scrollWidth <= node.clientWidth), true);
    await page.screenshot({ animations: "disabled", path: path.join(output, `prompt-workspace-${width}.png`) });
    if (width < 600) {
      await finalPositive.scrollIntoViewIfNeeded();
      await page.screenshot({ animations: "disabled", path: path.join(output, `prompt-preview-${width}.png`) });
    }
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".prompt-workspace").evaluate((node) => node.open), false);
    await overflow(`${width}-structured-dock`);
    await page.screenshot({ animations: "disabled", path: path.join(output, `prompt-dock-${width}.png`) });
    await page.getByRole("button", { name: /^(Structured|Raw) · 編集$/, exact: true }).click();
    await page.getByRole("textbox", { name: "Negative Prompt", exact: true }).focus();
    assert.equal(await page.getByRole("textbox", { name: "Negative Prompt", exact: true }).evaluate((node) => node === document.activeElement), true);
  }
  await page.keyboard.press("Escape");
  assert.deepEqual(errors, []); assert.deepEqual(failures, []); assert.deepEqual(external, []);
  assert.equal(requests.includes("/app.js"), false);
  assert.equal(requests.includes("/style.css"), false);
  assert.equal(requests.some((url) => url.startsWith("/api/")), false);
  const report = { result: "PASS", browser: await browser.version(), errors, failures, external,
    noLegacyAssets: true, noBackendRequests: true, measurements };
  await writeFile(path.join(output, "browser-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ result: report.result, viewports: [1280, 1440, 1920, 390, 430], canvasStates: 5, errors, failures, external, screenshots: output }));
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
