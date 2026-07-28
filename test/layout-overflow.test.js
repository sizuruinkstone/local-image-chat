import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

// 長いCheckpoint名（sd\obsessionIllustrious_vPredV20.safetensors など）で
// 画面が横へ広がった不具合の再発防止。
// Safariの <select> は「最長optionの幅」を最小幅として扱うため、
// grid/flexの列やフォーム部品が縮められる指定になっているかをCSSで確認する。

async function readCss() {
  return fs.readFile("public/style.css", "utf8");
}

test("フォーム部品は親幅を押し広げない（min-width/max-width）", async () => {
  const css = await readCss();
  const base = css.match(/textarea, input, select \{[^}]*\}/);
  assert.ok(base, "textarea, input, select の基本指定が見つからない");
  assert.match(base[0], /min-width: 0/);
  assert.match(base[0], /max-width: 100%/);
  assert.match(base[0], /box-sizing: border-box/);

  const checkpoint = css.match(/#checkpointSelect \{[^}]*\}/);
  assert.ok(checkpoint, "#checkpointSelect の指定が見つからない");
  assert.match(checkpoint[0], /min-width: 0/);
  assert.match(checkpoint[0], /max-width: 100%/);
  assert.match(checkpoint[0], /text-overflow: ellipsis/);
});

test("モデル名を含む状態表示は1語でも折り返す", async () => {
  const css = await readCss();
  const status = css.match(/#checkpointStatus,[\s\S]*?\{[^}]*\}/);
  assert.ok(status, "Checkpoint状態表示の指定が見つからない");
  assert.match(status[0], /overflow-wrap: anywhere/);
  assert.match(status[0], /max-width: 100%/);
  // 汎用の説明文（使用中のモデル名などを含む）も折り返す
  const hint = css.match(/\.hint \{[^}]*\}/);
  assert.match(hint[0], /overflow-wrap: anywhere/);
});

// 長いモデル名・LoRA名を抱えうるコンテナ。ここに素の 1fr があると列が広がる。
const CRITICAL_SELECTOR = /settings|checkpoint|layout|appShell|generate|lora|picker/i;

test("grid列は縮められる minmax(0, 1fr) を使う", async () => {
  const css = await readCss();
  // 「1fr」単独は min-content が下限になる。minmax(...) の内側は対象外。
  const bare = [...css.matchAll(/([^{}]+)\{([^}]*grid-template-columns:[^;]*;[^}]*)\}/g)]
    .filter(([, selector]) => CRITICAL_SELECTOR.test(selector))
    .map(([, selector, body]) => [selector.trim(), body.match(/grid-template-columns:[^;]*;/)[0]])
    .filter(([, declaration]) => /(^|[\s:(,])1fr/.test(declaration.replace(/minmax\([^)]*\)/g, "")));
  assert.deepEqual(bare, [], `1fr のままの指定が残っている: ${bare.map((item) => item.join(" ")).join(" / ")}`);

  for (const selector of [".settingsGrid", ".settingsRow", ".checkpointToolbar"]) {
    const rule = css.match(new RegExp(`\\${selector} \\{[^}]*\\}`));
    assert.ok(rule, `${selector} の指定が見つからない`);
    assert.match(rule[0], /minmax\(0, 1fr\)/, selector);
  }
});

test("100vwや max-content で横幅を固定していない", async () => {
  const css = await readCss();
  assert.equal(/(?:^|[\s:])width:\s*100vw/.test(css), false, "width: 100vw は使わない");
  assert.equal(/min-width:\s*100vw/.test(css), false, "min-width: 100vw は使わない");
  assert.equal(/min-width:\s*max-content/.test(css), false, "min-width: max-content は使わない");
  // 横あふれを overflow-x: hidden だけで隠していないこと
  assert.equal(/html\s*\{[^}]*overflow-x:\s*hidden/.test(css), false);
  assert.equal(/body\s*\{[^}]*overflow-x:\s*hidden/.test(css), false);
});

test("固定生成バーは幅を100vwで広げない", async () => {
  const css = await readCss();
  const bar = css.match(/\.generateActions \{[^}]*\}/);
  assert.ok(bar);
  assert.equal(/100vw/.test(bar[0]), false);
  assert.match(bar[0], /position: sticky/);
});
