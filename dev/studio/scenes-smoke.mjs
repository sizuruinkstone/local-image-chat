import {createRequire} from 'node:module';
import {once} from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import express from 'express';
import sharp from 'sharp';
import {createSceneService} from '../../src/scenes.js';
import {createV1Router} from '../../src/api/v1/router.js';
import {installFrontendEntry} from '../../src/frontend-entry.js';
import {createPreviewTransport} from './fixture-transport.js';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.LIC_PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lic-scenes-browser-'));
const artifacts=path.resolve('workbench/scenes');await fs.mkdir(artifacts,{recursive:true});
const imageId='12345678-1234-1234-1234-123456789abc',secondId='12345678-1234-1234-1234-123456789abd';
await sharp({create:{width:480,height:640,channels:3,background:'#71877b'}}).png().toFile(path.join(dir,'source.png'));
await sharp({create:{width:640,height:480,channels:3,background:'#c5a27d'}}).png().toFile(path.join(dir,'second.png'));
const record={id:'scene-source',title:'Fixture source',contentRating:'general',prompt:'person, old city',userNegativePrompt:'blur',structuredPrompt:{character:'person',appearance:'coat',situation:'night city'},rawPromptOverride:false,loras:[],settings:{checkpoint:'Fixture source checkpoint'},images:[{id:imageId,filename:'source.png',thumbnailUrl:`/api/images/${imageId}/thumbnail`,originalUrl:`/api/images/${imageId}/original`} ]};
const fixtureCatalog=[{name:'Soft light',registry:{uid:'fixture-light',subcategory:'style'}},{name:'Actor',registry:{uid:'fixture-actor',subcategory:'character'}}];
record.loras=[{name:'Actor',weight:.4,enabled:true},{name:'Soft light',weight:0,enabled:true}];
const second={...record,id:'second-source',title:'Other image',images:[{id:secondId,filename:'second.png',thumbnailUrl:`/api/images/${secondId}/thumbnail`,originalUrl:`/api/images/${secondId}/original`}]};
let records=[record,second],generationPosts=0;
const history={getRecipe:async id=>{const r=records.find(r=>r.images.some(image=>image.id===id));if(!r)throw new Error('source removed');return {...r,selectedImage:r.images.find(image=>image.id===id)};},getImage:async id=>{const recipe=await history.getRecipe(id);return recipe.selectedImage;}};
const service=createSceneService({dataDir:dir,outputDir:dir,history,getCatalog:async()=>fixtureCatalog});await service.recover();
const app=express(),fixture=createPreviewTransport();app.use(express.json());app.use('/api/v1',createV1Router({generationService:{},scenes:service}));
app.get('/api/images/:id/:size',async(req,res)=>{try{const image=await history.getImage(req.params.id);res.sendFile(path.join(dir,image.filename));}catch{res.sendStatus(404);}});
app.get('/api/history', (req,res)=>res.json({generations:records.filter(r=>r.contentRating===(req.query.rating??'general')&&r.title.includes(req.query.search??'')),hasMore:false,total:records.length}));
app.get('/api/history/:id/recipe',async(req,res)=>res.json(await history.getRecipe(req.params.id)));
app.get('/api/loras',(_req,res)=>res.json({loras:fixtureCatalog}));
app.get('/api/{*path}',async(req,res)=>{try{res.json(await fixture.getJson(req.url));}catch{res.json({});}});
app.post('/api/jobs',(_req,res)=>{generationPosts++;res.sendStatus(500);});
installFrontendEntry(app,path.resolve('public'));
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
const browser=await chromium.launch({headless:true,channel:'chrome'}),page=await browser.newPage({viewport:{width:1440,height:900}});
const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push(request.url()));page.on('dialog',dialog=>dialog.accept());
const origin=`http://127.0.0.1:${server.address().port}`;
async function overflow(label){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${label}: page overflow`);const dialogs=await page.locator('dialog[open]').evaluateAll(nodes=>nodes.map(node=>({width:node.scrollWidth,client:node.clientWidth})));assert.ok(dialogs.every(d=>d.width<=d.client+1),`${label}: dialog overflow`);}
try {
 await page.goto(origin);await page.getByRole('button',{name:'Structured · 編集',exact:true}).waitFor();
 // Production entry, legacy entry and new modules remain available without a build.
 assert.match(await (await page.request.get(`${origin}/?legacy=1`)).text(),/app\.js/);
 assert.equal((await page.request.get(`${origin}/scenes.js`)).status(),200);assert.equal((await page.request.get(`${origin}/frontend/styles/scenes.css`)).status(),200);
 await page.getByRole('button',{name:'Structured · 編集',exact:true}).click();await page.getByRole('textbox',{name:'キャラクター',exact:true}).fill('kept character');await page.keyboard.press('Escape');
 for(const width of [1440,390,430]) {
  await page.setViewportSize({width,height:900});
  await page.getByRole('button',{name:'Library',exact:true}).click();await page.getByRole('button',{name:`View image ${imageId}`,exact:true}).click();
  await page.getByRole('button',{name:'場面として保存',exact:true}).click();
  const editor=page.getByRole('dialog',{name:'場面を保存・編集',exact:true});
  await editor.getByRole('textbox',{name:'場面の名前',exact:true}).fill(`Night ${width}`);
  await editor.getByRole('textbox',{name:'シチュエーション・背景',exact:true}).fill(`city ${width}`);
  assert.equal(await editor.getByRole('checkbox',{name:'Actor',exact:true}).isChecked(),false);
  assert.equal(await editor.getByRole('checkbox',{name:'Actor',exact:true}).isDisabled(),true);
  await editor.getByRole('combobox',{name:'Soft lightの同一性',exact:true}).selectOption('confirmed');
  await overflow(`editor ${width}`);await page.screenshot({path:path.join(artifacts,`editor-${width}.png`)});
  await editor.getByRole('button',{name:'保存',exact:true}).click();await editor.waitFor({state:'hidden'});
  const stored=(await service.get((await service.list({query:`Night ${width}`})).items[0].id)).scene;assert.equal(stored.loras.length,1);assert.equal(stored.loras[0].weight,0);assert.equal(stored.loras[0].identity.registryUid,'fixture-light');
  assert.equal(await page.getByRole('dialog',{name:'Image Viewer',exact:true}).isVisible(),true);
  await page.getByRole('dialog',{name:'Image Viewer',exact:true}).getByRole('button',{name:'閉じる',exact:true}).click();
  await page.getByRole('button',{name:'Scenes',exact:true}).click();await page.getByRole('button',{name:`Night ${width}を適用`,exact:true}).waitFor();
  await overflow(`list ${width}`);await page.screenshot({path:path.join(artifacts,`list-${width}.png`)});
  assert.equal(await page.locator('.scene-grid img').first().evaluate(node=>getComputedStyle(node).objectFit),'contain');
  await page.getByRole('button',{name:`Night ${width}を編集`,exact:true}).click();
  await editor.getByRole('textbox',{name:'場面の名前',exact:true}).fill(`Updated ${width}`);
  await editor.getByRole('button',{name:'画像を変更',exact:true}).click();
  await page.getByRole('dialog',{name:'Libraryから代表画像を選択',exact:true}).getByRole('button',{name:'Other image',exact:true}).click();
  await editor.getByRole('button',{name:'上書き保存',exact:true}).click();await editor.waitFor({state:'hidden'});
  await page.getByRole('button',{name:`Updated ${width}を編集`,exact:true}).click();await editor.getByRole('textbox',{name:'場面の名前',exact:true}).fill(`Copy ${width}`);await editor.getByRole('button',{name:'別名保存',exact:true}).click();await editor.waitFor({state:'hidden'});
  const search=page.getByRole('searchbox',{name:'場面を名前で検索'});await search.fill(`Updated ${width}`);await page.waitForFunction(()=>document.querySelectorAll('.scene-card').length===1);
  await page.getByRole('button',{name:`Updated ${width}を適用`,exact:true}).click();await page.locator('.studio-shell[data-view="studio"]').waitFor();
  await page.getByRole('button',{name:'Structured · 編集',exact:true}).click();assert.equal(await page.getByRole('textbox',{name:'キャラクター',exact:true}).inputValue(),'kept character');assert.equal(await page.getByRole('textbox',{name:'シチュエーション・背景',exact:true}).inputValue(),`city ${width}`);await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Scenes',exact:true}).click();assert.equal(await search.inputValue(),`Updated ${width}`);assert.equal(await page.locator('.scene-card').count(),1);await search.fill('');await page.waitForFunction(()=>document.querySelectorAll('.scene-card').length>1);
 }
 // Raw and missing-LoRA exception: cancel is a no-op; explicit split applies rating without generating.
 const missingScene=(await service.create({sourceImageId:imageId,mutationId:'missing-browser',content:{name:'Missing scene',contentRating:'nsfw',fields:{situation:'exception city'},loras:[{name:'Absent LoRA',identity:{registryUid:null,sha256:null,civitaiVersionId:null,recordedName:'Absent LoRA'},weight:0,role:'scene'}],loraTriggers:[]}})).scene;
 await page.getByRole('button',{name:'Studio',exact:true}).click();await page.getByRole('button',{name:'Structured · 編集',exact:true}).click();await page.getByRole('button',{name:'Raw',exact:true}).click();await page.getByRole('textbox',{name:'Raw Prompt',exact:true}).fill('raw character, raw outfit');await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Scenes',exact:true}).click();await page.locator('.scenes-tools').getByRole('button',{name:'NSFW',exact:true}).click();await page.getByRole('button',{name:'Missing sceneを適用',exact:true}).click();
 const exception=page.getByRole('dialog',{name:'場面の適用を確認',exact:true});await exception.waitFor();await overflow('raw exception 430');await exception.getByRole('button',{name:'キャンセル',exact:true}).click();assert.equal(await page.locator('.studio-shell').getAttribute('data-view'),'scenes');await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Missing sceneを適用');
 await page.getByRole('button',{name:'Missing sceneを適用',exact:true}).click();await exception.getByRole('textbox',{name:'キャラクター',exact:true}).fill('split character');await exception.getByRole('button',{name:'分割して場面を適用',exact:true}).click();await page.locator('.studio-shell[data-view="studio"]').waitFor();
 assert.equal(await page.locator('.prompt-dock').getByRole('button',{name:'NSFW',exact:true}).getAttribute('aria-pressed'),'true');
 await page.getByRole('button',{name:'Structured · 編集',exact:true}).click();assert.equal(await page.getByRole('textbox',{name:'キャラクター',exact:true}).inputValue(),'split character');await page.getByRole('button',{name:'Raw',exact:true}).click();assert.equal(await page.getByRole('textbox',{name:'Raw Prompt',exact:true}).inputValue(),'raw character, raw outfit');await page.getByRole('button',{name:'Structured',exact:true}).click();await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'Scenes',exact:true}).click();assert.equal(await page.locator('.scenes-tools').getByRole('button',{name:'NSFW',exact:true}).getAttribute('aria-pressed'),'true');await page.locator('.scenes-tools').getByRole('button',{name:'一般',exact:true}).click();await page.getByRole('button',{name:'Updated 430を編集',exact:true}).waitFor();
 // Remote edit conflict preserves the user's unsaved form and offers a copy.
 await page.getByRole('button',{name:'Updated 430を編集',exact:true}).click();const editor=page.getByRole('dialog',{name:'場面を保存・編集',exact:true});await editor.getByRole('textbox',{name:'場面の名前'}).fill('Local unsaved');
 const saved=(await service.list({query:'Updated 430'})).items[0],latest=(await service.get(saved.id)).scene;
 const content=Object.fromEntries(['name','fields','contentRating','loras','loraTriggers'].map(key=>[key,latest[key]]));await service.update(saved.id,{expectedRevision:latest.revision,content:{...content,name:'Remote edit'}});
 await editor.getByRole('button',{name:'上書き保存',exact:true}).click();await editor.getByRole('button',{name:'最新版を読み直す',exact:true}).waitFor();assert.equal(await editor.getByRole('textbox',{name:'場面の名前'}).inputValue(),'Local unsaved');await editor.getByRole('button',{name:'別名保存',exact:true}).click();await editor.waitFor({state:'hidden'});
 // Original Library removal leaves every scene and its independently copied image readable.
 records=[];await fs.rm(path.join(dir,'source.png'));await fs.rm(path.join(dir,'second.png'));
 const all=(await service.list()).items;for(const item of all){const response=await page.request.get(origin+item.thumbnailUrl);assert.equal(response.status(),200);}
 const secondPage=await browser.newPage();await secondPage.goto(origin);await secondPage.getByRole('button',{name:'Scenes',exact:true}).click();await secondPage.getByRole('button',{name:'Local unsavedを適用',exact:true}).waitFor();await secondPage.close();
 await page.getByRole('button',{name:'Local unsavedを編集',exact:true}).click();await editor.getByRole('button',{name:'削除',exact:true}).click();await editor.waitFor({state:'hidden'});await page.getByRole('button',{name:'Local unsavedを適用',exact:true}).waitFor({state:'hidden'});
 assert.equal(generationPosts,0);assert.deepEqual(errors,[]);assert.equal(requests.some(url=>url.includes('/scenes/')&&url.includes('size=original')),false);
 console.log('Scenes browser PASS: production/legacy/static, save/edit/copy/delete, image picker, shared conflict, independent images, apply/no generation, desktop/390/430, contain/no original preload');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));await fs.rm(dir,{recursive:true,force:true});}
