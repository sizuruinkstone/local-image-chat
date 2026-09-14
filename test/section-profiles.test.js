import test from 'node:test';
import assert from 'node:assert/strict';
import {createSectionProfileLibrary} from '../public/section-profiles.js';
import {createGenerationDraft} from '../public/features/generation-draft.js';
const sample={name:'Summer',text:'white dress, summer hat',enabled:true};
test('saved profiles persist independently from active edits and failed writes are atomic',()=>{
 const values=new Map();const storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
 const library=createSectionProfileLibrary(storage);const p=library.save('appearance',sample);
 assert.equal(p.contentRating,'general');
 const d=createGenerationDraft();d.setSectionProfile('appearance',p);d.setSectionProfile('appearance',{...p,text:'blue dress'});
 assert.equal(library.list()[0].text,sample.text);assert.equal(createSectionProfileLibrary(storage).list()[0].text,sample.text);
 library.remove(p.id);assert.equal(d.readPrompt().sectionProfiles.appearance.text,'blue dress');
 const broken=createSectionProfileLibrary({...storage,setItem:()=>{throw Error('full');}});
 assert.throws(()=>broken.save('appearance',sample),/full/);assert.equal(broken.list().some(item=>item.name===sample.name),false);d.dispose();
});
test('profile content rating separates general and NSFW while legacy entries remain general',()=>{
 const values=new Map([['localImageChat.sectionProfiles.v1',JSON.stringify([{id:'legacy',field:'character',name:'Legacy',text:'solo'}])]]);
 const storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};const library=createSectionProfileLibrary(storage);
 assert.equal(library.list().find(p=>p.id==='legacy').contentRating,'general');
 assert.ok(library.list().filter(p=>p.id.startsWith('sample-v1:')).every(p=>p.contentRating==='general'));
 const nsfw=library.save('appearance',{...sample,contentRating:'nsfw'});assert.equal(nsfw.contentRating,'nsfw');
 const draft=createGenerationDraft();draft.setSectionProfile('appearance',nsfw);assert.equal(draft.readPrompt().sectionProfiles.appearance.contentRating,'nsfw');draft.dispose();
});
test('profiles compose Structured and Raw without baking, preserve empty edits, disable and reuse snapshots',()=>{
 const d=createGenerationDraft();d.setPrompt({sections:{appearance:'white dress'}});d.setSectionProfile('appearance',sample);
 assert.equal(d.positive(),'white dress, summer hat');assert.equal(d.readPrompt().structuredPrompt.appearance,'white dress');
 const saved=d.capture();d.setPrompt({mode:'raw'});assert.equal(d.readPrompt().rawPrompt,'white dress');assert.equal(d.positive(),'white dress, summer hat');
 d.applyGenerated({prompt:d.positive()});assert.equal(d.readPrompt().rawPrompt,'white dress');
 d.setSectionProfile('appearance',{...sample,text:'blue '});assert.equal(d.readPrompt().sectionProfiles.appearance.text,'blue ');
 d.setSectionProfile('appearance',{...sample,text:''});assert.equal(d.readPrompt().sectionProfiles.appearance.text,'');
 d.restore(saved);d.reuse(d.readPrompt(),{});assert.equal(d.positive(),'white dress, summer hat');
 d.setSectionProfile('appearance',{...sample,enabled:false});assert.equal(d.positive(),'white dress');
 d.setSectionProfile('appearance',null);assert.deepEqual(d.readPrompt().sectionProfiles,{});d.dispose();
});

test('built-in samples preserve saved entries and deletion survives reload',()=>{
 const values=new Map();const storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
 let library=createSectionProfileLibrary(storage);
 assert.equal(library.list().filter(p=>p.field==='character').length,14);
 for(const field of ['appearance','situation'])assert.equal(library.list().filter(p=>p.field===field).length,5);
 const compositions=library.list().filter(p=>p.field==='composition');assert.equal(compositions.length,6);
 assert.deepEqual(compositions.find(p=>p.name==='立ち姿・ダイナミック構図'),{
  id:'sample-v1:composition:6',field:'composition',name:'立ち姿・ダイナミック構図',
  text:'full body, standing, contrapposto, three-quarter view, from below, dynamic angle, foreshortening',enabled:true,contentRating:'general'
 });
 assert.deepEqual(library.list().filter(p=>p.field==='character').slice(-9).map(({name,text})=>({name,text})),[
  {name:'初音ミク',text:'1girl, solo, hatsune_miku, vocaloid, aqua hair, twintails, aqua eyes'},
  {name:'セイバー（Fate）',text:'1girl, solo, saber_(fate), fate_(series), blonde hair, green eyes'},
  {name:'綾波レイ',text:'1girl, solo, ayanami_rei, neon_genesis_evangelion, short blue hair, red eyes'},
  {name:'レム（Re:ゼロ）',text:'1girl, solo, rem_(re:zero), re:zero_kara_hajimeru_isekai_seikatsu, blue hair, blue eyes'},
  {name:'ヨル・ブライア',text:'1girl, solo, yor_briar, spy_x_family, black hair, red eyes'},
  {name:'フリーレン',text:'1girl, solo, frieren, sousou_no_frieren, white hair, green eyes, elf ears'},
  {name:'雷電将軍',text:'1girl, solo, raiden_shogun, genshin_impact, long purple hair, purple eyes, hair ornament'},
  {name:'猫猫（薬屋のひとりごと）',text:'1girl, solo, maomao_(kusuriya_no_hitorigoto), kusuriya_no_hitorigoto, green hair, hair ornament'},
  {name:'今汐（鳴潮）',text:'1girl, solo, jinhsi_(wuthering_waves), wuthering_waves, white hair, yellow eyes, dragon horns'}
 ]);
 const saved=library.save('character',{name:'My character',text:'solo'});
 const sample=library.list().find(p=>p.id.startsWith('sample-v1:'));library.remove(sample.id);
 library=createSectionProfileLibrary(storage);assert.equal(library.list().some(p=>p.id===sample.id),false);
 assert.equal(library.list().find(p=>p.id===saved.id).text,'solo');assert.equal(library.list().length,30);
});
