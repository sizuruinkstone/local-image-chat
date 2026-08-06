import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

export const STORAGE_SCHEMA_VERSION = 1;
export const STORAGE_SETTINGS_FILENAME = "storage-settings.json";
export const OUTPUT_MARKER_FILENAME = ".local-image-chat-output.json";

const COPY_TEMP_PREFIX = ".local-image-chat-copy-";
const MARKER_TEMP_PREFIX = ".local-image-chat-marker-";
const WRITE_PROBE_PREFIX = ".local-image-chat-write-probe-";
const SAFE_MIGRATION_STATUSES = new Set(["pending", "failed"]);
const STORAGE_OPERATION_QUEUES = new Map();

export class StorageSettingsError extends Error {
  constructor(message, { statusCode = 400, code = "STORAGE_SETTINGS_ERROR", progress = null } = {}) {
    super(message);
    this.name = "StorageSettingsError";
    this.statusCode = statusCode;
    this.code = code;
    this.progress = progress;
  }
}

export function createStorageSettingsService({ rootDir, dataDir, env = process.env, logger = console }) {
  const resolvedRootDir = path.resolve(rootDir);
  const resolvedDataDir = path.resolve(dataDir);
  const defaultOutputDir = path.join(resolvedRootDir, "outputs");
  const settingsPath = path.join(resolvedDataDir, STORAGE_SETTINGS_FILENAME);
  const envOutputDir = readEnvironmentOutputDir(env);
  const envFavoritesDir = readEnvironmentFavoritesDir(env);
  let runtimeOutputDir = envOutputDir ?? defaultOutputDir;
  let runtimeSource = envOutputDir ? "env" : "default";
  const operationKey = process.platform === "win32"
    ? settingsPath.toLowerCase()
    : settingsPath;

  function serialize(operation) {
    const previous = STORAGE_OPERATION_QUEUES.get(operationKey) ?? Promise.resolve();
    const next = previous.then(operation);
    const settled = next.catch(() => {});
    STORAGE_OPERATION_QUEUES.set(operationKey, settled);
    void settled.finally(() => {
      if (STORAGE_OPERATION_QUEUES.get(operationKey) === settled) STORAGE_OPERATION_QUEUES.delete(operationKey);
    });
    return next;
  }

  async function readSettings() {
    try {
      const value = JSON.parse(await fs.readFile(settingsPath, "utf8"));
      return normalizeSettings(value);
    } catch (error) {
      if (error?.code === "ENOENT") return emptySettings();
      logger.warn?.("[Storage] storage-settings.jsonが壊れているため既定outputsへフォールバックします。");
      return emptySettings();
    }
  }

  async function writeSettings(value) {
    await fs.mkdir(resolvedDataDir, { recursive: true });
    const temporaryPath = `${settingsPath}.${process.pid}-${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(normalizeSettings(value), null, 2)}\n`, "utf8");
      await fs.rename(temporaryPath, settingsPath);
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => {});
    }
  }

  async function resolveStoredOutputDir(settings) {
    if (!settings.activeOutputDir) {
      return { outputDir: defaultOutputDir, source: "default" };
    }
    try {
      const candidate = normalizeAbsolutePath(settings.activeOutputDir);
      await validatePathSafety(candidate, {
        rootDir: resolvedRootDir,
        allowDefaultOutput: true,
        requireManagedMarker: true,
        skipContentScan: true
      });
      return { outputDir: candidate, source: "stored" };
    } catch (error) {
      logger.warn?.("[Storage] 保存済みoutputDirが安全条件を満たさないため既定outputsへフォールバックします。");
      return { outputDir: defaultOutputDir, source: "default" };
    }
  }

  async function resolveRuntime(settings = null) {
    if (envOutputDir) {
      runtimeOutputDir = envOutputDir;
      runtimeSource = "env";
      return { outputDir: runtimeOutputDir, source: runtimeSource };
    }
    const resolved = await resolveStoredOutputDir(settings ?? await readSettings());
    runtimeOutputDir = resolved.outputDir;
    runtimeSource = resolved.source;
    return resolved;
  }

  async function getSettings() {
    const settings = await readSettings();
    const runtime = await resolveRuntime(settings);
    const pending = getPublicPending(settings);
    return {
      currentOutputDir: runtime.outputDir,
      source: runtime.source,
      editable: !envOutputDir,
      restartRequired: !envOutputDir && pending?.status === "pending",
      pendingOutputDir: pending?.targetOutputDir ?? null,
      pendingStatus: pending?.status ?? null,
      favorites: {
        followsOutputDir: !envFavoritesDir,
        source: envFavoritesDir ? "env" : "output"
      },
      lastMigration: settings.lastMigration
    };
  }

  async function plan(targetOutputDir, { allowPendingTarget = false } = {}) {
    const settings = await readSettings();
    const runtime = await resolveRuntime(settings);
    let retryFailedTarget = false;
    try {
      retryFailedTarget = settings.pendingMigration?.status === "failed"
        && samePath(normalizeAbsolutePath(targetOutputDir), settings.pendingMigration.targetOutputDir);
    } catch {
      retryFailedTarget = false;
    }
    return buildPlan(targetOutputDir, {
      currentOutputDir: runtime.outputDir,
      allowPendingTarget: allowPendingTarget || retryFailedTarget,
      pendingTargetOutputDir: settings.pendingMigration?.targetOutputDir ?? null
    });
  }

  async function reserve(targetOutputDir, { confirmMigration = false } = {}) {
    if (envOutputDir) {
      throw new StorageSettingsError(
        "LOCAL_IMAGE_CHAT_OUTPUT_DIRで保存先が固定されているため変更できません",
        { statusCode: 409, code: "STORAGE_OUTPUT_DIR_FIXED" }
      );
    }
    if (confirmMigration !== true) {
      throw new StorageSettingsError("confirmMigrationが必要です", {
        statusCode: 400,
        code: "STORAGE_CONFIRMATION_REQUIRED"
      });
    }

    return serialize(async () => {
      const settings = await readSettings();
      const runtime = await resolveRuntime(settings);
      const pending = getPublicPending(settings);
      const normalizedTarget = normalizeAbsolutePath(targetOutputDir);
      if (pending?.status === "pending" && !samePath(pending.targetOutputDir, normalizedTarget)) {
        throw new StorageSettingsError("既存の移行予約を解除してから別の保存先を指定してください", {
          statusCode: 409,
          code: "STORAGE_MIGRATION_ALREADY_PENDING"
        });
      }
      if (pending?.status === "pending" && samePath(pending.targetOutputDir, normalizedTarget)) {
        throw new StorageSettingsError("同じ移行予約がすでに存在します", {
          statusCode: 409,
          code: "STORAGE_MIGRATION_DUPLICATE"
        });
      }
      if (pending?.status === "failed" && !samePath(pending.targetOutputDir, normalizedTarget)) {
        throw new StorageSettingsError("前回の移行予約を解除してから別の保存先を指定してください", {
          statusCode: 409,
          code: "STORAGE_MIGRATION_FAILED_PENDING"
        });
      }

      const migrationPlan = await buildPlan(normalizedTarget, {
        currentOutputDir: runtime.outputDir,
        allowPendingTarget: pending?.status === "failed"
          && samePath(pending.targetOutputDir, normalizedTarget),
        pendingTargetOutputDir: pending?.targetOutputDir ?? null
      });
      if (!migrationPlan.valid) {
        throw new StorageSettingsError(migrationPlan.error, {
          statusCode: 400,
          code: "STORAGE_PLAN_INVALID"
        });
      }
      if (!migrationPlan.restartRequired) {
        throw new StorageSettingsError("現在と同じ保存先です", {
          statusCode: 400,
          code: "STORAGE_OUTPUT_DIR_UNCHANGED"
        });
      }

      const next = {
        ...settings,
        schemaVersion: STORAGE_SCHEMA_VERSION,
        activeOutputDir: settings.activeOutputDir ?? runtime.outputDir,
        pendingMigration: {
          targetOutputDir: migrationPlan.targetOutputDir,
          requestedAt: new Date().toISOString(),
          status: "pending"
        }
      };
      await writeSettings(next);
      return {
        ...migrationPlan,
        pendingOutputDir: migrationPlan.targetOutputDir,
        restartRequired: true
      };
    });
  }

  async function cancelPending() {
    return serialize(async () => {
      const settings = await readSettings();
      if (!settings.pendingMigration) return getPublicSettingsFromValue(settings);
      await writeSettings({ ...settings, pendingMigration: null });
      return getPublicSettingsFromValue({ ...settings, pendingMigration: null });
    });
  }

  async function prepareStartup() {
    return serialize(async () => {
      const settings = await readSettings();
      const runtime = await resolveRuntime(settings);
      if (envOutputDir || settings.pendingMigration?.status !== "pending") {
        return { outputDir: runtime.outputDir, source: runtime.source, migrated: false };
      }

      const pendingTarget = settings.pendingMigration.targetOutputDir;
      let migrationPlan;
      try {
        migrationPlan = await buildPlan(pendingTarget, {
          currentOutputDir: runtime.outputDir,
          allowPendingTarget: true,
          pendingTargetOutputDir: pendingTarget
        });
      } catch (error) {
        migrationPlan = { valid: false, error: safeMigrationReason(error) };
      }

      if (!migrationPlan.valid) {
        await markMigrationFailed(settings, migrationPlan.error ?? "移行先を検証できませんでした");
        logger.warn?.(`[Storage] 移行を中止し、旧保存先で起動します: ${migrationPlan.error}`);
        return { outputDir: runtime.outputDir, source: runtime.source, migrated: false, migrationFailed: true };
      }

      try {
        const result = await migrateOutputDirectory({
          sourceOutputDir: runtime.outputDir,
          targetOutputDir: migrationPlan.targetOutputDir,
          sourcePlan: migrationPlan,
          logger
        });
        await writeSettings({
          ...settings,
          activeOutputDir: migrationPlan.targetOutputDir,
          pendingMigration: null,
          lastMigration: {
            status: "completed",
            completedAt: new Date().toISOString(),
            copiedFiles: result.sourceFiles,
            copiedBytes: result.sourceBytes
          }
        });
        runtimeOutputDir = migrationPlan.targetOutputDir;
        runtimeSource = "stored";
        return {
          outputDir: runtimeOutputDir,
          source: runtimeSource,
          migrated: true,
          copiedFiles: result.sourceFiles,
          copiedBytes: result.sourceBytes
        };
      } catch (error) {
        const reason = safeMigrationReason(error);
        await markMigrationFailed(settings, reason, error?.progress);
        logger.warn?.(`[Storage] 移行に失敗したため旧保存先で起動します: ${reason}`);
        return { outputDir: runtime.outputDir, source: runtime.source, migrated: false, migrationFailed: true };
      }
    });
  }

  async function markMigrationFailed(settings, reason, progress = null) {
    const currentPending = settings.pendingMigration;
    const failedPending = currentPending
      ? { ...currentPending, status: "failed" }
      : null;
    try {
      await writeSettings({
        ...settings,
        pendingMigration: failedPending,
        lastMigration: {
          status: "failed",
          failedAt: new Date().toISOString(),
          reason: String(reason ?? "移行に失敗しました").slice(0, 180),
          copiedFiles: Number.isInteger(progress?.copiedFiles) ? progress.copiedFiles : 0,
          copiedBytes: Number.isFinite(progress?.copiedBytes) ? progress.copiedBytes : 0
        }
      });
    } catch {
      logger.warn?.("[Storage] 移行失敗状態を保存できませんでした。旧保存先を継続します。");
    }
  }

  function getPublicSettingsFromValue(settings) {
    const pending = getPublicPending(settings);
    return {
      currentOutputDir: runtimeOutputDir,
      source: runtimeSource,
      editable: !envOutputDir,
      restartRequired: !envOutputDir && pending?.status === "pending",
      pendingOutputDir: pending?.targetOutputDir ?? null,
      pendingStatus: pending?.status ?? null,
      favorites: {
        followsOutputDir: !envFavoritesDir,
        source: envFavoritesDir ? "env" : "output"
      },
      lastMigration: settings.lastMigration
    };
  }

  return {
    getSettings,
    plan,
    reserve,
    cancelPending,
    prepareStartup,
    settingsPath,
    defaultOutputDir,
    getPublicSettings: async () => getPublicSettingsFromValue(await readSettings())
  };

  async function buildPlan(targetOutputDir, {
    currentOutputDir,
    allowPendingTarget = false,
    pendingTargetOutputDir = null
  } = {}) {
    let normalizedTarget;
    try {
      normalizedTarget = normalizeAbsolutePath(targetOutputDir);
      const isCurrent = samePath(normalizedTarget, currentOutputDir);
      const isPendingTarget = allowPendingTarget
        && pendingTargetOutputDir
        && samePath(normalizedTarget, pendingTargetOutputDir);
      const targetInfo = await validateOutputDirectory(normalizedTarget, {
        rootDir: resolvedRootDir,
        currentOutputDir,
        allowSameCurrent: isCurrent,
        allowExistingActive: isCurrent,
        allowPendingTarget: isPendingTarget,
        allowDefaultOutput: samePath(normalizedTarget, defaultOutputDir),
        probe: true
      });
      const sourceScan = await scanOutputDirectory(currentOutputDir);
      const targetScan = await scanOutputDirectory(normalizedTarget);
      const availableBytes = await getAvailableBytes(targetInfo.probeDirectory);
      const spaceShortage = !isCurrent
        && availableBytes !== null
        && sourceScan.totalBytes > availableBytes;
      if (spaceShortage) {
        return buildInvalidPlan(normalizedTarget, "空き容量が不足しています", {
          sourceScan,
          targetScan,
          availableBytes
        });
      }
      return {
        valid: true,
        targetOutputDir: normalizedTarget,
        sourceFiles: sourceScan.fileCount,
        sourceBytes: sourceScan.totalBytes,
        availableBytes,
        availableBytesKnown: availableBytes !== null,
        existingTargetFiles: targetScan.fileCount,
        willCopyExisting: !isCurrent,
        willKeepSource: true,
        restartRequired: !isCurrent,
        targetExists: targetInfo.exists,
        targetHasMarker: targetInfo.marker.valid,
        sourceHasSymlinks: sourceScan.symlinks.length > 0
      };
    } catch (error) {
      return buildInvalidPlan(
        normalizedTarget ?? null,
        safeMigrationReason(error)
      );
    }
  }
}

export function emptyStorageSettings() {
  return emptySettings();
}

export function normalizeStorageSettings(value) {
  return normalizeSettings(value);
}

export function isValidOutputMarker(value) {
  const keys = value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value)
    : [];
  return Boolean(
    value
    && keys.every((key) => ["type", "schemaVersion", "createdAt"].includes(key))
    && value.type === "local-image-chat-output"
    && value.schemaVersion === STORAGE_SCHEMA_VERSION
    && typeof value.createdAt === "string"
    && Number.isFinite(Date.parse(value.createdAt))
  );
}

export async function validateOutputDirectory(targetOutputDir, options = {}) {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const currentOutputDir = options.currentOutputDir ? path.resolve(options.currentOutputDir) : null;
  const normalizedTarget = normalizeAbsolutePath(targetOutputDir);
  await validatePathSafety(normalizedTarget, {
    rootDir,
    currentOutputDir,
    allowSameCurrent: options.allowSameCurrent === true,
    allowExistingActive: options.allowExistingActive === true,
    allowPendingTarget: options.allowPendingTarget === true,
    allowDefaultOutput: options.allowDefaultOutput === true
  });

  const targetInfo = await inspectTargetDirectory(normalizedTarget);
  if (targetInfo.specialFiles.length) {
    throw new StorageSettingsError("移行先に対応していないファイルがあります", { code: "STORAGE_TARGET_SPECIAL_FILE" });
  }
  if (targetInfo.symlinks.length) {
    throw new StorageSettingsError("移行先にシンボリックリンクまたはjunctionがあります", {
      code: "STORAGE_TARGET_LINK"
    });
  }
  if (targetInfo.exists && !targetInfo.marker.valid) {
    const isDefault = options.allowDefaultOutput === true;
    const isPending = options.allowPendingTarget === true;
    const hasManagedFiles = targetInfo.scan.fileCount > 0;
    if (!isDefault && !isPending && !options.allowExistingActive && hasManagedFiles) {
      throw new StorageSettingsError("空またはLocal Image Chat専用marker付きの保存先を指定してください", {
        code: "STORAGE_TARGET_UNMANAGED"
      });
    }
    if (targetInfo.marker.present && !isPending && !isDefault && !options.allowExistingActive) {
      throw new StorageSettingsError("保存先のmarkerが不正です", { code: "STORAGE_TARGET_MARKER" });
    }
  }

  const probeDirectory = targetInfo.exists ? normalizedTarget : targetInfo.existingAncestor;
  if (options.probe !== false) await probeWritableDirectory(probeDirectory);
  return {
    targetOutputDir: normalizedTarget,
    exists: targetInfo.exists,
    marker: targetInfo.marker,
    scan: targetInfo.scan,
    probeDirectory
  };
}

export async function scanOutputDirectory(outputDir) {
  const rootDir = path.resolve(outputDir);
  const files = [];
  const symlinks = [];
  const specialFiles = [];

  let rootStats;
  try {
    rootStats = await fs.lstat(rootDir);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { files, symlinks, specialFiles, fileCount: 0, totalBytes: 0 };
    }
    throw error;
  }
  if (!rootStats.isDirectory()) {
    throw new StorageSettingsError("現在の保存先がディレクトリではありません", {
      code: "STORAGE_SOURCE_NOT_DIRECTORY"
    });
  }

  async function visit(directory) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(rootDir, absolutePath);
      let stats;
      try {
        stats = await fs.lstat(absolutePath);
      } catch (error) {
        if (error?.code === "ENOENT") continue;
        throw error;
      }
      if (stats.isSymbolicLink()) {
        symlinks.push(relativePath);
        continue;
      }
      if (stats.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (stats.isFile()) {
        if (relativePath === OUTPUT_MARKER_FILENAME || isTemporaryFile(relativePath)) continue;
        files.push({ relativePath, bytes: stats.size });
        continue;
      }
      specialFiles.push(relativePath);
    }
  }

  await visit(rootDir);
  return {
    files,
    symlinks,
    specialFiles,
    fileCount: files.length,
    totalBytes: files.reduce((total, file) => total + file.bytes, 0)
  };
}

export async function migrateOutputDirectory({
  sourceOutputDir,
  targetOutputDir,
  sourcePlan = null,
  logger = console
}) {
  const sourceDir = path.resolve(sourceOutputDir);
  const targetDir = path.resolve(targetOutputDir);
  const initialSource = sourcePlan?.sourceFiles !== undefined
    ? await scanOutputDirectory(sourceDir)
    : await scanOutputDirectory(sourceDir);
  let copiedFiles = 0;
  let copiedBytes = 0;
  const progress = () => ({ copiedFiles, copiedBytes });

  try {
    await fs.mkdir(targetDir, { recursive: true });
    const targetValidation = await validateOutputDirectory(targetDir, {
      rootDir: path.dirname(targetDir),
      currentOutputDir: sourceDir,
      allowPendingTarget: true,
      allowDefaultOutput: false,
      probe: true
    });
    if (targetValidation.symlinks?.length || targetValidation.scan.symlinks.length) {
      throw new StorageSettingsError("移行先にシンボリックリンクまたはjunctionがあります", {
        code: "STORAGE_TARGET_LINK",
        progress: progress()
      });
    }

    for (const file of initialSource.files) {
      const sourcePath = path.join(sourceDir, file.relativePath);
      const targetPath = path.join(targetDir, file.relativePath);
      try {
        const result = await copyFileWithResume(sourcePath, targetPath, file.bytes);
        if (result.copied) {
          copiedFiles += 1;
          copiedBytes += file.bytes;
        }
      } catch (error) {
        error.progress ??= progress();
        throw error;
      }
    }

    const finalSource = await scanOutputDirectory(sourceDir);
    if (finalSource.fileCount !== initialSource.fileCount || finalSource.totalBytes !== initialSource.totalBytes) {
      throw new StorageSettingsError("コピー中に旧保存先が変更されたため検証できません", {
        code: "STORAGE_SOURCE_CHANGED",
        progress: progress()
      });
    }
    const finalTarget = await scanOutputDirectory(targetDir);
    const targetByPath = new Map(finalTarget.files.map((file) => [file.relativePath, file]));
    for (const file of finalSource.files) {
      const targetFile = targetByPath.get(file.relativePath);
      if (!targetFile || targetFile.bytes !== file.bytes) {
        throw new StorageSettingsError("コピー結果の検証に失敗しました", {
          code: "STORAGE_COPY_VERIFY_FAILED",
          progress: progress()
        });
      }
      const [sourceHash, targetHash] = await Promise.all([
        hashFile(path.join(sourceDir, file.relativePath)),
        hashFile(path.join(targetDir, file.relativePath))
      ]);
      if (!sourceHash || sourceHash !== targetHash) {
        throw new StorageSettingsError("コピー結果の内容検証に失敗しました", {
          code: "STORAGE_COPY_HASH_MISMATCH",
          progress: progress()
        });
      }
    }

    await ensureOutputMarker(targetDir);
    const marker = await readOutputMarker(targetDir);
    if (!marker.valid) {
      throw new StorageSettingsError("移行先のmarker検証に失敗しました", {
        code: "STORAGE_MARKER_VERIFY_FAILED",
        progress: progress()
      });
    }
    logger.info?.(`[Storage] outputs移行を検証しました: ${finalSource.fileCount}ファイル`);
    return {
      sourceFiles: finalSource.fileCount,
      sourceBytes: finalSource.totalBytes,
      copiedFiles,
      copiedBytes
    };
  } catch (error) {
    error.progress ??= progress();
    throw error;
  }
}

export function normalizeOutputPath(value) {
  return normalizeAbsolutePath(value);
}

function emptySettings() {
  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    activeOutputDir: null,
    pendingMigration: null,
    lastMigration: null
  };
}

function normalizeSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptySettings();
  const pending = normalizePending(value.pendingMigration);
  const lastMigration = normalizeLastMigration(value.lastMigration);
  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    activeOutputDir: typeof value.activeOutputDir === "string" && value.activeOutputDir.trim()
      ? value.activeOutputDir.trim()
      : null,
    pendingMigration: pending,
    lastMigration
  };
}

function normalizePending(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const targetOutputDir = typeof value.targetOutputDir === "string" && value.targetOutputDir.trim()
    ? value.targetOutputDir.trim()
    : null;
  const status = SAFE_MIGRATION_STATUSES.has(value.status) ? value.status : null;
  if (!targetOutputDir || !status) return null;
  return {
    targetOutputDir,
    requestedAt: typeof value.requestedAt === "string" ? value.requestedAt : new Date(0).toISOString(),
    status
  };
}

function normalizeLastMigration(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.status !== "completed" && value.status !== "failed") return null;
  const result = {
    status: value.status,
    completedAt: typeof value.completedAt === "string" ? value.completedAt : undefined,
    failedAt: typeof value.failedAt === "string" ? value.failedAt : undefined,
    copiedFiles: Number.isInteger(value.copiedFiles) && value.copiedFiles >= 0 ? value.copiedFiles : 0,
    copiedBytes: Number.isFinite(value.copiedBytes) && value.copiedBytes >= 0 ? value.copiedBytes : 0
  };
  if (value.status === "failed") result.reason = String(value.reason ?? "移行に失敗しました").slice(0, 180);
  return result;
}

function getPublicPending(settings) {
  const pending = settings.pendingMigration;
  if (!pending || !SAFE_MIGRATION_STATUSES.has(pending.status)) return null;
  return pending;
}

function readEnvironmentOutputDir(env) {
  const raw = String(env.LOCAL_IMAGE_CHAT_OUTPUT_DIR ?? "").trim();
  return raw ? path.resolve(raw) : null;
}

function readEnvironmentFavoritesDir(env) {
  const raw = String(env.LOCAL_IMAGE_CHAT_FAVORITES_DIR ?? "").trim();
  return raw ? path.resolve(raw) : null;
}

function normalizeAbsolutePath(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) throw new StorageSettingsError("保存先の絶対パスを入力してください", { code: "STORAGE_PATH_EMPTY" });
  if (isUncPath(raw)) {
    throw new StorageSettingsError("UNCパスは現在の移行機能では使用できません", { code: "STORAGE_PATH_UNSUPPORTED" });
  }
  const driveLessRootedPath = process.platform === "win32" && /^[\\/](?![\\/])/.test(raw);
  if (!path.isAbsolute(raw) || driveLessRootedPath) {
    throw new StorageSettingsError("保存先には絶対パスを指定してください", { code: "STORAGE_PATH_RELATIVE" });
  }
  const normalized = path.normalize(path.resolve(raw));
  if (samePath(normalized, path.parse(normalized).root)) {
    throw new StorageSettingsError("ファイルシステムのルートは保存先にできません", { code: "STORAGE_PATH_ROOT" });
  }
  return normalized;
}

async function validatePathSafety(targetDir, {
  rootDir = process.cwd(),
  currentOutputDir = null,
  allowSameCurrent = false,
  allowPendingTarget = false,
  allowDefaultOutput = false,
  allowExistingActive = false,
  requireManagedMarker = false,
  skipContentScan = false
} = {}) {
  const normalizedTarget = path.resolve(targetDir);
  const normalizedRoot = path.resolve(rootDir);
  const defaultOutputDir = path.join(normalizedRoot, "outputs");
  const forbiddenNames = ["public", "src", "data", ".git", ".updates", "node_modules"];

  if (samePath(normalizedTarget, normalizedRoot)) {
    throw new StorageSettingsError("リポジトリルートは保存先にできません", { code: "STORAGE_PATH_FORBIDDEN" });
  }
  for (const name of forbiddenNames) {
    const forbidden = path.join(normalizedRoot, name);
    if (samePath(normalizedTarget, forbidden) || isInside(forbidden, normalizedTarget)) {
      throw new StorageSettingsError("アプリの管理用ディレクトリは保存先にできません", {
        code: "STORAGE_PATH_FORBIDDEN"
      });
    }
  }

  if (currentOutputDir) {
    const normalizedCurrent = path.resolve(currentOutputDir);
    const sameCurrent = samePath(normalizedTarget, normalizedCurrent);
    const related = sameCurrent || isInside(normalizedCurrent, normalizedTarget) || isInside(normalizedTarget, normalizedCurrent);
    if (related && !(sameCurrent && allowSameCurrent)) {
      throw new StorageSettingsError("現在の保存先またはその親子ディレクトリは指定できません", {
        code: "STORAGE_PATH_CURRENT_RELATED"
      });
    }
  }

  await assertNoSymlinkInPath(normalizedTarget);
  const targetInfo = await inspectTargetDirectory(normalizedTarget, { scanContents: !skipContentScan });
  if (targetInfo.exists && !targetInfo.isDirectory) {
    throw new StorageSettingsError("保存先が通常のディレクトリではありません", { code: "STORAGE_TARGET_FILE" });
  }
  if (!targetInfo.exists && !targetInfo.existingAncestor) {
    throw new StorageSettingsError("保存先の親ディレクトリを確認できません", { code: "STORAGE_TARGET_PARENT" });
  }
  const isDefaultOutput = allowDefaultOutput && samePath(normalizedTarget, defaultOutputDir);
  if (requireManagedMarker && !isDefaultOutput
    && (!targetInfo.exists || !targetInfo.isDirectory || !targetInfo.marker.valid)) {
    throw new StorageSettingsError("保存済み保存先の専用markerを確認できません", {
      code: "STORAGE_STORED_MARKER_REQUIRED"
    });
  }
  if (targetInfo.exists && !targetInfo.marker.valid && !allowDefaultOutput && !allowPendingTarget && !allowExistingActive) {
    if (targetInfo.scan.fileCount > 0 || targetInfo.marker.present) {
      throw new StorageSettingsError("空またはLocal Image Chat専用marker付きの保存先を指定してください", {
        code: "STORAGE_TARGET_UNMANAGED"
      });
    }
  }
  if (targetInfo.exists && targetInfo.marker.present && !targetInfo.marker.valid
    && !allowPendingTarget && !allowDefaultOutput && !allowExistingActive) {
    throw new StorageSettingsError("保存先のmarkerが不正です", { code: "STORAGE_TARGET_MARKER" });
  }
}

async function inspectTargetDirectory(targetDir, { scanContents = true } = {}) {
  let stats;
  try {
    stats = await fs.lstat(targetDir);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const existingAncestor = await findExistingAncestor(path.dirname(targetDir));
    return {
      exists: false,
      isDirectory: false,
      existingAncestor,
      marker: { present: false, valid: false },
      scan: { files: [], symlinks: [], specialFiles: [], fileCount: 0, totalBytes: 0 },
      symlinks: [],
      specialFiles: []
    };
  }
  if (stats.isSymbolicLink()) {
    return {
      exists: true,
      isDirectory: false,
      existingAncestor: path.dirname(targetDir),
      marker: { present: true, valid: false },
      scan: { files: [], symlinks: ["."], specialFiles: [], fileCount: 0, totalBytes: 0 },
      symlinks: ["."],
      specialFiles: []
    };
  }
  const isDirectory = stats.isDirectory();
  if (!isDirectory) {
    return {
      exists: true,
      isDirectory: false,
      existingAncestor: path.dirname(targetDir),
      marker: { present: false, valid: false },
      scan: { files: [], symlinks: [], specialFiles: [], fileCount: 0, totalBytes: 0 },
      symlinks: [],
      specialFiles: []
    };
  }
  const scan = scanContents
    ? await scanOutputDirectory(targetDir)
    : { files: [], symlinks: [], specialFiles: [], fileCount: 0, totalBytes: 0 };
  const marker = await readOutputMarker(targetDir);
  return {
    exists: true,
    isDirectory: true,
    existingAncestor: targetDir,
    marker,
    scan,
    symlinks: scan.symlinks,
    specialFiles: scan.specialFiles
  };
}

async function readOutputMarker(outputDir) {
  const markerPath = path.join(outputDir, OUTPUT_MARKER_FILENAME);
  try {
    const stats = await fs.lstat(markerPath);
    if (stats.isSymbolicLink() || !stats.isFile()) return { present: true, valid: false };
    const value = JSON.parse(await fs.readFile(markerPath, "utf8"));
    return { present: true, valid: isValidOutputMarker(value), value: isValidOutputMarker(value) ? value : null };
  } catch (error) {
    if (error?.code === "ENOENT") return { present: false, valid: false };
    return { present: true, valid: false };
  }
}

async function ensureOutputMarker(outputDir) {
  const existing = await readOutputMarker(outputDir);
  if (existing.valid) return;
  if (existing.present) {
    throw new StorageSettingsError("移行先のmarkerが不正です", { code: "STORAGE_TARGET_MARKER" });
  }
  const markerPath = path.join(outputDir, OUTPUT_MARKER_FILENAME);
  const temporaryPath = path.join(
    outputDir,
    `${MARKER_TEMP_PREFIX}${process.pid}-${crypto.randomUUID()}.tmp`
  );
  const marker = {
    type: "local-image-chat-output",
    schemaVersion: STORAGE_SCHEMA_VERSION,
    createdAt: new Date().toISOString()
  };
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
    await fs.rename(temporaryPath, markerPath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
}

async function assertNoSymlinkInPath(targetDir) {
  const normalized = path.resolve(targetDir);
  const root = path.parse(normalized).root;
  const relative = path.relative(root, normalized);
  let current = root;
  if (relative) {
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      try {
        const stats = await fs.lstat(current);
        if (stats.isSymbolicLink()) {
          throw new StorageSettingsError("シンボリックリンクまたはjunction経由の保存先は使用できません", {
            code: "STORAGE_PATH_LINK"
          });
        }
      } catch (error) {
        if (error?.code === "ENOENT") break;
        throw error;
      }
    }
  }
}

async function findExistingAncestor(start) {
  let current = path.resolve(start);
  while (true) {
    try {
      const stats = await fs.lstat(current);
      if (stats.isSymbolicLink()) {
        throw new StorageSettingsError("保存先の親にシンボリックリンクまたはjunctionがあります", {
          code: "STORAGE_PATH_LINK"
        });
      }
      if (!stats.isDirectory()) {
        throw new StorageSettingsError("保存先の親がディレクトリではありません", { code: "STORAGE_TARGET_PARENT" });
      }
      return current;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
}

async function probeWritableDirectory(directory) {
  if (!directory) throw new StorageSettingsError("保存先へ書き込めません", { code: "STORAGE_TARGET_WRITE" });
  const probePath = path.join(directory, `${WRITE_PROBE_PREFIX}${process.pid}-${crypto.randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(probePath, "wx");
    await handle.writeFile("local-image-chat-write-probe");
  } catch (error) {
    throw new StorageSettingsError("保存先へ書き込めません", { code: "STORAGE_TARGET_WRITE", progress: null });
  } finally {
    await handle?.close().catch(() => {});
    await fs.rm(probePath, { force: true }).catch(() => {});
  }
}

async function getAvailableBytes(directory) {
  if (!directory || typeof fs.statfs !== "function") return null;
  try {
    const stats = await fs.statfs(directory);
    const blockSize = Number(stats.bsize ?? stats.frsize ?? 0);
    const availableBlocks = Number(stats.bavail ?? stats.bfree ?? 0);
    if (!Number.isFinite(blockSize) || blockSize <= 0 || !Number.isFinite(availableBlocks)) return null;
    const bytes = blockSize * availableBlocks;
    return Number.isSafeInteger(bytes) ? bytes : Number.MAX_SAFE_INTEGER;
  } catch {
    return null;
  }
}

async function copyFileWithResume(sourcePath, targetPath, sourceBytes) {
  await assertNoSymlinkInPath(path.dirname(targetPath));
  let targetStats;
  try {
    targetStats = await fs.lstat(targetPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (targetStats) {
    if (targetStats.isSymbolicLink() || !targetStats.isFile()) {
      throw new StorageSettingsError("移行先に同名の別形式ファイルがあります", {
        code: "STORAGE_TARGET_COLLISION"
      });
    }
    if (targetStats.size !== sourceBytes) {
      throw new StorageSettingsError("同名ファイルの内容が異なるため移行を中止しました", {
        code: "STORAGE_TARGET_COLLISION"
      });
    }
    const [sourceHash, targetHash] = await Promise.all([hashFile(sourcePath), hashFile(targetPath)]);
    if (!sourceHash || sourceHash !== targetHash) {
      throw new StorageSettingsError("同名ファイルの内容が異なるため移行を中止しました", {
        code: "STORAGE_TARGET_COLLISION"
      });
    }
    return { copied: false };
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await assertNoSymlinkInPath(path.dirname(targetPath));
  const temporaryPath = path.join(
    path.dirname(targetPath),
    `${COPY_TEMP_PREFIX}${process.pid}-${crypto.randomUUID()}.tmp`
  );
  try {
    const sourceStats = await fs.lstat(sourcePath);
    if (sourceStats.isSymbolicLink() || !sourceStats.isFile()) {
      throw new StorageSettingsError("旧保存先のコピー対象が通常ファイルではありません", {
        code: "STORAGE_SOURCE_UNSUPPORTED"
      });
    }
    await fs.copyFile(sourcePath, temporaryPath);
    await fs.rename(temporaryPath, targetPath);
    return { copied: true };
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
}

async function hashFile(filePath) {
  return new Promise((resolve) => {
    const hash = crypto.createHash("sha256");
    const stream = fsSync.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", () => resolve(null));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function buildInvalidPlan(targetOutputDir, error, details = {}) {
  return {
    valid: false,
    targetOutputDir,
    error: String(error ?? "保存先を確認できませんでした"),
    sourceFiles: details.sourceScan?.fileCount ?? 0,
    sourceBytes: details.sourceScan?.totalBytes ?? 0,
    availableBytes: details.availableBytes ?? null,
    availableBytesKnown: details.availableBytes !== undefined && details.availableBytes !== null,
    existingTargetFiles: details.targetScan?.fileCount ?? 0,
    willCopyExisting: false,
    willKeepSource: true,
    restartRequired: false
  };
}

function safeMigrationReason(error) {
  if (error instanceof StorageSettingsError) return error.message;
  if (error?.code === "ENOSPC") return "空き容量が不足しています";
  if (error?.code === "EACCES" || error?.code === "EPERM") return "保存先へ書き込めません";
  return "移行中にファイルを確認できませんでした";
}

function isTemporaryFile(relativePath) {
  const name = path.basename(relativePath);
  return name.startsWith(COPY_TEMP_PREFIX)
    || name.startsWith(MARKER_TEMP_PREFIX)
    || name.startsWith(WRITE_PROBE_PREFIX);
}

function isInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function samePath(left, right) {
  if (!left || !right) return false;
  const normalize = (value) => {
    const resolved = path.normalize(path.resolve(String(value)));
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function isUncPath(value) {
  return /^[/\\]{2}/.test(String(value));
}
