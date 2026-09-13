import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {once} from 'node:events';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createSectionProfileService,registerSectionProfileRoutes} from '../src/section-profiles.js';
import {createMcpServer} from '../src/mcp/tools.js';
import {createLocalImageChatClient} from '../src/mcp/local-image-chat-client.js';
import {createSharedSectionProfileLibrary} from '../public/core/section-profile-library.js';

test('MCP CRUD shares server catalog with Studio, migrates once, preserves active snapshots and rejects invalid fields',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lic-mcp-profiles-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const service=createSectionProfileService(dir);
 const app=express();app.use(express.json());const router=express.Router();
 registerSectionProfileRoutes(router,{service,wrap:fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next)});
 app.use('/api/v1',router);app.use((error,req,res,next)=>res.status(error.statusCode||500).json({error:{code:error.apiCode||'INTERNAL_ERROR',message:error.message}}));
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
 const origin=`http://127.0.0.1:${server.address().port}`;
 const api=createLocalImageChatClient({baseUrl:origin});
 const mcp=createMcpServer({client:api});const host=new Client({name:'test',version:'1.0.0'});
 const [a,b]=InMemoryTransport.createLinkedPair();await Promise.all([mcp.connect(a),host.connect(b)]);t.after(async()=>{await host.close();await mcp.close();});
 const call=async(name,args={})=>{const r=await host.callTool({name,arguments:args});assert.notEqual(r.isError,true,JSON.stringify(r));return r.structuredContent;};
 const builtins=(await call('list_section_profiles')).profiles;assert.equal(builtins.length,30);
 assert.equal(builtins.find(profile=>profile.id==='sample-v1:composition:6')?.name,'立ち姿・ダイナミック構図');
 const created=(await call('create_section_profile',{field:'situation',name:'Garden',text:'garden, daylight'})).profile;assert.equal(created.contentRating,'general');
 const adult=(await call('create_section_profile',{field:'appearance',name:'Adult',text:'adult theme',contentRating:'nsfw'})).profile;assert.equal(adult.contentRating,'nsfw');
 const snapshot=structuredClone(created);
 const values=new Map([['localImageChat.sectionProfiles.v1',JSON.stringify([{id:'legacy',field:'appearance',name:'Old',text:'white dress'}])]]);
 const shared=createSharedSectionProfileLibrary({storage:{getItem:k=>values.get(k)},transport:{fetch:(url,opts)=>fetch(origin+url,opts)}});
 await shared.initialize();assert.ok(shared.list().some(p=>p.id===created.id),JSON.stringify({created,ids:shared.list().map(p=>p.id)}));
 await call('update_section_profile',{id:created.id,field:'situation',name:'Garden updated',text:'garden, evening'});
 await shared.refresh();assert.equal(shared.list().find(p=>p.id===created.id).text,'garden, evening');assert.equal(snapshot.text,'garden, daylight');
 await call('update_section_profile',{id:'legacy',field:'appearance',name:'Updated',text:'blue dress'});
 await shared.initialize();assert.equal(shared.list().find(p=>p.id==='legacy').text,'blue dress');
 await call('delete_section_profile',{id:'legacy'});await shared.initialize();assert.equal(shared.list().some(p=>p.id==='legacy'),false);
 const ui=await shared.save('character',{name:'UI character',text:'solo',contentRating:'nsfw'});assert.equal(ui.contentRating,'nsfw');
 assert.ok((await call('list_section_profiles')).profiles.some(p=>p.id===ui.id));
 await shared.remove(ui.id);assert.equal((await call('list_section_profiles')).profiles.some(p=>p.id===ui.id),false);
 const invalid=await fetch(origin+'/api/v1/section-profiles',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({field:'bad',name:'x',text:'y'})});assert.equal(invalid.status,400);
 const invalidRating=await fetch(origin+'/api/v1/section-profiles',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({field:'character',name:'x',text:'y',contentRating:'unknown'})});assert.equal(invalidRating.status,400);
 const fresh=createSectionProfileService(dir);assert.ok((await fresh.list()).profiles.some(p=>p.id===created.id));
});

test('stale catalog refresh cannot replace a newer write',async()=>{
 let resolve;let read=0;
 const library=createSharedSectionProfileLibrary({storage:{getItem:()=>null},transport:{fetch:async(url,opts)=>{
  if(opts.method==='GET'){read++;return await new Promise(r=>resolve=r);}
  return {ok:true,json:async()=>({profile:{id:'new',name:'New',field:'character',text:'solo'}})};
 }}});
 const pending=library.refresh();await Promise.resolve();await library.save('character',{name:'New',text:'solo'});
 resolve({ok:true,json:async()=>({profiles:[]})});await pending;
 assert.equal(library.list()[0].id,'new');
});
test('shared save deduplicates a profile already returned by an overlapping refresh',async()=>{
 let resolveGet,resolvePost;
 const profile={id:'new',name:'New',field:'character',text:'solo',contentRating:'nsfw'};
 const library=createSharedSectionProfileLibrary({storage:{getItem:()=>null},transport:{fetch:async(url,opts)=>{
  if(opts.method==='GET')return await new Promise(resolve=>{resolveGet=resolve;});
  return await new Promise(resolve=>{resolvePost=resolve;});
 }}});
 const saving=library.save('character',{name:'New',text:'solo',contentRating:'nsfw'});await Promise.resolve();
 const refreshing=library.refresh();await Promise.resolve();resolveGet({ok:true,json:async()=>({profiles:[profile]})});await refreshing;
 resolvePost({ok:true,json:async()=>({profile})});await saving;
 assert.deepEqual(library.list().map(item=>item.id),['new']);
});
