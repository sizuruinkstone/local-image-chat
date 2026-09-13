import {SECTION_PROFILE_SAMPLES} from "./section-profile-samples.js";
import { appendTriggersToRawPrompt, syncTriggerWords, triggerKey } from './structured-prompt.js';
export const PROFILE_SECTIONS = ['character','appearance','composition','situation'];
export const PROFILE_CONTENT_RATINGS = ['general','nsfw'];
export function normalizeProfileContentRating(value) { return value === 'nsfw' ? 'nsfw' : 'general'; }
export function normalizeSectionProfiles(value) {
 const result={};
 for(const field of PROFILE_SECTIONS){
  const p=value?.[field];
  if(p && typeof p.text==='string') {
   const disabledTriggerKeys=[...new Set((Array.isArray(p.disabledTriggerKeys)?p.disabledTriggerKeys:[]).filter(key=>typeof key==='string'&&key).map(triggerKey).filter(Boolean))].slice(0,300);
   result[field]={id:String(p.id??'').slice(0,100),name:String(p.name??'無題').slice(0,100),text:p.text.slice(0,12000),enabled:p.enabled!==false,contentRating:normalizeProfileContentRating(p.contentRating),...(disabledTriggerKeys.length?{disabledTriggerKeys}:{})};
  }
 }
 return result;
}
export function profileSections(sections,profiles){
 const result={...sections};
 for(const [field,p] of Object.entries(normalizeSectionProfiles(profiles))) if(p.enabled){
  const disabled=new Set(p.disabledTriggerKeys);
  const triggers=syncTriggerWords([],[{id:'section-profile',triggerWords:p.text,targetField:field}]).triggers.map(trigger=>({...trigger,enabled:!disabled.has(triggerKey(trigger.text))}));
  result[field]=appendTriggersToRawPrompt(result[field]??'',triggers);
 }
 return result;
}
export function profileRaw(raw,profiles){
 let result=raw;
 for(const p of Object.values(normalizeSectionProfiles(profiles)))if(p.enabled){
  const disabled=new Set(p.disabledTriggerKeys);
  const triggers=syncTriggerWords([],[{id:'section-profile',triggerWords:p.text}]).triggers.map(trigger=>({...trigger,enabled:!disabled.has(triggerKey(trigger.text))}));
  result=appendTriggersToRawPrompt(result,triggers);
 }
 return result;
}
export function createSectionProfileLibrary(storage){
 const key='localImageChat.sectionProfiles.v1';
 const hiddenKey='localImageChat.sectionProfileSamplesHidden.v1';
 let hidden=[];
 try{const saved=JSON.parse(storage.getItem(hiddenKey)||'[]');if(Array.isArray(saved))hidden=saved.filter(id=>typeof id==='string');}catch{/* Optional sample preference. */}
 let items=[];
 try{const saved=JSON.parse(storage.getItem(key)||'[]');if(Array.isArray(saved))items=saved.filter(p=>PROFILE_SECTIONS.includes(p.field)&&p.id&&p.name&&p.text).slice(0,300).map(p=>({...p,contentRating:normalizeProfileContentRating(p.contentRating)}));}catch{/* A damaged optional catalog does not block generation. */}
 return {list:()=>structuredClone([...items,...SECTION_PROFILE_SAMPLES.filter(p=>!hidden.includes(p.id))]),save(field,value){
  if(!PROFILE_SECTIONS.includes(field)||!value.name?.trim()||!value.text?.trim())throw new Error('名前とPrompt内容を入力してください。');
  if(value.contentRating!==undefined&&!PROFILE_CONTENT_RATINGS.includes(value.contentRating))throw new Error('分類は一般またはNSFWを指定してください。');
  if(items.length>=300)throw new Error('保存上限300件です。不要なプロファイルを削除してください。');
  const p={...normalizeSectionProfiles({[field]:value})[field],field,id:globalThis.crypto.randomUUID()};
  const next=[...items,p];storage.setItem(key,JSON.stringify(next));items=next;return structuredClone(p);
 },remove(id){
  if(SECTION_PROFILE_SAMPLES.some(p=>p.id===id)){const next=[...new Set([...hidden,id])];storage.setItem(hiddenKey,JSON.stringify(next));hidden=next;return;}
  const next=items.filter(p=>p.id!==id);storage.setItem(key,JSON.stringify(next));items=next;}};
}
