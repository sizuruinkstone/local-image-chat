import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const LOCK_DIRECTORY = path.join(os.tmpdir(), "local-image-chat");
const INCOMPLETE_LOCK_GRACE_MS = 5000;

export class InstanceAlreadyRunningError extends Error {
  constructor(metadata, requestedPort) {
    const pid = Number.isInteger(metadata?.pid) ? metadata.pid : "不明";
    const port = Number.isInteger(metadata?.port) ? metadata.port : requestedPort;
    super(
      "Local Image Chatは既に起動しています。\n"
      + `PID: ${pid}\n`
      + `Port: ${port}\n`
      + "既存の画面を使用するか、既存プロセスを終了してから再起動してください。"
    );
    this.name = "InstanceAlreadyRunningError";
    this.code = "INSTANCE_ALREADY_RUNNING";
    this.metadata = metadata ?? null;
  }
}

export function getInstanceLockPath(rootDir, port) {
  const normalizedRoot = normalizeRootDir(rootDir);
  const normalizedPort = normalizePort(port);
  const rootHash = crypto.createHash("sha256").update(normalizedRoot, "utf8").digest("hex");
  return path.join(LOCK_DIRECTORY, `${rootHash}-${normalizedPort}.lock`);
}

export async function acquireInstanceLock({ rootDir, port, version }) {
  const normalizedPort = normalizePort(port);
  const lockPath = getInstanceLockPath(rootDir, normalizedPort);
  await fs.mkdir(LOCK_DIRECTORY, { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const instanceId = crypto.randomUUID();
    const metadata = {
      pid: process.pid,
      instanceId,
      startedAt: new Date().toISOString(),
      port: normalizedPort,
      version: String(version ?? "").trim()
    };

    let handle;
    try {
      // wx is deliberately the first ownership decision: never check then write.
      handle = await fs.open(lockPath, "wx");
      try {
        await handle.writeFile(JSON.stringify(metadata), "utf8");
      } catch (error) {
        await fs.rm(lockPath, { force: true }).catch(() => {});
        throw error;
      } finally {
        await handle.close();
      }
      let released = false;
      return {
        metadata,
        release: async () => {
          if (released) return;
          released = true;
          await releaseOwnedLock(lockPath, instanceId);
        },
        releaseSync: () => {
          if (released) return;
          released = true;
          releaseOwnedLockSync(lockPath, instanceId);
        }
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;

      const state = await inspectLock(lockPath);
      if (state.kind === "metadata" && isProcessAlive(state.metadata.pid)) {
        throw new InstanceAlreadyRunningError(state.metadata, normalizedPort);
      }
      // An empty file can be observed between wx and the metadata write. Treat
      // a recent one as an in-progress owner instead of deleting it.
      if (state.kind === "incomplete") {
        throw new InstanceAlreadyRunningError(null, normalizedPort);
      }
      if (attempt === 1) {
        // A second collision is safer to treat as contention than to remove a
        // file another process may have acquired after the stale check.
        throw new InstanceAlreadyRunningError(
          state.kind === "metadata" ? state.metadata : null,
          normalizedPort
        );
      }
      if (state.kind === "missing") continue;
      if (await removeStaleLock(lockPath, state)) continue;
    }
  }

  throw new InstanceAlreadyRunningError(null, normalizedPort);
}

function normalizeRootDir(rootDir) {
  const resolved = path.normalize(path.resolve(String(rootDir)));
  const root = path.parse(resolved).root;
  const withoutTrailingSeparator = resolved === root
    ? root
    : resolved.replace(/[\\/]+$/, "");
  return process.platform === "win32"
    ? withoutTrailingSeparator.toLowerCase()
    : withoutTrailingSeparator;
}

function normalizePort(port) {
  const normalized = Number(port);
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 65535) {
    throw new TypeError("port must be an integer between 1 and 65535");
  }
  return normalized;
}

async function inspectLock(lockPath) {
  let raw;
  let stats;
  try {
    stats = await fs.stat(lockPath);
    raw = await fs.readFile(lockPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { kind: "missing" };
    throw error;
  }

  let metadata;
  try {
    metadata = JSON.parse(raw);
  } catch {
    metadata = null;
  }
  if (isValidMetadata(metadata)) {
    return { kind: "metadata", metadata, raw, stats };
  }
  if (!raw.trim() && Date.now() - stats.mtimeMs <= INCOMPLETE_LOCK_GRACE_MS) {
    return { kind: "incomplete", raw, stats };
  }
  return { kind: "stale", raw, stats };
}

function isValidMetadata(metadata) {
  return Boolean(
    metadata
    && Number.isInteger(metadata.pid)
    && metadata.pid > 0
    && typeof metadata.instanceId === "string"
    && metadata.instanceId.trim()
    && typeof metadata.startedAt === "string"
    && Number.isFinite(Date.parse(metadata.startedAt))
    && Number.isInteger(metadata.port)
    && metadata.port >= 1
    && metadata.port <= 65535
    && typeof metadata.version === "string"
    && metadata.version.trim()
  );
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function removeStaleLock(lockPath, state) {
  try {
    const currentStats = await fs.stat(lockPath);
    const currentRaw = await fs.readFile(lockPath, "utf8");
    if (
      currentRaw !== state.raw
      || currentStats.size !== state.stats.size
      || currentStats.mtimeMs !== state.stats.mtimeMs
    ) {
      return false;
    }
    // Rename is the atomic handoff: another cleaner either wins the rename,
    // or sees the path disappear and can observe the new owner via wx.
    const stalePath = `${lockPath}.${process.pid}.${crypto.randomUUID()}.stale`;
    await fs.rename(lockPath, stalePath);
    await fs.rm(stalePath, { force: true });
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
}

async function releaseOwnedLock(lockPath, instanceId) {
  let current;
  try {
    current = JSON.parse(await fs.readFile(lockPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return;
    return;
  }
  if (current?.instanceId !== instanceId) return;
  await fs.rm(lockPath, { force: true });
}

function releaseOwnedLockSync(lockPath, instanceId) {
  let current;
  try {
    current = JSON.parse(fsSync.readFileSync(lockPath, "utf8"));
  } catch {
    return;
  }
  if (current?.instanceId !== instanceId) return;
  try {
    fsSync.rmSync(lockPath, { force: true });
  } catch {
    // The synchronous fallback runs during process exit; there is no caller
    // left that can safely handle an unlink failure here.
  }
}
