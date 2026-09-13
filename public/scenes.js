import { PROMPT_FIELDS, normalizeSections, normalizeAppliedTriggerWords, triggerKey } from './structured-prompt.js';
import { profileSections } from './section-profiles.js';
import { findProfileForLora } from './lora-profiles.js';
import { parseLoraTags, sameLoraName } from './lora-tags.js';
import { outfitSourceLoraName, parseOutfitStateSourceId, outfitStateSourceId } from './lora-outfit-selection.js';

export const SCENE_FIELDS = PROMPT_FIELDS.filter(key => key !== 'character');
export const sceneError = (message, statusCode = 400) => Object.assign(new Error(message), {statusCode, apiCode: statusCode === 409 ? 'CONFLICT' : statusCode === 404 ? 'NOT_FOUND' : 'INVALID_REQUEST'});
const nonempty = value => typeof value === 'string' && Boolean(value.trim());
export function sceneIdentity(item = {}) {
  const value = item.identity ?? item;
  const hash = value.sha256 ?? item.registry?.sha256 ?? item.metadata?.sshs_model_hash;
  return {registryUid: value.registryUid ?? item.registry?.uid ?? null,
    sha256: /^[a-f0-9]{64}$/i.test(hash ?? '') ? hash.toLowerCase() : null,
    civitaiVersionId: value.civitaiVersionId ?? item.registry?.versionId ?? null,
    recordedName: String(value.recordedName ?? item.name ?? '')};
}
export function sceneLoraRole(item) {
  if (!item) return 'unknown';
  const profile = findProfileForLora(item);
  if (profile?.category === 'character') return 'character';
  if (profile?.category === 'direction') return 'scene';
  const category = item.registry?.subcategory || item.registry?.category || item.category;
  if (category === 'character') return 'character';
  return ['style','body','pose','utility','other','direction'].includes(category) ? 'scene' : 'unknown';
}
export function resolveSceneLora(saved, catalog, chosenName) {
  const identity = sceneIdentity(saved);
  let candidates = identity.registryUid ? catalog.filter(item => sceneIdentity(item).registryUid === identity.registryUid) : [];
  if (candidates.some(item => identity.sha256 && sceneIdentity(item).sha256 && identity.sha256 !== sceneIdentity(item).sha256)) return {status:'collision', candidates:[]};
  if (!candidates.length && identity.sha256) candidates = catalog.filter(item => sceneIdentity(item).sha256 === identity.sha256);
  if (candidates.length === 1) return {status:'matched', item:candidates[0]};
  if (candidates.length > 1) {
    const chosen=candidates.find(item=>item.name===chosenName);
    return chosen ? {status:'manual',item:chosen} : {status:'ambiguous', candidates};
  }
  // A manual decision is scoped to this application, never written into the registry.
  if (chosenName) {
    const item = catalog.find(item => item.name === chosenName);
    if (item) return {status:'manual', item};
  }
  return {status:'missing', candidates:catalog.filter(item => item.name === identity.recordedName || (identity.civitaiVersionId && sceneIdentity(item).civitaiVersionId === identity.civitaiVersionId))};
}
function keys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw sceneError('場面に未対応の項目があります');
}
function validateIdentity(value) {
  keys(value,['registryUid','sha256','civitaiVersionId','recordedName']);
  for(const key of ['registryUid','sha256','recordedName']) if(value[key]!=null&&(typeof value[key]!=='string'||value[key].length>500))throw sceneError('LoRA同一性が不正です');
  if(value.sha256!=null&&!/^[a-f0-9]{64}$/i.test(value.sha256))throw sceneError('LoRAのSHA-256は完全な値で指定してください');
  if(value.civitaiVersionId!=null&&!/^[0-9]{1,20}$/.test(String(value.civitaiVersionId)))throw sceneError('LoRA version IDが不正です');
}
export function validateSceneContent(value) {
  keys(value, ['name','contentRating','fields','userNegativePrompt','loras','loraTriggers']);
  if (!nonempty(value.name) || value.name.length > 100) throw sceneError('名前は1〜100文字で入力してください');
  if (!['general','nsfw'].includes(value.contentRating)) throw sceneError('分類を指定してください');
  keys(value.fields ?? {}, SCENE_FIELDS);
  const fields = {};
  for (const [key,text] of Object.entries(value.fields ?? {})) {
    if (typeof text !== 'string' || text.length > 12000) throw sceneError('Promptは各欄12000文字以内です');
    if (nonempty(text)) fields[key] = text;
  }
  if (value.userNegativePrompt !== undefined && (typeof value.userNegativePrompt !== 'string' || value.userNegativePrompt.length > 12000)) throw sceneError('Negativeが不正です');
  if (!Array.isArray(value.loras ?? []) || (value.loras ?? []).length > 100) throw sceneError('LoRA一覧が不正です');
  const loras = (value.loras ?? []).map(item => {
    keys(item,['identity','name','weight','role']);
    validateIdentity(item.identity);
    if (item.role !== 'scene' || !nonempty(item.name) || item.name.length > 500 || !Number.isFinite(item.weight) || (item.weight !== 0 && item.weight < 0.05) || item.weight > 2) throw sceneError('場面LoRAの分類・weight（0、または0.05〜2）を確認してください');
    for (const key of ['registryUid','sha256','civitaiVersionId','recordedName']) if (item.identity[key] != null && !['string','number'].includes(typeof item.identity[key])) throw sceneError('LoRA同一性が不正です');
    return {...item, identity:sceneIdentity(item)};
  });
  if (new Set(loras.map(item=>JSON.stringify(item.identity))).size !== loras.length) throw sceneError('LoRAが重複しています');
  if (!Array.isArray(value.loraTriggers ?? []) || (value.loraTriggers ?? []).length > 1000) throw sceneError('Trigger一覧が不正です');
  const loraTriggers = (value.loraTriggers ?? []).map(trigger => {
    keys(trigger,['text','targetField','weight','enabled','sources']);
    if (!nonempty(trigger.text) || trigger.text.length > 12000 || !SCENE_FIELDS.includes(trigger.targetField) || !Number.isFinite(trigger.weight) || trigger.weight < 0.05 || trigger.weight > 2 || typeof trigger.enabled !== 'boolean' || !Array.isArray(trigger.sources) || trigger.sources.length>100) throw sceneError('Triggerが不正です');
    const sources = trigger.sources.map(source => {
      keys(source,['loraIdentity','sourceKind','choiceId']);
      validateIdentity(source.loraIdentity);
      if (!['base','outfit'].includes(source.sourceKind) || (source.sourceKind === 'outfit' && (!nonempty(source.choiceId)||source.choiceId.length>500))) throw sceneError('Trigger sourceが不正です');
      if (!loras.some(item=>JSON.stringify(item.identity) === JSON.stringify(sceneIdentity({identity:source.loraIdentity})))) throw sceneError('Triggerの保存LoRAがありません');
      return {loraIdentity:sceneIdentity({identity:source.loraIdentity}),sourceKind:source.sourceKind,choiceId:source.sourceKind === 'outfit' ? source.choiceId : null};
    });
    return {...trigger,sources};
  }).filter(trigger=>trigger.sources.length);
  // Inline directives cannot be retained invisibly across identity/weight replacement.
  if (Object.values(fields).some(text=>parseLoraTags(text).length)) throw sceneError('本文の <lora:…> 指定を整理し、LoRA一覧で選択してください');
  return {name:value.name.trim(),contentRating:value.contentRating,fields,loras,loraTriggers,
    ...(nonempty(value.userNegativePrompt) ? {userNegativePrompt:value.userNegativePrompt} : {})};
}
export function extractSceneSource(record, catalog = []) {
  const structured = record.structuredPrompt && !record.rawPromptOverride;
  const sections = structured ? profileSections(record.structuredPrompt,record.sectionProfiles) : {};
  const loras = (record.loras ?? []).map(item => {
    // Only an identity already recorded at generation can be automatically trusted later.
    const current = catalog.find(entry=>entry.name === item.name);
    return {...item, identity:sceneIdentity(item), identityCandidate:current ? sceneIdentity(current) : null, role:sceneLoraRole(current), selected:item.enabled !== false && sceneLoraRole(current) === 'scene'};
  });
  return {name:record.title || record.description || '',contentRating:['general','nsfw'].includes(record.contentRating) ? record.contentRating : '',
    fields:Object.fromEntries(SCENE_FIELDS.filter(key=>nonempty(sections[key])).map(key=>[key,sections[key]])),
    loras,userNegativePrompt:Object.hasOwn(record,'userNegativePrompt') ? record.userNegativePrompt : '',
    negativeRecorded:Object.hasOwn(record,'userNegativePrompt'), referenceNegative:record.negativePrompt ?? '',
    referencePrompt:structured ? '' : record.rawPrompt || record.prompt || '',
    appliedTriggerWords:normalizeAppliedTriggerWords(record.appliedTriggerWords),
    source:{historyImageId:record.selectedImage?.id,historyGenerationId:record.id,checkpointName:record.settings?.checkpoint ?? record.settings?.checkpointModelName ?? record.checkpoint ?? null}};
}
export function extractSceneTriggers(triggers, loras) {
  return normalizeAppliedTriggerWords(triggers).filter(trigger=>SCENE_FIELDS.includes(trigger.targetField)).map(trigger=>({
    text:trigger.text,targetField:trigger.targetField,weight:trigger.weight,enabled:trigger.enabled,
    sources:trigger.sourceLoraIds.flatMap(id=>{
      const outfit = parseOutfitStateSourceId(id);
      const lora = loras.find(item=>item.name === (outfit?.loraName ?? id));
      return lora ? [{loraIdentity:lora.identity,sourceKind:outfit ? 'outfit' : 'base',choiceId:outfit?.choiceId ?? null}] : [];
    })
  })).filter(trigger=>trigger.sources.length);
}
export function planSceneApplication(scene, {prompt,loras,catalog,maxSelected = 4}, decisions = {}) {
  const content = validateSceneContent(Object.fromEntries(['name','contentRating','fields','loras','loraTriggers','userNegativePrompt'].filter(key=>scene[key] !== undefined).map(key=>[key,scene[key]])));
  const resolved = content.loras.map((saved,index)=>({saved,index,...resolveSceneLora(saved,catalog,decisions.matches?.[index])}));
  const missing = resolved.filter(entry=>!entry.item);
  const available = resolved.filter(entry=>entry.item);
  const unknown = available.length ? loras.filter(item=>sceneLoraRole(catalog.find(c=>c.name===item.name)) === 'unknown') : [];
  const needsRaw = prompt.rawPromptOverride && Object.keys(content.fields).length > 0;
  const issues = [];
  if (missing.length && !decisions.allowMissing) issues.push('missing');
  if (unknown.some(item=>!Object.hasOwn(decisions.keep ?? {},item.name))) issues.push('classification');
  if (needsRaw && !decisions.sections) issues.push('raw');
  const sections = decisions.sections ? normalizeSections(decisions.sections) : {...prompt.structuredPrompt};
  const profiles = structuredClone(prompt.sectionProfiles ?? {});
  for (const [key,text] of Object.entries(content.fields)) { sections[key] = text; delete profiles[key]; }
  const retained = available.length ? loras.filter(item=>sceneLoraRole(catalog.find(c=>c.name===item.name)) === 'character' || decisions.keep?.[item.name] === true) : loras;
  const selected = available.length ? [...retained,...available.map(({saved,item})=>({name:item.name,weight:saved.weight,enabled:true,source:'ui',triggerWords:'',negativeWords:''}))] : loras;
  if (selected.length > maxSelected) throw sceneError(`LoRAは合計${maxSelected}件までです。現在の構成を整理してください`);
  if (new Set(selected.map(item=>item.name)).size !== selected.length) throw sceneError('保持するキャラクターと場面LoRAが重複しています');
  const rawMode = prompt.rawPromptOverride && !decisions.sections;
  const inline = (rawMode ? [prompt.rawPrompt] : Object.values(sections)).flatMap(parseLoraTags);
  if (available.length && inline.some(tag=>{
    const matches=selected.filter(item=>sameLoraName(item.name,tag.name));
    return matches.length!==1||tag.invalidWeight||tag.clamped||tag.extra||matches[0].weight!==tag.weight;
  })) issues.push('inline');
  let triggers = normalizeAppliedTriggerWords(prompt.appliedTriggerWords);
  if (available.length) {
    const retainedNames = new Set(retained.map(item=>item.name));
    const removedNames = new Set(loras.filter(item=>!retainedNames.has(item.name)).map(item=>item.name));
    triggers = triggers.map(trigger=>({...trigger,sourceLoraIds:trigger.sourceLoraIds.filter(id=>!removedNames.has(outfitSourceLoraName(id) || id))})).filter(trigger=>trigger.sourceLoraIds.length);
    for (const trigger of content.loraTriggers) {
      const ids = trigger.sources.flatMap(source=>{
        const match = available.find(entry=>JSON.stringify(entry.saved.identity)===JSON.stringify(source.loraIdentity));
        return match ? [source.sourceKind === 'outfit' ? outfitStateSourceId(match.item.name,source.choiceId) : match.item.name] : [];
      });
      if (!ids.length) continue;
      const same = triggers.find(t=>triggerKey(t.text)===triggerKey(trigger.text));
      if (same) same.sourceLoraIds = [...new Set([...same.sourceLoraIds,...ids])];
      else triggers.push({text:trigger.text,targetField:trigger.targetField,weight:trigger.weight,enabled:trigger.enabled,sourceLoraIds:ids});
    }
  }
  return {issues:[...new Set(issues)],missing,unknown,available,needsRaw,content,
    update:{sections,profiles,loras:selected,replaceLoras:available.length > 0,triggers,rawPromptOverride:rawMode,userNegativePrompt:content.userNegativePrompt},contentRating:content.contentRating};
}
