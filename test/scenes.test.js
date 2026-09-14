import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import express from 'express';
import {once} from 'node:events';
import {createSceneService} from '../src/scenes.js';
import {createV1Router} from '../src/api/v1/router.js';
import {validateSceneContent,sceneIdentity,extractSceneSource,extractSceneTriggers,planSceneApplication,resolveSceneLora} from '../public/scenes.js';
import {createGenerationDraft} from '../public/features/generation-draft.js';
import {createSceneLibrary} from '../public/core/scene-library.js';
import {JsonStore} from '../src/json-store.js';
const content=(patch={})=>({name:'夜の街',contentRating:'general',fields:{situation:'night city'},loras:[],loraTriggers:[],...patch});
const catalog=[{name:'person',registry:{uid:'person-uid',subcategory:'character'}},{name:'old',registry:{uid:'old-uid',subcategory:'style'}},{name:'new',registry:{uid:'new-uid',subcategory:'style'}}];
const sceneLora=(item=catalog[2],weight=0)=>({name:item.name,identity:sceneIdentity(item),role:'scene',weight});
test('scene schema permits nonempty five fields and zero weight; rejects unsupported contracts and inline directives',()=>{
 const value=validateSceneContent(content({fields:{appearance:'  ',style:' ink '},userNegativePrompt:'',loras:[sceneLora()]}));
 assert.deepEqual(value.fields,{style:' ink '});assert.equal(value.loras[0].weight,0);assert.equal(value.userNegativePrompt,undefined);
 for(const patch of [{fields:{character:'person'}},{settings:{}},{preview:{path:'x'}},{loras:[{...sceneLora(),role:'character'}]},{fields:{style:'<lora:new:1>'}},{loras:[sceneLora(catalog[2],3)]}])assert.throws(()=>validateSceneContent(content(patch)));
});
test('source extraction excludes character and managed final values, composes enabled profiles, respects explicit empty Negative',()=>{
 const record={structuredPrompt:{character:'person',situation:'city'},sectionProfiles:{situation:{text:'rain',enabled:true}},userNegativePrompt:'',negativePrompt:'checkpoint negative',contentRating:'general',loras:[{name:'person',weight:.5},{name:'new',weight:0}],appliedTriggerWords:[]};
 const source=extractSceneSource(record,catalog);assert.equal(source.fields.character,undefined);assert.match(source.fields.situation,/rain/);assert.equal(source.userNegativePrompt,'');assert.equal(source.loras[0].selected,false);assert.equal(source.loras[1].selected,true);assert.equal(source.loras[1].identity.registryUid,null);
 const raw=extractSceneSource({...record,rawPromptOverride:true,rawPrompt:'manual raw'});assert.deepEqual(raw.fields,{});assert.equal(raw.referencePrompt,'manual raw');
 const legacy=extractSceneSource({prompt:'old final',negativePrompt:'old negative'});assert.equal(legacy.negativeRecorded,false);assert.equal(legacy.userNegativePrompt,'');assert.equal(legacy.contentRating,'');
});
test('identity requires UID or full hash, detects collisions, rename and manual weak matches',()=>{
 const saved=sceneLora();assert.equal(resolveSceneLora(saved,[{...catalog[2],name:'renamed'}]).item.name,'renamed');
 assert.equal(resolveSceneLora({...saved,identity:sceneIdentity({name:'new'})},catalog).status,'missing');
 assert.equal(resolveSceneLora({...saved,identity:sceneIdentity({name:'new'})},catalog,'new').status,'manual');
 const identity={...saved.identity,sha256:'a'.repeat(64)};
 assert.equal(resolveSceneLora({...saved,identity},[{...catalog[2],sha256:'b'.repeat(64)}],'new').status,'collision');
 assert.equal(resolveSceneLora({...saved,identity},[{name:'renamed',sha256:'a'.repeat(64)}]).item.name,'renamed');
});
test('atomic draft plan preserves character, parameters, profiles, blank sections and zero weight; reconciles trigger ownership',()=>{
 const draft=createGenerationDraft({getCatalog:()=>catalog});
 draft.setPrompt({sections:{character:'person text',appearance:'dress',situation:'park',style:'old style'},negative:'manual negative'});
 draft.setParameters({width:768,seed:42});draft.setSectionProfile('character',{text:'solo',enabled:false});draft.setSectionProfile('situation',{text:'old background',enabled:true});
 draft.addLora('person',.4);draft.toggleLora('person');draft.addLora('old',.6);
 draft.addManagedTriggers('person',{triggerWords:'shared, identity'});draft.addManagedTriggers('old',{triggerWords:'shared, old words'});
 const trigger={text:'scene words',targetField:'style',weight:1,enabled:true,sources:[{loraIdentity:sceneIdentity(catalog[2]),sourceKind:'base',choiceId:null}]};
 const scene=content({loras:[sceneLora()],loraTriggers:[trigger]});
 const plan=planSceneApplication(scene,{prompt:draft.readPrompt(),loras:draft.readLoras(),catalog});assert.deepEqual(plan.issues,[]);
 const before=draft.capture();draft.applyScene(plan.update);
 assert.deepEqual(draft.readParameters(),before.settings);assert.equal(draft.readPrompt().structuredPrompt.character,'person text');assert.equal(draft.readPrompt().structuredPrompt.appearance,'dress');assert.equal(draft.readPrompt().sectionProfiles.situation,undefined);assert.equal(draft.readPrompt().sectionProfiles.character.enabled,false);
 assert.deepEqual(draft.readLoras().map(({name,weight,enabled})=>({name,weight,enabled})),[{name:'person',weight:.4,enabled:false},{name:'new',weight:0,enabled:true}]);
 assert.equal(draft.readPrompt().negativePrompt,'manual negative');assert.doesNotMatch(draft.positive(),/old words/);assert.match(draft.positive(),/scene words/);
 draft.restore(before);assert.deepEqual(draft.capture(),before);
});
test('all missing and zero saved LoRAs maintain selection; Raw requires explicit split and retains inactive raw',()=>{
 const draft=createGenerationDraft({getCatalog:()=>catalog});draft.setPrompt({positive:'my raw',negative:'neg'});draft.addLora('old',.7);
 const scene=content({loras:[sceneLora({name:'absent'})]});
 const context={prompt:draft.readPrompt(),loras:draft.readLoras(),catalog};
 const initial=planSceneApplication(scene,context);assert.deepEqual(initial.issues,['missing','raw']);assert.deepEqual(draft.readPrompt(),context.prompt);
 const final=planSceneApplication(scene,context,{allowMissing:true,sections:{character:'manual person',style:''}});draft.applyScene(final.update);
 assert.equal(draft.readPrompt().rawPromptOverride,false);assert.equal(draft.capture().prompt.rawPrompt,'my raw');assert.equal(draft.readLoras()[0].name,'old');
 const negativeOnly=planSceneApplication(content({fields:{},userNegativePrompt:'new'}),context);assert.deepEqual(negativeOnly.issues,[]);assert.equal(negativeOnly.update.rawPromptOverride,true);
});
test('inline-derived LoRAs survive a replaced field and subsequent generation reconciliation with no saved LoRAs',()=>{
 const draft=createGenerationDraft({getCatalog:()=>catalog});draft.setPrompt({sections:{style:'<lora:old:0.6>'}});
 assert.equal(draft.readLoras()[0].source,'prompt');
 const plan=planSceneApplication(content({fields:{style:'ink'}}),{prompt:draft.readPrompt(),loras:draft.readLoras(),catalog});draft.applyScene(plan.update);draft.syncLoras();
 assert.equal(draft.readLoras()[0].name,'old');assert.equal(draft.readLoras()[0].weight,.6);assert.equal(draft.readPrompt().structuredPrompt.style,'ink');
});
test('compatible retained character inline directive needs no manual exception',()=>{
 const draft=createGenerationDraft({getCatalog:()=>catalog});draft.setPrompt({sections:{character:'person, <lora:person:0.4>'}});
 const plan=planSceneApplication(content({loras:[sceneLora()]}),{prompt:draft.readPrompt(),loras:draft.readLoras(),catalog});assert.deepEqual(plan.issues,[]);draft.applyScene(plan.update);draft.syncLoras();
 assert.equal(draft.readLoras().find(l=>l.name==='person').weight,.4);assert.equal(draft.readLoras().find(l=>l.name==='new').weight,0);
});
test('scene commit never stores checkpoint ownership even when a word is shared with a character',()=>{
 const draft=createGenerationDraft({getCatalog:()=>catalog,getCheckpoint:()=>({hash:'ed32d6584f'})});draft.setPrompt({sections:{character:'person'}});draft.addLora('person',.4);draft.addManagedTriggers('person',{triggerWords:'masterpiece'});
 const plan=planSceneApplication(content(),{prompt:draft.readPrompt(),loras:draft.readLoras(),catalog});draft.applyScene(plan.update);
 const stored=draft.capture().prompt.appliedTriggerWords;assert.ok(stored.length);assert.ok(stored.every(trigger=>trigger.sourceLoraIds.every(id=>!id.startsWith('checkpoint-style:'))));assert.match(draft.positive(),/masterpiece/);
});
test('unknown current classification, maximum and inline conflicts require explicit resolution',()=>{
 const prompt={structuredPrompt:{character:'<lora:person:0.5>'},sectionProfiles:{},appliedTriggerWords:[]};
 const context={prompt,loras:[{name:'unknown',weight:1}],catalog:[...catalog,{name:'unknown'}]};
 const scene=content({loras:[sceneLora()]});const plan=planSceneApplication(scene,context);assert.ok(plan.issues.includes('classification'));assert.ok(plan.issues.includes('inline'));
 assert.throws(()=>planSceneApplication(scene,{...context,maxSelected:1},{keep:{unknown:true}}),/合計/);
 const resolved=planSceneApplication(scene,context,{keep:{unknown:true},sections:{character:'person'}});assert.deepEqual(resolved.issues,[]);
});
test('saved triggers use only selected scene identities and remap outfit source after rename',()=>{
 const lora=sceneLora();const triggers=extractSceneTriggers([{text:'clothes',targetField:'appearance',weight:1,enabled:true,sourceLoraIds:['outfit-state:new::preset%3Ax','person','checkpoint-style:abc']}],[lora]);
 assert.equal(triggers[0].sources.length,1);assert.equal(triggers[0].sources[0].choiceId,'preset:x');
 const plan=planSceneApplication(content({loras:[lora],loraTriggers:triggers}),{prompt:{structuredPrompt:{},appliedTriggerWords:[]},loras:[],catalog:[{...catalog[2],name:'renamed'}]});
 assert.equal(plan.update.triggers[0].sourceLoraIds[0],'outfit-state:renamed::preset%3Ax');
});
async function storageFixture(t,options={}) {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lic-scenes-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const imageId='12345678-1234-1234-1234-123456789abc';await sharp({create:{width:30,height:20,channels:3,background:'#884422'}}).png().toFile(path.join(dir,'original.png'));
 const record={id:'generation',title:'Source',contentRating:'general',settings:{checkpoint:'Source checkpoint'},structuredPrompt:{situation:'room'},selectedImage:{id:imageId,filename:'original.png'}};
 const history={getImage:async id=>{assert.equal(id,imageId);return record.selectedImage;},getRecipe:async id=>{assert.equal(id,imageId);return record;}};
 const service=createSceneService({dataDir:dir,outputDir:dir,history,...options});await service.recover();return {dir,imageId,service,record,history};
}
test('shared storage CRUD, source, search/paging, conflict, independent images, copy and recovery',async t=>{
 const {service,imageId,dir,history}=await storageFixture(t);
 assert.equal((await service.source(imageId)).source.source.checkpointName,'Source checkpoint');
 const body={content:content(),sourceImageId:imageId,mutationId:'create-one'};
 const scene=(await service.create(body)).scene;
 assert.equal((await service.create(body)).scene.id,scene.id);
 await assert.rejects(service.create({...body,content:content({name:'changed'})}),{statusCode:409});
 const second=(await service.create({...body,mutationId:'create-two',content:content({name:'Second'})})).scene;
 const page=await service.list({limit:1});assert.equal(page.total,2);assert.equal((await service.list({limit:1,cursor:page.nextCursor})).items.length,1);
 const updated=(await service.update(scene.id,{expectedRevision:1,content:content({name:'Night edit'})})).scene;
 await assert.rejects(service.update(scene.id,{expectedRevision:1,content:content()}),{statusCode:409});
 await assert.rejects(service.list({limit:1,cursor:page.nextCursor}),{statusCode:409});
 assert.equal((await service.list({query:'Night'})).total,1);
 await fs.rm(path.join(dir,'original.png'));
 const independent=await service.preview(scene.id,updated.preview.assetId,'original');assert.equal((await sharp(independent.path).metadata()).width,30);
 const copied=(await service.copy(scene.id,{expectedRevision:2,content:content({name:'Copy'}),mutationId:'copy-one'})).scene;
 assert.notEqual(copied.preview.assetId,updated.preview.assetId);assert.deepEqual(copied.source,updated.source);
 const other=createSceneService({dataDir:dir,outputDir:dir,history});assert.equal((await other.get(copied.id)).scene.name,'Copy');
 await service.remove(scene.id,2);assert.equal((await sharp((await service.preview(copied.id,copied.preview.assetId,'original')).path).metadata()).height,20);
 const orphan='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';await fs.writeFile(path.join(dir,'scenes-images',orphan),'orphan');await service.recover();await assert.rejects(fs.access(path.join(dir,'scenes-images',orphan)));
 await assert.rejects(service.create({...body,mutationId:'source-gone'}));
 await assert.rejects(service.update(second.id,{expectedRevision:1,content:content(),previewSourceImageId:'../../private'}));
 await assert.rejects(service.create({...body,mutationId:'bad-path',path:'C:/private'}),{statusCode:400});
});
test('failed JSON commit removes staged asset and leaves old scene intact',async t=>{
 const {dir,imageId,history}=await storageFixture(t);const actual=new JsonStore(path.join(dir,'failure.json'),{items:[],revision:0,mutations:{}});
 let rejectWrite=false;
 const store={read:()=>actual.read(),update:fn=>actual.update(async data=>{const next=await fn(data);if(rejectWrite)throw new Error('disk write failed');return next;})};
 const service=createSceneService({dataDir:dir,outputDir:dir,history,store});
 const scene=(await service.create({sourceImageId:imageId,mutationId:'first-one',content:content()})).scene;
 const before=await fs.readdir(path.join(dir,'scenes-images'));rejectWrite=true;
 await assert.rejects(service.update(scene.id,{expectedRevision:1,previewSourceImageId:imageId,content:content({name:'new'})}),/disk write/);
 assert.deepEqual(await fs.readdir(path.join(dir,'scenes-images')),before);assert.equal((await service.get(scene.id)).scene.name,'夜の街');
});
test('real HTTP routes validate revision and stream only owned scene assets',async t=>{
 const {service,imageId}=await storageFixture(t);const app=express();app.use(express.json());app.use('/api/v1',createV1Router({generationService:{},scenes:service}));const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));const url=`http://127.0.0.1:${server.address().port}/api/v1/scenes`;
 const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sourceImageId:imageId,mutationId:'http-create',content:content()})});assert.equal(response.status,201);const {scene}=await response.json();
 const image=await fetch(`${url}/${scene.id}/preview?asset=${scene.preview.assetId}&size=thumb`);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/webp');
 assert.equal((await fetch(`${url}/${scene.id}?expectedRevision=0`,{method:'DELETE'})).status,409);
 assert.equal((await fetch(`${url}/${scene.id}?expectedRevision=1`,{method:'DELETE'})).status,200);
});
test('list request and mutation generations suppress stale responses',async()=>{
 const pending=[];const library=createSceneLibrary({request:()=>new Promise(resolve=>pending.push(resolve))});
 const first=library.load(),second=library.setQuery({contentRating:'nsfw'});
 pending[1]({items:[{id:'new'}],total:1});await second;pending[0]({items:[{id:'old'}],total:1});await first;
 assert.equal(library.getState().items[0].id,'new');
 const third=library.load();library.invalidate();pending[2]({items:[],total:0});await third;assert.equal(library.getState().items[0].id,'new');library.dispose();
});
