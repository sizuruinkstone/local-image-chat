import assert from "node:assert/strict";
import test from "node:test";
import { cleanTags, createPrompt, inspectTagOutput } from "../src/ollama.js";

const LOOPED_RESPONSE = [
  "masterpiece", "best quality", "amazing quality", "newest", "absurdres", "highres",
  "1girl", "solo", "naked", "detailed face", "detailed eyes", "anime coloring",
  "dynamic pose", "cowboy shot", "simple background", "soft lighting",
  "detailed clothing", "detailed body features", "natural lighting", "realistic shading",
  "perfect composition", "perfect lighting", "perfect pose", "perfect expression",
  "perfect color", "perfect texture", "perfect composition", "perfect lighting",
  "perfect pose", "perfect expression", "perfect color", "perfect texture"
].join(", ");

test("Qwenの反復タグと裸指定に矛盾する一般衣装タグを除去する", () => {
  const prompt = cleanTags(LOOPED_RESPONSE, { description: "裸にする" });
  const tags = prompt.split(", ");

  assert.equal(tags.length, new Set(tags.map((tag) => tag.toLowerCase())).size);
  assert.match(prompt, /\bnaked\b/);
  assert.doesNotMatch(prompt, /detailed clothing/i);
  assert.doesNotMatch(prompt, /perfect (?:composition|lighting|pose|expression|color|texture)/i);
  assert.doesNotMatch(prompt, /detailed body features/i);
});

test("短い指示ではタグ数を48個までに制限する", () => {
  const generated = Array.from({ length: 100 }, (_, index) => `unique tag ${index}`).join(", ");
  const prompt = cleanTags(generated, { description: "青髪の女性", maxTags: 96 });
  assert.equal(prompt.split(", ").length, 48);
});

test("反復数を検出する", () => {
  assert.deepEqual(inspectTagOutput("one, two, one, two, one"), {
    tagCount: 5,
    duplicateCount: 3
  });
});

test("Ollamaへ反復抑制を指定し、返答を正規化する", async (t) => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return new Response(JSON.stringify({
      response: LOOPED_RESPONSE,
      done: true,
      done_reason: "length"
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await createPrompt({
    url: "http://127.0.0.1:11434",
    model: "mock",
    timeoutMs: 5000
  }, "裸にする");

  assert.equal(requestBody.options.repeat_penalty, 1.18);
  assert.equal(requestBody.options.repeat_last_n, 128);
  assert.equal(requestBody.options.num_predict, 320);
  assert.doesNotMatch(result.prompt, /detailed clothing/i);
  assert.equal(
    result.prompt.split(", ").length,
    new Set(result.prompt.toLowerCase().split(", ")).size
  );
});
