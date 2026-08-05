import { splitTriggerText, triggerKey } from "./structured-prompt.js";

const OUTFIT_STATE_PREFIX = "outfit-state:";
const OUTFIT_CHOICE_PREFIX = "outfit-choice:";

export function listLoraOutfitChoices(profile) {
  if (!profile) return [];
  const choices = [];
  if (profile.category !== "direction") {
    const identityWords = profile.presets?.find((preset) => preset.id === "identity")?.triggerWords ?? "";
    for (const preset of profile.presets ?? []) {
      if (preset.id === "identity") continue;
      const prompt = subtractTriggerWords(preset.triggerWords, identityWords);
      if (prompt) choices.push(toChoice("preset", preset, prompt));
    }
  }
  for (const addon of profile.addons ?? []) {
    const prompt = String(addon?.triggerWords ?? "").trim();
    if (prompt) choices.push(toChoice("addon", addon, prompt));
  }
  return dedupeChoices(choices);
}

export function defaultLoraOutfitChoice(profile, selectedPresetId, selectedAddonId) {
  // 衣装は明示選択時だけ適用する。過去のdefaultPreset/defaultAddonは
  // プロファイル互換用に残すが、生成画面の初期選択には使わない。
  void profile;
  void selectedPresetId;
  void selectedAddonId;
  return "";
}

export function resolveLoraOutfitPrompt(profile, choiceId) {
  return listLoraOutfitChoices(profile).find((choice) => choice.id === choiceId)?.prompt ?? "";
}

export function resolveLoraBaseTriggerWords(profile, selectedPresetId, fallback = "") {
  if (!profile) return String(fallback ?? "");
  if (profile.category === "direction") {
    const preset = profile.presets?.find((item) => item.id === selectedPresetId)
      ?? profile.presets?.find((item) => item.id === profile.defaultPreset)
      ?? profile.presets?.[0];
    return String(preset?.triggerWords ?? fallback ?? "");
  }
  const identity = profile.presets?.find((preset) => preset.id === "identity");
  return String(identity?.triggerWords ?? fallback ?? "");
}

export function outfitStateSourceId(loraName, choiceId) {
  return `${OUTFIT_STATE_PREFIX}${encodeURIComponent(loraName)}::${encodeURIComponent(choiceId)}`;
}

export function outfitChoiceSourceId(loraName, choiceId) {
  return `${OUTFIT_CHOICE_PREFIX}${encodeURIComponent(loraName)}::${encodeURIComponent(choiceId)}`;
}

export function parseOutfitStateSourceId(sourceId) {
  if (!String(sourceId).startsWith(OUTFIT_STATE_PREFIX)) return null;
  const encoded = String(sourceId).slice(OUTFIT_STATE_PREFIX.length);
  const separator = encoded.indexOf("::");
  if (separator < 0) return null;
  try {
    return {
      loraName: decodeURIComponent(encoded.slice(0, separator)),
      choiceId: decodeURIComponent(encoded.slice(separator + 2))
    };
  } catch {
    return null;
  }
}

export function isOutfitChoiceSourceId(sourceId) {
  return String(sourceId).startsWith(OUTFIT_CHOICE_PREFIX);
}

export function outfitSourceLoraName(sourceId) {
  const value = String(sourceId);
  const prefix = value.startsWith(OUTFIT_STATE_PREFIX)
    ? OUTFIT_STATE_PREFIX
    : value.startsWith(OUTFIT_CHOICE_PREFIX)
      ? OUTFIT_CHOICE_PREFIX
      : "";
  if (!prefix) return "";
  const encoded = value.slice(prefix.length);
  const separator = encoded.indexOf("::");
  try {
    return decodeURIComponent(separator < 0 ? encoded : encoded.slice(0, separator));
  } catch {
    return "";
  }
}

function subtractTriggerWords(value, base) {
  const baseKeys = new Set(splitTriggerText(base).map((word) => triggerKey(word)));
  return splitTriggerText(value)
    .filter((word) => !baseKeys.has(triggerKey(word)))
    .join(", ");
}

function toChoice(kind, item, prompt) {
  return {
    id: `${kind}:${String(item.id ?? item.name)}`,
    name: String(item.name ?? item.id ?? "衣装"),
    prompt
  };
}

function dedupeChoices(choices) {
  const seen = new Set();
  return choices.filter((choice) => {
    const key = triggerKey(choice.prompt);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
