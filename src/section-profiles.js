import path from 'node:path';
import crypto from 'node:crypto';
import {JsonStore} from './json-store.js';
import {PROFILE_SECTIONS} from '../public/section-profiles.js';
import {SECTION_PROFILE_SAMPLES} from '../public/section-profile-samples.js';
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{apiCode:statusCode===404?'NOT_FOUND':'INVALID_REQUEST',statusCode});
function validate(value){
 if(!value||!PROFILE_SECTIONS.includes(value.field)||typeof value.name!=='string'||!value.name.trim()||value.name.length>100||typeof value.text!=='string'||!value.text.trim()||value.text.length>12000)throw fail('field・名前（1〜100文字）・Prompt（1〜12000文字）を指定してください');
 if(value.contentRating!==undefined&&!['general','nsfw'].includes(value.contentRating))throw fail('contentRatingはgeneralまたはnsfwで指定してください');
 return {field:value.field,name:value.name.trim(),text:value.text,enabled:true,contentRating:value.contentRating==='nsfw'?'nsfw':'general'};
}
export function createSectionProfileService(dataDir){
 const store=new JsonStore(path.join(dataDir,'section-profiles.json'),{items:[],hidden:[],imported:[]});
 const list=data=>[...data.items.map(p=>({...p,contentRating:p.contentRating==='nsfw'?'nsfw':'general'})),...SECTION_PROFILE_SAMPLES.filter(p=>!data.hidden.includes(p.id)&&!data.items.some(item=>item.id===p.id))];
 return {
  async list(){return {profiles:list(await store.read())};},
  async create(value){const p={...validate(value),id:crypto.randomUUID()};await store.update(data=>{if(data.items.length>=300)throw fail('保存上限300件です');data.items.push(p);return data;});return {profile:p};},
  async update(id,value){let profile;await store.update(data=>{const existing=list(data).find(p=>p.id===id);if(!existing)throw fail('プロファイルがありません',404);if(!data.items.some(p=>p.id===id)&&data.items.length>=300)throw fail('保存上限300件です');profile={...validate({...existing,...value}),id};data.items=data.items.filter(p=>p.id!==id);data.items.push(profile);return data;});return {profile};},
  async remove(id){await store.update(data=>{if(!list(data).some(p=>p.id===id))return;data.items=data.items.filter(p=>p.id!==id);if(SECTION_PROFILE_SAMPLES.some(p=>p.id===id)&&!data.hidden.includes(id))data.hidden.push(id);return data;});return {deleted:true,id};},
  async importLegacy(body){
   if(!Array.isArray(body?.profiles)||body.profiles.length>300||!Array.isArray(body.hidden)||body.hidden.length>100)throw fail('移行データが不正です');
   const entries=body.profiles.map(p=>{if(typeof p?.id!=='string'||!p.id||p.id.length>100)throw fail('移行IDが不正です');return {...validate(p),id:p.id};});
   await store.update(data=>{
    for(const p of entries){if(data.imported.includes(p.id))continue;if(data.items.length>=300)throw fail('保存上限300件です');if(!data.items.some(item=>item.id===p.id))data.items.push(p);data.imported.push(p.id);}
    // One-time import of hidden bundled samples; later server choices win.
    for(const id of body.hidden){const token=`hidden:${id}`;if(SECTION_PROFILE_SAMPLES.some(p=>p.id===id)&&!data.imported.includes(token)){if(!data.hidden.includes(id))data.hidden.push(id);data.imported.push(token);}}
    return data;
   });return this.list();
  }
 };
}
export function registerSectionProfileRoutes(router,{service,wrap}){
 router.get('/section-profiles',wrap(async(req,res)=>res.json(await service.list())));
 router.post('/section-profiles/import',wrap(async(req,res)=>res.json(await service.importLegacy(req.body))));
 router.post('/section-profiles',wrap(async(req,res)=>res.status(201).json(await service.create(req.body))));
 router.patch('/section-profiles/:id',wrap(async(req,res)=>res.json(await service.update(req.params.id,req.body))));
 router.delete('/section-profiles/:id',wrap(async(req,res)=>res.json(await service.remove(req.params.id))));
}
