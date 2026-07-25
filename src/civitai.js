import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { JsonStore } from "./json-store.js";
import { parseRecommendedWeight } from "./lora-weight.js";
import { normalizeInstallFolder, resolveInstallTarget } from "./lora-folder.js";
import { AMBIGUOUS_ROOT_MESSAGE, resolveLoraRoot } from "./lora-root.js";
import { fetchLoraDirectory } from "./reforge.js";

const CIVITAI_API = "https://civitai.com/api/v1";
const CATEGORY_FOLDERS = {
  character: "Characters",
  style: "Style",
  body: "Body",
  pose: "Pose"
};

export function createCivitaiService({
  dataDir,
  loraConfig,
  reforgeConfig,
  inspectCivitai = inspectCivitaiUrl,
  fetchLoraDir = fetchLoraDirectory
}) {
  const registry = new JsonStore(path.join(dataDir, "lora-registry.json"), {
    schemaVersion: 1,
    entries: []
  });

  // LoRAルートは「明示設定 → ReForge設定API → LoRAパス検出」の順で決める。
  async function resolveRoot(rawLoras) {
    const loras = rawLoras ?? await fetchRawLoras(reforgeConfig).catch(() => []);
    const configured = loraConfig?.installDir;
    // 明示設定があるならReForgeへ問い合わせない（起動していなくても動く）。
    const reforgeLoraDir = configured?.trim()
      ? ""
      : await Promise.resolve(fetchLoraDir(reforgeConfig)).catch(() => "");
    return { ...resolveLoraRoot({ installDir: configured, reforgeLoraDir, rawLoras: loras }), rawLoras: loras };
  }

  return {
    inspect: (url, token) => inspectCivitai(url, token),

    // UI表示・フォルダを開く操作で使う、現在認識しているLoRAルート。
    async describeInstallRoot() {
      const { root, source, label, warning } = await resolveRoot();
      return { root, source, label, warning, configured: source === "config" };
    },

    async install({ url, token, category = "style", folder = "", overwrite = false }) {
      const metadata = await inspectCivitai(url, token);
      if (metadata.modelType.toLowerCase() !== "lora") {
        throw new Error(`このモデルはLoRAではありません（種類: ${metadata.modelType}）`);
      }
      const defaultFolder = CATEGORY_FOLDERS[category];
      if (!defaultFolder) throw new Error("LoRAの分類が不正です");

      const rawLoras = await fetchRawLoras(reforgeConfig);
      const { root: installRoot } = await resolveRoot(rawLoras);
      // 安全に特定できない場合は自動インストールを行わない（誤った場所へフォルダを作らない）。
      if (!installRoot) throw new Error(AMBIGUOUS_ROOT_MESSAGE);

      // 保存先フォルダ: 指定があれば正規化・検証、なければ分類デフォルト。
      // サーバー側でも必ず検証し、LoRAルート外・パストラバーサルを拒否する。
      const requestedFolder = typeof folder === "string" && folder.trim() ? folder : defaultFolder;
      const { absolute: destinationDir, relative: relativeFolder } = resolveInstallTarget(installRoot, requestedFolder);
      const filename = sanitizeFilename(metadata.file.name);
      const destinationPath = path.join(destinationDir, filename);
      const baseName = filename.replace(/\.(?:safetensors|ckpt|pt)$/i, "");

      const currentRegistry = await registry.read();
      const existingRegistration = currentRegistry.entries.find((item) =>
        item.id === `${metadata.modelId}:${metadata.versionId}`
      );
      const targetExists = await exists(destinationPath);
      // 同名ファイルが別フォルダに既にある場合は、勝手に移動せずその場所を再利用する。
      const otherLora = rawLoras.find((lora) => sameLoraFilename(lora, filename));
      const otherFolder = otherLora ? loraFolderOf(otherLora) : "";
      const inOtherFolder = Boolean(otherLora) && !targetExists
        && otherFolder.toLowerCase() !== relativeFolder.toLowerCase();
      const alreadyInstalled = Boolean(existingRegistration) || targetExists || Boolean(otherLora);
      const reusedExisting = !overwrite && alreadyInstalled;

      let relativeName = `${relativeFolder}/${baseName}`;
      let existingInOtherFolder = null;
      if (reusedExisting && inOtherFolder) {
        relativeName = loraRelativeName(otherLora);
        existingInOtherFolder = otherFolder;
      }

      if (!reusedExisting) {
        await fsp.mkdir(destinationDir, { recursive: true });
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
      }

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
        outfitPresets: metadata.outfitPresets,
        recommendedWeight: metadata.recommendedWeight,
        recommendedWeightMin: metadata.recommendedWeightMin,
        recommendedWeightMax: metadata.recommendedWeightMax,
        recommendedWeightLabel: metadata.recommendedWeightLabel,
        recommendedWeightSource: metadata.recommendedWeightSource,
        previewUrl: metadata.previewUrl,
        installedAt: new Date().toISOString()
      };

      await registry.update((data) => {
        data.entries = data.entries.filter((item) => item.id !== entry.id && item.relativeName !== entry.relativeName);
        data.entries.unshift(entry);
        return data;
      });

      return { metadata, entry, destinationPath, reusedExisting, folder: relativeFolder, existingInOtherFolder };
    },

    // foldersは「実在するフォルダ」だけを返す。分類デフォルト（Characters等）は
    // 実在しない場合があるため、recommendedとして別枠で返しUIでも混ぜない。
    async listInstallFolders() {
      const { root: installRoot, rawLoras, source, label, warning } = await resolveRoot();
      const set = new Set();
      for (const lora of rawLoras) {
        const folder = loraFolderOf(lora);
        if (folder) set.add(folder);
      }
      if (installRoot) {
        for (const dir of await listSubdirectories(installRoot)) set.add(dir);
      }
      const seen = new Set();
      const folders = [];
      const normalized = [...set]
        .map((value) => String(value).replaceAll("\\", "/").replace(/^\/+|\/+$/g, ""))
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }));
      for (const value of normalized) {
        const key = value.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        folders.push(value);
      }

      const recommended = {};
      for (const [category, defaultFolder] of Object.entries(CATEGORY_FOLDERS)) {
        const exact = folders.find((folder) => folder.toLowerCase() === defaultFolder.toLowerCase());
        const leaf = exact ?? folders.find((folder) => matchesCategoryLeaf(folder, category));
        recommended[category] = leaf
          ? { folder: leaf, exists: true }
          : { folder: defaultFolder, exists: false };
      }

      return {
        folders,
        recommended,
        defaults: {
          character: CATEGORY_FOLDERS.character,
          style: CATEGORY_FOLDERS.style,
          body: CATEGORY_FOLDERS.body,
          pose: CATEGORY_FOLDERS.pose
        },
        installRoot: { root: installRoot, source, label, warning },
        installDirConfigured: Boolean(installRoot)
      };
    },

    async refreshRegistrations(token = "") {
      const current = await registry.read();
      const candidates = current.entries.filter((entry) =>
        typeof entry?.sourceUrl === "string" && entry.sourceUrl.trim()
      );
      const updates = new Map();
      const failures = [];

      for (const entry of candidates) {
        try {
          const metadata = await inspectCivitai(entry.sourceUrl, token);
          updates.set(entry.id, {
            modelId: metadata.modelId,
            versionId: metadata.versionId,
            modelName: metadata.modelName,
            versionName: metadata.versionName,
            baseModel: metadata.baseModel,
            sourceUrl: metadata.sourceUrl,
            triggerWords: metadata.trainedWords.join(", "),
            outfitPresets: metadata.outfitPresets,
            recommendedWeight: metadata.recommendedWeight,
            recommendedWeightMin: metadata.recommendedWeightMin,
            recommendedWeightMax: metadata.recommendedWeightMax,
            recommendedWeightLabel: metadata.recommendedWeightLabel,
            recommendedWeightSource: metadata.recommendedWeightSource,
            previewUrl: metadata.previewUrl,
            metadataUpdatedAt: new Date().toISOString()
          });
        } catch (error) {
          failures.push({
            id: entry.id,
            modelName: entry.modelName || entry.relativeName || entry.filename || entry.id,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      if (updates.size) {
        await registry.update((data) => {
          data.entries = data.entries.map((entry) => {
            const update = updates.get(entry.id);
            return update ? { ...entry, ...update } : entry;
          });
          return data;
        });
      }

      return {
        total: candidates.length,
        updated: updates.size,
        failed: failures.length,
        failures
      };
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

  const trainedWords = Array.isArray(version.trainedWords)
    ? version.trainedWords.filter((word) => typeof word === "string" && word.trim()).slice(0, 40)
    : [];
  const outfitPresets = deriveCivitaiOutfitPresets(
    trainedWords,
    `${model.description ?? ""}\n${version.description ?? ""}`
  );

  const weightInfo = parseRecommendedWeight(
    `${model.description ?? ""}\n${version.description ?? ""}`,
    version.name
  );

  return {
    modelId: Number(model.id ?? version.modelId ?? parsed.modelId),
    versionId: Number(version.id),
    modelName: String(model.name ?? "名称不明"),
    versionName: String(version.name ?? "バージョン不明"),
    modelType: String(model.type ?? "Unknown"),
    baseModel: String(version.baseModel ?? "不明"),
    trainedWords,
    outfitPresets,
    recommendedWeight: weightInfo.recommendedWeight,
    recommendedWeightMin: weightInfo.recommendedWeightMin,
    recommendedWeightMax: weightInfo.recommendedWeightMax,
    recommendedWeightLabel: weightInfo.recommendedWeightLabel,
    recommendedWeightSource: weightInfo.recommendedWeightSource,
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

// 後方互換のために残す同期版。判定ロジックは lora-root.js に集約している。
export function resolveLoraInstallRoot(configuredPath, rawLoras) {
  const { root, source } = resolveLoraRoot({ installDir: configuredPath, rawLoras });
  return source === "config" ? path.resolve(root) : root;
}

export function deriveCivitaiOutfitPresets(trainedWords, description = "") {
  const words = uniqueStrings(trainedWords);
  const lines = htmlToLines(description);
  const descriptionPresets = extractDescriptionOutfitPresets(description);
  const descriptionByTrigger = new Map(descriptionPresets.map((preset) => [
    normalizeTrigger(preset.trigger),
    preset
  ]));
  const triggerCounts = new Map();
  const presets = [];

  for (const word of words) {
    const tags = splitPromptTags(word);
    const trigger = tags[0] ?? "";
    if (!isLikelyConceptTrigger(trigger)) continue;

    const normalizedTrigger = normalizeTrigger(trigger);
    const count = (triggerCounts.get(normalizedTrigger) ?? 0) + 1;
    triggerCounts.set(normalizedTrigger, count);
    const described = descriptionByTrigger.get(normalizedTrigger);
    const triggerWords = tags.length > 1
      ? tags.join(", ")
      : collectTriggerTags(trigger, words.map(firstPromptTag).filter(Boolean), lines);

    presets.push({
      id: uniquePresetId(trigger, count, presets.length),
      name: `${described?.name ?? humanizeTrigger(trigger)}${count > 1 ? ` (${count})` : ""}`,
      triggerWords
    });
  }

  for (const described of descriptionPresets) {
    const normalizedTrigger = normalizeTrigger(described.trigger);
    if (triggerCounts.has(normalizedTrigger)) continue;
    triggerCounts.set(normalizedTrigger, 1);
    presets.push({
      id: uniquePresetId(described.trigger, 1, presets.length),
      name: described.name,
      triggerWords: described.triggerWords
    });
  }

  return presets;
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
    "User-Agent": "Local-Image-Chat/2.3.8"
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

function collectTriggerTags(trigger, allTriggers, lines) {
  const triggerLower = trigger.toLowerCase();
  const index = lines.findIndex((line) => line.toLowerCase().includes(triggerLower));
  if (index < 0) return trigger;

  const sameLineTriggers = allTriggers.filter((candidate) =>
    lines[index].toLowerCase().includes(candidate.toLowerCase())
  );
  if (sameLineTriggers.length > 1) return trigger;

  const collected = [trigger];
  for (let offset = 0; offset < 4 && index + offset < lines.length; offset += 1) {
    const line = lines[index + offset].trim();
    if (!line && offset > 0) break;
    if (offset > 0 && allTriggers.some((candidate) =>
      line.toLowerCase().includes(candidate.toLowerCase())
    )) break;

    const cleaned = offset === 0
      ? line.slice(line.toLowerCase().indexOf(triggerLower) + trigger.length)
      : line;
    for (const item of cleaned.replace(/^[\s:：\-–—|]+/, "").split(",")) {
      const tag = item.trim().replace(/^[•*·]\s*/, "");
      if (!tag || tag.length > 60 || /https?:\/\//i.test(tag) || tag.split(/\s+/).length > 7) continue;
      collected.push(tag);
    }
  }
  return uniqueStrings(collected).join(", ");
}

function extractDescriptionOutfitPresets(description) {
  const html = String(description ?? "");
  const headingPattern = /<h3\b[^>]*>([\s\S]*?)<\/h3>([\s\S]*?)(?=<h[23]\b|$)/gi;
  const presets = [];
  let headingMatch;

  while ((headingMatch = headingPattern.exec(html))) {
    const name = decodeHtmlText(headingMatch[1]).replace(/[:：]\s*$/, "").trim();
    const section = headingMatch[2];
    const triggerMatch = section.match(
      /(?:trigger\s*words?|トリガーワード|触发词)[\s\S]{0,500}?<pre\b[^>]*>\s*<code\b[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/i
    );
    if (!triggerMatch) continue;

    const trigger = firstPromptTag(decodeHtmlText(triggerMatch[1]));
    if (!isLikelyConceptTrigger(trigger)) continue;

    const sectionTags = [];
    const codePattern = /<pre\b[^>]*>\s*<code\b[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi;
    let codeMatch;
    let previousEnd = 0;
    while ((codeMatch = codePattern.exec(section))) {
      const between = section.slice(previousEnd, codeMatch.index);
      previousEnd = codePattern.lastIndex;
      if (/<p\b[^>]*>\s*or\s*<\/p>/i.test(between)) continue;
      const value = decodeHtmlText(codeMatch[1]);
      if (/https?:\/\/|if it(?:'|’)s|ならだめ|的话不行/i.test(value)) continue;
      sectionTags.push(...splitPromptTags(value));
    }

    const triggerWords = uniqueStrings([trigger, ...sectionTags])
      .filter((tag) => !/^official3d$/i.test(tag))
      .join(", ");
    presets.push({
      trigger,
      name: name || humanizeTrigger(trigger),
      triggerWords: triggerWords || trigger
    });
  }

  return presets;
}

function splitPromptTags(value) {
  return String(value ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function firstPromptTag(value) {
  return splitPromptTags(value)[0] ?? "";
}

function normalizeTrigger(value) {
  return String(value ?? "")
    .replaceAll("\\", "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function uniquePresetId(trigger, occurrence, fallbackIndex) {
  const base = slugify(trigger) || String(fallbackIndex + 1);
  return `civitai-outfit-${base}${occurrence > 1 ? `-${occurrence}` : ""}`;
}

function isLikelyConceptTrigger(word) {
  const normalized = String(word).trim().toLowerCase();
  if (!normalized || normalized.length < 3) return false;
  return !/^(?:1girl|1boy|solo|female|male|woman|man|adult|anime|character|masterpiece|best quality|highres|absurdres|alternate costume)$/.test(normalized)
    && !/\b(?:hair|eyes?|bangs?|ahoge|breasts?|hips?|waist|body|skin|ears?|tail|dress|shirt|skirt|shorts|pants|jacket|coat|cape|cloak|uniform|bikini|swimsuit|bodysuit|leotard|underwear|bra|panties|thighhighs?|stockings?|pantyhose|socks?|boots?|shoes?|heels?|sandals?|gloves?|sleeves?|collar|choker|necktie|bowtie|belt|straps?|apron|kimono|yukata|hat|headgear|hood|armor|pauldrons?|jewelry|earrings?|necklace|bracelet|ribbon|hairpin|hairclip|ornament)\b/.test(normalized);
}

function decodeHtmlText(value) {
  return String(value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function htmlToLines(value) {
  return String(value ?? "")
    .replace(/<(?:br|\/p|\/li|\/h[1-6]|\/div)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim());
}

function humanizeTrigger(value) {
  return String(value)
    .replaceAll("_", " ")
    .replace(/[()\\]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function uniqueStrings(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value ?? "").trim())
    .filter((value) => {
      const normalized = value.toLowerCase();
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
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

function sameLoraFilename(lora, filename) {
  const target = normalizeName(filename);
  return [lora?.name, lora?.displayName, lora?.alias]
    .filter(Boolean)
    .map(normalizeName)
    .some((candidate) => candidate === target || candidate.endsWith(`/${target}`));
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

// ReForgeのLoRA名（サブフォルダ込み）から拡張子を除いた相対名を得る。
function loraRelativeName(lora) {
  return String(lora?.name ?? "")
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .replace(/\.(?:safetensors|ckpt|pt)$/i, "");
}

// 末尾セグメントが分類名に一致する実在フォルダ（例 Anime/Character）を推奨候補にする。
const CATEGORY_LEAF_PATTERNS = {
  character: /^characters?$/i,
  style: /^styles?$/i,
  body: /^bod(?:y|ies)$/i,
  pose: /^poses?$/i
};

function matchesCategoryLeaf(folder, category) {
  const pattern = CATEGORY_LEAF_PATTERNS[category];
  if (!pattern) return false;
  return pattern.test(String(folder).split("/").at(-1) ?? "");
}

function loraFolderOf(lora) {
  const relative = loraRelativeName(lora);
  const index = relative.lastIndexOf("/");
  return index > 0 ? relative.slice(0, index) : "";
}

// LoRAルート配下のサブフォルダを相対パス（/区切り）で列挙する。空フォルダも含む。
async function listSubdirectories(root, maxDepth = 4) {
  const results = [];
  async function walk(dir, prefix, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      results.push(relative);
      await walk(path.join(dir, entry.name), relative, depth + 1);
    }
  }
  await walk(root, "", 1);
  return results;
}
