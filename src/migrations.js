import fs from "node:fs/promises";
import path from "node:path";
import { ensureEntryUid, normalizeSubcategory } from "./lora-registry.js";

// 既存データを壊さずにschemaVersionを上げる。書き換える前に必ずバックアップを取る。
export const HISTORY_SCHEMA_VERSION = 2;
export const REGISTRY_SCHEMA_VERSION = 2;

export async function backupDataFile(dataDir, filename) {
  const source = path.join(dataDir, filename);
  const raw = await fs.readFile(source, "utf8").catch(() => null);
  if (raw === null) return "";
  const backupsDir = path.join(dataDir, "backups");
  await fs.mkdir(backupsDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const target = path.join(backupsDir, `${path.basename(filename, ".json")}-${stamp}.json`);
  // 同日に複数回移行しても、最初のバックアップを上書きしない。
  try {
    await fs.writeFile(target, raw, { flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  return target;
}

export async function migrateDataFiles(dataDir) {
  const results = [];
  results.push(await migrateJson(dataDir, "lora-registry.json", REGISTRY_SCHEMA_VERSION, (data) => {
    data.entries = (Array.isArray(data.entries) ? data.entries : []).map((entry) => {
      const withUid = ensureEntryUid(entry);
      return {
        ...withUid,
        subcategory: normalizeSubcategory(withUid.subcategory ?? withUid.category, "other"),
        manualFields: Array.isArray(withUid.manualFields) ? withUid.manualFields : []
      };
    });
    return data;
  }));
  results.push(await migrateJson(dataDir, "history.json", HISTORY_SCHEMA_VERSION, (data) => {
    // v2で実験グループ用フィールドを追加する。既存世代はnullのままで良い。
    data.generations = (Array.isArray(data.generations) ? data.generations : []).map((generation) => ({
      experimentId: null,
      experimentName: null,
      ...generation
    }));
    return data;
  }));
  return results.filter(Boolean);
}

async function migrateJson(dataDir, filename, targetVersion, migrate) {
  const filePath = path.join(dataDir, filename);
  const raw = await fs.readFile(filePath, "utf8").catch(() => null);
  if (raw === null) return null;

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    console.warn(`[Migration] ${filename} を解析できないため移行をスキップします`);
    return null;
  }
  const current = Number(data?.schemaVersion ?? 1);
  if (!Number.isFinite(current) || current >= targetVersion) return null;

  const backup = await backupDataFile(dataDir, filename);
  const migrated = migrate({ ...data });
  migrated.schemaVersion = targetVersion;
  const temporaryPath = `${filePath}.${process.pid}.migrate`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(migrated, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, filePath);
  console.log(`[Migration] ${filename}: v${current} → v${targetVersion}（バックアップ: ${backup || "なし"}）`);
  return { filename, from: current, to: targetVersion, backup };
}
