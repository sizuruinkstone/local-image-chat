import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  OUTPUT_MARKER_FILENAME,
  STORAGE_SETTINGS_FILENAME,
  createStorageSettingsService,
  migrateOutputDirectory,
  scanOutputDirectory,
  validateOutputDirectory
} from "../src/storage-settings.js";

const QUIET_LOGGER = { warn() {}, info() {} };

async function makeSandbox(t, suffix = "case") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `local-image-chat-storage-${suffix}-`));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return {
    root,
    dataDir: path.join(root, "data"),
    sourceDir: path.join(root, "outputs")
  };
}

function serviceFor({ root, dataDir }, env = {}) {
  return createStorageSettingsService({ rootDir: root, dataDir, env, logger: QUIET_LOGGER });
}

async function writeMarker(directory) {
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, OUTPUT_MARKER_FILENAME), `${JSON.stringify({
    type: "local-image-chat-output",
    schemaVersion: 1,
    createdAt: "2026-08-07T00:00:00.000Z"
  })}\n`);
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeStoredSettings(sandbox, activeOutputDir, {
  pendingMigration = null,
  lastMigration = null
} = {}) {
  await writeJson(path.join(sandbox.dataDir, STORAGE_SETTINGS_FILENAME), {
    schemaVersion: 1,
    activeOutputDir,
    pendingMigration,
    lastMigration
  });
}

test("既定・stored・envの保存先優先順位と壊れたJSONのfallback", async (t) => {
  const sandbox = await makeSandbox(t, "priority");
  const defaultService = serviceFor(sandbox);
  const defaultSettings = await defaultService.getSettings();
  assert.equal(defaultSettings.currentOutputDir, sandbox.sourceDir);
  assert.equal(defaultSettings.source, "default");
  assert.equal(defaultSettings.editable, true);

  const storedDir = path.join(sandbox.root, "保存先 (stored)");
  await writeMarker(storedDir);
  await fs.writeFile(path.join(storedDir, "stored.png"), "stored");
  await writeStoredSettings(sandbox, storedDir);
  const storedSettings = await serviceFor(sandbox).getSettings();
  assert.equal(storedSettings.currentOutputDir, path.normalize(storedDir));
  assert.equal(storedSettings.source, "stored");

  const envDir = path.join(sandbox.root, "env-output");
  const envSettings = await serviceFor(sandbox, { LOCAL_IMAGE_CHAT_OUTPUT_DIR: envDir }).getSettings();
  assert.equal(envSettings.currentOutputDir, path.normalize(envDir));
  assert.equal(envSettings.source, "env");
  assert.equal(envSettings.editable, false);
  assert.equal(envSettings.favorites.followsOutputDir, true);

  await fs.writeFile(path.join(sandbox.dataDir, "storage-settings.json"), "{broken", "utf8");
  const fallback = await serviceFor(sandbox).getSettings();
  assert.equal(fallback.currentOutputDir, sandbox.sourceDir);
  assert.equal(fallback.source, "default");
});

test("markerなしのstored active pathは既定outputsへfallbackし、内容を変更しない", async (t) => {
  const sandbox = await makeSandbox(t, "stored-unmanaged");
  const unmanaged = path.join(sandbox.root, "unmanaged");
  const secretPath = path.join(unmanaged, "secret.txt");
  await fs.mkdir(unmanaged, { recursive: true });
  await fs.writeFile(secretPath, "do not expose");
  await writeStoredSettings(sandbox, unmanaged);

  const settings = await serviceFor(sandbox).getSettings();
  assert.equal(settings.currentOutputDir, sandbox.sourceDir);
  assert.equal(settings.source, "default");
  assert.equal(await fs.readFile(secretPath, "utf8"), "do not expose");
  assert.equal(await fileExists(path.join(unmanaged, OUTPUT_MARKER_FILENAME)), false);
});

test("空または削除済みのstored active pathを作成せずfallbackする", async (t) => {
  const sandbox = await makeSandbox(t, "stored-missing");
  const emptyStored = path.join(sandbox.root, "empty-stored");
  await fs.mkdir(emptyStored, { recursive: true });
  await writeStoredSettings(sandbox, emptyStored);

  const emptySettings = await serviceFor(sandbox).getSettings();
  assert.equal(emptySettings.currentOutputDir, sandbox.sourceDir);
  assert.equal(emptySettings.source, "default");
  assert.equal(await fileExists(emptyStored), true);
  assert.equal(await fileExists(path.join(emptyStored, OUTPUT_MARKER_FILENAME)), false);

  const deletedStored = path.join(sandbox.root, "deleted-stored");
  await writeStoredSettings(sandbox, deletedStored);
  const deletedSettings = await serviceFor(sandbox).getSettings();
  assert.equal(deletedSettings.currentOutputDir, sandbox.sourceDir);
  assert.equal(deletedSettings.source, "default");
  assert.equal(await fileExists(deletedStored), false);
});

test("不正marker・通常ファイル・禁止パスのstored active pathを採用しない", async (t) => {
  const sandbox = await makeSandbox(t, "stored-invalid");
  const markerCases = [
    ["broken", "{broken"],
    ["wrong-type", JSON.stringify({ type: "other", schemaVersion: 1, createdAt: "2026-08-07T00:00:00.000Z" })],
    ["wrong-schema", JSON.stringify({ type: "local-image-chat-output", schemaVersion: 999, createdAt: "2026-08-07T00:00:00.000Z" })]
  ];
  for (const [label, markerText] of markerCases) {
    const target = path.join(sandbox.root, `invalid-${label}`);
    const markerPath = path.join(target, OUTPUT_MARKER_FILENAME);
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(markerPath, markerText);
    await writeStoredSettings(sandbox, target);
    const settings = await serviceFor(sandbox).getSettings();
    assert.equal(settings.currentOutputDir, sandbox.sourceDir, label);
    assert.equal(await fs.readFile(markerPath, "utf8"), markerText, label);
  }

  const regularFile = path.join(sandbox.root, "stored-file");
  await fs.writeFile(regularFile, "not a directory");
  await writeStoredSettings(sandbox, regularFile);
  const fileSettings = await serviceFor(sandbox).getSettings();
  assert.equal(fileSettings.currentOutputDir, sandbox.sourceDir);
  assert.equal(await fs.readFile(regularFile, "utf8"), "not a directory");

  for (const forbidden of [sandbox.root, path.join(sandbox.root, "data")]) {
    await writeStoredSettings(sandbox, forbidden);
    const forbiddenSettings = await serviceFor(sandbox).getSettings();
    assert.equal(forbiddenSettings.currentOutputDir, sandbox.sourceDir);
    assert.equal(forbiddenSettings.source, "default");
  }
});

test("stored active pathの対象または祖先がsymlink・junctionならfallbackする", async (t) => {
  const sandbox = await makeSandbox(t, "stored-links");
  const outside = path.join(sandbox.root, "outside");
  await fs.mkdir(outside, { recursive: true });
  const targetLink = path.join(sandbox.root, "stored-link");
  const ancestorLink = path.join(sandbox.root, "ancestor-link");
  try {
    await fs.symlink(outside, targetLink, process.platform === "win32" ? "junction" : "dir");
    await fs.symlink(outside, ancestorLink, process.platform === "win32" ? "junction" : "dir");
  } catch {
    t.skip("この環境ではsymlink/junctionを作成できません");
    return;
  }

  await writeStoredSettings(sandbox, targetLink);
  const targetLinkSettings = await serviceFor(sandbox).getSettings();
  assert.equal(targetLinkSettings.currentOutputDir, sandbox.sourceDir);

  await writeStoredSettings(sandbox, path.join(ancestorLink, "nested"));
  const ancestorLinkSettings = await serviceFor(sandbox).getSettings();
  assert.equal(ancestorLinkSettings.currentOutputDir, sandbox.sourceDir);
  assert.equal(await fileExists(path.join(ancestorLink, "nested")), false);
});

test("不正stored pathへのfallbackでpendingMigrationとlastMigrationを保持する", async (t) => {
  const sandbox = await makeSandbox(t, "stored-state");
  const pendingTarget = path.join(sandbox.root, "pending-target");
  await writeStoredSettings(sandbox, path.join(sandbox.root, "missing-stored"), {
    pendingMigration: {
      targetOutputDir: pendingTarget,
      requestedAt: "2026-08-07T00:00:00.000Z",
      status: "pending"
    },
    lastMigration: {
      status: "completed",
      completedAt: "2026-08-06T00:00:00.000Z",
      copiedFiles: 1,
      copiedBytes: 10
    }
  });

  const settings = await serviceFor(sandbox).getSettings();
  assert.equal(settings.currentOutputDir, sandbox.sourceDir);
  assert.equal(settings.source, "default");
  assert.equal(settings.pendingStatus, "pending");
  assert.equal(settings.pendingOutputDir, path.normalize(pendingTarget));
  assert.equal(settings.restartRequired, true);
  assert.equal(settings.lastMigration.status, "completed");
  assert.equal(await fileExists(path.join(sandbox.root, "missing-stored")), false);
});

test("危険なパス、current outputの親子、未管理フォルダを拒否する", async (t) => {
  const sandbox = await makeSandbox(t, "validation");
  const current = sandbox.sourceDir;
  const cases = [
    ["relative", "relative-output"],
    ["root", path.parse(sandbox.root).root],
    ["repository", sandbox.root],
    ["public", path.join(sandbox.root, "public")],
    ["src", path.join(sandbox.root, "src")],
    ["data", path.join(sandbox.root, "data")],
    ["node_modules", path.join(sandbox.root, "node_modules", "nested")],
    ["current parent", path.dirname(current)],
    ["current child", path.join(current, "nested")]
  ];
  for (const [label, candidate] of cases) {
    await assert.rejects(
      validateOutputDirectory(candidate, { rootDir: sandbox.root, currentOutputDir: current, probe: false }),
      { name: "StorageSettingsError" },
      label
    );
  }

  const outsideRoot = path.join(sandbox.root, "storage-safe-targets");
  const japaneseTarget = path.join(outsideRoot, "日本語 (long folder name) ".repeat(4));
  const allowed = await validateOutputDirectory(japaneseTarget, {
    rootDir: sandbox.root,
    currentOutputDir: current
  });
  assert.equal(allowed.exists, false);
  assert.equal(allowed.targetOutputDir, path.normalize(japaneseTarget.trim()));

  const emptyTarget = path.join(outsideRoot, "empty");
  await fs.mkdir(emptyTarget, { recursive: true });
  assert.equal((await validateOutputDirectory(emptyTarget, {
    rootDir: sandbox.root,
    currentOutputDir: current
  })).exists, true);

  const unmanagedTarget = path.join(outsideRoot, "unmanaged");
  await fs.mkdir(unmanagedTarget, { recursive: true });
  await fs.writeFile(path.join(unmanagedTarget, "not-managed.txt"), "do not expose");
  await assert.rejects(
    validateOutputDirectory(unmanagedTarget, { rootDir: sandbox.root, currentOutputDir: current, probe: false }),
    /専用marker/
  );

  const regularFile = path.join(outsideRoot, "regular-file");
  await fs.mkdir(path.dirname(regularFile), { recursive: true });
  await fs.writeFile(regularFile, "file");
  await assert.rejects(
    validateOutputDirectory(regularFile, { rootDir: sandbox.root, currentOutputDir: current, probe: false }),
    /通常のディレクトリ/
  );

  const markerTarget = path.join(outsideRoot, "managed");
  await writeMarker(markerTarget);
  await fs.writeFile(path.join(markerTarget, "existing.png"), "managed");
  assert.equal((await validateOutputDirectory(markerTarget, {
    rootDir: sandbox.root,
    currentOutputDir: current
  })).marker.valid, true);
});

test("symlink・junction経由の保存先を拒否する（作成可能な環境のみ）", async (t) => {
  const sandbox = await makeSandbox(t, "links");
  const outside = path.join(sandbox.root, "outside");
  await fs.mkdir(outside, { recursive: true });
  const link = path.join(sandbox.root, "output-link");
  try {
    await fs.symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
  } catch {
    t.skip("この環境ではsymlink/junctionを作成できません");
    return;
  }
  await assert.rejects(
    validateOutputDirectory(path.join(link, "nested"), { rootDir: sandbox.root, currentOutputDir: sandbox.sourceDir, probe: false }),
    /シンボリックリンク|junction/
  );
});

test("planは再帰的な画像・favorite・thumbnail・参照画像・maskを集計し、設定を変更しない", async (t) => {
  const sandbox = await makeSandbox(t, "plan");
  const files = [
    ["image.png", "image"],
    ["thumbnails/image.webp", "thumbnail"],
    ["favorite/image.png", "favorite"],
    ["uploads/reference.png", "reference"],
    ["masks/mask.png", "mask"]
  ];
  for (const [relative, value] of files) {
    const filePath = path.join(sandbox.sourceDir, relative);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, value);
  }
  await writeMarker(sandbox.sourceDir);
  const target = path.join(sandbox.root, "plan-target");
  const service = serviceFor(sandbox);
  const plan = await service.plan(target);
  assert.equal(plan.valid, true, plan.error);
  assert.equal(plan.sourceFiles, files.length);
  assert.equal(plan.sourceBytes, files.reduce((total, [, value]) => total + Buffer.byteLength(value), 0));
  assert.equal(plan.existingTargetFiles, 0);
  assert.equal(plan.willCopyExisting, true);
  assert.equal(plan.willKeepSource, true);
  assert.equal(await fileExists(path.join(sandbox.dataDir, "storage-settings.json")), false);
  assert.equal(await fileExists(target), false, "planはtarget directoryを作成しない");

  const sameCurrentPlan = await serviceFor(sandbox, {
    LOCAL_IMAGE_CHAT_OUTPUT_DIR: sandbox.sourceDir
  }).plan(sandbox.sourceDir);
  assert.equal(sameCurrentPlan.valid, true, sameCurrentPlan.error);
  assert.equal(sameCurrentPlan.restartRequired, false);
});

test("予約はconfirm必須で、サーバー側再計算と原子的なpending保存を行う", async (t) => {
  const sandbox = await makeSandbox(t, "reserve");
  await fs.mkdir(sandbox.sourceDir, { recursive: true });
  const target = path.join(sandbox.root, "reserve-target");
  const service = serviceFor(sandbox);
  await assert.rejects(service.reserve(target), /confirmMigration/);
  const reserved = await service.reserve(target, { confirmMigration: true });
  assert.equal(reserved.restartRequired, true);
  assert.equal(reserved.sourceFiles, 0);
  const stored = JSON.parse(await fs.readFile(path.join(sandbox.dataDir, "storage-settings.json"), "utf8"));
  assert.equal(stored.activeOutputDir, sandbox.sourceDir);
  assert.equal(stored.pendingMigration.status, "pending");
  assert.equal(stored.pendingMigration.targetOutputDir, path.normalize(target));
  assert.equal(await fileExists(`${path.join(sandbox.dataDir, "storage-settings.json")}.${process.pid}.tmp`), false);
  await assert.rejects(
    service.reserve(target, { confirmMigration: true }),
    /同じ移行予約/
  );

  const envService = serviceFor(sandbox, { LOCAL_IMAGE_CHAT_OUTPUT_DIR: path.join(sandbox.root, "fixed") });
  await assert.rejects(
    envService.reserve(path.join(sandbox.root, "other"), { confirmMigration: true }),
    /固定されている/
  );
});

test("再起動時移行はlisten前に全fixtureをコピーし、sourceを残して成功時だけactiveを切り替える", async (t) => {
  const sandbox = await makeSandbox(t, "migration-success");
  const fixture = [
    ["image.png", "image-content"],
    ["thumbnails/image.webp", "thumbnail-content"],
    ["favorite/image.png", "favorite-content"],
    ["uploads/reference.png", "reference-content"],
    ["masks/mask.png", "mask-content"]
  ];
  for (const [relative, value] of fixture) {
    const filePath = path.join(sandbox.sourceDir, relative);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, value);
  }
  const target = path.join(sandbox.root, "migration-target");
  const service = serviceFor(sandbox);
  await service.reserve(target, { confirmMigration: true });
  assert.equal((await service.getSettings()).currentOutputDir, sandbox.sourceDir);

  const startup = await service.prepareStartup();
  assert.equal(startup.migrated, true);
  assert.equal(startup.outputDir, path.normalize(target));
  for (const [relative, value] of fixture) {
    assert.equal(await fs.readFile(path.join(target, relative), "utf8"), value);
    assert.equal(await fs.readFile(path.join(sandbox.sourceDir, relative), "utf8"), value);
  }
  const markerText = await fs.readFile(path.join(target, OUTPUT_MARKER_FILENAME), "utf8");
  assert.doesNotMatch(markerText, new RegExp(sandbox.root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  assert.doesNotMatch(markerText, /webhook|integration|secret|token/i);
  const settings = await service.getSettings();
  assert.equal(settings.currentOutputDir, path.normalize(target));
  assert.equal(settings.pendingOutputDir, null);
  assert.equal(settings.lastMigration.status, "completed");
  assert.equal(settings.lastMigration.copiedFiles, fixture.length);
});

test("同名同内容は再利用し、同名異内容は上書きせずfailed fallbackにする", async (t) => {
  const sandbox = await makeSandbox(t, "migration-collision");
  await fs.mkdir(sandbox.sourceDir, { recursive: true });
  await fs.writeFile(path.join(sandbox.sourceDir, "same.png"), "source-content");
  const reuseTarget = path.join(sandbox.root, "reuse-target");
  await fs.mkdir(reuseTarget, { recursive: true });
  await fs.writeFile(path.join(reuseTarget, "same.png"), "source-content");
  await writeMarker(reuseTarget);
  const reuseResult = await migrateOutputDirectory({
    sourceOutputDir: sandbox.sourceDir,
    targetOutputDir: reuseTarget,
    logger: QUIET_LOGGER
  });
  assert.equal(reuseResult.copiedFiles, 0);
  assert.equal(await fs.readFile(path.join(reuseTarget, "same.png"), "utf8"), "source-content");

  const collisionTarget = path.join(sandbox.root, "collision-target");
  await fs.mkdir(collisionTarget, { recursive: true });
  await fs.writeFile(path.join(collisionTarget, "same.png"), "different-content");
  await writeMarker(collisionTarget);
  const service = serviceFor(sandbox);
  await service.reserve(collisionTarget, { confirmMigration: true });
  const failed = await service.prepareStartup();
  assert.equal(failed.migrated, false);
  assert.equal(failed.outputDir, sandbox.sourceDir);
  const failedSettings = await service.getSettings();
  assert.equal(failedSettings.currentOutputDir, sandbox.sourceDir);
  assert.equal(failedSettings.pendingStatus, "failed");
  assert.equal(failedSettings.lastMigration.status, "failed");
  assert.equal(await fs.readFile(path.join(collisionTarget, "same.png"), "utf8"), "different-content");
  assert.equal(await fs.readFile(path.join(sandbox.sourceDir, "same.png"), "utf8"), "source-content");

  // failed後は自動再試行せず、明示的な再予約が必要。
  const secondBoot = await service.prepareStartup();
  assert.equal(secondBoot.migrated, false);
  assert.equal((await service.getSettings()).pendingStatus, "failed");

  await fs.writeFile(path.join(collisionTarget, "same.png"), "source-content");
  await service.reserve(collisionTarget, { confirmMigration: true });
  const retry = await service.prepareStartup();
  assert.equal(retry.migrated, true);
  assert.equal((await service.getSettings()).lastMigration.status, "completed");
});

test("同一サービスの同時startupは移行を二重実行せず、途中tempは完成ファイルとして数えない", async (t) => {
  const sandbox = await makeSandbox(t, "migration-concurrency");
  await fs.mkdir(sandbox.sourceDir, { recursive: true });
  await fs.writeFile(path.join(sandbox.sourceDir, "image.png"), "content");
  const target = path.join(sandbox.root, "concurrent-target");
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(target, ".local-image-chat-copy-old.tmp"), "incomplete");
  const before = await scanOutputDirectory(target);
  assert.equal(before.fileCount, 0);

  const service = serviceFor(sandbox);
  await service.reserve(target, { confirmMigration: true });
  const results = await Promise.all([service.prepareStartup(), service.prepareStartup()]);
  assert.equal(results.filter((result) => result.migrated).length, 1);
  assert.equal((await service.getSettings()).lastMigration.status, "completed");
  assert.equal(await fs.readFile(path.join(target, "image.png"), "utf8"), "content");
});

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
