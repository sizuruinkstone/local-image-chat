import assert from "node:assert/strict";
import test from "node:test";
import { describeRetryInfo, diffLoras, diffPrompts, diffSettings } from "../public/compare-view.js";

function entry(settings, { prompt = "1girl, blue hair", loras = [], seed = 1 } = {}) {
  return { generation: { settings, prompt, loras }, image: { id: `img-${seed}`, seed } };
}

test("2枚比較で設定の差分だけを抽出する", () => {
  const rows = diffSettings([
    entry({ steps: 25, cfgScale: 6, samplerName: "Euler a" }),
    entry({ steps: 25, cfgScale: 8, samplerName: "Euler a" })
  ]);
  assert.deepEqual(rows.map((row) => row.key), ["cfgScale"]);
  assert.deepEqual(rows[0].values, ["6", "8"]);
});

test("差分がなければ空を返す", () => {
  assert.deepEqual(diffSettings([entry({ steps: 25 }), entry({ steps: 25 })]), []);
});

test("LoRA weightの差分を抽出する", () => {
  const rows = diffLoras([
    entry({}, { loras: [{ name: "Flat", weight: 0.5 }, { name: "Ema", weight: 0.8 }] }),
    entry({}, { loras: [{ name: "Flat", weight: 0.7 }, { name: "Ema", weight: 0.8 }] })
  ]);
  assert.deepEqual(rows.map((row) => row.label), ["Flat"]);
  assert.deepEqual(rows[0].values, ["0.50", "0.70"]);
});

test("片方にしかないLoRAも差分として出す", () => {
  const rows = diffLoras([
    entry({}, { loras: [{ name: "Flat", weight: 0.5 }] }),
    entry({}, { loras: [] })
  ]);
  assert.deepEqual(rows[0].values, ["0.50", "—"]);
});

test("Prompt差分をAを基準に追加・削除で出す", () => {
  const diffs = diffPrompts([
    entry({}, { prompt: "1girl, blue hair, smile" }),
    entry({}, { prompt: "1girl, blue hair, angry, night" })
  ]);
  assert.deepEqual(diffs[0], { added: [], removed: [] });
  assert.deepEqual(diffs[1].added, ["angry", "night"]);
  assert.deepEqual(diffs[1].removed, ["smile"]);
});

test("自動リカバリで下げた設定を説明文にまとめる", () => {
  const text = describeRetryInfo({
    retryReasonLabel: "VRAM不足",
    originalSettings: { width: 896, candidateCount: 4, steps: 25 },
    retrySettings: { width: 832, candidateCount: 1, steps: 25 }
  });
  assert.match(text, /VRAM不足/);
  assert.match(text, /width: 896 → 832/);
  assert.match(text, /candidateCount: 4 → 1/);
  assert.equal(/steps/.test(text), false, "変わっていない設定は出さない");
  assert.equal(describeRetryInfo(null), "");
});

test("4枚まで差分表を組める", () => {
  const rows = diffSettings([
    entry({ cfgScale: 4 }), entry({ cfgScale: 5 }), entry({ cfgScale: 6 }), entry({ cfgScale: 7 })
  ]);
  assert.deepEqual(rows[0].values, ["4", "5", "6", "7"]);
});
