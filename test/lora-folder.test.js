import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  isValidInstallFolder,
  normalizeInstallFolder,
  resolveInstallTarget
} from "../src/lora-folder.js";

test("有効な相対フォルダを正規化する", () => {
  assert.equal(normalizeInstallFolder("characters"), "characters");
  assert.equal(normalizeInstallFolder("characters/Blue Archive"), "characters/Blue Archive");
  assert.equal(normalizeInstallFolder("  characters/Arknights  "), "characters/Arknights");
});

test("バックスラッシュ・連続スラッシュ・末尾スラッシュを正規化する", () => {
  assert.equal(normalizeInstallFolder("characters\\Blue Archive"), "characters/Blue Archive");
  assert.equal(normalizeInstallFolder("characters//Original"), "characters/Original");
  assert.equal(normalizeInstallFolder("characters/VTuber/"), "characters/VTuber");
});

test("空文字・空白のみは拒否する", () => {
  assert.throws(() => normalizeInstallFolder(""), /保存先を選択/);
  assert.throws(() => normalizeInstallFolder("   "), /保存先を選択/);
  assert.throws(() => normalizeInstallFolder(null), /保存先を選択/);
});

test("パストラバーサル・絶対パス・UNCを拒否する", () => {
  assert.throws(() => normalizeInstallFolder("../test"), /ルート外/);
  assert.throws(() => normalizeInstallFolder("..\\test"), /ルート外/);
  assert.throws(() => normalizeInstallFolder("characters/../../etc"), /ルート外/);
  assert.throws(() => normalizeInstallFolder("C:\\test"), /ルート外/);
  assert.throws(() => normalizeInstallFolder("/test"), /ルート外/);
  assert.throws(() => normalizeInstallFolder("\\\\server\\share"), /ルート外/);
});

test("Windows予約名・禁止文字・末尾スペース/ドットを拒否する", () => {
  assert.throws(() => normalizeInstallFolder("characters/CON"), /使用できない/);
  assert.throws(() => normalizeInstallFolder("characters/com1"), /使用できない/);
  assert.throws(() => normalizeInstallFolder("characters/NUL.txt"), /使用できない/);
  assert.throws(() => normalizeInstallFolder("characters/foo."), /使用できない/);
  assert.throws(() => normalizeInstallFolder("characters/a?b"), /使用できない/);
  assert.throws(() => normalizeInstallFolder("characters/a|b"), /使用できない/);
  assert.throws(() => normalizeInstallFolder("characters/a*b"), /使用できない/);
});

test("セグメント末尾のスペース/ドットを拒否する（外側の空白はトリム）", () => {
  // 内側セグメントの末尾スペースは拒否
  assert.throws(() => normalizeInstallFolder("characters/foo /bar"), /使用できない/);
  // 外側の空白はトリムされ、正当なフォルダとして受理
  assert.equal(normalizeInstallFolder("characters/foo  "), "characters/foo");
});

test("制御文字を拒否する", () => {
  assert.throws(() => normalizeInstallFolder("characters/a" + String.fromCharCode(0) + "b"), /使用できない/);
});

test("スペースやハイフンを含む正当な名前は許可する", () => {
  assert.equal(isValidInstallFolder("characters/Blue Archive"), true);
  assert.equal(isValidInstallFolder("style/Anime-2.5D"), true);
  assert.equal(isValidInstallFolder("characters/CON"), false);
});

test("resolveInstallTargetはルート配下だけを許可する", () => {
  const root = path.resolve("/tmp/lora-root");
  const resolved = resolveInstallTarget(root, "characters/Blue Archive");
  assert.equal(resolved.relative, "characters/Blue Archive");
  assert.equal(resolved.absolute, path.resolve(root, "characters/Blue Archive"));
  assert.throws(() => resolveInstallTarget(root, "../escape"), /ルート外/);
});
