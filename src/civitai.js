import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { JsonStore } from "./json-store.js";

const CIVITAI_API = "https://civitai.com/api/v1";
const CATEGORY_FOLDERS = {
  character: "Characters",
  style: "Style",
  body: "Body",
  pose: "Pose"
};

export function createCivitaiService({ dataDir, loraConfig, reforgeConfig }) {
  const registry = new JsonStore(path.join(dataDir, "lora-registry.json"), {
    schemaVersion: 1,
    entries: []
  });

  return {
    inspect: (url, token) => inspectCivitaiUrl(url, token),

    async install({ url, token, category = "style", overwrite = false }) {
      const metadata = await inspectCivitaiUrl(url, token);
      if (metadata.modelType.toLowerCase() !== "lora") {
        throw new Error(`このモデルはLoRAではありません（種類: ${metadata.modelType}）`);
      }
      const folderName = CATEGORY_FOLDERS[category];
      if (!folderName) throw new Error("LoRAの分類が不正です");

      const rawLoras = await fetchRawLoras(reforgeConfig);
      const installRoot = resolveLoraInstallRoot(loraConfig?.installDir, rawLoras);
      if (!installRoot) {
        throw new Error("LoRA保存先を自動検出できません。config.jsonのlora.installDirへReForgeのLoRAフォルダを設定してください");
      }

      const destinationDir = path.join(installRoot, folderName);
      const filename = sanitizeFilename(metadata.file.name);
      const destinationPath = path.join(destinationDir, filename);
      await fsp.mkdir(destinationDir, { recursive: true });

      if (!overwrite && await exists(destinationPath)) {
        throw new Error(`${folderName}/${filename} は既に存在します`);
      }

      const temporaryPath = `${destinationPath}.${process.pid}.download`;
      try {
        const response = await fetch(metadata.file.downloadUrl, {
          headers: civitaiHeaders(token, "application/octet-stream"),
          signal: AbortSignal.timeout(60 * 60 * 1000)
        });
        if (!response.ok || !response.body) {
          const detail = await response.text().catch(() => "");
          throw new Error(`Civitaiダウンロード HTTP ${response.status}: ${detail.slice(0, 300)}`);
        }
        await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporaryPath));
        await fsp.rename(temporaryPath, destinationPath);
      } catch (error) {
        await fsp.rm(temporaryPath, { force: true }).catch(() => {});
        throw error;
      }

      const relativeName = `${folderName}/${filename.replace(/\.(?:safetensors|ckpt|pt)$/i, "")}`;
      const entry = {
        id: `${metadata.modelId}:${metadata.versionId}`,
        modelId: metadata.modelId,
        versionId: metadata.versionId,
        modelName: metadata.modelName,
        versionName: metadata.versionName,
        baseModel: metadata.baseModel,
        sourceUrl: metadata.sourceUrl,
        filename,
        relativeName,
        category: category === "character" ? "character" : "direction",
        subcategory: category,
        triggerWords: metadata.trainedWords.join(", "),
        recommendedWeight: metadata.recommendedWeight,
        previewUrl: metadata.previewUrl,
        installedAt: new Date().toISOString()
      };

      await registry.update((data) => {
        data.entries = data.entries.filter((item) => item.id !== entry.id && item.relativeName !== entry.relativeName);
        data.entries.unshift(entry);
        return data;
      });

      return { metadata, entry, destinationPath };
    },

    async mergeWithInstalled(loras) {
      const data = await registry.read();
      return loras.map((lora) => {
        const entry = findRegistryEntry(data.entries, lora);
        if (!entry) return lora;
        return {
          ...lora,
          category: entry.category,
          registry: entry
        };
      });
    },

    async listRegistry() {
      return (await registry.read()).entries;
    }
  };
}

export async function inspectCivitaiUrl(inputUrl, token = "") {
  const parsed = parseCivitaiUrl(inputUrl);
  let model;
  let version;

  if (parsed.versionId) {
    version = await fetchCivitaiJson(`${CIVITAI_API}/model-versions/${parsed.versionId}`, token);
    model = await fetchCivitaiJson(`${CIVITAI_API}/models/${version.modelId ?? parsed.modelId}`, token);
  } else {
    model = await fetchCivitaiJson(`${CIVITAI_API}/models/${parsed.modelId}`, token);
    version = selectVersion(model.modelVersions);
  }

  if (!version) throw new Error("利用可能なモデルバージョンがありません");
  const file = selectModelFile(version.files);
  if (!file) throw new Error("ダウンロード可能な.safetensorsファイルがありません");

  return {
    modelId: Number(model.id ?? version.modelId ?? parsed.modelId),
    versionId: Number(version.id),
    modelName: String(model.name ?? "名称不明"),
    versionName: String(version.name ?? "バージョン不明"),
    modelType: String(model.type ?? "Unknown"),
    baseModel: String(version.baseModel ?? "不明"),
    trainedWords: Array.isArray(version.trainedWords)
      ? version.trainedWords.filter((word) => typeof word === "string" && word.trim()).slice(0, 40)
      : [],
    recommendedWeight: inferRecommendedWeight(version),
    previewUrl: version.images?.find((image) => image.type === "image")?.url ?? version.images?.[0]?.url ?? "",
    sourceUrl: `https://civitai.com/models/${model.id ?? parsed.modelId}?modelVersionId=${version.id}`,
    file: {
      name: file.name,
      sizeKB: file.sizeKB ?? null,
      downloadUrl: file.downloadUrl ?? `https://civitai.com/api/download/models/${version.id}`
    }
  };
}

export function parseCivitaiUrl(inputUrl) {
  let url;
  try {
    url = new URL(String(inputUrl ?? "").trim());
  } catch {
    throw new Error("CivitaiのモデルページURLを入力してください");
  }
  if (!/(^|\.)civitai\.com$/i.test(url.hostname)) throw new Error("civitai.comのURLだけ使用できます");
  const modelMatch = url.pathname.match(/^\/models\/(\d+)/i);
  if (!modelMatch) throw new Error("CivitaiのモデルページURLを入力してください");
  const versionId = url.searchParams.get("modelVersionId");
  return {
    modelId: Number(modelMatch[1]),
    versionId: versionId && /^\d+$/.test(versionId) ? Number(versionId) : null
  };
}

export function resolveLoraInstallRoot(configuredPath, rawLoras) {
  if (typeof configuredPath === "string" && configuredPath.trim()) {
    return path.resolve(configuredPath.trim());
  }

  for (const item of rawLoras ?? []) {
    if (typeof item?.path !== "string" || !item.path.trim()) continue;
    const sourcePath = item.path.trim();
    const pathApi = /^[a-z]:[\\/]/i.test(sourcePath) ? path.win32 : path;
    const relativeParts = String(item.name ?? "")
      .replaceAll("\\", "/")
      .split("/")
      .filter(Boolean);
    if (!relativeParts.length) continue;
    let root = sourcePath;
    for (let index = 0; index < relativeParts.length; index += 1) root = pathApi.dirname(root);
    if (root && root !== ".") return root;
  }
  return "";
}

async function fetchRawLoras(config) {
  const response = await fetch(`${config.url}/sdapi/v1/loras`, {
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`ReForge LoRA一覧 HTTP ${response.status}`);
  const body = await response.json();
  return Array.isArray(body) ? body : [];
}

async function fetchCivitaiJson(url, token) {
  const response = await fetch(url, {
    headers: civitaiHeaders(token, "application/json"),
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("Civitaiで閲覧制限されています。APIキーを入力して再試行してください");
    }
    throw new Error(`Civitai API HTTP ${response.status}`);
  }
  return response.json();
}

function civitaiHeaders(token, accept) {
  const headers = {
    Accept: accept,
    "User-Agent": "Local-Image-Chat/2.1"
  };
  if (typeof token === "string" && token.trim()) headers.Authorization = `Bearer ${token.trim()}`;
  return headers;
}

function selectVersion(versions) {
  if (!Array.isArray(versions) || !versions.length) return null;
  return versions.find((version) => /illustrious|noobai/i.test(version.baseModel ?? ""))
    ?? versions[0];
}

function selectModelFile(files) {
  if (!Array.isArray(files)) return null;
  return files.find((file) => file.primary && /\.safetensors$/i.test(file.name ?? ""))
    ?? files.find((file) => /\.safetensors$/i.test(file.name ?? ""));
}

function inferRecommendedWeight(version) {
  const text = `${version.description ?? ""} ${version.name ?? ""}`;
  const match = text.match(/(?:weight|strength|強度)\s*[:：]?\s*(0?\.\d+|1(?:\.0+)?)/i);
  const value = match ? Number(match[1]) : 0.75;
  return Math.max(0.05, Math.min(1.5, Number(value.toFixed(2))));
}

function findRegistryEntry(entries, lora) {
  const candidates = [lora.name, lora.displayName, lora.alias]
    .filter(Boolean)
    .map(normalizeName);
  return entries.find((entry) => {
    const registered = [
      entry.relativeName,
      entry.filename,
      entry.filename?.replace(/\.(?:safetensors|ckpt|pt)$/i, "")
    ].filter(Boolean).map(normalizeName);
    return registered.some((name) => candidates.includes(name) || candidates.some((candidate) => candidate.endsWith(`/${name}`)));
  });
}

function normalizeName(value) {
  return String(value ?? "")
    .replaceAll("\\", "/")
    .replace(/\.(?:safetensors|ckpt|pt)$/i, "")
    .toLowerCase();
}

function sanitizeFilename(value) {
  const filename = path.basename(String(value ?? "").replaceAll("\\", "/"))
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .slice(0, 220);
  if (!filename || !/\.safetensors$/i.test(filename)) {
    throw new Error("安全な.safetensorsファイル名を取得できませんでした");
  }
  return filename;
}

async function exists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}
