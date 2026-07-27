import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  hashOutputImage,
  isContentSha256,
  isSafeOutputFilename,
  normalizeContentSha256,
  resolveOutputPath,
  sha256OfBuffer
} from "../src/content-hash.js";

async function makeOutputDir(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "local-image-chat-hash-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test("SHA-256は64桁の小文字16進数だけを受け付ける", () => {
  const valid = "a".repeat(64);
  assert.equal(normalizeContentSha256(valid), valid);
  // 大文字は小文字へ揃える。
  assert.equal(normalizeContentSha256("A".repeat(64)), valid);
  assert.equal(normalizeContentSha256(` ${valid} `), valid);

  for (const invalid of ["", "xyz", "a".repeat(63), "a".repeat(65), "g".repeat(64), null, 123, {}]) {
    assert.equal(normalizeContentSha256(invalid), null);
    assert.equal(isContentSha256(invalid), false);
  }
});

test("ファイル全体のバイト列からハッシュを取る", async (t) => {
  const directory = await makeOutputDir(t);
  const bytes = Buffer.from("画像のバイト列", "utf8");
  await fs.writeFile(path.join(directory, "one.png"), bytes);

  const expected = crypto.createHash("sha256").update(bytes).digest("hex");
  assert.equal(await hashOutputImage(directory, "one.png"), expected);
  assert.equal(sha256OfBuffer(bytes), expected);
});

test("同じ内容ならファイル名が違っても同じ値になる", async (t) => {
  const directory = await makeOutputDir(t);
  const bytes = Buffer.from("同じ中身");
  await fs.writeFile(path.join(directory, "a.png"), bytes);
  await fs.writeFile(path.join(directory, "b-renamed.png"), bytes);

  assert.equal(
    await hashOutputImage(directory, "a.png"),
    await hashOutputImage(directory, "b-renamed.png")
  );
});

test("ファイルが無ければnullを返す", async (t) => {
  const directory = await makeOutputDir(t);
  assert.equal(await hashOutputImage(directory, "missing.png"), null);
});

test("outputDirの外は読まない", async (t) => {
  const directory = await makeOutputDir(t);
  const parent = path.dirname(directory);
  await fs.writeFile(path.join(parent, "outside-secret.txt"), "秘密");
  t.after(() => fs.rm(path.join(parent, "outside-secret.txt"), { force: true }));

  for (const name of [
    "../outside-secret.txt",
    "..\\outside-secret.txt",
    "../../outside-secret.txt",
    "sub/one.png",
    "C:/Windows/system32/drivers/etc/hosts",
    "/etc/passwd",
    "..",
    ""
  ]) {
    assert.equal(isSafeOutputFilename(name), false, `安全と判定してはいけない: ${name}`);
    assert.equal(resolveOutputPath(directory, name), null, `解決してはいけない: ${name}`);
    assert.equal(await hashOutputImage(directory, name), null, `読んではいけない: ${name}`);
  }

  assert.equal(isSafeOutputFilename("one.png"), true);
  assert.ok(resolveOutputPath(directory, "one.png"));
});

test("シンボリックリンクは辿らない", async (t) => {
  const directory = await makeOutputDir(t);
  const parent = path.dirname(directory);
  const secretPath = path.join(parent, "outside-linked.txt");
  await fs.writeFile(secretPath, "リンク先の秘密");
  t.after(() => fs.rm(secretPath, { force: true }));

  try {
    await fs.symlink(secretPath, path.join(directory, "link.png"));
  } catch {
    // Windows では管理者権限か開発者モードが要る。作れない環境では確認しない。
    return;
  }

  assert.equal(await hashOutputImage(directory, "link.png"), null);
});
