import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import AdmZip from "adm-zip";

const execFileAsync = promisify(execFile);
const UPDATE_PATHS = [
  "public", "src", "test", ".gitignore", "README.md", "install.bat",
  "package.json", "package-lock.json", "start.bat"
];

export function createUpdater(rootDir, { repository, branch = "main" }, currentVersion) {
  if (!repository) throw new Error("github.repositoryが設定されていません");

  return {
    async check(token = "") {
      const remotePackage = await fetchRemotePackage(repository, branch, token);
      const latestVersion = String(remotePackage.packageJson.version ?? "0.0.0");
      return {
        currentVersion,
        latestVersion,
        updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
        repository,
        branch,
        sourceUrl: `https://github.com/${repository}/tree/${branch}`
      };
    },

    async apply(token = "") {
      const status = await this.check(token);
      if (!status.updateAvailable) return { ...status, applied: false, restartRequired: false };

      const updatesDir = path.join(rootDir, ".updates");
      const stamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
      const archivePath = path.join(updatesDir, `v${status.latestVersion}-${stamp}.zip`);
      const stagingDir = path.join(updatesDir, `staging-${stamp}`);
      const backupDir = path.join(updatesDir, `backup-v${currentVersion}-${stamp}`);
      await fs.mkdir(updatesDir, { recursive: true });
      let backupReady = false;

      try {
        await downloadArchive(repository, branch, token, archivePath);
        const zip = new AdmZip(archivePath);
        validateArchive(zip);
        zip.extractAllTo(stagingDir, true);
        const sourceRoot = await findArchiveRoot(stagingDir);
        const packageJson = JSON.parse(await fs.readFile(path.join(sourceRoot, "package.json"), "utf8"));
        if (packageJson.name !== "local-image-chat" || packageJson.version !== status.latestVersion) {
          throw new Error("更新アーカイブの内容を検証できませんでした");
        }

        await fs.mkdir(backupDir, { recursive: true });
        for (const relativePath of UPDATE_PATHS) {
          await copyIfExists(path.join(rootDir, relativePath), path.join(backupDir, relativePath));
        }
        await copyIfExists(path.join(rootDir, "config.json"), path.join(backupDir, "config.json"));
        backupReady = true;

        for (const relativePath of UPDATE_PATHS) {
          await replaceIfExists(path.join(sourceRoot, relativePath), path.join(rootDir, relativePath));
        }
        await mergeConfig(path.join(sourceRoot, "config.json"), path.join(rootDir, "config.json"));
        await installDependencies(rootDir);

        return {
          ...status,
          applied: true,
          restartRequired: true,
          backupDir
        };
      } catch (error) {
        if (backupReady) {
          await restoreBackup(backupDir, rootDir).catch((rollbackError) => {
            error.message = `${error.message}（復元にも失敗: ${rollbackError.message}）`;
          });
        }
        throw error;
      } finally {
        await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
        await fs.rm(archivePath, { force: true }).catch(() => {});
      }
    }
  };
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

async function fetchRemotePackage(repository, branch, token) {
  const response = await fetch(`https://api.github.com/repos/${repository}/contents/package.json?ref=${encodeURIComponent(branch)}`, {
    headers: githubHeaders(token, "application/vnd.github+json"),
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      throw new Error("GitHubの最新版を取得できません。非公開リポジトリではFine-grained PAT（Contents: Read）が必要です");
    }
    throw new Error(`GitHub API HTTP ${response.status}`);
  }
  const body = await response.json();
  const content = Buffer.from(String(body.content ?? "").replaceAll(/\s+/g, ""), "base64").toString("utf8");
  return { packageJson: JSON.parse(content), sha: body.sha };
}

async function downloadArchive(repository, branch, token, destination) {
  const response = await fetch(`https://api.github.com/repos/${repository}/zipball/${encodeURIComponent(branch)}`, {
    headers: githubHeaders(token, "application/vnd.github+json"),
    redirect: "follow",
    signal: AbortSignal.timeout(5 * 60 * 1000)
  });
  if (!response.ok) throw new Error(`GitHub更新アーカイブ HTTP ${response.status}`);
  await fs.writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

function githubHeaders(token, accept) {
  const headers = {
    Accept: accept,
    "User-Agent": "Local-Image-Chat-Updater/2.1",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  if (typeof token === "string" && token.trim()) headers.Authorization = `Bearer ${token.trim()}`;
  return headers;
}

function validateArchive(zip) {
  for (const entry of zip.getEntries()) {
    const normalized = entry.entryName.replaceAll("\\", "/");
    if (normalized.startsWith("/") || normalized.split("/").includes("..")) {
      throw new Error("更新アーカイブに安全でないパスが含まれています");
    }
  }
}

async function findArchiveRoot(stagingDir) {
  const entries = await fs.readdir(stagingDir, { withFileTypes: true });
  const root = entries.find((entry) => entry.isDirectory());
  if (!root) throw new Error("更新アーカイブを展開できませんでした");
  return path.join(stagingDir, root.name);
}

async function mergeConfig(remotePath, currentPath) {
  const remote = JSON.parse(await fs.readFile(remotePath, "utf8"));
  let current = {};
  try {
    current = JSON.parse(await fs.readFile(currentPath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const merged = deepMerge(remote, current);
  await fs.writeFile(currentPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
}

async function restoreBackup(backupDir, rootDir) {
  for (const relativePath of [...UPDATE_PATHS, "config.json"]) {
    await replaceIfExists(path.join(backupDir, relativePath), path.join(rootDir, relativePath));
  }
}

function deepMerge(base, override) {
  if (!isObject(base) || !isObject(override)) return structuredClone(override);
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    result[key] = isObject(value) && isObject(result[key])
      ? deepMerge(result[key], value)
      : structuredClone(value);
  }
  return result;
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

async function copyIfExists(source, destination) {
  try {
    const stat = await fs.stat(source);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    if (stat.isDirectory()) await fs.cp(source, destination, { recursive: true, force: true });
    else await fs.copyFile(source, destination);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function replaceIfExists(source, destination) {
  try {
    const stat = await fs.stat(source);
    if (stat.isDirectory()) {
      await fs.rm(destination, { recursive: true, force: true });
      await fs.cp(source, destination, { recursive: true, force: true });
    } else {
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(source, destination);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function installDependencies(rootDir) {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  await execFileAsync(command, ["install", "--omit=dev", "--no-audit", "--no-fund"], {
    cwd: rootDir,
    timeout: 5 * 60 * 1000,
    windowsHide: true
  });
}

function parseVersion(value) {
  const match = String(value ?? "").match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : [0, 0, 0];
}
