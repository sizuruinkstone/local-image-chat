import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  acquireInstanceLock,
  getInstanceLockPath,
  InstanceAlreadyRunningError
} from "../src/instance-lock.js";

const TEST_PORT = 41100;

async function makeRoot(t, suffix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `local-image-chat-lock-${suffix}-`));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function readMetadata(lockPath) {
  return JSON.parse(await fs.readFile(lockPath, "utf8"));
}

function validMetadata(port, overrides = {}) {
  return {
    pid: 2147483647,
    instanceId: "stale-instance",
    startedAt: new Date().toISOString(),
    port,
    version: "test-version",
    ...overrides
  };
}

test("新規取得のメタデータは必要最小限で、ルートや秘密情報を含めない", async (t) => {
  const root = await makeRoot(t, "metadata");
  const lock = await acquireInstanceLock({ rootDir: root, port: TEST_PORT, version: "test-version" });
  const lockPath = getInstanceLockPath(root, TEST_PORT);
  t.after(() => lock.release());

  const metadata = await readMetadata(lockPath);
  assert.equal(metadata.pid, process.pid);
  assert.equal(metadata.port, TEST_PORT);
  assert.equal(metadata.version, "test-version");
  assert.ok(metadata.instanceId);
  assert.ok(Number.isFinite(Date.parse(metadata.startedAt)));
  assert.doesNotMatch(JSON.stringify(metadata), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  assert.doesNotMatch(JSON.stringify(metadata), /webhook|integration|secret|token/i);
  if (process.platform === "win32") {
    assert.equal(
      getInstanceLockPath(root, TEST_PORT),
      getInstanceLockPath(root.toUpperCase(), TEST_PORT),
      "Windowsではルートの大文字小文字を同一視する"
    );
  }
});

test("同一ルート・同一ポートはホスト表記に関係なく二重取得を拒否する", async (t) => {
  const root = await makeRoot(t, "duplicate");
  const first = await acquireInstanceLock({
    rootDir: root,
    port: TEST_PORT + 1,
    version: "test-version",
    host: "127.0.0.1"
  });
  t.after(() => first.release());

  await assert.rejects(
    acquireInstanceLock({
      rootDir: root,
      port: TEST_PORT + 1,
      version: "test-version",
      host: "0.0.0.0"
    }),
    (error) => {
      assert.ok(error instanceof InstanceAlreadyRunningError);
      assert.equal(error.code, "INSTANCE_ALREADY_RUNNING");
      assert.match(error.message, /Local Image Chatは既に起動しています。/);
      assert.match(error.message, /PID:/);
      assert.match(error.message, /Port:/);
      return true;
    }
  );
});

test("同一ルートの別ポートと別ルートの同一ポートは同時取得できる", async (t) => {
  const root = await makeRoot(t, "scope-a");
  const otherRoot = await makeRoot(t, "scope-b");
  const locks = await Promise.all([
    acquireInstanceLock({ rootDir: root, port: TEST_PORT + 2, version: "test-version" }),
    acquireInstanceLock({ rootDir: root, port: TEST_PORT + 3, version: "test-version" }),
    acquireInstanceLock({ rootDir: otherRoot, port: TEST_PORT + 2, version: "test-version" })
  ]);
  t.after(() => Promise.all(locks.map((lock) => lock.release())));
  assert.equal(new Set(locks.map((lock) => lock.metadata.instanceId)).size, 3);
});

test("解放後は同じキーを再取得でき、ロックファイルも残さない", async (t) => {
  const root = await makeRoot(t, "release");
  const lockPath = getInstanceLockPath(root, TEST_PORT + 4);
  const first = await acquireInstanceLock({ rootDir: root, port: TEST_PORT + 4, version: "test-version" });
  await first.release();
  const second = await acquireInstanceLock({ rootDir: root, port: TEST_PORT + 4, version: "test-version" });
  await second.release();
  const synchronous = await acquireInstanceLock({ rootDir: root, port: TEST_PORT + 4, version: "test-version" });
  synchronous.releaseSync();
  t.after(() => Promise.all([first.release(), second.release(), synchronous.release()]));
  await assert.rejects(fs.access(lockPath), { code: "ENOENT" });
});

test("所有者でない解放処理は後から取得したロックを削除しない", async (t) => {
  const root = await makeRoot(t, "owner");
  const lockPath = getInstanceLockPath(root, TEST_PORT + 5);
  const first = await acquireInstanceLock({ rootDir: root, port: TEST_PORT + 5, version: "test-version" });
  await fs.rm(lockPath);
  const replacement = await acquireInstanceLock({ rootDir: root, port: TEST_PORT + 5, version: "test-version" });
  t.after(() => Promise.all([first.release(), replacement.release()]));

  await first.release();
  const current = await readMetadata(lockPath);
  assert.equal(current.instanceId, replacement.metadata.instanceId);
  await replacement.release();
  await assert.rejects(fs.access(lockPath), { code: "ENOENT" });
});

test("生存していないPIDのロックと壊れたJSONをstaleとして回収する", async (t) => {
  const root = await makeRoot(t, "stale");
  const lockPath = getInstanceLockPath(root, TEST_PORT + 6);
  await fs.mkdir(path.dirname(lockPath), { recursive: true });

  await fs.writeFile(lockPath, JSON.stringify(validMetadata(TEST_PORT + 6)), "utf8");
  const recoveredDeadPid = await acquireInstanceLock({ rootDir: root, port: TEST_PORT + 6, version: "test-version" });
  await recoveredDeadPid.release();

  for (const invalidContents of ["{broken", "{}"] ) {
    await fs.writeFile(lockPath, invalidContents, "utf8");
    const recoveredCorrupt = await acquireInstanceLock({ rootDir: root, port: TEST_PORT + 6, version: "test-version" });
    await recoveredCorrupt.release();
  }
  await assert.rejects(fs.access(lockPath), { code: "ENOENT" });
});

test("同時取得は一方だけが勝ち、競合側は非0終了相当のエラーになる", async (t) => {
  const root = await makeRoot(t, "race");
  const results = await Promise.allSettled([
    acquireInstanceLock({ rootDir: root, port: TEST_PORT + 7, version: "test-version" }),
    acquireInstanceLock({ rootDir: root, port: TEST_PORT + 7, version: "test-version" })
  ]);
  const winners = results.filter((result) => result.status === "fulfilled");
  const losers = results.filter((result) => result.status === "rejected");
  assert.equal(winners.length, 1);
  assert.equal(losers.length, 1);
  assert.equal(losers[0].reason.code, "INSTANCE_ALREADY_RUNNING");
  await winners[0].value.release();
  t.after(() => Promise.all(winners.map((result) => result.value.release())));
  await assert.rejects(fs.access(getInstanceLockPath(root, TEST_PORT + 7)), { code: "ENOENT" });
});
