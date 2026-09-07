import test from "node:test";
import assert from "node:assert/strict";
import { createGenerateWorkspace } from "../public/features/generate-workspace.js";
import { createRuntimeService } from "../public/core/runtime-service.js";
import { createGenerationDraft } from "../public/features/generation-draft.js";
import { recipeParameterPatch } from "../public/core/generation-settings.js";
import { readFile } from "node:fs/promises";

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const runtimes = [
  { id: "reforge", label: "ReForge", available: true, features: { txt2img: true } },
  { id: "forge-neo-anima", label: "Neo", provider: "forge-neo", available: true, features: { txt2img: true } }
];
const models = [
  { title: "A", hash: "aaa", modelName: "a", filename: "A.safetensors" },
  { title: "B", hash: "bbb", modelName: "b", filename: "B.safetensors" }
];
const generated = {
  runtime: runtimes[0], mode: "txt2img", prompt: "generated", negativePrompt: "bad",
  settings: { seed: 7 }, loras: [], images: [{ id: "image-a", seed: 7, url: "/outputs/a.png" }]
};
function fixture(overrides = {}) {
  const calls = [];
  const values = new Map();
  let status = { id: "job-1", status: "done", result: generated };
  const transport = {
    async getJson(url) {
      calls.push(["GET", url]);
      if (overrides.get) {
        const value = overrides.get(url);
        if (value !== undefined) return value;
      }
      if (url === "/api/config") return {
        runtimes, defaultRuntimeId: "reforge", lora: { defaultWeight: 0.7, maxSelected: 4 },
        defaults: { width: 512, height: 768, steps: 20, cfgScale: 7, samplerName: "Euler", scheduler: "Automatic" }
      };
      if (url === "/api/runtimes") return { runtimes, defaultRuntimeId: "reforge" };
      if (url.startsWith("/api/checkpoints?")) return { checkpoints: models, activeCheckpoint: "A" };
      if (url.startsWith("/api/loras?")) return { loras: [{ name: "portrait" }, { name: "light" }] };
      if (url.startsWith("/api/samplers?")) return { samplers: ["Euler", "DPM++ 2M"], schedulers: ["Automatic", "Karras"] };
      if (url.startsWith("/api/history?")) return { generations: [{ id: "previous", ...generated }] };
      if (url.startsWith("/api/jobs/")) return status;
      throw new Error(`Unexpected GET ${url}`);
    },
    async postJson(url, body) {
      calls.push(["POST", url, structuredClone(body)]);
      if (overrides.post) {
        const value = overrides.post(url, body);
        if (value !== undefined) return value;
      }
      if (url === "/api/checkpoints/select") return { checkpoint: body.checkpoint };
      if (url === "/api/jobs") return { job: { id: "job-1", status: "queued" } };
      if (url === "/api/prompt") return { prompt: "AI prompt", negative_prompt: "AI negative" };
      throw new Error(`Unexpected POST ${url}`);
    },
    async fetch(url, options) {
      calls.push([options.method, url]);
      if (overrides.fetch) return overrides.fetch(url, options);
      return { ok: true, json: async () => ({ job: { id: "job-1", status: "cancelled" } }) };
    }
  };
  // Job GET returns {job}, the exact legacy wire shape.
  const originalGet = transport.getJson;
  transport.getJson = async (url) => {
    const result = await originalGet(url);
    return url.startsWith("/api/jobs/") && result?.status ? { job: result } : result;
  };
  const workspace = createGenerateWorkspace({ transport,
    storage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key) },
    timing: { sleep: overrides.sleep ?? (async () => {}), setTimeout: () => 0 },
    confirmRecovery: overrides.confirmRecovery
  });
  return { workspace, calls, setStatus: (value) => { status = value; } };
}
async function setup(t, overrides) {
  const result = fixture(overrides);
  t.after(() => result.workspace.dispose());
  assert.equal(await result.workspace.initialize(), true);
  return result;
}

const r4Catalog = [{name:"portrait",folder:"Anima/People",registry:{uid:"p",triggerWords:"soft portrait",favorite:true}},{name:"light",folder:"Anima/Style",registry:{triggerWords:"warm light"}}];
test("R4 composition uses canonical order, weights, disabled state, explicit triggers and preserves draft", async t => {
  const {workspace:w,calls} = await setup(t,{get:url=>url.startsWith("/api/loras?")?{loras:r4Catalog}:undefined});
  w.setPrompt({sections:{character:"teapot",style:"watercolor"},negative:"blur"});
  w.setParameters({seed:123,width:768,height:1024,steps:16,cfgScale:6});
  const before=w.getSnapshot();
  w.addLora("portrait",0.6,{includeTriggers:false});w.addLora("light",0.7,{includeTriggers:false});
  w.addLora("portrait",0.6,{includeTriggers:false});assert.equal(w.getSnapshot().loras.length,2);
  assert.equal(w.buildRequest().prompt,before.prompt.prompt);
  assert.equal(w.buildRequest().loras[0].triggerWords,"");
  w.reorderLoras(["light","portrait"]);w.setLoraWeight("light",0.55);
  w.setPrompt({sections:{...before.prompt.structuredPrompt,extra:"<lora:portrait:0.6>"}});
  assert.deepEqual(w.buildRequest().loras.map(l=>l.name),["light","portrait"]);
  assert.equal(w.buildRequest().loras[0].weight,0.55);
  w.toggleLora("light");assert.equal(w.getSnapshot().loras[0].enabled,false);
  assert.deepEqual(w.buildRequest().loras.filter(l=>l.enabled!==false).map(l=>l.name),["portrait"]);
  w.toggleLora("light");assert.deepEqual(w.buildRequest().loras.map(l=>l.name),["light","portrait"]);
  assert.throws(()=>w.reorderLoras(["light","light"]),/exactly once/);
  w.insertLoraTrigger("light","style");assert.equal(w.getSnapshot().prompt.structuredPrompt.style,"watercolor, warm light");
  assert.equal(w.getSnapshot().prompt.negativePrompt,"blur");
  assert.deepEqual(w.getSnapshot().parameters,before.parameters);
  assert.deepEqual(w.getSnapshot().runtime.selectedCheckpoint,before.runtime.selectedCheckpoint);
  assert.throws(()=>w.insertLoraTrigger("light","raw"),/current Prompt mode/);
  w.setPrompt({positive:"raw teapot"});w.insertLoraTrigger("light","raw");
  assert.equal(w.buildRequest().prompt,"raw teapot, warm light");
  assert.equal(w.getSnapshot().prompt.structuredPrompt.style,"watercolor, warm light");
  const final=w.getSnapshot().prompt.prompt;await w.generate();
  assert.equal(calls.find(([method,url])=>method==="POST"&&url==="/api/jobs")[2].prompt,final);
  const image=w.getSnapshot().currentImage;
  w.removeLora("light");assert.equal(w.getSnapshot().loras.some(l=>l.name==="light"),false);
  await w.refreshLoras();assert.deepEqual(w.getSnapshot().currentImage,image);
});
test("R4 shares favorites registry, ensures uid and ignores the legacy runtime catalog in PATCH",async t=>{
  const writes=[];
  const {workspace:w,calls}=await setup(t,{get:url=>url.startsWith("/api/loras?")?{loras:r4Catalog}:undefined,
    post:url=>url==="/api/loras/registry/ensure"?{entry:{uid:"l"}}:undefined,
    fetch:async(url,options)=>{writes.push([url,JSON.parse(options.body)]);return {ok:true,json:async()=>({entry:{note:"shared registry"},loras:[{name:"foreign-runtime"}]})};}});
  await w.setLoraFavorite("portrait",false);await w.setLoraFavorite("light",true);
  assert.deepEqual(writes,[["/api/loras/p",{favorite:false}],["/api/loras/l",{favorite:true}]]);
  assert.deepEqual(w.getSnapshot().catalogs.loras.map(l=>l.name),["portrait","light"]);
  assert.equal(w.getSnapshot().catalogs.loras[1].registry.favorite,true);
  assert.equal(calls.filter(([,url])=>url==="/api/loras/registry/ensure").length,1);
  assert.deepEqual(w.getSnapshot().catalogState.pendingFavorites,[]);
});
test("R4 stale catalog reads cannot undo a favorite commit; failed writes leave state unchanged",async t=>{
  let wait=false,fail=false;const slow=deferred();
  const {workspace:w}=await setup(t,{get:url=>url.startsWith("/api/loras?")?(wait?slow.promise:{loras:r4Catalog}):undefined,
    fetch:async()=>({ok:!fail,status:503,json:async()=>fail?{error:"registry unavailable"}:{entry:{favorite:false}}})});
  wait=true;const loading=w.refreshLoras();await Promise.resolve();await Promise.resolve();
  assert.equal(w.getSnapshot().catalogState.loading,true);
  await w.setLoraFavorite("portrait",false);slow.resolve({loras:r4Catalog});await loading;
  assert.equal(w.getSnapshot().catalogs.loras[0].registry.favorite,false);
  fail=true;await assert.rejects(w.setLoraFavorite("portrait",true),/registry unavailable/);
  assert.equal(w.getSnapshot().catalogs.loras[0].registry.favorite,false);
});
test("R4 ignores favorite responses after runtime switch and serializes same-asset writes",async t=>{
  const delayed=deferred();let writes=0;
  const {workspace:w}=await setup(t,{get:url=>url.startsWith("/api/loras?")?{loras:r4Catalog}:undefined,
    fetch:async()=>{writes++;return delayed.promise;}});
  const first=w.setLoraFavorite("portrait",false);const second=w.setLoraFavorite("portrait",true);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(writes,1);
  await w.selectRuntime("forge-neo-anima");
  delayed.resolve({ok:true,json:async()=>({entry:{favorite:false}})});
  assert.equal(await first,false);assert.equal(await second,false);assert.equal(writes,1);
  assert.equal(w.getSnapshot().catalogs.loras[0].registry.favorite,true);
});

test("initializes without DOM, loads catalogs once, exposes immutable snapshots", async (t) => {
  assert.equal(typeof globalThis.document, "undefined");
  assert.equal(typeof globalThis.Option, "undefined");
  const { workspace: w, calls } = await setup(t);
  await w.initialize();
  assert.equal(calls.filter(([, url]) => url === "/api/config").length, 1);
  const snapshot = w.getSnapshot();
  assert.equal(snapshot.runtime.selectedCheckpoint.title, "A");
  assert.deepEqual(snapshot.catalogs.samplers, ["Euler", "DPM++ 2M"]);
  snapshot.catalogs.loras[0].name = "mutated";
  snapshot.runtime.selectedCheckpoint.title = "mutated";
  assert.equal(w.getSnapshot().catalogs.loras[0].name, "portrait");
  assert.equal(w.getSnapshot().runtime.selectedCheckpoint.title, "A");
});

test("positive/negative and Structured/Raw edits preserve their independent values", async (t) => {
  const { workspace: w } = await setup(t);
  w.setPrompt({ sections: { character: "cat", situation: "garden" }, negative: "blur" });
  assert.equal(w.getSnapshot().prompt.prompt, "cat, garden");
  w.setPrompt({ positive: "raw cat" });
  assert.equal(w.getSnapshot().prompt.prompt, "raw cat");
  assert.equal(w.getSnapshot().prompt.negativePrompt, "blur");
  assert.equal(w.getSnapshot().prompt.structuredPrompt.character, "cat");
  w.setPrompt({ positive: "", negative: "" });
  assert.equal(w.getSnapshot().prompt.prompt, "");
  assert.equal(w.getSnapshot().prompt.negativePrompt, "");
});

test("resolution, seed, sampler and scheduler reach the exact shared request", async (t) => {
  const { workspace: w } = await setup(t);
  w.setPrompt({ positive: "cat", negative: "blur" });
  w.setParameters({ width: 1024, height: 768, seed: 123, samplerName: "DPM++ 2M", scheduler: "Karras" });
  const request = w.buildRequest();
  assert.equal(request.prompt, "cat");
  assert.equal(request.negativePrompt, "blur");
  assert.deepEqual(request.settings, {
    seed: 123, candidateCount: 1, noiseSchedule: "Automatic", width: 1024, height: 768,
    steps: 20, cfgScale: 7, samplerName: "DPM++ 2M", scheduler: "Karras",
    checkpoint: "A", checkpointHash: "aaa", checkpointModelName: "a", checkpointFilename: "A.safetensors", hiresEnabled: false
  });
  assert.equal(request.runtimeId, "reforge");
  assert.equal(request.mode, "txt2img");
  request.settings.seed = 999;
  assert.equal(w.getSnapshot().parameters.seed, 123);
  assert.throws(() => w.setParameters({ checkpoint: "B" }), /Unknown/);
});

test("model selection uses legacy endpoint and canonical selected model", async (t) => {
  const { workspace: w, calls } = await setup(t);
  assert.equal(await w.selectModel("B"), true);
  assert.equal(w.getSnapshot().runtime.selectedCheckpoint.title, "B");
  assert.equal(w.buildRequest().settings.checkpointHash, "bbb");
  assert.deepEqual(calls.find(([method, url]) => method === "POST" && url === "/api/checkpoints/select")[2], { checkpoint: "B", runtimeId: "reforge" });
});

test("LoRA add/weight/disable/remove uses existing coordinator tag semantics", async (t) => {
  const { workspace: w } = await setup(t);
  w.setPrompt({ positive: "portrait" });
  w.addLora("portrait", 0.7);
  assert.equal(w.getSnapshot().prompt.prompt, "portrait", "UI add does not insert a tag");
  assert.equal(w.getSnapshot().loras[0].source, "ui");
  w.setPrompt({ positive: "portrait, <lora:portrait:0.4>" });
  w.setLoraWeight("portrait", 0.9);
  assert.equal(w.getSnapshot().loras[0].weight, 0.9);
  assert.match(w.getSnapshot().prompt.prompt, /<lora:portrait:0.9>/);
  w.toggleLora("portrait");
  assert.equal(w.buildRequest().loras[0].enabled, false);
  assert.doesNotMatch(w.buildRequest().prompt, /<lora:/);
  w.removeLora("portrait");
  assert.deepEqual(w.getSnapshot().loras, []);
  assert.doesNotMatch(w.getSnapshot().prompt.rawPrompt, /<lora:/);
});

test("generation is observable before POST, single-flight, succeeds and refreshes recent", async (t) => {
  const gate = deferred();
  const { workspace: w, calls } = await setup(t, { sleep: () => gate.promise });
  w.setPrompt({ positive: "cat", negative: "blur" });
  const preview = w.buildRequest();
  const events = [];
  const unsubscribe = w.subscribe((snapshot) => events.push(snapshot));
  w.subscribe(() => { throw new Error("broken view"); });
  const pending = w.generate();
  assert.equal(w.getSnapshot().generation.busy, true);
  await assert.rejects(w.generate(), /busy/);
  assert.throws(() => w.setPrompt({ positive: "during generation" }), /busy/);
  assert.deepEqual(calls.find(([method, url]) => method === "POST" && url === "/api/jobs")[2], { ...preview, autoRetry: false });
  gate.resolve();
  await pending;
  assert.equal(w.getSnapshot().generation.phase, "succeeded");
  assert.equal(w.getSnapshot().generation.busy, false);
  assert.equal(w.getSnapshot().currentImage.id, "image-a");
  assert.equal(w.getSnapshot().completed.prompt, "generated");
  assert.equal(events.some((value) => value.generation.busy && value.generation.phase === "preparing"), true);
  assert.equal(calls.filter(([, url]) => url.startsWith("/api/history?")).length, 2);
  unsubscribe();
});

test("generation failure releases reservation, keeps draft and previous completed image", async (t) => {
  const { workspace: w, setStatus } = await setup(t);
  w.setPrompt({ positive: "cat" });
  await w.generate();
  w.setPrompt({ positive: "next cat" });
  setStatus({ id: "job-1", status: "failed", error: "out of memory" });
  await w.generate();
  const state = w.getSnapshot();
  assert.equal(state.generation.phase, "failed");
  assert.equal(state.generation.error, "out of memory");
  assert.equal(state.generation.busy, false);
  assert.equal(state.prompt.prompt, "next cat");
  assert.equal(state.currentImage.id, "image-a");
});

test("transport rejection and input failure are observable without a modal", async (t) => {
  const { workspace: w } = await setup(t, { post: (url) => url === "/api/jobs" ? Promise.reject(new Error("offline")) : undefined });
  await w.generate();
  assert.equal(w.getSnapshot().generation.phase, "failed");
  w.setPrompt({ positive: "cat" });
  await w.generate();
  assert.equal(w.getSnapshot().generation.error, "offline");
  assert.equal(w.getSnapshot().generation.busy, false);
});

test("description-only generation uses existing prompt API before job assembly", async (t) => {
  const { workspace: w, calls } = await setup(t);
  w.setDescription("猫");
  await w.generate();
  const posted = calls.filter(([method]) => method === "POST");
  assert.deepEqual(posted.map(([, url]) => url), ["/api/prompt", "/api/jobs"]);
  assert.equal(posted[1][2].prompt, "AI prompt");
  assert.equal(posted[1][2].negativePrompt, "AI negative");
});

test("metadata reuse selects runtime first and restores only legacy parameter subset", async (t) => {
  const { workspace: w } = await setup(t);
  const recipe = { runtime: runtimes[1], prompt: "old raw", negativePrompt: "bad old",
    settings: { width: 768, height: 1024, samplerName: "Euler", scheduler: "Karras", seed: 99, checkpoint: "DO NOT APPLY" },
    loras: [{ name: "portrait", weight: 0.3, enabled: false, negativeWords: "uniform" }], sourceImageId: "source" };
  const result = await w.reuseMetadata(recipe, { seed: 17 });
  assert.equal(result.applied, true);
  assert.equal(w.getSnapshot().runtime.activeRuntimeId, "forge-neo-anima");
  assert.equal(w.getSnapshot().runtime.selectedCheckpoint.title, "A");
  assert.equal(w.getSnapshot().prompt.prompt, "old raw");
  assert.equal(w.getSnapshot().prompt.negativePrompt, "bad old");
  assert.equal(w.getSnapshot().parameters.seed, 17);
  assert.equal(w.getSnapshot().parameters.candidateCount, 1);
  assert.equal(w.getSnapshot().loras[0].enabled, false);
  assert.equal(w.buildRequest().loras[0].negativeWords, "uniform");
  assert.equal(w.buildRequest().initImageId, undefined);
  assert.ok(result.excluded.includes("checkpoint"));
});

test("Recipe endpoint's selectedImage wire shape is consumed directly", async (t) => {
  const { workspace: w } = await setup(t, { get: (url) => url.endsWith("/recipe")
    ? { prompt: "endpoint", negativePrompt: "n", settings: {}, selectedImage: { seed: 45 } } : undefined });
  assert.equal((await w.reuseImage("image-a")).applied, true);
  assert.equal(w.getSnapshot().parameters.seed, 45);
});

test("late metadata response cannot overwrite newer user edits or a newer reuse", async (t) => {
  const old = deferred();
  const { workspace: w } = await setup(t, { get: (url) => url.endsWith("/recipe") ? old.promise : undefined });
  const pending = w.reuseImage("old");
  w.setPrompt({ positive: "new edit" });
  old.resolve({ prompt: "old response", selectedImage: { seed: 4 } });
  assert.equal(await pending, false);
  assert.equal(w.getSnapshot().prompt.prompt, "new edit");
});

test("newest recent request wins including reverse completion and errors", async (t) => {
  let intercept = false;
  const old = deferred(), recent = deferred();
  const { workspace: w } = await setup(t, { get: (url) => intercept && url.startsWith("/api/history?")
    ? (url.includes("favorites=1") ? recent.promise : old.promise) : undefined });
  intercept = true;
  const first = w.loadRecent(), second = w.loadRecent("favorite");
  recent.resolve({ generations: [{ id: "new" }] });
  assert.equal(await second, true);
  old.reject(new Error("stale error"));
  assert.equal(await first, false);
  assert.deepEqual(w.getSnapshot().recent.generations, [{ id: "new" }]);
  assert.equal(w.getSnapshot().recent.error, null);
});

test("dispose detaches in-flight Job without DELETE or late result publication", async (t) => {
  const job = deferred();
  const { workspace: w, calls } = await setup(t, { get: (url) => url.startsWith("/api/jobs/") ? job.promise : undefined });
  w.setPrompt({ positive: "cat" });
  const events = [];
  w.subscribe((state) => events.push(state));
  const pending = w.generate();
  await new Promise((resolve) => setImmediate(resolve));
  w.dispose();
  const count = events.length;
  job.resolve({ job: { status: "done", result: generated } });
  await pending;
  assert.equal(events.length, count);
  assert.equal(w.getSnapshot().completed, null);
  assert.equal(calls.some(([method]) => method === "DELETE"), false);
});

test("headless Runtime suppresses stale checkpoint selection response", async () => {
  const one = deferred(), two = deferred();
  const service = createRuntimeService({
    storage: { getItem: () => null, setItem() {}, removeItem() {} },
    getJson: async () => ({ checkpoints: models, activeCheckpoint: "A" }),
    postJson: (_url, body) => body.checkpoint === "B" ? one.promise : two.promise
  });
  service.init(); service.configure(runtimes, "reforge"); await service.loadCheckpoints();
  const first = service.selectCheckpoint("B");
  const second = service.selectCheckpoint("C");
  two.resolve({ checkpoint: "C" }); assert.equal(await second, true);
  one.resolve({ checkpoint: "B" }); assert.equal(await first, false);
  assert.equal(service.getState().selectedCheckpoint.title, "C");
  service.dispose();
});

test("shared metadata mapper does not apply checkpoint/source/mask or source settings seed", () => {
  const patch = recipeParameterPatch({ settings: { width: 768, checkpoint: "B", seed: 2, inpaintFullRes: false }, sourceImageId: "x", maskImageUrl: "y" }, { seed: 0 });
  assert.deepEqual(patch, { width: 768, inpaintFullRes: false, seed: 0, candidateCount: 1 });
});

test("structured Recipe and LoRA trigger metadata survive draft round trip", () => {
  const draft = createGenerationDraft({ getCatalog: () => [{ name: "portrait" }] });
  draft.reuse({ structuredPrompt: { character: "cat", style: "ink" }, rawPromptOverride: false,
    negativePrompt: "blur", loras: [{ name: "portrait", weight: 0.7, source: "ui" }],
    appliedTriggerWords: [{ text: "fine detail", targetField: "style", sourceLoraIds: ["portrait"], weight: 1, enabled: true }]
  }, { seed: 2 });
  assert.match(draft.positive(), /cat/);
  assert.match(draft.positive(), /fine detail/);
  const saved = draft.capture();
  draft.setPrompt({ positive: "changed" }); draft.restore(saved);
  assert.equal(draft.readPrompt().rawPromptOverride, false);
  assert.equal(draft.readPrompt().negativePrompt, "blur");
  draft.dispose();
});

test("new workspace import closure contains no DOM or legacy entry dependency", async () => {
  const visited = new Set();
  async function inspect(url) {
    if (visited.has(url.href)) return;
    visited.add(url.href);
    const source = await readFile(url, "utf8");
    assert.doesNotMatch(source, /\b(?:document|window)\s*\.|querySelector|getElementById|\.dataset\b|\.classList\b|new Option\b/, url.pathname);
    assert.doesNotMatch(source, /from\s+["'][^"']*(?:app\.js|runtime-controller\.js|ui-kit\.js)["']/, url.pathname);
    for (const match of source.matchAll(/from\s+["'](\.[^"']+)["']/g)) await inspect(new URL(match[1], url));
  }
  await inspect(new URL("../public/features/generate-workspace.js", import.meta.url));
  assert.ok(visited.size >= 8);
});

test("Runtime failure restores its old draft/catalogs and successful switch survives later reuse failure", async (t) => {
  let fail = true;
  const { workspace: w } = await setup(t, { get: (url) => fail && url === "/api/loras?runtimeId=forge-neo-anima"
    ? Promise.reject(new Error("catalog offline")) : undefined });
  w.setPrompt({ positive: "retained" });
  assert.equal(await w.selectRuntime("forge-neo-anima"), false);
  assert.equal(w.getSnapshot().runtime.activeRuntimeId, "reforge");
  assert.equal(w.getSnapshot().prompt.prompt, "retained");
  fail = false;
  await assert.rejects(w.reuseMetadata({ runtime: runtimes[1], prompt: "not committed",
    loras: [{ name: "portrait", weight: 0.5, invalid: () => {} }] }, { seed: 4 }));
  assert.equal(w.getSnapshot().runtime.activeRuntimeId, "forge-neo-anima");
  assert.equal(w.getSnapshot().prompt.prompt, "retained");
  assert.equal(w.getSnapshot().reusing, false);
});

test("cancel uses DELETE and terminal cancellation releases busy", async (t) => {
  const pause = deferred();
  const { workspace: w, calls, setStatus } = await setup(t, { sleep: () => pause.promise });
  w.setPrompt({ positive: "cat" });
  const pending = w.generate();
  await new Promise((resolve) => setImmediate(resolve));
  await w.cancel();
  await w.cancel(); // Terminal DELETE response must not permit another cancellation request.
  setStatus({ id: "job-1", status: "cancelled" });
  pause.resolve(); await pending;
  assert.equal(w.getSnapshot().generation.phase, "cancelled");
  assert.equal(w.getSnapshot().generation.busy, false);
  assert.equal(calls.filter(([method]) => method === "DELETE").length, 1);
});

test("dispose during recovery confirmation cannot submit a retry", async (t) => {
  const confirmation = deferred();
  const { workspace: w, calls, setStatus } = await setup(t, { confirmRecovery: () => confirmation.promise });
  setStatus({ id: "job-1", status: "failed", error: "OOM", recovery: { kind: "oom", settings: { width: 256 } } });
  w.setPrompt({ positive: "cat" });
  const pending = w.generate();
  await new Promise((resolve) => setImmediate(resolve));
  w.dispose(); confirmation.resolve(true); await pending;
  assert.equal(calls.filter(([method, url]) => method === "POST" && url === "/api/jobs").length, 1);
});

test("primary Structured workflow previews the exact six-section request and retains Raw edits across modes", async (t) => {
  const { workspace: w } = await setup(t);
  const sections = { character: "cat", appearance: "white fur", composition: "close up", situation: "garden", style: "watercolor", extra: "soft light" };
  w.setPrompt({ sections, negative: "blur" });
  assert.equal(w.getSnapshot().prompt.prompt, Object.values(sections).join(", "));
  assert.equal(w.buildRequest().prompt, w.getSnapshot().prompt.prompt);
  assert.equal(w.buildRequest().negativePrompt, "blur");
  w.setPrompt({ mode: "raw" });
  assert.equal(w.getSnapshot().prompt.rawPrompt, Object.values(sections).join(", "));
  w.setPrompt({ positive: "manually edited final" });
  w.setPrompt({ mode: "structured" });
  assert.deepEqual(w.getSnapshot().prompt.structuredPrompt, sections);
  assert.equal(w.buildRequest().prompt, Object.values(sections).join(", "));
  w.setPrompt({ mode: "raw" });
  assert.equal(w.buildRequest().prompt, "manually edited final");
  w.setPrompt({ positive: "" });
  w.setPrompt({ mode: "structured" });
  w.setPrompt({ mode: "raw" });
  assert.equal(w.getSnapshot().prompt.rawPrompt, "");
});

test("Raw draft mode memory survives draft capture/restore without leaking into request prompt data", () => {
  const draft = createGenerationDraft();
  draft.setPrompt({ positive: "", sections: { character: "cat" } });
  const saved = draft.capture();
  draft.setPrompt({ positive: "temporary" });
  draft.restore(saved);
  draft.setPrompt({ mode: "raw" });
  assert.equal(draft.readPrompt().rawPrompt, "");
  assert.equal(Object.hasOwn(draft.readPrompt(), "rawDraftInitialized"), false);
  draft.dispose();
});

test("R3 Structured and Raw Final preview equals the submitted canonical request, including primary and inspector parameters", async (t) => {
  for (const raw of [false,true]) {
    const {workspace:w,calls}=await setup(t);
    w.setPrompt({sections:{character:"teapot",appearance:"ivory",composition:"eye level",situation:"window",style:"photo",extra:"soft light"},negative:"blur"});
    if(raw)w.setPrompt({positive:"raw teapot"});
    w.setParameters({width:768,height:1024,seed:321,candidateCount:2,steps:16,cfgScale:5,samplerName:"Euler",scheduler:"Karras"});
    w.addLora("portrait",0.6);
    const snapshot=w.getSnapshot(),preview=w.buildRequest();
    assert.equal(snapshot.prompt.prompt,preview.prompt);
    await w.generate();
    const request=calls.find(([method,url])=>method==="POST"&&url==="/api/jobs")[2];
    assert.deepEqual(request,{...preview,autoRetry:false});
    assert.equal(request.negativePrompt,"blur");
    assert.equal(request.rawPromptOverride,raw);
  }
});

test("R3 candidate selection and result metadata leave Current Draft untouched; reuse is explicit", async (t) => {
  const {workspace:w,setStatus}=await setup(t);
  w.setPrompt({sections:{character:"draft teapot"},negative:"draft negative"});
  setStatus({id:"job-1",status:"done",result:{...generated,images:[{id:"first",seed:11,imageUrl:"/outputs/first.png"},{id:"second",seed:22,imageUrl:"/outputs/second.png"}]}});
  await w.generate();
  w.setPrompt({sections:{character:"edited draft"}});
  const before=w.getSnapshot();
  w.selectImage("second");
  assert.equal(w.getSnapshot().currentImage.seed,22);
  assert.deepEqual(w.getSnapshot().prompt,before.prompt);
  assert.deepEqual(w.getSnapshot().parameters,before.parameters);
  assert.deepEqual(w.getSnapshot().recent,before.recent);
  await w.reuseMetadata(w.getSnapshot().completed,w.getSnapshot().currentImage);
  assert.equal(w.getSnapshot().parameters.seed,22);
  assert.equal(w.getSnapshot().prompt.prompt,"generated");
});
